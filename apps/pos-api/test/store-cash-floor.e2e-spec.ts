import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import postgres from 'postgres';
import request from 'supertest';
import { ADMIN_DATABASE_URL } from './support/env';
import { createApp, createStore } from './support/fixtures';
import { createCashier } from './support/staff';

const OWNER_PIN = '482913';

// Owner rulings 2026-11-27 (PR 71 review): store cash never goes negative, and the cash it may give is the cash
// actually in the store, not what cashier collectors still hold; the store cash lock never closes a deadlock cycle;
// a drawer refund's own cashier voids it without `purchasing.manage`.
describe('store cash floor across purchases and kasbon (UMK-1970, UMK-1971)', () => {
  let app: INestApplication;
  const admin = postgres(ADMIN_DATABASE_URL, { max: 1, onnotice: () => {} });
  const locker = postgres(ADMIN_DATABASE_URL, { max: 1, onnotice: () => {} });
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createApp();
  });
  afterAll(async () => {
    await app.close();
    await admin.end();
    await locker.end();
  });

  const post = (auth: string, url: string, body: object = {}, key?: string) => {
    const req = http().post(url).set('Authorization', auth);
    if (key) req.set('Idempotency-Key', key);
    return req.send(body);
  };
  const get = (auth: string, url: string) =>
    http().get(url).set('Authorization', auth);

  async function untilWaiting(n: number) {
    for (let i = 0; i < 400; i++) {
      const [{ waiting }] = await admin<{ waiting: number }[]>`
        select count(*)::int as waiting from pg_locks l
        join pg_stat_activity a on a.pid = l.pid
        where not l.granted and a.datname = current_database()`;
      if (waiting >= n) return;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error(`fewer than ${n} requests reached the lock`);
  }

  /**
   * A store with a kasbon of `qty` × Rp6.000 (methods Tunai, Transfer), the owner's void PIN, an owner shift open
   * with Rp0, and a purchase paid Rp150.000 with 2 of 10 returned: Rp30.000 due back from the supplier.
   */
  async function floorStore(qty = 10) {
    const s = await createStore();
    const cat = await post(s.auth, '/catalog/categories', {
      name: 'Sembako',
    }).expect(201);
    const product = await post(s.auth, '/catalog/products', {
      categoryId: cat.body.id,
      name: 'Beras 1 kg',
      costPrice: 4000,
      sellingPrice: 6000,
    }).expect(201);
    await post(s.auth, '/stock/opening', {
      productId: product.body.id,
      qty: 50,
    }).expect(201);
    const kasbon = await post(s.auth, '/payment-methods', {
      name: 'Kasbon',
      kind: 'credit',
    }).expect(201);
    const transfer = await post(s.auth, '/payment-methods', {
      name: 'Transfer',
      kind: 'debit',
    }).expect(201);
    const member = await post(s.auth, '/members', {
      name: 'Siti',
      code: `M${randomUUID().slice(0, 6)}`,
    }).expect(201);
    await http()
      .put('/void-pin')
      .set('Authorization', s.freshAuth)
      .send({ pin: OWNER_PIN })
      .expect(200);
    const shift = await post(s.auth, '/shifts/open', {
      openingCash: 0,
    }).expect(201);
    const sale = await post(
      s.auth,
      '/sales',
      {
        lines: [{ productId: product.body.id, qty }],
        memberId: member.body.id,
        paymentMethodId: kasbon.body.id,
        paid: 0,
      },
      randomUUID(),
    ).expect(201);

    const mentega = await post(s.auth, '/catalog/products', {
      categoryId: cat.body.id,
      name: 'Mentega',
      costPrice: 15_000,
      sellingPrice: 30_000,
    }).expect(201);
    const supplier = await post(s.auth, '/suppliers', {
      name: 'Toko Grosir Makmur',
    }).expect(201);
    const order = await post(s.auth, '/purchasing/orders', {
      supplierId: supplier.body.id,
      lines: [{ productId: mentega.body.id, qty: 10, unitCost: 15_000 }],
    }).expect(201);
    const orderId = order.body.id as string;
    await post(s.auth, `/purchasing/orders/${orderId}/approve`).expect(200);
    const detail = await get(s.auth, `/purchasing/orders/${orderId}`).expect(
      200,
    );
    await post(
      s.auth,
      `/purchasing/orders/${orderId}/payments`,
      { amount: 150_000, source: 'outside' },
      randomUUID(),
    ).expect(201);
    await post(
      s.auth,
      `/purchasing/orders/${orderId}/returns`,
      {
        reason: 'rusak',
        lines: [{ lineId: detail.body.lines[0].id, qty: 2 }],
      },
      randomUUID(),
    ).expect(201);
    return {
      ...s,
      rid: sale.body.receivableId as string,
      transferId: transfer.body.id as string,
      ownerShiftId: shift.body.id as string,
      orderId,
    };
  }
  type FloorStore = Awaited<ReturnType<typeof floorStore>>;

  const payKasbon = async (auth: string, k: FloorStore, amount: number) => {
    const res = await post(
      auth,
      `/receivables/${k.rid}/payments`,
      { amount },
      randomUUID(),
    ).expect(201);
    const payments = res.body.payments as { id: string }[];
    return payments[payments.length - 1].id;
  };
  const correct = (
    auth: string,
    k: FloorStore,
    paymentId: string,
    replacement: { amount: number; paymentMethodId?: string } | null,
    pin = OWNER_PIN,
  ) =>
    post(
      auth,
      `/receivables/${k.rid}/payments/${paymentId}/correction`,
      {
        replacement,
        reasonCode: 'wrong_amount',
        approverId: k.userId,
        pin,
      },
      randomUUID(),
    );
  const refund = async (
    auth: string,
    k: FloorStore,
    amount: number,
    destination: 'drawer' | 'store_cash',
  ) =>
    (
      await post(
        auth,
        `/purchasing/orders/${k.orderId}/refunds`,
        { amount, destination },
        randomUUID(),
      ).expect(201)
    ).body.id as string;
  const voidRefund = (auth: string, k: FloorStore, refundId: string) =>
    post(auth, `/purchasing/orders/${k.orderId}/refunds/${refundId}/void`, {
      reason: 'Salah catat',
    });
  const deposit = (k: FloorStore, collectorId: string, amount: number) =>
    post(k.auth, '/store-cash/deposits', { collectorId, amount }, randomUUID());
  const storeCash = async (k: FloorStore) =>
    (await get(k.auth, '/store-cash').expect(200)).body.summary as {
      balance: number;
      outstanding: number;
    };
  const closeShift = (auth: string, countedCash: number) =>
    post(auth, '/shifts/current/close', { countedCash }).expect(200);
  const pinFailures = async (k: FloorStore) =>
    (
      await admin<{ failures: number }[]>`
        select failures from pos.void_pins where tenant_id = ${k.tenantId} and actor_id = ${k.userId}`
    )[0]?.failures ?? 0;

  it('cash a cashier collector still holds is not the store’s to give: the void is refused, and their later deposit never takes the store cash below zero', async () => {
    const k = await floorStore();
    // A drawer refund of Rp12.000, its shift closed: voiding it takes the cash out of the store cash.
    const drawerRefund = await refund(k.auth, k, 12_000, 'drawer');
    await closeShift(k.auth, 12_000);
    // A collector (no `sales.create`: collects outside every shift) takes Rp12.000 of the kasbon.
    const c = await createCashier(app, k, ['receivables.manage']);
    await payKasbon(c.auth, k, 12_000);
    expect(await storeCash(k)).toMatchObject({
      balance: 12_000,
      outstanding: 12_000,
    });

    // The balance says Rp12.000, but all of it is still with the collector: nothing to give back.
    const refused = await voidRefund(k.auth, k, drawerRefund).expect(422);
    expect(refused.body).toMatchObject({
      code: 'STORE_CASH_INSUFFICIENT',
      available: 0,
    });

    // The collector hands the Rp12.000 over into a drawer, as their outstanding allows: the store cash ends at 0.
    await post(k.auth, '/shifts/open', { openingCash: 0 }).expect(201);
    await deposit(k, c.staffId, 12_000).expect(201);
    expect(await storeCash(k)).toMatchObject({ balance: 0, outstanding: 0 });

    // Cash really in the store (a refund received into it) can be given back, down to 0 and no further.
    await refund(k.auth, k, 12_000, 'store_cash');
    await voidRefund(k.auth, k, drawerRefund).expect(200);
    expect((await storeCash(k)).balance).toBe(0);
  });

  it('a kasbon correction that takes a closed shift’s cash out of an empty store cash is refused before the PIN; a refund void and such a correction racing for the last of it get one success and one 422', async () => {
    const k = await floorStore();
    // In the owner's shift: a kasbon instalment of Rp6.000 and a supplier refund of Rp6.000, then the shift closes.
    const instalment = await payKasbon(k.auth, k, 6_000);
    const drawerRefund = await refund(k.auth, k, 6_000, 'drawer');
    await closeShift(k.auth, 12_000);

    // Store cash is empty: refused before the PIN is checked, so a wrong PIN costs no attempt.
    const early = await correct(
      k.auth,
      k,
      instalment,
      { amount: 6_000, paymentMethodId: k.transferId },
      '000000',
    ).expect(422);
    expect(early.body).toMatchObject({
      code: 'STORE_CASH_INSUFFICIENT',
      available: 0,
    });
    expect(await pinFailures(k)).toBe(0);

    // Rp6.000 into the store cash; both want it. Different first locks (the purchase, the receivable): the store
    // cash's own lock decides. The ledger is held against inserts (reads still pass) until both wait.
    await refund(k.auth, k, 6_000, 'store_cash');
    const sent: Promise<request.Response>[] = [];
    await locker.begin(async (sql) => {
      await sql`lock table pos.store_cash_entries in exclusive mode`;
      sent.push(
        voidRefund(k.auth, k, drawerRefund).then((r) => r),
        correct(k.auth, k, instalment, {
          amount: 6_000,
          paymentMethodId: k.transferId,
        }).then((r) => r),
      );
      await untilWaiting(2);
    });
    const [v, c] = await Promise.all(sent);
    // The void answers 200, the correction 201: exactly one of them wins.
    expect(
      v.status === 422 ? [c.status, v.status] : [v.status, c.status],
    ).toEqual(v.status === 422 ? [201, 422] : [200, 422]);
    const loser = v.status === 422 ? v : c;
    expect(loser.body).toMatchObject({
      code: 'STORE_CASH_INSUFFICIENT',
      available: 0,
    });
    expect((await storeCash(k)).balance).toBe(0);
  });

  it('a collector’s deposit into a shift and a correction whose cash replacement goes into that shift never deadlock', async () => {
    const k = await floorStore();
    const a = await createCashier(app, k, ['receivables.manage']);
    const b = await createCashier(app, k, ['receivables.manage']);
    const fromA = await payKasbon(a.auth, k, 6_000);
    await payKasbon(b.auth, k, 6_000);

    // The owner's shift is held; B's deposit into it queues first, then the owner's correction of A's instalment
    // (cash Rp5.000 into the same shift). Before the fix the correction took the store cash lock before the shift
    // and the deposit took them the other way round: 40P01, a 500.
    const sent: Promise<request.Response>[] = [];
    await locker.begin(async (sql) => {
      await sql`select id from pos.shifts where id = ${k.ownerShiftId} for update`;
      sent.push(deposit(k, b.staffId, 6_000).then((r) => r));
      await untilWaiting(1);
      sent.push(correct(k.auth, k, fromA, { amount: 5_000 }).then((r) => r));
      await untilWaiting(2);
    });
    const [dep, cor] = await Promise.all(sent);
    expect([dep.status, cor.status]).toEqual([201, 201]);
    const shift = (await get(k.auth, '/shifts/current').expect(200)).body
      .shift as { expectedCash: number };
    expect(shift.expectedCash).toBe(11_000);
    expect(await storeCash(k)).toMatchObject({ balance: 0, outstanding: 0 });
  });

  it('a drawer refund’s own cashier voids it without purchasing.manage; another Kasir, purchasing staff and staff with neither are refused', async () => {
    const k = await floorStore();
    const rina = await createCashier(app, k, [
      'sales.create',
      'purchasing.manage',
    ]);
    await post(rina.auth, '/shifts/open', { openingCash: 0 }).expect(201);
    const first = await refund(rina.auth, k, 5_000, 'drawer');
    const second = await refund(rina.auth, k, 5_000, 'drawer');
    const store = await refund(rina.auth, k, 5_000, 'store_cash');
    // Rina keeps only the Kasir permission (permissions are read per request).
    await http()
      .patch(`/roles/${rina.roleId}`)
      .set('Authorization', k.auth)
      .send({ permissions: ['sales.create'] })
      .expect(200);
    const kasir = await createCashier(app, k, ['sales.create']);
    const buyer = await createCashier(app, k, ['purchasing.manage']);
    const neither = await createCashier(app, k, ['reports.view']);

    // Neither purchasing, nor at a till, nor admin: refused before anything is read.
    await voidRefund(neither.auth, k, first).expect(403);
    await voidRefund(neither.auth, k, randomUUID()).expect(403);
    for (const who of [kasir, buyer]) {
      const no = await voidRefund(who.auth, k, first).expect(403);
      expect(no.body).toMatchObject({ code: 'DRAWER_REFUND_NOT_YOURS' });
    }
    // A refund into the store cash is purchasing's: a Kasir without purchasing.manage is refused.
    const notDrawer = await voidRefund(rina.auth, k, store).expect(403);
    expect(notDrawer.body.code).toBeUndefined();

    // Rina's own drawer: voided by her, open shift or closed.
    await voidRefund(rina.auth, k, first).expect(200);
    const drawer = (await get(rina.auth, '/shifts/current').expect(200)).body
      .shift as { expectedCash: number };
    expect(drawer.expectedCash).toBe(5_000);
    await refund(k.auth, k, 5_000, 'store_cash');
    await closeShift(rina.auth, 5_000);
    await voidRefund(rina.auth, k, second).expect(200);
    // The buyer still voids the store cash refund.
    await voidRefund(buyer.auth, k, store).expect(200);
  });
});
