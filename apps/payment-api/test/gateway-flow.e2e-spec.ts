import { randomUUID } from 'node:crypto';
import request from 'supertest';
import {
  auditOf,
  createApp,
  createStore,
  Harness,
  MINUTE,
  outboxOf,
  unmatchedOf,
} from './support/fixtures';

/**
 * The PG flow of the design doc "Payment-api: alur pembayaran PG dan kasus tepi", against the scriptable fake
 * gateway and a fake clock. Each test name carries the edge-case code it proves (D = double payment,
 * M = missing or late payment), so QA can match the doc to the test run.
 */
describe('PG flow and edge cases', () => {
  let h: Harness;
  let defaults: object;
  beforeAll(async () => {
    h = await createApp();
    defaults = { ...h.settings };
  });
  afterEach(() => {
    h.pg.reset();
    Object.assign(h.settings, defaults);
  });
  afterAll(() => h.close());

  const sync = (s: ReturnType<typeof createStore>, id: string) =>
    s.post(`/payments/${id}/sync`).expect(200);
  const statusMoves = async (id: string) =>
    (await auditOf(h.sql, id))
      .filter((e) => e.from_status !== e.to_status)
      .map((e) => e.to_status);
  const webhookRows = (reference: string) =>
    h.sql<{ state: string; attempts: number; tenant_id: string | null }[]>`
      select state, attempts, tenant_id from payment.webhook_events
      where reference = ${reference} order by created_at, id`;

  it('charges a QR: the row is created first, the bill carries our payment id, and the answer is pending with the QR', async () => {
    const s = createStore(h.app);
    const p = await s.qr({ amount: 30_000 });
    expect(p).toMatchObject({
      status: 'pending',
      kind: 'online',
      providerRef: `fake-${p.id}`,
      checkout: { qrString: `QR:${p.id}` },
      capabilities: { supportsVoid: false, supportsRefund: true },
    });
    expect(h.pg.bills.get(p.id)?.amount).toBe(30_000);
    expect(await statusMoves(p.id)).toEqual(['created', 'pending']);
    expect(await outboxOf(h.sql, p.id)).toEqual(['payment.pending']);
  });

  it('D3 the PG created the bill but its answer was lost: the bill is found by our reference and adopted, one bill', async () => {
    const s = createStore(h.app);
    h.pg.chargeScript = ['timeout_after_success'];
    const p = await s.qr();
    expect(p.checkout).toEqual({ qrString: `QR:${p.id}` });
    expect(h.pg.count('charge', p.id)).toBe(1);
    expect(h.pg.count('getStatus', p.id)).toBe(1);
    expect([...h.pg.bills.keys()].filter((k) => k === p.id)).toHaveLength(1);

    // Variant: the request never arrived. The PG says "not found", so the bill is created again with the
    // same reference: still one bill.
    h.pg.chargeScript = ['timeout_before'];
    const q = await s.qr();
    expect(h.pg.count('charge', q.id)).toBe(2);
    expect(h.pg.bills.has(q.id)).toBe(true);
    expect(await statusMoves(q.id)).toEqual(['created', 'pending']);
  });

  it('D4 a second payment on the same QR is refused by a single-use QR; if the PG reports one anyway it is unmatched money, refunded once', async () => {
    const s = createStore(h.app);
    const p = await s.qr();
    h.pg.pay(p.id);
    expect(() => h.pg.pay(p.id)).toThrow(/already used/);
    await sync(s, p.id);

    h.pg.pay(p.id, undefined, { force: true });
    await h.deliver(p.id).expect(200);
    await h.deliver(p.id).expect(200);
    h.clock.advance(10_000);
    await sync(s, p.id);
    const after = await s.read(p.id);
    expect(after.status).toBe('paid');
    expect(after.unmatchedReceipts).toMatchObject([
      { kind: 'duplicate', refundStatus: 'refunded', refundActor: 'system' },
    ]);
    expect(h.pg.count('refund', p.id)).toBe(1);
    expect(
      (await outboxOf(h.sql, p.id)).filter((t) => t === 'payment.paid'),
    ).toHaveLength(1);
  });

  it('D5 cancel while pending: the PG closes the bill → cancelled and cash is allowed; already paid → refused and the sale is paid by QR; PG down → still pending, cash blocked', async () => {
    const s = createStore(h.app);
    // Closed in time.
    const a = await s.qr({ orderRef: 'INV-D5a' });
    const cancelled = await s
      .post(`/payments/${a.id}/cancel`, { actorRef: 'cashier-1' })
      .expect(200);
    expect(cancelled.body.status).toBe('cancelled');
    const cash = await s.charge({ orderRef: 'INV-D5a', attempt: 2 });
    expect(cash.status).toBe('paid');
    // A repeated cancel answers the cancelled payment.
    await s
      .post(`/payments/${a.id}/cancel`, { actorRef: 'cashier-1' })
      .expect(200);

    // The payer paid a moment before the cashier pressed cancel.
    const b = await s.qr({ orderRef: 'INV-D5b' });
    h.pg.pay(b.id);
    const refused = await s
      .post(`/payments/${b.id}/cancel`, { actorRef: 'cashier-1' })
      .expect(409);
    expect(refused.body.code).toBe('already_paid');
    expect((await s.read(b.id)).status).toBe('paid');
    const blocked = await s
      .chargeRaw({ orderRef: 'INV-D5b', attempt: 2 })
      .expect(409);
    expect(blocked.body.code).toBe('order_has_live_payment');

    // The PG cannot be reached: nothing is assumed.
    const c = await s.qr({ orderRef: 'INV-D5c' });
    h.pg.cancelsDown = 1;
    await s
      .post(`/payments/${c.id}/cancel`, { actorRef: 'cashier-1' })
      .expect(503);
    expect((await s.read(c.id)).status).toBe('pending');
    await s.chargeRaw({ orderRef: 'INV-D5c', attempt: 2 }).expect(409);
  });

  it('D6 a new QR for the same order is refused while the old one waits, allowed once it is closed; money on the old QR is refunded and never pays the new one', async () => {
    const s = createStore(h.app);
    const old = await s.qr({ orderRef: 'INV-D6' });
    const early = await s
      .chargeRaw({ orderRef: 'INV-D6', attempt: 2, method: 'fake_qris' })
      .expect(409);
    expect(early.body.code).toBe('order_has_live_payment');

    await s
      .post(`/payments/${old.id}/cancel`, { actorRef: 'cashier-1' })
      .expect(200);
    const fresh = await s.qr({ orderRef: 'INV-D6', attempt: 2 });
    expect(fresh.id).not.toBe(old.id);
    expect(fresh.checkout).not.toEqual(old.checkout);

    // The PG takes money on the closed QR anyway.
    h.pg.bills
      .get(old.id)!
      .receipts.push({ id: 'late-1', net: 25_000, fee: 0 });
    await h.deliver(old.id).expect(200);
    expect(await s.read(old.id)).toMatchObject({
      status: 'cancelled',
      unmatchedReceipts: [{ kind: 'late_payment', refundStatus: 'refunded' }],
    });
    expect((await s.read(fresh.id)).status).toBe('pending');
    expect((await s.read(fresh.id)).unmatchedReceipts).toEqual([]);
  });

  it('D7 webhook twice + manual check + reconciliation at the same instant: one transition, one audit row, one paid notice', async () => {
    const s = createStore(h.app);
    const p = await s.qr();
    h.clock.advance(3 * MINUTE); // old enough for the reconciliation to pick it up
    h.pg.pay(p.id);
    h.pg.delayMs = 30; // every lookup overlaps the others
    const hook = h.pg.webhook(p.id);
    const post = () =>
      request(h.app.getHttpServer())
        .post('/webhooks/fake')
        .set('Content-Type', 'application/json')
        .set('X-Fake-Signature', hook.signature)
        .send(hook.body);
    const results = await Promise.all([
      post(),
      post(),
      h.deliver(p.id),
      s.post(`/payments/${p.id}/sync`),
      s.post(`/payments/${p.id}/sync`),
      h.reconcile.tick(),
    ]);
    for (const r of results.slice(0, 5))
      expect((r as request.Response).status).toBe(200);

    expect((await s.read(p.id)).status).toBe('paid');
    expect(await statusMoves(p.id)).toEqual(['created', 'pending', 'paid']);
    expect(await outboxOf(h.sql, p.id)).toEqual([
      'payment.pending',
      'payment.paid',
    ]);
    // The same event twice is stored once.
    expect(await webhookRows(p.id)).toHaveLength(2);
  });

  it('D10 the same pending sale sent again returns the same payment and the same QR; no second bill', async () => {
    const s = createStore(h.app);
    const body = {
      orderRef: 'INV-D10',
      attempt: 1,
      method: 'fake_qris',
      amount: 18_000,
      actorRef: 'cashier-1',
    };
    const first = await s.post('/payments', body, 'INV-D10:1').expect(201);
    const again = await s.post('/payments', body, 'INV-D10:1').expect(200);
    expect(again.body.id).toBe(first.body.id);
    expect(again.body.checkout).toEqual(first.body.checkout);
    expect(again.body.status).toBe('pending');
    expect(h.pg.count('charge', first.body.id)).toBe(1);
  });

  it('D11 late money on an expired bill and a second payment on a paid one are both recorded outside the live-payment index: settle never fails, each is refunded once', async () => {
    const s = createStore(h.app);
    // C: attempt 1, expired. A: attempt 2, paid. Same order, so A holds the order's one live slot.
    const c = await s.qr({ orderRef: 'INV-D11' });
    h.pg.expire(c.id);
    h.clock.advance(26 * MINUTE); // past expiry (15) + grace (10)
    await sync(s, c.id);
    expect((await s.read(c.id)).status).toBe('expired');
    const a = await s.qr({ orderRef: 'INV-D11', attempt: 2 });
    h.pg.pay(a.id);
    await sync(s, a.id);

    // Money arrives on C, and a second time on A.
    h.pg.bills.get(c.id)!.receipts.push({ id: 'late-c', net: 25_000, fee: 0 });
    h.pg.pay(a.id, undefined, { force: true });
    await h.deliver(c.id).expect(200);
    await h.deliver(a.id).expect(200);
    // Again, by every path: nothing fails and nothing is refunded twice.
    h.clock.advance(3 * MINUTE);
    await h.reconcile.tick();
    await sync(s, c.id);
    await sync(s, a.id);

    expect((await s.read(c.id)).status).toBe('expired');
    expect((await s.read(a.id)).status).toBe('paid');
    expect(await unmatchedOf(h.sql, c.id)).toMatchObject([
      { kind: 'late_payment', refund_status: 'refunded', needs_review: false },
    ]);
    expect(await unmatchedOf(h.sql, a.id)).toMatchObject([
      { kind: 'duplicate', refund_status: 'refunded', needs_review: false },
    ]);
    expect(Object.keys(h.pg.bills.get(c.id)!.refunds)).toHaveLength(1);
    expect(Object.keys(h.pg.bills.get(a.id)!.refunds)).toHaveLength(1);
    const [events] = await h.sql<{ n: number }[]>`
      select count(*)::int as n from payment.webhook_events
      where reference in (${c.id}, ${a.id}) and state <> 'processed'`;
    expect(events.n).toBe(0);
  });

  it('D12 a QR lives 15 minutes; a new attempt needs a new number and gets a new bill, the old key still answers the old payment; nobody pressing → expired only after the grace', async () => {
    const s = createStore(h.app);
    const body = {
      orderRef: 'INV-D12',
      attempt: 1,
      method: 'fake_qris',
      amount: 12_000,
      actorRef: 'cashier-1',
    };
    const old = (await s.post('/payments', body, 'INV-D12:1').expect(201)).body;
    expect(
      new Date(old.expiresAt).getTime() - new Date(old.createdAt).getTime(),
    ).toBe(15 * MINUTE);

    // Nobody presses anything. The PG expires the QR; we wait out the grace for a payment on its way.
    h.clock.advance(16 * MINUTE);
    h.pg.expire(old.id);
    await h.reconcile.tick();
    expect((await s.read(old.id)).status).toBe('pending');
    h.clock.advance(8 * MINUTE); // 24 min: still inside expiry + 10 min grace
    await h.reconcile.tick();
    expect((await s.read(old.id)).status).toBe('pending');
    h.clock.advance(2 * MINUTE); // 26 min
    await h.reconcile.tick();
    expect((await s.read(old.id)).status).toBe('expired');

    // The old key keeps answering the old, expired payment.
    const replay = await s.post('/payments', body, 'INV-D12:1').expect(200);
    expect(replay.body).toMatchObject({ id: old.id, status: 'expired' });
    // The new attempt: new number, new reference at the PG, new QR.
    const next = await s.qr({ ...body, attempt: 2 });
    expect(next.id).not.toBe(old.id);
    expect(next.checkout.qrString).not.toBe(old.checkout.qrString);
    expect(h.pg.bills.has(next.id)).toBe(true);

    // The cashier does not have to wait for the grace: a cancel at any minute frees the order at once.
    const quick = await s.qr({ orderRef: 'INV-D12b' });
    h.clock.advance(4 * MINUTE);
    await s
      .post(`/payments/${quick.id}/cancel`, { actorRef: 'cashier-1' })
      .expect(200);
    await s.qr({ orderRef: 'INV-D12b', attempt: 2 });
    // Money on the old QR after that is unmatched and refunded once.
    h.pg.bills
      .get(quick.id)!
      .receipts.push({ id: 'late-q', net: 25_000, fee: 0 });
    await h.deliver(quick.id).expect(200);
    await h.deliver(quick.id).expect(200);
    expect(await unmatchedOf(h.sql, quick.id)).toMatchObject([
      { kind: 'late_payment', refund_status: 'refunded' },
    ]);
    expect(h.pg.count('refund', quick.id)).toBe(1);
  });

  it('D13 the PG cannot close a QR: the cashier may still cancel and take cash; the QR stays payable, and money on it is refunded once', async () => {
    const s = createStore(h.app);
    h.pg.canCancel = false;
    const p = await s.qr({ orderRef: 'INV-D13' });
    expect(p.capabilities.canCancel).toBe(false);
    const res = await s
      .post(`/payments/${p.id}/cancel`, { actorRef: 'cashier-1' })
      .expect(200);
    // The screen can say until when the QR stays valid.
    expect(res.body).toMatchObject({
      status: 'cancelled',
      expiresAt: p.expiresAt,
    });
    expect(h.pg.count('cancel', p.id)).toBe(0);
    expect(h.pg.bills.get(p.id)?.status).toBe('pending');
    const cash = await s.charge({ orderRef: 'INV-D13', attempt: 2 });
    expect(cash.status).toBe('paid');

    // The customer pays the QR after all.
    h.pg.pay(p.id);
    await h.deliver(p.id).expect(200);
    h.clock.advance(3 * MINUTE);
    await h.reconcile.tick();
    expect(await s.read(p.id)).toMatchObject({
      status: 'cancelled',
      unmatchedReceipts: [
        {
          kind: 'late_payment',
          refundStatus: 'refunded',
          refundActor: 'system',
        },
      ],
    });
    expect(h.pg.count('refund', p.id)).toBe(1);
    // Counted once: the order has exactly one paid payment, the cash one.
    const paid = await s
      .get('/payments?orderRef=INV-D13&status=paid')
      .expect(200);
    expect(paid.body.items.map((i: { id: string }) => i.id)).toEqual([cash.id]);

    // A payer who already paid cannot be cancelled away, closable QR or not.
    const q = await s.qr();
    h.pg.pay(q.id);
    const refused = await s
      .post(`/payments/${q.id}/cancel`, { actorRef: 'cashier-1' })
      .expect(409);
    expect(refused.body.code).toBe('already_paid');

    // The switch turned off: cancel is refused and names when the QR stops being payable.
    h.settings.cancelWithoutGatewayClose = false;
    const r = await s.qr();
    const off = await s
      .post(`/payments/${r.id}/cancel`, { actorRef: 'cashier-1' })
      .expect(409);
    expect(off.body).toMatchObject({
      code: 'cancel_not_supported',
      meta: { expiresAt: r.expiresAt },
    });
    expect((await s.read(r.id)).status).toBe('pending');
  });

  it('M1 no webhook ever comes: a manual check records the payment at once, the reconciliation within 3 minutes', async () => {
    const s = createStore(h.app);
    const a = await s.qr();
    const b = await s.qr();
    h.pg.pay(a.id);
    h.pg.pay(b.id);
    // Manual check ("Cek status pembayaran").
    expect((await sync(s, a.id)).body.status).toBe('paid');
    // Nobody presses anything for b.
    h.clock.advance(1 * MINUTE);
    await h.reconcile.tick();
    expect((await s.read(b.id)).status).toBe('pending'); // younger than the 2-minute threshold
    h.clock.advance(2 * MINUTE); // 3 minutes after it was paid
    await h.reconcile.tick();
    expect((await s.read(b.id)).status).toBe('paid');
    expect((await auditOf(h.sql, b.id)).pop()?.source).toBe('reconciliation');
  });

  it('M1 polling: the PG is asked at most once per 5 seconds per payment; in between the stored status and its check time are the answer', async () => {
    const s = createStore(h.app);
    const p = await s.qr();
    const first = (await sync(s, p.id)).body;
    h.pg.pay(p.id);
    for (let i = 0; i < 3; i++) {
      h.clock.advance(1000);
      const polled = (await sync(s, p.id)).body;
      expect(polled.status).toBe('pending');
      expect(polled.lastSyncedAt).toBe(first.lastSyncedAt);
    }
    expect(h.pg.count('getStatus', p.id)).toBe(1);
    h.clock.advance(2500);
    expect((await sync(s, p.id)).body.status).toBe('paid');
    expect(h.pg.count('getStatus', p.id)).toBe(2);
  });

  it('M2 the webhook arrives before the PG’s answer to the charge is stored: the created row is there, and goes straight to paid', async () => {
    const s = createStore(h.app);
    h.pg.onCharge = async (reference) => {
      h.pg.pay(reference);
      await h.deliver(reference).expect(200);
    };
    const res = await s.chargeRaw({ method: 'fake_qris' }).expect(201);
    expect(res.body.status).toBe('paid');
    expect(await statusMoves(res.body.id)).toEqual(['created', 'paid']);
    expect(h.pg.count('charge', res.body.id)).toBe(1);
    expect(await outboxOf(h.sql, res.body.id)).toEqual(['payment.paid']);
    expect(await webhookRows(res.body.id)).toMatchObject([
      { state: 'processed', tenant_id: s.tenantId },
    ]);
  });

  it('M3 payment-api was down while the PG sent its webhook and the PG gave up: the reconciliation finds the payment; the PG’s late retry is harmless', async () => {
    const s = createStore(h.app);
    const p = await s.qr();
    h.pg.pay(p.id);
    const lost = h.pg.webhook(p.id); // never delivered
    h.clock.advance(3 * MINUTE);
    await h.reconcile.tick();
    expect((await s.read(p.id)).status).toBe('paid');
    // The PG tries the same event once more, much later.
    await request(h.app.getHttpServer())
      .post('/webhooks/fake')
      .set('Content-Type', 'application/json')
      .set('X-Fake-Signature', lost.signature)
      .send(lost.body)
      .expect(200, { received: true, duplicate: false });
    expect(await statusMoves(p.id)).toEqual(['created', 'pending', 'paid']);
    expect(await outboxOf(h.sql, p.id)).toEqual([
      'payment.pending',
      'payment.paid',
    ]);
  });

  it('M4 the paid notice for the caller is written with the status change and stays undelivered in the outbox (the dispatcher is not built yet)', async () => {
    const s = createStore(h.app);
    const p = await s.qr({ orderRef: 'INV-M4', amount: 7_000 });
    h.pg.pay(p.id);
    await h.deliver(p.id).expect(200);
    const rows = await h.sql<
      {
        topic: string;
        payload: Record<string, unknown>;
        delivered_at: Date | null;
        tenant_id: string;
      }[]
    >`select topic, payload, delivered_at, tenant_id from payment.outbox
      where payment_id = ${p.id} and topic = 'payment.paid'`;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      tenant_id: s.tenantId,
      delivered_at: null,
      payload: {
        paymentId: p.id,
        orderRef: 'INV-M4',
        attempt: 1,
        amount: 7_000,
        status: 'paid',
      },
    });
    // Until a dispatcher exists the caller's own job finds it by order reference.
    const found = await s.get('/payments?orderRef=INV-M4').expect(200);
    expect(found.body.items[0]).toMatchObject({ id: p.id, status: 'paid' });
  });

  it('M5 paid after the bill expired, and after it was cancelled: the payment stays closed, the money is an unmatched receipt on the review list, refunded once by system', async () => {
    const s = createStore(h.app);
    const expired = await s.qr({ amount: 11_000 });
    h.pg.expire(expired.id);
    h.clock.advance(26 * MINUTE);
    await h.reconcile.tick();
    expect((await s.read(expired.id)).status).toBe('expired');
    const cancelled = await s.qr({ amount: 12_000 });
    await s
      .post(`/payments/${cancelled.id}/cancel`, { actorRef: 'cashier-1' })
      .expect(200);

    h.pg.refundMode = 'pending'; // the refund takes a while: the receipt stays on the review list meanwhile
    for (const p of [expired, cancelled]) {
      h.pg.bills.get(p.id)!.receipts.push({
        id: `late-${p.id}`,
        net: p.amount,
        fee: 0,
      });
      await h.deliver(p.id).expect(200);
      await h.deliver(p.id).expect(200);
    }
    expect((await s.read(expired.id)).status).toBe('expired');
    expect((await s.read(cancelled.id)).status).toBe('cancelled');
    const review = await s
      .get('/unmatched-receipts?needsReview=true')
      .expect(200);
    expect(review.body.total).toBe(2);
    expect(review.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          paymentId: expired.id,
          kind: 'late_payment',
          grossAmount: 11_000,
          refundStatus: 'pending',
          refundActor: 'system',
        }),
        expect.objectContaining({
          paymentId: cancelled.id,
          grossAmount: 12_000,
        }),
      ]),
    );
    // The caller is told (cashier banner, owner list).
    expect(await outboxOf(h.sql, expired.id)).toContain(
      'payment.unmatched_receipt',
    );

    // The PG pays the refunds out: off the review list, refunded exactly once each.
    for (const p of [expired, cancelled])
      for (const key of Object.keys(h.pg.bills.get(p.id)!.refunds))
        h.pg.finishRefund(key, 'succeeded');
    h.clock.advance(3 * MINUTE);
    await h.reconcile.tick();
    await h.reconcile.tick();
    expect(
      (await s.get('/unmatched-receipts?needsReview=true').expect(200)).body
        .total,
    ).toBe(0);
    expect(
      (await s.get('/unmatched-receipts').expect(200)).body.items.map(
        (i: { refundStatus: string }) => i.refundStatus,
      ),
    ).toEqual(['refunded', 'refunded']);
    expect(h.pg.count('refund', expired.id)).toBe(1);
    expect(h.pg.count('refund', cancelled.id)).toBe(1);
  });

  it('M5 with the automatic refund turned off: the late money waits on the review list and nothing is refunded', async () => {
    const s = createStore(h.app);
    h.settings.lateAutoRefund = false;
    const p = await s.qr();
    await s
      .post(`/payments/${p.id}/cancel`, { actorRef: 'cashier-1' })
      .expect(200);
    h.pg.bills.get(p.id)!.receipts.push({ id: 'late', net: 25_000, fee: 0 });
    await h.deliver(p.id).expect(200);
    expect(await unmatchedOf(h.sql, p.id)).toMatchObject([
      { needs_review: true, refund_status: 'none', refund_actor: null },
    ]);
    expect(h.pg.count('refund', p.id)).toBe(0);
  });

  it('M6 the cashier’s tablet is off: the payment is completed by the webhook alone, with no request from the caller', async () => {
    const s = createStore(h.app);
    const p = await s.qr();
    h.pg.pay(p.id);
    // Only the PG talks to us: no service key, no tenant header.
    await h.deliver(p.id).expect(200, { received: true, duplicate: false });
    const [row] = await h.sql<{ status: string; tenant_id: string }[]>`
      select status, tenant_id from payment.payments where id = ${p.id}`;
    expect(row).toEqual({ status: 'paid', tenant_id: s.tenantId });
    expect((await auditOf(h.sql, p.id)).pop()).toMatchObject({
      to_status: 'paid',
      source: 'webhook',
      actor_ref: 'system',
    });
    // When the cashier is back, the waiting list and the history read it by order.
    const list = await s.get(`/payments?orderRef=${p.orderRef}`).expect(200);
    expect(list.body.items[0].status).toBe('paid');
  });

  it('M7 news out of order: paid then expired stays paid; expired then paid stays expired with the money unmatched; paid twice is paid once', async () => {
    const s = createStore(h.app);
    // paid, expired
    const a = await s.qr();
    h.pg.pay(a.id);
    await h.deliver(a.id).expect(200);
    h.pg.bills.get(a.id)!.status = 'expired'; // stale or wrong news from the PG
    h.clock.advance(30 * MINUTE);
    await h.deliver(a.id).expect(200);
    await sync(s, a.id);
    expect((await s.read(a.id)).status).toBe('paid');

    // expired, paid, expired
    const b = await s.qr();
    h.pg.expire(b.id);
    h.clock.advance(26 * MINUTE);
    await h.deliver(b.id).expect(200);
    expect((await s.read(b.id)).status).toBe('expired');
    h.pg.bills.get(b.id)!.receipts.push({ id: 'late-b', net: 25_000, fee: 0 });
    h.pg.bills.get(b.id)!.status = 'paid';
    await h.deliver(b.id).expect(200);
    h.pg.bills.get(b.id)!.status = 'expired';
    await h.deliver(b.id).expect(200);
    expect(await s.read(b.id)).toMatchObject({
      status: 'expired',
      unmatchedReceipts: [{ kind: 'late_payment' }],
    });
    expect(await statusMoves(b.id)).toEqual(['created', 'pending', 'expired']);

    // paid, paid
    const c = await s.qr();
    h.pg.pay(c.id);
    await h.deliver(c.id).expect(200);
    await h.deliver(c.id).expect(200);
    expect(await statusMoves(c.id)).toEqual(['created', 'pending', 'paid']);
    expect((await s.read(c.id)).unmatchedReceipts).toEqual([]);
  });

  it.each([-1, 1])(
    'M8 the payer paid Rp%i off the bill: never marked paid; the money is unmatched (amount_mismatch) and refunded',
    async (delta) => {
      const s = createStore(h.app);
      const p = await s.qr({ amount: 20_000 });
      h.pg.pay(p.id, 20_000 + delta);
      await h.deliver(p.id).expect(200);
      await sync(s, p.id);
      const after = await s.read(p.id);
      expect(after.status).toBe('pending');
      expect(after.paidAt).toBeNull();
      expect(after.unmatchedReceipts).toMatchObject([
        {
          kind: 'amount_mismatch',
          grossAmount: 20_000 + delta,
          refundStatus: 'refunded',
          refundActor: 'system',
        },
      ]);
      expect(await outboxOf(h.sql, p.id)).not.toContain('payment.paid');
      expect(h.pg.count('refund', p.id)).toBe(1);
    },
  );

  it('M8 a decimal or text amount is refused at the boundary', async () => {
    const s = createStore(h.app);
    for (const amount of [20_000.5, '20000', '20.000']) {
      const res = await s
        .chargeRaw({ method: 'fake_qris', amount })
        .expect(422);
      expect(res.body.errors).toHaveProperty('amount');
    }
  });

  it('M9 a forged webhook: a wrong signature is 401 and stores nothing; a valid signature for an unpaid bill marks nothing paid; a replayed old event is harmless', async () => {
    const s = createStore(h.app);
    const p = await s.qr();
    const body = JSON.stringify({ eventId: 'forged-1', reference: p.id });
    for (const signature of [undefined, '', 'deadbeef', 'x'.repeat(64)]) {
      const req = request(h.app.getHttpServer())
        .post('/webhooks/fake')
        .set('Content-Type', 'application/json');
      if (signature !== undefined) req.set('X-Fake-Signature', signature);
      const res = await req.send(body).expect(401);
      expect(res.body.code).toBe('invalid_signature');
    }
    // A signature over another body does not carry over.
    const other = h.pg.webhook(randomUUID());
    await request(h.app.getHttpServer())
      .post('/webhooks/fake')
      .set('Content-Type', 'application/json')
      .set('X-Fake-Signature', other.signature)
      .send(body)
      .expect(401);
    expect(await webhookRows(p.id)).toHaveLength(0);
    expect((await s.read(p.id)).status).toBe('pending');

    // Correctly signed, claiming a payment that the PG itself says is unpaid: the PG's answer is what counts.
    await h.deliver(p.id, 'evt-claims-paid').expect(200);
    expect((await s.read(p.id)).status).toBe('pending');

    // Paid for real; the old event replayed later changes nothing.
    h.pg.pay(p.id);
    await h.deliver(p.id).expect(200);
    await h
      .deliver(p.id, 'evt-claims-paid')
      .expect(200, { received: true, duplicate: true });
    expect(await statusMoves(p.id)).toEqual(['created', 'pending', 'paid']);
    // An unknown provider is not a door.
    await request(h.app.getHttpServer())
      .post('/webhooks/nobody')
      .send({})
      .expect(404);
  });

  it('M10 a webhook for a reference we do not know is stored, answered 200 and flagged; it is never dropped', async () => {
    const unknown = randomUUID();
    await h.deliver(unknown).expect(200);
    await h.deliver('not-even-a-uuid').expect(200);
    expect(await webhookRows(unknown)).toEqual([
      { state: 'unmatched', attempts: 0, tenant_id: null },
    ]);
    h.clock.advance(3 * MINUTE);
    await h.reconcile.tick();
    expect(await webhookRows(unknown)).toHaveLength(1);
    expect(await webhookRows('not-even-a-uuid')).toMatchObject([
      { state: 'unmatched' },
    ]);
  });

  it('M11 the PG is down when the cashier presses pay: the payment is failed at once and another method works immediately', async () => {
    const s = createStore(h.app);
    h.pg.chargeScript = ['unreachable'];
    const res = await s
      .chargeRaw({ orderRef: 'INV-M11', method: 'fake_qris' })
      .expect(201);
    expect(res.body.status).toBe('failed');
    expect(h.pg.bills.has(res.body.id)).toBe(false);
    expect(await outboxOf(h.sql, res.body.id)).toEqual(['payment.failed']);
    const cash = await s.charge({ orderRef: 'INV-M11', attempt: 2 });
    expect(cash.status).toBe('paid');
    // The PG says no: the same.
    h.pg.chargeScript = ['refuse'];
    const refused = await s.chargeRaw({ method: 'fake_qris' }).expect(201);
    expect(refused.body.status).toBe('failed');
  });

  it('M14 a charge that timed out is failed only after two "no such bill" answers a minute apart; money the PG reports later stays off the failed payment and is refunded once', async () => {
    const s = createStore(h.app);
    // The PG took the bill but answers "not found" for a while (it lags), and our retry times out too.
    h.pg.chargeScript = ['timeout_after_success', 'timeout_after_success'];
    h.pg.lookupsNotFound = 3;
    const res = await s.chargeRaw({ method: 'fake_qris' }).expect(201);
    const id = res.body.id as string;
    expect(res.body.status).toBe('created'); // one lookup said "not found": that proves nothing

    h.clock.advance(30_000);
    expect((await sync(s, id)).body.status).toBe('created'); // second "not found", only 30 s later
    h.clock.advance(31_000);
    expect((await sync(s, id)).body.status).toBe('failed'); // a minute after the first: now it is failed
    expect((await auditOf(h.sql, id)).pop()).toMatchObject({
      to_status: 'failed',
      note: 'no bill at the gateway on two lookups',
    });

    // The PG catches up and the payer pays that bill.
    h.pg.pay(id);
    await h.deliver(id).expect(200);
    h.clock.advance(3 * MINUTE);
    await h.reconcile.tick();
    await h.deliver(id).expect(200);
    const after = await s.read(id);
    expect(after.status).toBe('failed');
    expect(after.unmatchedReceipts).toMatchObject([
      { kind: 'late_payment', refundStatus: 'refunded', refundActor: 'system' },
    ]);
    expect(h.pg.count('refund', id)).toBe(1);
    expect(await statusMoves(id)).toEqual(['created', 'failed']);
  });

  it('M14 a bill the PG first cannot find and then finds is adopted, not failed', async () => {
    const s = createStore(h.app);
    h.pg.chargeScript = ['timeout_after_success', 'timeout_after_success'];
    h.pg.lookupsNotFound = 1;
    const res = await s.chargeRaw({ method: 'fake_qris' }).expect(201);
    expect(res.body.status).toBe('created');
    h.clock.advance(3 * MINUTE);
    await h.reconcile.tick();
    expect(await s.read(res.body.id)).toMatchObject({
      status: 'pending',
      checkout: { qrString: `QR:${res.body.id}` },
    });
  });

  it('M18 the PG reports net of its fee: the adapter’s gross equals the bill, so it is paid and the fee is kept apart; a gross off by Rp1 is a mismatch', async () => {
    const s = createStore(h.app);
    h.pg.fee = 700;
    const p = await s.qr({ amount: 10_000 });
    h.pg.pay(p.id); // the PG stores net 9.300 + fee 700
    expect(h.pg.bills.get(p.id)!.receipts[0]).toMatchObject({
      net: 9_300,
      fee: 700,
    });
    const paid = (await sync(s, p.id)).body;
    expect(paid).toMatchObject({
      status: 'paid',
      amount: 10_000,
      feeAmount: 700,
      unmatchedReceipts: [],
    });

    const q = await s.qr({ amount: 10_000 });
    h.pg.pay(q.id, 10_001);
    const off = (await sync(s, q.id)).body;
    expect(off.status).toBe('pending');
    expect(off.unmatchedReceipts).toMatchObject([
      { kind: 'amount_mismatch', grossAmount: 10_001 },
    ]);
  });

  it('M20 an event that always fails is parked after the configured attempts; other events are still processed and the reconciliation settles the payment', async () => {
    const s = createStore(h.app);
    h.settings.webhookMaxAttempts = 3;
    const p = await s.qr();
    h.pg.pay(p.id);
    h.pg.brokenLookups.add(p.id);
    await h.deliver(p.id, 'poison').expect(200); // stored, answered 200, processing failed
    expect(await webhookRows(p.id)).toMatchObject([
      { state: 'failed', attempts: 1 },
    ]);
    // Not retried before its delay has passed.
    await h.reconcile.tick();
    expect((await webhookRows(p.id))[0].attempts).toBe(1);
    h.clock.advance(31_000);
    await h.reconcile.tick();
    h.clock.advance(61_000);
    await h.reconcile.tick();
    expect(await webhookRows(p.id)).toMatchObject([
      { state: 'parked', attempts: 3 },
    ]);
    expect((await s.read(p.id)).status).toBe('pending');
    // Parked events are left alone…
    h.pg.brokenLookups.delete(p.id);
    h.clock.advance(60 * MINUTE);
    await h.reconcile.tick();
    // …and by then the reconciliation has settled the payment itself (the PG is back).
    expect((await s.read(p.id)).status).toBe('paid');
    expect((await webhookRows(p.id))[0]).toMatchObject({
      state: 'parked',
      attempts: 3,
    });
    // A later event for the same payment is processed normally.
    await h.deliver(p.id, 'healthy').expect(200);
    expect((await webhookRows(p.id)).map((e) => e.state)).toEqual([
      'parked',
      'processed',
    ]);
  });

  it('sync answers 503 without internals when the PG is down, and changes nothing', async () => {
    const s = createStore(h.app);
    const p = await s.qr();
    h.pg.lookupsDown = 1;
    const res = await s.post(`/payments/${p.id}/sync`).expect(503);
    expect(res.body).toEqual({
      message: 'Payment gateway unavailable',
      code: 'gateway_unavailable',
    });
    expect((await s.read(p.id)).status).toBe('pending');
  });
});
