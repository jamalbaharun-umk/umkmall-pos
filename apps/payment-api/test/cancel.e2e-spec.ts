import { INestApplication } from '@nestjs/common';
import postgres from 'postgres';
import { ADMIN_DATABASE_URL } from './support/env';
import { FakeOnlineAdapter } from './support/fake-online.adapter';
import { CANCEL, createApp, createStore } from './support/fixtures';

describe('cancel: void for CASHAC, refund for a PG payment', () => {
  let app: INestApplication;
  let fakeOnline: FakeOnlineAdapter;
  const admin = postgres(ADMIN_DATABASE_URL, { max: 1, onnotice: () => {} });

  beforeAll(async () => {
    ({ app, fakeOnline } = await createApp());
  });
  afterAll(async () => {
    await app.close();
    await admin.end();
  });

  const audit = (paymentId: string) =>
    admin<
      {
        type: string;
        actor_ref: string;
        approved_by: string | null;
        reason: string | null;
        created_at: Date;
      }[]
    >`select type, actor_ref, approved_by, reason, created_at from payment.payment_events
      where payment_id = ${paymentId} order by created_at, id`;

  /** A fake online payment the payer has paid. */
  async function paidOnline(s: ReturnType<typeof createStore>) {
    const p = await s.charge({ method: 'fake_online' });
    expect(p.status).toBe('pending');
    fakeOnline.settle(p.id, 'paid');
    const synced = await s.post(`/payments/${p.id}/sync`).expect(200);
    expect(synced.body.status).toBe('paid');
    return p;
  }

  it.each(['cash', 'edc_debit', 'static_qris', 'kasbon'])(
    'voids a %s payment with no outbound call and writes the audit row',
    async (method) => {
      const s = createStore(app);
      const p = await s.charge({ method });
      const fetchSpy = jest.spyOn(globalThis, 'fetch');
      const gatewayCalls = fakeOnline.calls.length;
      const before = Date.now();
      try {
        const res = await s
          .post(`/payments/${p.id}/void`, {
            reason: '  Wrong item scanned  ',
            actorRef: 'cashier-3',
            approvedBy: 'supervisor-1',
          })
          .expect(200);
        expect(res.body.status).toBe('voided');
        expect(res.body.cancelledAt).toEqual(expect.any(String));
        expect(res.body.events.map((e: { type: string }) => e.type)).toEqual([
          'charged',
          'voided',
        ]);
        expect(fetchSpy).not.toHaveBeenCalled();
        expect(fakeOnline.calls).toHaveLength(gatewayCalls);
      } finally {
        fetchSpy.mockRestore();
      }
      const [, voided] = await audit(p.id);
      expect(voided).toMatchObject({
        type: 'voided',
        actor_ref: 'cashier-3',
        approved_by: 'supervisor-1',
        reason: 'Wrong item scanned',
      });
      expect(voided.created_at.getTime()).toBeGreaterThanOrEqual(before - 5000);
      expect(voided.created_at.getTime()).toBeLessThanOrEqual(
        Date.now() + 5000,
      );
    },
  );

  it('refuses a refund on a CASHAC payment and leaves it paid', async () => {
    const s = createStore(app);
    const p = await s.charge({ method: 'cash' });
    const res = await s.post(`/payments/${p.id}/refund`, CANCEL).expect(409);
    expect(res.body).toEqual({
      message: 'This payment method cannot be refunded; void it instead',
      code: 'refund_not_supported',
    });
    const after = await s.get(`/payments/${p.id}`).expect(200);
    expect(after.body.status).toBe('paid');
    expect(await audit(p.id)).toHaveLength(1);
  });

  it('refuses a void on a refund-only adapter and leaves it paid', async () => {
    const s = createStore(app);
    const p = await paidOnline(s);
    const res = await s.post(`/payments/${p.id}/void`, CANCEL).expect(409);
    expect(res.body).toEqual({
      message: 'This payment method cannot be voided; refund it instead',
      code: 'void_not_supported',
    });
    const after = await s.get(`/payments/${p.id}`).expect(200);
    expect(after.body.status).toBe('paid');
    expect(fakeOnline.calls.filter((c) => c.paymentId === p.id)).toEqual([
      { op: 'charge', paymentId: p.id },
      { op: 'getStatus', paymentId: p.id },
    ]);
  });

  it('cancel picks void for CASHAC', async () => {
    const s = createStore(app);
    const p = await s.charge({ method: 'static_qris' });
    const res = await s.post(`/payments/${p.id}/cancel`, CANCEL).expect(200);
    expect(res.body.status).toBe('voided');
    expect((await audit(p.id)).map((e) => e.type)).toEqual([
      'charged',
      'voided',
    ]);
  });

  it('cancel picks refund for the online adapter and calls the gateway once', async () => {
    const s = createStore(app);
    const p = await paidOnline(s);
    const res = await s.post(`/payments/${p.id}/cancel`, CANCEL).expect(200);
    expect(res.body).toMatchObject({
      status: 'refunded',
      kind: 'online',
      providerRef: `fake-${p.id}`,
    });
    const [, refunded] = await audit(p.id);
    expect(refunded).toMatchObject({
      type: 'refunded',
      actor_ref: CANCEL.actorRef,
      approved_by: CANCEL.approvedBy,
      reason: CANCEL.reason,
    });
    // A retry (cancel or refund) is the first result: no second gateway call, no second audit row.
    await s.post(`/payments/${p.id}/cancel`, CANCEL).expect(200);
    const again = await s.post(`/payments/${p.id}/refund`, CANCEL).expect(200);
    expect(again.body.status).toBe('refunded');
    expect(
      fakeOnline.calls.filter((c) => c.paymentId === p.id && c.op === 'refund'),
    ).toHaveLength(1);
    expect(await audit(p.id)).toHaveLength(2);
  });

  it.each(['reason', 'actorRef', 'approvedBy'] as const)(
    'refuses a cancel without %s (422) and leaves the payment paid',
    async (field) => {
      const s = createStore(app);
      const p = await s.charge();
      for (const path of ['cancel', 'void', 'refund']) {
        for (const value of [undefined, '', '   ', 7]) {
          const res = await s
            .post(`/payments/${p.id}/${path}`, { ...CANCEL, [field]: value })
            .expect(422);
          expect(Object.keys(res.body.errors)).toEqual([field]);
        }
      }
      const after = await s.get(`/payments/${p.id}`).expect(200);
      expect(after.body.status).toBe('paid');
      expect(await audit(p.id)).toHaveLength(1);
    },
  );

  it('a repeated void changes nothing; ten concurrent voids write one audit row', async () => {
    const s = createStore(app);
    const p = await s.charge();
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        s.post(`/payments/${p.id}/void`, CANCEL),
      ),
    );
    expect(results.map((r) => r.status)).toEqual(Array(10).fill(200));
    const first = await s.post(`/payments/${p.id}/void`, CANCEL).expect(200);
    const again = await s
      .post(`/payments/${p.id}/void`, { ...CANCEL, reason: 'another reason' })
      .expect(200);
    expect(again.body).toEqual(first.body);
    expect(await audit(p.id)).toHaveLength(2);
  });

  it('cancels only a paid payment: pending, failed and expired are refused', async () => {
    const s = createStore(app);
    for (const status of ['pending', 'failed', 'expired'] as const) {
      const p = await s.charge({ method: 'fake_online' });
      if (status !== 'pending') {
        fakeOnline.settle(p.id, status);
        const synced = await s.post(`/payments/${p.id}/sync`).expect(200);
        expect(synced.body.status).toBe(status);
      }
      for (const path of ['cancel', 'refund']) {
        const res = await s
          .post(`/payments/${p.id}/${path}`, CANCEL)
          .expect(409);
        expect(res.body.code).toBe('not_cancellable');
      }
      expect(
        fakeOnline.calls.filter(
          (c) => c.paymentId === p.id && c.op === 'refund',
        ),
      ).toHaveLength(0);
    }
  });

  it('sync leaves a settled payment alone and asks the gateway only while pending', async () => {
    const s = createStore(app);
    const p = await s.charge({ method: 'fake_online' });
    const still = await s.post(`/payments/${p.id}/sync`).expect(200);
    expect(still.body).toMatchObject({ status: 'pending', paidAt: null });
    fakeOnline.settle(p.id, 'paid');
    const paid = await s.post(`/payments/${p.id}/sync`).expect(200);
    expect(paid.body.status).toBe('paid');
    expect(paid.body.paidAt).toEqual(expect.any(String));
    fakeOnline.settle(p.id, 'failed'); // must not be asked again
    const after = await s.post(`/payments/${p.id}/sync`).expect(200);
    expect(after.body.status).toBe('paid');
    expect(
      fakeOnline.calls.filter(
        (c) => c.paymentId === p.id && c.op === 'getStatus',
      ),
    ).toHaveLength(2);
    // CASHAC is never pending, so sync is a read.
    const cash = await s.charge();
    const synced = await s.post(`/payments/${cash.id}/sync`).expect(200);
    expect(synced.body.status).toBe('paid');
  });

  it('answers 503 without internals when the gateway fails, and changes nothing', async () => {
    const s = createStore(app);
    const p = await paidOnline(s);
    fakeOnline.failNext = true;
    const res = await s.post(`/payments/${p.id}/refund`, CANCEL).expect(503);
    expect(res.body).toEqual({
      message: 'Payment gateway unavailable',
      code: 'gateway_unavailable',
    });
    expect((await s.get(`/payments/${p.id}`)).body.status).toBe('paid');
    expect(await audit(p.id)).toHaveLength(1);
    // The retry completes it.
    await s.post(`/payments/${p.id}/refund`, CANCEL).expect(200);

    // A charge the gateway never answered stays pending; the same key replays it instead of charging twice.
    fakeOnline.failNext = true;
    const key = 'charge-while-gateway-down';
    const body = {
      orderRef: 'INV-DOWN',
      method: 'fake_online',
      amount: 500,
      actorRef: 'c',
    };
    await s.post('/payments', body, key).expect(503);
    const replay = await s.post('/payments', body, key).expect(200);
    expect(replay.body.status).toBe('pending');
    expect(
      fakeOnline.calls.filter(
        (c) => c.paymentId === replay.body.id && c.op === 'charge',
      ),
    ).toHaveLength(1);
  });
});
