import {
  auditOf,
  CANCEL,
  createApp,
  createStore,
  Harness,
  MINUTE,
  outboxOf,
  Store,
} from './support/fixtures';

describe('void (CASHAC) and refund (PG)', () => {
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

  /** A QR payment the payer has paid, confirmed by a manual check. */
  async function paidQr(s: Store) {
    const p = await s.qr();
    h.pg.pay(p.id);
    const synced = await s.post(`/payments/${p.id}/sync`).expect(200);
    expect(synced.body.status).toBe('paid');
    return p;
  }

  it.each(['cash', 'edc_debit', 'static_qris'])(
    'voids a %s payment with no outbound call and writes the audit row',
    async (method) => {
      const s = createStore(h.app);
      const p = await s.charge({ method });
      const fetchSpy = jest.spyOn(globalThis, 'fetch');
      const gatewayCalls = h.pg.calls.length;
      try {
        const res = await s
          .post(`/payments/${p.id}/void`, {
            reasonCode: 'wrong_item_or_qty',
            note: '  scanned twice  ',
            actorRef: 'cashier-3',
            approvedBy: 'supervisor-1',
          })
          .expect(200);
        expect(res.body.status).toBe('voided');
        expect(fetchSpy).not.toHaveBeenCalled();
        expect(h.pg.calls).toHaveLength(gatewayCalls);
      } finally {
        fetchSpy.mockRestore();
      }
      const audit = await auditOf(h.sql, p.id);
      expect(audit[audit.length - 1]).toEqual({
        from_status: 'paid',
        to_status: 'voided',
        source: 'void',
        actor_ref: 'cashier-3',
        approved_by: 'supervisor-1',
        reason_code: 'wrong_item_or_qty',
        note: 'scanned twice',
      });
      expect(await outboxOf(h.sql, p.id)).toEqual([
        'payment.paid',
        'payment.voided',
      ]);
    },
  );

  it('V1 void asked twice (and ten times at once): the second answers the first, one audit row, one notice', async () => {
    const s = createStore(h.app);
    const p = await s.charge();
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        s.post(`/payments/${p.id}/void`, CANCEL),
      ),
    );
    expect(results.map((r) => r.status)).toEqual(Array(10).fill(200));
    const first = await s.post(`/payments/${p.id}/void`, CANCEL).expect(200);
    const again = await s
      .post(`/payments/${p.id}/void`, {
        ...CANCEL,
        reasonCode: 'goods_returned',
      })
      .expect(200);
    expect(again.body).toEqual(first.body);
    const audit = await auditOf(h.sql, p.id);
    expect(audit.filter((e) => e.to_status === 'voided')).toHaveLength(1);
    expect(audit[2].reason_code).toBe('customer_cancelled');
    expect(
      (await outboxOf(h.sql, p.id)).filter((t) => t === 'payment.voided'),
    ).toHaveLength(1);
  });

  it('V2 cancelling a QR that is still pending closes the bill: no PIN, no void row, no refund', async () => {
    const s = createStore(h.app);
    const p = await s.qr();
    // Only the actor: no reason, no supervisor.
    const res = await s
      .post(`/payments/${p.id}/cancel`, { actorRef: 'cashier-3' })
      .expect(200);
    expect(res.body.status).toBe('cancelled');
    const audit = await auditOf(h.sql, p.id);
    expect(audit.map((e) => e.to_status)).toEqual([
      'created',
      'pending',
      'cancelled',
    ]);
    expect(audit[2]).toMatchObject({
      source: 'cancel',
      actor_ref: 'cashier-3',
      approved_by: null,
      reason_code: null,
    });
    expect(h.pg.count('refund', p.id)).toBe(0);
    expect(h.pg.bills.get(p.id)?.status).toBe('cancelled');
    // An explicit void or refund of a waiting payment is refused: it is neither.
    const q = await s.qr();
    const refund = await s.post(`/payments/${q.id}/refund`, CANCEL).expect(409);
    expect(refund.body.code).toBe('not_cancellable');
    const voided = await s.post(`/payments/${q.id}/void`, CANCEL).expect(409);
    expect(voided.body.code).toBe('void_not_supported');
    expect((await s.read(q.id)).status).toBe('pending');
  });

  it('V3 a refund the PG accepted but has not paid out is refund_pending; the later confirmation moves it once', async () => {
    const s = createStore(h.app);
    const p = await paidQr(s);
    h.pg.refundMode = 'pending';
    const res = await s.post(`/payments/${p.id}/refund`, CANCEL).expect(200);
    expect(res.body.status).toBe('refund_pending');
    const [key] = Object.keys(h.pg.bills.get(p.id)!.refunds);

    // Still on its way: nothing changes, whoever asks.
    h.clock.advance(3 * MINUTE);
    await h.reconcile.tick();
    expect((await s.read(p.id)).status).toBe('refund_pending');

    h.pg.finishRefund(key, 'succeeded');
    // The confirmation arrives by webhook and by the reconciliation: one move, one notice.
    await h.deliver(p.id).expect(200);
    await h.reconcile.tick();
    await h.deliver(p.id).expect(200);
    const after = await s.read(p.id);
    expect(after).toMatchObject({ status: 'refunded', needsReview: false });
    expect(await outboxOf(h.sql, p.id)).toEqual([
      'payment.pending',
      'payment.paid',
      'payment.refund_pending',
      'payment.refunded',
    ]);
    expect(h.pg.count('refund', p.id)).toBe(1);
  });

  it('V4 the PG refuses the refund: refund_failed + needs_review; the owner retries, or marks it returned by hand with a note', async () => {
    const s = createStore(h.app);
    const p = await paidQr(s);
    h.pg.refundMode = 'refuse';
    const refused = await s
      .post(`/payments/${p.id}/refund`, CANCEL)
      .expect(200);
    expect(refused.body).toMatchObject({
      status: 'refund_failed',
      needsReview: true,
      reviewReason: 'refund_failed',
    });
    const review = await s.get('/payments?needsReview=true').expect(200);
    expect(review.body.items.map((i: { id: string }) => i.id)).toEqual([p.id]);

    // Retry while the PG still refuses: a new refund at the PG, refused again.
    await s.post(`/payments/${p.id}/refund`, CANCEL).expect(200);
    expect((await s.read(p.id)).status).toBe('refund_failed');
    expect(h.pg.count('refund', p.id)).toBe(2);

    // Marked by hand: the note is required, and the supervisor too.
    for (const body of [
      { actorRef: 'owner-1', approvedBy: 'owner-1' },
      { note: '  ', actorRef: 'owner-1', approvedBy: 'owner-1' },
      { note: 'cash handed back', actorRef: 'owner-1' },
    ])
      await s.post(`/payments/${p.id}/refund/manual`, body).expect(422);
    h.settings.manualRefundMark = false;
    const off = await s
      .post(`/payments/${p.id}/refund/manual`, {
        note: 'cash handed back',
        actorRef: 'owner-1',
        approvedBy: 'owner-1',
      })
      .expect(409);
    expect(off.body.code).toBe('manual_refund_disabled');
    h.settings.manualRefundMark = true;
    const marked = await s
      .post(`/payments/${p.id}/refund/manual`, {
        note: 'cash handed back',
        actorRef: 'owner-1',
        approvedBy: 'owner-1',
      })
      .expect(200);
    expect(marked.body).toMatchObject({
      status: 'refunded',
      needsReview: false,
    });
    const audit = await auditOf(h.sql, p.id);
    expect(audit.map((e) => `${e.to_status}/${e.source}`).slice(-5)).toEqual([
      'refund_pending/refund',
      'refund_failed/refund',
      'refund_pending/refund',
      'refund_failed/refund',
      'refunded/manual_refund',
    ]);
    expect(audit[audit.length - 1]).toMatchObject({
      actor_ref: 'owner-1',
      approved_by: 'owner-1',
      note: 'cash handed back',
    });
    expect(
      (await s.get('/payments?needsReview=true').expect(200)).body.total,
    ).toBe(0);

    // A retry that the PG accepts also resolves it; a payment that is not refund_failed cannot be marked.
    const q = await paidQr(s);
    h.pg.refundMode = 'refuse';
    await s.post(`/payments/${q.id}/refund`, CANCEL).expect(200);
    h.pg.refundMode = 'succeed';
    const retried = await s
      .post(`/payments/${q.id}/refund`, CANCEL)
      .expect(200);
    expect(retried.body).toMatchObject({
      status: 'refunded',
      needsReview: false,
    });
    const notFailed = await s
      .post(`/payments/${q.id}/refund/manual`, {
        note: 'x',
        actorRef: 'o',
        approvedBy: 'o',
      })
      .expect(409);
    expect(notFailed.body.code).toBe('not_refund_failed');
  });

  it('V5 void on a PG payment and refund on CASHAC are refused with a clear message; nothing reaches the PG', async () => {
    const s = createStore(h.app);
    const cash = await s.charge({ method: 'cash' });
    const calls = h.pg.calls.length;
    const refund = await s
      .post(`/payments/${cash.id}/refund`, CANCEL)
      .expect(409);
    expect(refund.body).toEqual({
      message: 'This payment method cannot be refunded; void it instead',
      code: 'refund_not_supported',
    });
    expect((await s.read(cash.id)).status).toBe('paid');
    expect(await auditOf(h.sql, cash.id)).toHaveLength(2);
    expect(h.pg.calls).toHaveLength(calls);

    const qr = await paidQr(s);
    const before = h.pg.calls.length;
    const voided = await s.post(`/payments/${qr.id}/void`, CANCEL).expect(409);
    expect(voided.body).toEqual({
      message: 'This payment method cannot be voided; refund it instead',
      code: 'void_not_supported',
    });
    expect((await s.read(qr.id)).status).toBe('paid');
    expect(h.pg.calls).toHaveLength(before);

    // `cancel` picks by what the adapter declares.
    const c = await s.post(`/payments/${cash.id}/cancel`, CANCEL).expect(200);
    expect(c.body.status).toBe('voided');
    const r = await s.post(`/payments/${qr.id}/cancel`, CANCEL).expect(200);
    expect(r.body.status).toBe('refunded');
  });

  it('D9 refund asked twice (and five times at once): one refund at the PG, the second answers the first', async () => {
    const s = createStore(h.app);
    const p = await paidQr(s);
    h.pg.refundMode = 'pending';
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        s.post(`/payments/${p.id}/refund`, CANCEL),
      ),
    );
    expect(results.map((r) => r.status)).toEqual(Array(5).fill(200));
    expect(new Set(results.map((r) => r.body.status))).toEqual(
      new Set(['refund_pending']),
    );
    await s
      .post(`/payments/${p.id}/refund`, {
        ...CANCEL,
        reasonCode: 'other',
        note: 'again',
      })
      .expect(200);
    await s.post(`/payments/${p.id}/cancel`, CANCEL).expect(200);
    expect(Object.keys(h.pg.bills.get(p.id)!.refunds)).toHaveLength(1);
    const audit = await auditOf(h.sql, p.id);
    expect(audit.filter((e) => e.to_status === 'refund_pending')).toHaveLength(
      1,
    );

    // The PG took the refund but our call timed out: the reconciliation finds it, no second refund.
    const q = await paidQr(s);
    h.pg.refundMode = 'timeout_after_success';
    const lost = await s.post(`/payments/${q.id}/refund`, CANCEL).expect(200);
    expect(lost.body.status).toBe('refund_pending');
    h.pg.refundMode = 'succeed';
    h.clock.advance(3 * MINUTE);
    await h.reconcile.tick();
    expect((await s.read(q.id)).status).toBe('refunded');
    expect(Object.keys(h.pg.bills.get(q.id)!.refunds)).toHaveLength(1);

    // The PG was down when we asked: still refund_pending, and the reconciliation sends the refund.
    const d = await paidQr(s);
    h.pg.refundMode = 'down';
    await s.post(`/payments/${d.id}/refund`, CANCEL).expect(200);
    expect(Object.keys(h.pg.bills.get(d.id)!.refunds)).toHaveLength(0);
    h.pg.refundMode = 'succeed';
    h.clock.advance(3 * MINUTE);
    await h.reconcile.tick();
    expect((await s.read(d.id)).status).toBe('refunded');
  });

  it('V9 a refund a person asks for needs the supervisor and a reason: refused without, and the payment stays paid', async () => {
    const s = createStore(h.app);
    const cash = await s.charge();
    const qr = await paidQr(s);
    for (const [p, paths] of [
      [cash, ['cancel', 'void']],
      [qr, ['cancel', 'refund']],
    ] as const) {
      for (const path of paths) {
        for (const field of ['reasonCode', 'actorRef', 'approvedBy']) {
          for (const value of [undefined, '', '   ', 7]) {
            const res = await s
              .post(`/payments/${p.id}/${path}`, { ...CANCEL, [field]: value })
              .expect(422);
            expect(Object.keys(res.body.errors)).toEqual([field]);
          }
        }
      }
      expect((await s.read(p.id)).status).toBe('paid');
    }
    expect(h.pg.count('refund', qr.id)).toBe(0);
    expect(await auditOf(h.sql, cash.id)).toHaveLength(2);
  });

  it('Reasons: the six fixed codes are stored as codes; other needs a note; anything else is refused', async () => {
    const s = createStore(h.app);
    const codes = [
      'wrong_item_or_qty',
      'wrong_payment_method',
      'customer_cancelled',
      'duplicate_transaction',
      'goods_returned',
      'other',
    ];
    for (const reasonCode of codes) {
      const p = await s.charge();
      const body = {
        ...CANCEL,
        reasonCode,
        ...(reasonCode === 'other' ? { note: 'till was short' } : {}),
      };
      await s.post(`/payments/${p.id}/void`, body).expect(200);
      const audit = await auditOf(h.sql, p.id);
      expect(audit[2].reason_code).toBe(reasonCode);
    }
    const counts = await h.sql<{ reason_code: string; n: number }[]>`
      select reason_code, count(*)::int as n from payment.payment_events
      where tenant_id = ${s.tenantId} and to_status = 'voided' group by 1 order by 1`;
    expect(counts.map((c) => c.reason_code)).toEqual([...codes].sort());
    expect(counts.every((c) => c.n === 1)).toBe(true);

    const p = await s.charge();
    const noNote = await s
      .post(`/payments/${p.id}/void`, { ...CANCEL, reasonCode: 'other' })
      .expect(422);
    expect(noNote.body.errors).toEqual({
      note: 'Required when the reason is other',
    });
    const free = await s
      .post(`/payments/${p.id}/void`, {
        ...CANCEL,
        reasonCode: 'because-i-said-so',
      })
      .expect(422);
    expect(Object.keys(free.body.errors)).toEqual(['reasonCode']);
    expect(JSON.stringify(free.body)).not.toContain('because-i-said-so');
    expect((await s.read(p.id)).status).toBe('paid');
  });

  it('cancels only what can be cancelled: a voided, refunded or failed payment is refused or replayed, never changed', async () => {
    const s = createStore(h.app);
    h.pg.chargeScript = ['refuse'];
    const failed = (await s.chargeRaw({ method: 'fake_qris' }).expect(201))
      .body;
    expect(failed.status).toBe('failed');
    for (const path of ['cancel', 'refund']) {
      const res = await s
        .post(`/payments/${failed.id}/${path}`, CANCEL)
        .expect(409);
      expect(res.body.code).toBe('not_cancellable');
    }
    expect(h.pg.count('refund', failed.id)).toBe(0);
  });

  it('M12 M15 a paid CASHAC payment whose order never finished is returned by the same key and never voided automatically', async () => {
    const s = createStore(h.app);
    const body = {
      orderRef: 'INV-M12',
      attempt: 1,
      method: 'cash',
      amount: 15_000,
      actorRef: 'cashier-2',
    };
    const first = await s.post('/payments', body, 'INV-M12:1').expect(201);
    // pos-api died before completing the sale. The cashier (or pos-api's job) asks again with the same key
    // and gets the paid payment to complete the sale with.
    const retry = await s.post('/payments', body, 'INV-M12:1').expect(200);
    expect(retry.body).toMatchObject({ id: first.body.id, status: 'paid' });
    const byOrder = await s.get('/payments?orderRef=INV-M12').expect(200);
    expect(byOrder.body.items).toHaveLength(1);

    // Nobody ever comes back. Hours and days of reconciliation later it is still paid: the cashier may hold
    // the cash. Only a person's void, with a supervisor, undoes it.
    for (const wait of [11 * MINUTE, 60 * MINUTE, 3 * 24 * 60 * MINUTE]) {
      h.clock.advance(wait);
      await h.reconcile.tick();
    }
    const after = await s.read(first.body.id);
    expect(after.status).toBe('paid');
    expect(await auditOf(h.sql, first.body.id)).toHaveLength(2);
    expect(await outboxOf(h.sql, first.body.id)).toEqual(['payment.paid']);
    await s.post(`/payments/${first.body.id}/void`, CANCEL).expect(200);
  });
});
