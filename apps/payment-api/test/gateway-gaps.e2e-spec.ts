import {
  CANCEL,
  createApp,
  createStore,
  Harness,
  MINUTE,
  unmatchedOf,
} from './support/fixtures';

/**
 * Gaps found in the review of the PG flow: a refund sent twice, late money nobody is told about, payments that
 * never close, debt instalments. Same fake gateway and fake clock as `gateway-flow.e2e-spec.ts`.
 */
describe('PG flow: review gaps', () => {
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

  const sync = async (s: ReturnType<typeof createStore>, id: string) =>
    (await s.post(`/payments/${id}/sync`).expect(200)).body;
  const cancel = (s: ReturnType<typeof createStore>, id: string) =>
    s.post(`/payments/${id}/cancel`, { actorRef: 'cashier-1' });
  const refundKeys = (id: string) =>
    Object.keys(h.pg.bills.get(id)!.refunds).sort();
  const tickLater = async (ms = 3 * MINUTE) => {
    h.clock.advance(ms);
    await h.reconcile.tick();
  };

  it('D9 a second payment arrives while a refund is pending: the refund keeps its one key at the PG, tick after tick', async () => {
    const s = createStore(h.app);
    const p = await s.qr();
    h.pg.pay(p.id);
    expect((await sync(s, p.id)).status).toBe('paid');
    h.pg.refundMode = 'pending';
    await s.post(`/payments/${p.id}/refund`, CANCEL).expect(200);
    const [refundKey] = refundKeys(p.id);

    // The payer pays the same QR again; the PG reports it.
    h.pg.pay(p.id, undefined, { force: true });
    await tickLater();
    await tickLater();
    await tickLater();
    const [receipt] = await unmatchedOf(h.sql, p.id);
    expect(receipt).toMatchObject({ kind: 'duplicate' });
    // One refund for the payment (its first key) and one for the second receipt. Nothing else.
    expect(refundKeys(p.id)).toEqual([refundKey, receipt.id].sort());
    const [{ refund_key: stored }] = await h.sql<{ refund_key: string }[]>`
      select refund_key from payment.payments where id = ${p.id}`;
    expect(stored).toBe(refundKey);

    h.pg.finishRefund(refundKey, 'succeeded');
    h.pg.finishRefund(receipt.id, 'succeeded');
    await tickLater();
    expect((await s.read(p.id)).status).toBe('refunded');
    expect(refundKeys(p.id)).toHaveLength(2);
  });

  it('D9 a refund asked again after a refusal gets a new key', async () => {
    const s = createStore(h.app);
    const p = await s.qr();
    h.pg.pay(p.id);
    await sync(s, p.id);
    h.pg.refundMode = 'refuse';
    await s.post(`/payments/${p.id}/refund`, CANCEL).expect(200);
    h.pg.refundMode = 'succeed';
    const again = await s.post(`/payments/${p.id}/refund`, CANCEL).expect(200);
    expect(again.body.status).toBe('refunded');
    expect(refundKeys(p.id)).toHaveLength(2);
  });

  it('D13 no webhook ever comes: money on a QR the cashier cancelled is found by the reconciliation and refunded once', async () => {
    const s = createStore(h.app);
    h.pg.canCancel = false;
    const p = await s.qr();
    expect((await cancel(s, p.id).expect(200)).body.status).toBe('cancelled');
    h.pg.pay(p.id); // the QR was still payable; nobody tells us
    await tickLater();
    expect((await s.read(p.id)).status).toBe('cancelled');
    expect(await unmatchedOf(h.sql, p.id)).toMatchObject([
      {
        kind: 'late_payment',
        refund_status: 'refunded',
        refund_actor: 'system',
      },
    ]);
    await tickLater();
    expect(h.pg.count('refund', p.id)).toBe(1);
  });

  it('M5 no webhook ever comes: money on an expired bill is found until the bill’s expiry plus the margin, and not looked for after', async () => {
    const s = createStore(h.app);
    h.settings.lateSweepMs = 30 * MINUTE;
    const early = await s.qr();
    const late = await s.qr();
    h.pg.expire(early.id);
    h.pg.expire(late.id);
    await tickLater(26 * MINUTE); // expiry (15) + grace (10)
    expect((await s.read(early.id)).status).toBe('expired');
    expect((await s.read(late.id)).status).toBe('expired');

    h.pg.pay(early.id);
    await tickLater(); // minute 29: inside expiry + margin (45)
    expect((await s.read(early.id)).status).toBe('expired');
    expect(await unmatchedOf(h.sql, early.id)).toMatchObject([
      { kind: 'late_payment', refund_status: 'refunded' },
    ]);

    await tickLater(30 * MINUTE); // minute 59: past the margin
    const asked = h.pg.count('getStatus', late.id);
    h.pg.pay(late.id);
    await tickLater();
    expect(h.pg.count('getStatus', late.id)).toBe(asked);
    expect(await unmatchedOf(h.sql, late.id)).toEqual([]);
  });

  it('M14 a pending bill the PG no longer knows is flagged at once and failed after a second lookup a minute later: the order is free again', async () => {
    const s = createStore(h.app);
    const p = await s.qr({ orderRef: 'INV-LOST' });
    h.pg.bills.delete(p.id);
    expect(await sync(s, p.id)).toMatchObject({
      status: 'pending',
      needsReview: true,
      reviewReason: 'missing_at_gateway',
    });
    await tickLater();
    expect(await s.read(p.id)).toMatchObject({
      status: 'failed',
      needsReview: true,
    });
    await s.charge({ orderRef: 'INV-LOST', attempt: 2 });
  });

  it('M14 a pending bill the PG loses sight of once and then finds again stays pending', async () => {
    const s = createStore(h.app);
    const p = await s.qr();
    h.pg.lookupsNotFound = 1;
    await sync(s, p.id);
    await tickLater(); // found again: the first "not found" no longer counts
    h.pg.lookupsNotFound = 1;
    await tickLater();
    expect((await s.read(p.id)).status).toBe('pending');
  });

  it('M18 a single-use QR paid in another amount: the payment is failed, the money is unmatched and refunded, and a new attempt works', async () => {
    const s = createStore(h.app);
    const p = await s.qr({ orderRef: 'INV-SHORT', amount: 10_000 });
    h.pg.pay(p.id, 9_000);
    expect(await sync(s, p.id)).toMatchObject({
      status: 'failed',
      needsReview: true,
      reviewReason: 'amount_mismatch',
    });
    expect(await unmatchedOf(h.sql, p.id)).toMatchObject([
      { kind: 'amount_mismatch', refund_status: 'refunded' },
    ]);
    await s.qr({ orderRef: 'INV-SHORT', attempt: 2, amount: 10_000 });
  });

  it('M18 a reusable QR paid in another amount waits for the right money while the bill lives, and is expired after expiry plus the grace', async () => {
    const s = createStore(h.app);
    h.pg.singleUseQr = false;
    const p = await s.qr({ amount: 10_000 });
    h.pg.pay(p.id, 9_000);
    expect((await sync(s, p.id)).status).toBe('pending');
    await tickLater(26 * MINUTE);
    expect(await s.read(p.id)).toMatchObject({
      status: 'expired',
      reviewReason: 'amount_mismatch',
    });
  });

  it('M19 the PG says paid but reports no receipt: the payment waits while the bill lives, is expired after expiry plus the grace, and no longer blocks the purge', async () => {
    const s = createStore(h.app);
    const p = await s.qr();
    h.pg.bills.get(p.id)!.status = 'paid';
    expect((await sync(s, p.id)).status).toBe('pending');
    await s.post('/internal/tenants/purge').expect(409);
    await tickLater(26 * MINUTE);
    expect(await s.read(p.id)).toMatchObject({
      status: 'expired',
      needsReview: true,
      reviewReason: 'paid_without_receipt',
    });
    await s.post('/internal/tenants/purge').expect(200, { purged: true });
  });

  it('D5 cancel when the PG says paid in another amount: the payment is cancelled, not left pending, and the money is unmatched', async () => {
    const s = createStore(h.app);
    const p = await s.qr({ amount: 10_000 });
    h.pg.pay(p.id, 9_000);
    expect((await cancel(s, p.id).expect(200)).body.status).toBe('cancelled');
    expect(await unmatchedOf(h.sql, p.id)).toMatchObject([
      { kind: 'amount_mismatch' },
    ]);
  });

  it('D5 cancel when the PG says paid but the receipt has not arrived: cancelled and flagged for review; the receipt, when it comes, is late money refunded once', async () => {
    const s = createStore(h.app);
    const p = await s.qr();
    h.pg.bills.get(p.id)!.status = 'paid';
    expect((await cancel(s, p.id).expect(200)).body).toMatchObject({
      status: 'cancelled',
      needsReview: true,
      reviewReason: 'paid_without_receipt',
    });
    const review = await s.get('/payments?needsReview=true').expect(200);
    expect(review.body.items.map((i: { id: string }) => i.id)).toEqual([p.id]);

    h.pg.pay(p.id);
    await tickLater();
    expect((await s.read(p.id)).status).toBe('cancelled');
    expect(await unmatchedOf(h.sql, p.id)).toMatchObject([
      { kind: 'late_payment', refund_status: 'refunded' },
    ]);
    expect(h.pg.count('refund', p.id)).toBe(1);

    // An ordinary cancel is not flagged.
    const plain = await s.qr();
    expect((await cancel(s, plain.id).expect(200)).body.needsReview).toBe(
      false,
    );
  });

  it('D5 the PG takes the cancel but leaves the bill open: cancelled anyway when configured (later money is refunded), 503 and still pending when not', async () => {
    const s = createStore(h.app);
    h.pg.cancelIgnored = true;
    h.settings.cancelWithoutGatewayClose = false;
    const p = await s.qr();
    const res = await cancel(s, p.id).expect(503);
    expect(res.body.code).toBe('gateway_unavailable');
    expect((await s.read(p.id)).status).toBe('pending');

    h.settings.cancelWithoutGatewayClose = true;
    expect((await cancel(s, p.id).expect(200)).body.status).toBe('cancelled');
    h.pg.pay(p.id);
    await tickLater();
    expect(await unmatchedOf(h.sql, p.id)).toMatchObject([
      { kind: 'late_payment', refund_status: 'refunded' },
    ]);
  });

  it('M8 a PG receipt that is not a whole rupiah amount never pays and is never refunded by the system: the payment is flagged for a person', async () => {
    const s = createStore(h.app);
    const p = await s.qr({ amount: 10_000 });
    h.pg.pay(p.id, 10_000.5);
    expect(await sync(s, p.id)).toMatchObject({
      status: 'pending',
      needsReview: true,
      reviewReason: 'invalid_gateway_amount',
    });
    expect(await unmatchedOf(h.sql, p.id)).toEqual([]);
    expect(h.pg.count('refund', p.id)).toBe(0);
  });

  it('kasbon instalments: each instalment is its own order reference (<receivable>:<n>), so two are both paid; the same instalment is not charged twice', async () => {
    const s = createStore(h.app);
    const first = await s.charge({ orderRef: 'RCV-77:1', amount: 50_000 });
    const second = await s.charge({ orderRef: 'RCV-77:2', amount: 30_000 });
    expect([first.status, second.status]).toEqual(['paid', 'paid']);
    const again = await s
      .chargeRaw({ orderRef: 'RCV-77:2', attempt: 2, amount: 30_000 })
      .expect(409);
    expect(again.body.code).toBe('order_has_live_payment');
    // A voided instalment can be paid again under the same reference.
    await s.post(`/payments/${second.id}/void`, CANCEL).expect(200);
    await s.charge({ orderRef: 'RCV-77:2', attempt: 2, amount: 30_000 });
  });
});
