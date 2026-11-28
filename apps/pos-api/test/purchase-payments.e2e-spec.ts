import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import postgres from 'postgres';
import request from 'supertest';
import { ADMIN_DATABASE_URL } from './support/env';
import { createApp, createStore } from './support/fixtures';
import { createCashier } from './support/staff';

type Store = { auth: string; tenantId: string; userId: string };
type Line = {
  id: string;
  productId: string;
  qty: number;
  returnable: number;
  returnedQty: number;
};

// UMK-1970 (design feature 29): purchase payment status, due dates, supplier payments and returns.
describe('purchase payments and returns (UMK-1970)', () => {
  let app: INestApplication;
  const admin = postgres(ADMIN_DATABASE_URL, { max: 1, onnotice: () => {} });
  // Holds a purchase's row lock while requests queue behind it (the race test).
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

  const get = (auth: string, url: string) =>
    http().get(url).set('Authorization', auth);
  const post = (auth: string, url: string, body: object = {}) =>
    http().post(url).set('Authorization', auth).send(body);

  async function product(s: Store, name: string, costPrice: number) {
    const cat = await post(s.auth, '/catalog/categories', {
      name: `Kategori ${Math.random()}`,
    }).expect(201);
    const res = await post(s.auth, '/catalog/products', {
      categoryId: cat.body.id,
      name,
      costPrice,
      sellingPrice: costPrice * 2,
    }).expect(201);
    return res.body.id as string;
  }

  async function supplier(s: Store, name = 'Toko Grosir Makmur') {
    const res = await post(s.auth, '/suppliers', { name }).expect(201);
    return res.body.id as string;
  }

  /** An order of `lines`, approved unless `draft`; returns its detail. */
  async function order(
    s: Store,
    lines: { productId: string; qty: number; unitCost: number }[],
    opts: { draft?: boolean; dueDate?: string | null } = {},
  ) {
    const res = await post(s.auth, '/purchasing/orders', {
      supplierId: await supplier(s),
      lines,
      ...(opts.dueDate !== undefined ? { dueDate: opts.dueDate } : {}),
    }).expect(201);
    if (!opts.draft)
      await post(s.auth, `/purchasing/orders/${res.body.id}/approve`).expect(
        200,
      );
    return detail(s, res.body.id as string);
  }

  const detail = async (s: Store, id: string) =>
    (await get(s.auth, `/purchasing/orders/${id}`).expect(200)).body as {
      id: string;
      code: string;
      status: string;
      total: number;
      paid: number;
      returned: number;
      remaining: number | null;
      credit: number;
      paymentStatus: string | null;
      overdueDays: number | null;
      dueInDays: number | null;
      dueDate: string | null;
      lines: Line[];
      payments: Record<string, unknown>[];
      returns: Record<string, unknown>[];
    };

  const pay = (
    auth: string,
    id: string,
    body: object,
    key: string = randomUUID(),
  ) =>
    http()
      .post(`/purchasing/orders/${id}/payments`)
      .set('Authorization', auth)
      .set('Idempotency-Key', key)
      .send(body);

  const giveBack = (
    auth: string,
    id: string,
    body: object,
    key: string = randomUUID(),
  ) =>
    http()
      .post(`/purchasing/orders/${id}/returns`)
      .set('Authorization', auth)
      .set('Idempotency-Key', key)
      .send(body);

  const openShift = (s: Store, openingCash: number) =>
    post(s.auth, '/shifts/open', { openingCash }).expect(201);
  const current = async (auth: string) =>
    (await get(auth, '/shifts/current').expect(200)).body.shift as Record<
      string,
      unknown
    >;
  const onHand = async (s: Store, productId: string) =>
    (await get(s.auth, `/stock/products/${productId}`).expect(200)).body
      .onHand as number;

  /** Resolves once `n` backends of this database wait for a lock: the requests are in flight. */
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

  /** Holds a row lock while the requests queue behind it, then lets them race; returns their answers. */
  async function racing(
    lockSql: (sql: postgres.TransactionSql) => Promise<unknown>,
    start: () => Promise<request.Response>[],
  ) {
    const sent: Promise<request.Response>[] = [];
    await locker.begin(async (sql) => {
      await lockSql(sql);
      sent.push(...start());
      await untilWaiting(sent.length);
    });
    return Promise.all(sent);
  }

  /** The store's today (store timezone, default Asia/Jakarta) moved by `days`, as YYYY-MM-DD. */
  async function storeDay(days: number) {
    const [r] = await admin<{ d: string }[]>`
      select to_char((now() at time zone 'Asia/Jakarta')::date + ${days}::int, 'YYYY-MM-DD') as d`;
    return r.d;
  }

  /** The design's purchase: Rp2.400.000 of which 40 pcs Indomie Goreng at Rp2.800. */
  async function designOrder(s: Store, opts: { dueDate?: string } = {}) {
    const indomie = await product(s, 'Indomie Goreng', 2_800);
    const beras = await product(s, 'Beras 5 kg', 45_760);
    const o = await order(
      s,
      [
        { productId: indomie, qty: 40, unitCost: 2_800 },
        { productId: beras, qty: 50, unitCost: 45_760 },
      ],
      opts,
    );
    const line = o.lines.find((l) => l.productId === indomie)!;
    return { o, indomie, beras, line };
  }

  describe("the design's example", () => {
    it('PB Rp2.400.000, paid Rp1.000.000 from the drawer: Rp1.400.000 left; 10 pcs at Rp2.800 back: Rp28.000 less debt', async () => {
      const s = await createStore();
      const dueDate = await storeDay(4);
      const { o, indomie, line } = await designOrder(s, { dueDate });
      expect(o).toMatchObject({
        code: 'PB-0001',
        status: 'approved',
        total: 2_400_000,
        paid: 0,
        returned: 0,
        remaining: 2_400_000,
        paymentStatus: 'belum_bayar',
        overdueDays: null,
        dueInDays: 4,
        dueDate,
        payments: [],
        returns: [],
      });
      expect(line).toMatchObject({ qty: 40, returnable: 40, returnedQty: 0 });

      await openShift(s, 2_390_000);
      const paid = await pay(s.auth, o.id, {
        amount: 1_000_000,
        source: 'drawer',
      }).expect(201);
      expect(paid.body).toEqual({
        id: expect.any(String),
        amount: 1_000_000,
        source: 'drawer',
        note: null,
        shiftId: expect.any(String),
        drawerCashBefore: 2_390_000,
        actorName: 'Pemilik',
        createdAt: expect.any(String),
        voidedAt: null,
        voidReason: null,
        drawerReversed: null,
      });
      // The drawer: Rp2.390.000 − Rp1.000.000, as a supplier payment of the shift (not an expense).
      expect(await current(s.auth)).toMatchObject({
        expectedCash: 1_390_000,
        cashOut: 1_000_000,
        purchasePayments: 1_000_000,
        expenses: 0,
      });
      const [entry] = await admin<Record<string, string>[]>`
        select direction, kind, amount, ref_id, note from pos.shift_cash_entries
         where tenant_id = ${s.tenantId}`;
      expect(entry).toEqual({
        direction: 'out',
        kind: 'purchase_payment',
        amount: '1000000',
        ref_id: paid.body.id,
        note: 'PB-0001 · Toko Grosir Makmur',
      });
      expect(await detail(s, o.id)).toMatchObject({
        total: 2_400_000,
        paid: 1_000_000,
        remaining: 1_400_000,
        paymentStatus: 'sebagian',
      });

      // Overpay: the design's error dialog numbers.
      const over = await pay(s.auth, o.id, {
        amount: 1_600_000,
        source: 'outside',
      }).expect(422);
      expect(over.body).toMatchObject({
        code: 'PURCHASE_OVERPAY',
        remaining: 1_400_000,
        message: 'Jumlah Rp1.600.000 melebihi sisa hutang Rp1.400.000',
        errors: { amount: expect.any(String) },
      });

      // Return 10 pcs of Indomie at Rp2.800.
      const back = await giveBack(s.auth, o.id, {
        reason: 'rusak',
        lines: [{ lineId: line.id, qty: 10 }],
      }).expect(201);
      expect(back.body).toEqual({
        id: expect.any(String),
        reason: 'rusak',
        reasonLabel: 'Barang rusak',
        note: null,
        total: 28_000,
        refundDue: 0,
        actorName: 'Pemilik',
        createdAt: expect.any(String),
        reversedAt: null,
        reverseReason: null,
        reversedByName: null,
        countedSince: false,
        lines: [
          {
            orderLineId: line.id,
            productId: indomie,
            qty: 10,
            unitCost: 2_800,
          },
        ],
      });
      const after = await detail(s, o.id);
      expect(after).toMatchObject({
        paid: 1_000_000,
        returned: 28_000,
        remaining: 1_372_000,
        paymentStatus: 'sebagian',
      });
      expect(after.lines.find((l) => l.id === line.id)).toMatchObject({
        returnable: 30,
        returnedQty: 10,
      });
      expect(after.payments).toHaveLength(1);
      expect(after.returns).toHaveLength(1);
      expect(await onHand(s, indomie)).toBe(30);
      const [movement] = await admin<Record<string, unknown>[]>`
        select delta, reason, ref_id from pos.stock_movements
         where tenant_id = ${s.tenantId} and reason = 'purchase_return'`;
      expect(movement).toEqual({
        delta: -10,
        reason: 'purchase_return',
        ref_id: back.body.id,
      });
      // The drawer did not move for the return.
      expect(await current(s.auth)).toMatchObject({ expectedCash: 1_390_000 });
    });
  });

  describe('payment status', () => {
    it('belum bayar → sebagian → lunas; a paid-in-full purchase refuses payment and still takes a return', async () => {
      const s = await createStore();
      const p = await product(s, 'Gula 1 kg', 15_000);
      const o = await order(s, [{ productId: p, qty: 10, unitCost: 15_000 }]);
      expect(o).toMatchObject({
        remaining: 150_000,
        paymentStatus: 'belum_bayar',
      });
      await pay(s.auth, o.id, {
        amount: 50_000,
        source: 'outside',
        note: 'transfer termin 1',
      }).expect(201);
      expect(await detail(s, o.id)).toMatchObject({
        paid: 50_000,
        remaining: 100_000,
        paymentStatus: 'sebagian',
      });
      await pay(s.auth, o.id, { amount: 100_000, source: 'outside' }).expect(
        201,
      );
      expect(await detail(s, o.id)).toMatchObject({
        paid: 150_000,
        remaining: 0,
        paymentStatus: 'lunas',
        credit: 0,
      });
      const again = await pay(s.auth, o.id, {
        amount: 1,
        source: 'outside',
      }).expect(422);
      expect(again.body).toMatchObject({
        code: 'PURCHASE_OVERPAY',
        remaining: 0,
        message: 'Pembelian ini sudah lunas, tidak bisa dibayar lagi',
      });
      // Returned after it was paid: the debt stays at 0, the supplier owes the money back (outside the system).
      const back = await giveBack(s.auth, o.id, {
        reason: 'kedaluwarsa',
        note: 'Uang kembali tunai dari sales',
        lines: [{ lineId: o.lines[0].id, qty: 2 }],
      }).expect(201);
      expect(back.body).toMatchObject({ total: 30_000, refundDue: 30_000 });
      expect(await detail(s, o.id)).toMatchObject({
        remaining: 0,
        credit: 30_000,
        paymentStatus: 'lunas',
      });
      expect(await onHand(s, p)).toBe(8);
    });

    it('a return alone lowers the debt without a payment: still belum bayar; a full return leaves nothing owed', async () => {
      const s = await createStore();
      const p = await product(s, 'Kopi sachet', 1_000);
      const o = await order(s, [{ productId: p, qty: 10, unitCost: 1_000 }]);
      await giveBack(s.auth, o.id, {
        reason: 'salah_kirim',
        lines: [{ lineId: o.lines[0].id, qty: 4 }],
      }).expect(201);
      expect(await detail(s, o.id)).toMatchObject({
        remaining: 6_000,
        paymentStatus: 'belum_bayar',
      });
      // The rest goes back too: exactly the debt, so nothing is due back from the supplier.
      const rest = await giveBack(s.auth, o.id, {
        reason: 'salah_kirim',
        lines: [{ lineId: o.lines[0].id, qty: 6 }],
      }).expect(201);
      expect(rest.body).toMatchObject({ total: 6_000, refundDue: 0 });
      expect(await detail(s, o.id)).toMatchObject({
        remaining: 0,
        paymentStatus: 'lunas',
      });
    });

    it('a draft and a cancelled purchase have no payment status and refuse payment and return', async () => {
      const s = await createStore();
      const p = await product(s, 'Teh celup', 5_000);
      const d = await order(s, [{ productId: p, qty: 2, unitCost: 5_000 }], {
        draft: true,
      });
      expect(d).toMatchObject({
        status: 'draft',
        remaining: null,
        paymentStatus: null,
      });
      const refused = await pay(s.auth, d.id, {
        amount: 1_000,
        source: 'outside',
      }).expect(409);
      expect(refused.body).toMatchObject({ code: 'PURCHASE_NOT_APPROVED' });
      expect(
        (
          await giveBack(s.auth, d.id, {
            reason: 'rusak',
            lines: [{ lineId: d.lines[0].id, qty: 1 }],
          }).expect(409)
        ).body,
      ).toMatchObject({ code: 'PURCHASE_NOT_APPROVED' });
      await post(s.auth, `/purchasing/orders/${d.id}/cancel`).expect(200);
      await pay(s.auth, d.id, { amount: 1_000, source: 'outside' }).expect(409);
      const [{ n }] = await admin<{ n: number }[]>`
        select count(*)::int as n from pos.purchase_payments where tenant_id = ${s.tenantId}`;
      expect(n).toBe(0);
    });

    it('late by the store day, never without a due date; the debt summary covers every approved purchase', async () => {
      const s = await createStore();
      const p = await product(s, 'Minyak 1 L', 10_000);
      const line = (qty: number) => [{ productId: p, qty, unitCost: 10_000 }];
      // Late 2 days, half paid: Rp30.000 of it owed and late.
      const late = await order(s, line(6), { dueDate: await storeDay(-2) });
      await pay(s.auth, late.id, { amount: 30_000, source: 'outside' }).expect(
        201,
      );
      // Due in 4 days: within the 7-day window.
      const soon = await order(s, line(10), { dueDate: await storeDay(4) });
      // Due today: not late yet, in the window.
      await order(s, line(1), { dueDate: await storeDay(0) });
      // The window is 7 days counting today: due in 6 days is in, due in 7 days is out. No due date: never late.
      await order(s, line(4), { dueDate: await storeDay(6) });
      await order(s, line(2), { dueDate: await storeDay(7) });
      const none = await order(s, line(3));
      // Paid in full and past due: not late, nothing owed.
      const paidLate = await order(s, line(1), { dueDate: await storeDay(-9) });
      await pay(s.auth, paidLate.id, {
        amount: 10_000,
        source: 'outside',
      }).expect(201);
      // A draft owes nothing yet.
      await order(s, line(50), { draft: true, dueDate: await storeDay(-3) });

      expect(await detail(s, late.id)).toMatchObject({
        paymentStatus: 'sebagian',
        overdueDays: 2,
        dueInDays: -2,
      });
      expect(await detail(s, soon.id)).toMatchObject({
        paymentStatus: 'belum_bayar',
        overdueDays: null,
        dueInDays: 4,
      });
      expect(await detail(s, none.id)).toMatchObject({
        overdueDays: null,
        dueInDays: null,
      });
      expect(await detail(s, paidLate.id)).toMatchObject({
        paymentStatus: 'lunas',
        overdueDays: null,
      });

      const list = await get(s.auth, '/purchasing/orders').expect(200);
      expect(list.body.summary).toEqual({
        total: 30_000 + 100_000 + 10_000 + 40_000 + 20_000 + 30_000,
        overdue: 30_000,
        dueSoon: 100_000 + 10_000 + 40_000,
        openCount: 6,
        overdueCount: 1,
      });
      const rows = list.body.data as Record<string, unknown>[];
      expect(rows).toHaveLength(8);
      expect(rows.find((r) => r.id === late.id)).toMatchObject({
        code: expect.stringMatching(/^PB-000\d$/),
        total: 60_000,
        paid: 30_000,
        remaining: 30_000,
        paymentStatus: 'sebagian',
        overdueDays: 2,
      });
      // Numbers per store, in creation order.
      expect(rows.map((r) => r.code).sort()).toEqual([
        'PB-0001',
        'PB-0002',
        'PB-0003',
        'PB-0004',
        'PB-0005',
        'PB-0006',
        'PB-0007',
        'PB-0008',
      ]);
    });

    it('the due date can be set while draft or approved; nothing else changes on an approved purchase', async () => {
      const s = await createStore();
      const p = await product(s, 'Sabun', 3_000);
      const o = await order(s, [{ productId: p, qty: 1, unitCost: 3_000 }]);
      const due = await storeDay(10);
      const res = await http()
        .patch(`/purchasing/orders/${o.id}`)
        .set('Authorization', s.auth)
        .send({ dueDate: due })
        .expect(200);
      expect(res.body).toMatchObject({ dueDate: due, dueInDays: 10 });
      await http()
        .patch(`/purchasing/orders/${o.id}`)
        .set('Authorization', s.auth)
        .send({ dueDate: null })
        .expect(200);
      await http()
        .patch(`/purchasing/orders/${o.id}`)
        .set('Authorization', s.auth)
        .send({ note: 'ubah' })
        .expect(409);
      await http()
        .patch(`/purchasing/orders/${o.id}`)
        .set('Authorization', s.auth)
        .send({ dueDate: '2026-02-31' })
        .expect(422);
      expect(await detail(s, o.id)).toMatchObject({
        dueDate: null,
        note: null,
      });
    });
  });

  describe('paying from the drawer', () => {
    it('needs an open shift (SHIFT_REQUIRED) and enough cash in it (DRAWER_INSUFFICIENT); outside the drawer needs neither', async () => {
      const s = await createStore();
      // A store with staff, so the owner has no shift opened for them (UMK-2120 solo-owner mode).
      await createCashier(app, s);
      const { o } = await designOrder(s);
      const noShift = await pay(s.auth, o.id, {
        amount: 100_000,
        source: 'drawer',
      }).expect(422);
      expect(noShift.body).toMatchObject({
        code: 'SHIFT_REQUIRED',
        message:
          'Belum ada shift buka. Buka shift untuk membayar dari laci, atau pilih Di luar laci.',
      });
      await openShift(s, 300_000);
      const low = await pay(s.auth, o.id, {
        amount: 300_001,
        source: 'drawer',
      }).expect(422);
      expect(low.body).toMatchObject({
        code: 'DRAWER_INSUFFICIENT',
        drawerCash: 300_000,
        errors: { amount: expect.any(String) },
      });
      // Nothing was written by the refusals, the drawer is as it was.
      const [{ payments, entries }] = await admin<
        { payments: number; entries: number }[]
      >`select (select count(*)::int from pos.purchase_payments where tenant_id = ${s.tenantId}) as payments,
               (select count(*)::int from pos.shift_cash_entries where tenant_id = ${s.tenantId}) as entries`;
      expect({ payments, entries }).toEqual({ payments: 0, entries: 0 });
      // The whole drawer is fine.
      await pay(s.auth, o.id, { amount: 300_000, source: 'drawer' }).expect(
        201,
      );
      // From outside the drawer: no shift cash, any amount up to the debt.
      await pay(s.auth, o.id, { amount: 2_000_000, source: 'outside' }).expect(
        201,
      );
      expect(await current(s.auth)).toMatchObject({
        expectedCash: 0,
        purchasePayments: 300_000,
      });
      expect(await detail(s, o.id)).toMatchObject({
        paid: 2_300_000,
        remaining: 100_000,
      });
    });

    it('needs the permission that holds a drawer: purchasing.manage alone pays from outside only', async () => {
      const s = await createStore();
      const { o } = await designOrder(s);
      const buyer = await createCashier(app, s, ['purchasing.manage']);
      const res = await pay(buyer.auth, o.id, {
        amount: 1_000,
        source: 'drawer',
      }).expect(403);
      expect(res.body).toMatchObject({ code: 'DRAWER_PERMISSION' });
      const ok = await pay(buyer.auth, o.id, {
        amount: 1_000,
        source: 'outside',
      }).expect(201);
      expect(ok.body).toMatchObject({ actorName: 'Sari', source: 'outside' });
    });
  });

  describe('idempotency and races', () => {
    it('a retry with the same key answers the first payment; another body under the key is refused', async () => {
      const s = await createStore();
      const { o } = await designOrder(s);
      await openShift(s, 1_000_000);
      const key = randomUUID();
      const body = { amount: 400_000, source: 'drawer', note: 'termin 1' };
      const first = await pay(s.auth, o.id, body, key).expect(201);
      const again = await pay(s.auth, o.id, body, key).expect(201);
      expect(again.body).toEqual(first.body);
      const other = await pay(
        s.auth,
        o.id,
        { ...body, amount: 400_001 },
        key,
      ).expect(422);
      expect(other.body).toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
      await pay(s.auth, o.id, { amount: 1 }, 'bad key!').expect(422);
      await http()
        .post(`/purchasing/orders/${o.id}/payments`)
        .set('Authorization', s.auth)
        .send(body)
        .expect(422);
      expect(await detail(s, o.id)).toMatchObject({ paid: 400_000 });
      expect(await current(s.auth)).toMatchObject({ expectedCash: 600_000 });
      // A return replays the same way, and draws the stock once.
      const line = (await detail(s, o.id)).lines[0];
      const rkey = randomUUID();
      const rbody = { reason: 'rusak', lines: [{ lineId: line.id, qty: 3 }] };
      const r1 = await giveBack(s.auth, o.id, rbody, rkey).expect(201);
      const r2 = await giveBack(s.auth, o.id, rbody, rkey).expect(201);
      expect(r2.body).toEqual(r1.body);
      expect(
        (await detail(s, o.id)).lines.find((l) => l.id === line.id),
      ).toMatchObject({ returnedQty: 3 });
    });

    it('two payments of the whole debt at once: one is recorded, the other is PURCHASE_OVERPAY', async () => {
      const s = await createStore();
      const p = await product(s, 'Tepung', 12_000);
      const o = await order(s, [{ productId: p, qty: 10, unitCost: 12_000 }]);
      // Both requests reach the purchase's row lock while a third connection holds it, then race for it.
      const sent: Promise<request.Response>[] = [];
      await locker.begin(async (sql) => {
        await sql`select id from pos.purchase_orders where id = ${o.id} for update`;
        for (let i = 0; i < 2; i++)
          sent.push(
            pay(s.auth, o.id, { amount: 120_000, source: 'outside' }).then(
              (r) => r,
            ),
          );
        await untilWaiting(2);
      });
      const [a, b] = await Promise.all(sent);
      expect([a.status, b.status].sort()).toEqual([201, 422]);
      expect((a.status === 422 ? a : b).body).toMatchObject({
        code: 'PURCHASE_OVERPAY',
        remaining: 0,
      });
      expect(await detail(s, o.id)).toMatchObject({
        paid: 120_000,
        remaining: 0,
        paymentStatus: 'lunas',
      });
    });
  });

  describe('returns', () => {
    it('take at most what is left in the stock batch (RETURN_EXCEEDS_BATCH)', async () => {
      const s = await createStore();
      const p = await product(s, 'Susu kotak', 4_000);
      const o = await order(s, [{ productId: p, qty: 10, unitCost: 4_000 }]);
      // 8 units leave the batch (counted 2 at the opname): 2 are left to return.
      const op = await post(s.auth, '/stock-opnames', {
        lines: [{ productId: p, countedQty: 2 }],
      }).expect(201);
      await post(s.auth, `/stock-opnames/${op.body.id}/approve`).expect(200);
      expect((await detail(s, o.id)).lines[0]).toMatchObject({
        returnable: 2,
      });
      const over = await giveBack(s.auth, o.id, {
        reason: 'rusak',
        lines: [{ lineId: o.lines[0].id, qty: 3 }],
      }).expect(422);
      expect(over.body).toMatchObject({
        code: 'RETURN_EXCEEDS_BATCH',
        available: 2,
        errors: { 'lines.0.qty': expect.any(String) },
      });
      await giveBack(s.auth, o.id, {
        reason: 'rusak',
        lines: [{ lineId: o.lines[0].id, qty: 2 }],
      }).expect(201);
      expect(await onHand(s, p)).toBe(0);
      expect(await detail(s, o.id)).toMatchObject({
        returned: 8_000,
        remaining: 32_000,
      });
    });

    it('refuses a line of another purchase, a duplicate line and Lainnya without a note (422)', async () => {
      const s = await createStore();
      const p = await product(s, 'Kecap', 9_000);
      const o = await order(s, [{ productId: p, qty: 5, unitCost: 9_000 }]);
      const other = await order(s, [{ productId: p, qty: 5, unitCost: 9_000 }]);
      const wrong = await giveBack(s.auth, o.id, {
        reason: 'rusak',
        lines: [{ lineId: other.lines[0].id, qty: 1 }],
      }).expect(422);
      expect(wrong.body.errors).toHaveProperty(['lines.0.lineId']);
      await giveBack(s.auth, o.id, {
        reason: 'rusak',
        lines: [
          { lineId: o.lines[0].id, qty: 1 },
          { lineId: o.lines[0].id, qty: 1 },
        ],
      }).expect(422);
      const note = await giveBack(s.auth, o.id, {
        reason: 'lainnya',
        lines: [{ lineId: o.lines[0].id, qty: 1 }],
      }).expect(422);
      expect(note.body.errors).toHaveProperty('note');
      expect(await onHand(s, p)).toBe(10);
    });
  });

  describe('voiding a payment (the reversal line)', () => {
    it('a drawer payment whose shift is open: the cash goes back into that drawer; repeating changes nothing', async () => {
      const s = await createStore();
      const { o } = await designOrder(s);
      await openShift(s, 500_000);
      const p = await pay(s.auth, o.id, {
        amount: 200_000,
        source: 'drawer',
      }).expect(201);
      const voided = await post(
        s.auth,
        `/purchasing/orders/${o.id}/payments/${p.body.id}/void`,
        { reason: 'Salah jumlah' },
      ).expect(200);
      expect(voided.body).toMatchObject({
        id: p.body.id,
        voidReason: 'Salah jumlah',
        voidedAt: expect.any(String),
        drawerReversed: true,
      });
      expect(await current(s.auth)).toMatchObject({
        expectedCash: 500_000,
        purchasePayments: 200_000,
        purchasePaymentReversals: 200_000,
      });
      expect(await detail(s, o.id)).toMatchObject({
        paid: 0,
        remaining: 2_400_000,
        paymentStatus: 'belum_bayar',
      });
      const again = await post(
        s.auth,
        `/purchasing/orders/${o.id}/payments/${p.body.id}/void`,
        { reason: 'Lagi' },
      ).expect(200);
      expect(again.body).toEqual(voided.body);
      // The voided payment stays in the history.
      expect((await detail(s, o.id)).payments).toHaveLength(1);
      await post(
        s.auth,
        `/purchasing/orders/${o.id}/payments/${p.body.id}/void`,
        {},
      ).expect(422);
    });

    it('a drawer payment whose shift closed: the closed shift never changes, the cash goes to the store cash', async () => {
      const s = await createStore();
      const { o } = await designOrder(s);
      const shift = await openShift(s, 500_000);
      const p = await pay(s.auth, o.id, {
        amount: 200_000,
        source: 'drawer',
      }).expect(201);
      await post(s.auth, '/shifts/current/close', {
        countedCash: 300_000,
      }).expect(200);
      const before =
        await admin`select * from pos.shifts where id = ${shift.body.id}`;
      expect(before[0].expected_cash).toBe('300000');
      const voided = await post(
        s.auth,
        `/purchasing/orders/${o.id}/payments/${p.body.id}/void`,
        { reason: 'Dibatalkan pemasok' },
      ).expect(200);
      expect(voided.body).toMatchObject({ drawerReversed: false });
      expect(
        await admin`select * from pos.shifts where id = ${shift.body.id}`,
      ).toEqual(before);
      expect(
        await admin`select direction, kind, amount, ref_id from pos.store_cash_entries
                     where tenant_id = ${s.tenantId}`,
      ).toEqual([
        {
          direction: 'in',
          kind: 'purchase_payment_void',
          amount: '200000',
          ref_id: p.body.id,
        },
      ]);
      expect(await detail(s, o.id)).toMatchObject({ remaining: 2_400_000 });
    });
  });

  describe('review follow-ups (PR 62)', () => {
    it('the same key sent twice at once records one payment and answers it to both', async () => {
      const s = await createStore();
      const p = await product(s, 'Terigu', 10_000);
      const o = await order(s, [{ productId: p, qty: 10, unitCost: 10_000 }]);
      const key = randomUUID();
      const body = { amount: 40_000, source: 'outside' };
      const [a, b] = await racing(
        (sql) =>
          sql`select id from pos.purchase_orders where id = ${o.id} for update`,
        () => [
          pay(s.auth, o.id, body, key).then((r) => r),
          pay(s.auth, o.id, body, key).then((r) => r),
        ],
      );
      expect([a.status, b.status]).toEqual([201, 201]);
      expect(a.body).toEqual(b.body);
      const [{ n }] = await admin<{ n: number }[]>`
        select count(*)::int as n from pos.purchase_payments where tenant_id = ${s.tenantId}`;
      expect(n).toBe(1);
      expect(await detail(s, o.id)).toMatchObject({
        paid: 40_000,
        remaining: 60_000,
      });
    });

    it('two drawer payments that together overdraw the drawer: one is recorded, the other is DRAWER_INSUFFICIENT', async () => {
      const s = await createStore();
      const p = await product(s, 'Garam', 5_000);
      const o1 = await order(s, [{ productId: p, qty: 100, unitCost: 5_000 }]);
      const o2 = await order(s, [{ productId: p, qty: 100, unitCost: 5_000 }]);
      const shift = await openShift(s, 300_000);
      // Two purchases, so the payments meet only at the shift's row lock.
      const [a, b] = await racing(
        (sql) =>
          sql`select id from pos.shifts where id = ${shift.body.id} for update`,
        () => [
          pay(s.auth, o1.id, { amount: 200_000, source: 'drawer' }).then(
            (r) => r,
          ),
          pay(s.auth, o2.id, { amount: 200_000, source: 'drawer' }).then(
            (r) => r,
          ),
        ],
      );
      expect([a.status, b.status].sort()).toEqual([201, 422]);
      expect((a.status === 422 ? a : b).body).toMatchObject({
        code: 'DRAWER_INSUFFICIENT',
        drawerCash: 100_000,
      });
      expect(await current(s.auth)).toMatchObject({
        expectedCash: 100_000,
        purchasePayments: 200_000,
      });
    });

    it('voiding a payment after a return recomputes the money due back from the supplier', async () => {
      const s = await createStore();
      const p = await product(s, 'Mentega', 15_000);
      const o = await order(s, [{ productId: p, qty: 10, unitCost: 15_000 }]);
      const paid = await pay(s.auth, o.id, {
        amount: 150_000,
        source: 'outside',
      }).expect(201);
      const back = await giveBack(s.auth, o.id, {
        reason: 'rusak',
        lines: [{ lineId: o.lines[0].id, qty: 2 }],
      }).expect(201);
      expect(back.body).toMatchObject({ total: 30_000, refundDue: 30_000 });
      expect(await detail(s, o.id)).toMatchObject({
        remaining: 0,
        credit: 30_000,
        paymentStatus: 'lunas',
      });
      await post(
        s.auth,
        `/purchasing/orders/${o.id}/payments/${paid.body.id}/void`,
        { reason: 'Transfer gagal' },
      ).expect(200);
      const after = await detail(s, o.id);
      expect(after).toMatchObject({
        paid: 0,
        returned: 30_000,
        remaining: 120_000,
        credit: 0,
        paymentStatus: 'belum_bayar',
      });
      expect(after.returns).toMatchObject([
        { id: back.body.id, total: 30_000, refundDue: 0 },
      ]);
      // Paid in full again: the next return sits wholly above the total.
      await pay(s.auth, o.id, { amount: 120_000, source: 'outside' }).expect(
        201,
      );
      await giveBack(s.auth, o.id, {
        reason: 'rusak',
        lines: [{ lineId: o.lines[0].id, qty: 1 }],
      }).expect(201);
      expect(
        ((await detail(s, o.id)).returns as { refundDue: number }[]).map(
          (r) => r.refundDue,
        ),
      ).toEqual([0, 15_000]);
    });

    it('a retry of a drawer payment is answered even after the actor lost the drawer permission', async () => {
      const s = await createStore();
      const { o } = await designOrder(s);
      const buyer = await createCashier(app, s, [
        'purchasing.manage',
        'sales.create',
      ]);
      await post(buyer.auth, '/shifts/open', { openingCash: 500_000 }).expect(
        201,
      );
      const key = randomUUID();
      const body = { amount: 100_000, source: 'drawer' };
      const first = await pay(buyer.auth, o.id, body, key).expect(201);
      await http()
        .patch(`/roles/${buyer.roleId}`)
        .set('Authorization', s.auth)
        .send({ permissions: ['purchasing.manage'] })
        .expect(200);
      const again = await pay(buyer.auth, o.id, body, key).expect(201);
      expect(again.body).toEqual(first.body);
      const fresh = await pay(buyer.auth, o.id, body).expect(403);
      expect(fresh.body).toMatchObject({ code: 'DRAWER_PERMISSION' });
    });

    it('the shift report and the agent ledger show supplier payments (voided ones as a reversal / left out)', async () => {
      const s = await createStore();
      const { o } = await designOrder(s);
      await openShift(s, 500_000);
      const drawer = await pay(s.auth, o.id, {
        amount: 200_000,
        source: 'drawer',
      }).expect(201);
      const outside = await pay(s.auth, o.id, {
        amount: 50_000,
        source: 'outside',
        note: 'transfer',
      }).expect(201);
      await post(
        s.auth,
        `/purchasing/orders/${o.id}/payments/${drawer.body.id}/void`,
        { reason: 'Salah' },
      ).expect(200);
      await pay(s.auth, o.id, { amount: 70_000, source: 'drawer' }).expect(201);
      const today = await storeDay(0);
      const report = await get(
        s.auth,
        `/reports/shifts?from=${today}&to=${today}`,
      ).expect(200);
      expect(report.body.rows).toHaveLength(1);
      expect(report.body.rows[0]).toMatchObject({
        purchasePayments: 270_000,
        purchasePaymentReversals: 200_000,
        cashOut: 270_000,
        cashIn: 200_000,
        expectedCash: 430_000, // the open shift: 500.000 opening + 200.000 in - 270.000 out (UMK-2088)
      });
      const ledger = await get(
        s.auth,
        `/agent/ledger?from=${today}&to=${today}`,
      ).expect(200);
      const supplier = (
        ledger.body.entries as { id: string; kind: string }[]
      ).filter((e) => e.kind === 'supplier_payment');
      expect(supplier).toHaveLength(2);
      expect(supplier).toContainEqual(
        expect.objectContaining({
          id: `purchase_payment:${outside.body.id}`,
          direction: 'out',
          category: 'bayar_pemasok',
          amount: 50_000,
          method: null,
          note: 'transfer',
        }),
      );
      expect(supplier).toContainEqual(
        expect.objectContaining({ amount: 70_000, method: 'Tunai' }),
      );
      expect(ledger.body.totals.out).toBe(120_000);
    });
  });

  describe('undoing a return and money back from the supplier (feature 29 additions)', () => {
    const refund = (
      auth: string,
      id: string,
      body: object,
      key: string = randomUUID(),
    ) =>
      http()
        .post(`/purchasing/orders/${id}/refunds`)
        .set('Authorization', auth)
        .set('Idempotency-Key', key)
        .send(body);
    const reverse = (
      auth: string,
      id: string,
      returnId: string,
      reason = 'Salah catat',
    ) =>
      post(auth, `/purchasing/orders/${id}/returns/${returnId}/reverse`, {
        reason,
      });
    const voidRefund = (auth: string, id: string, refundId: string) =>
      post(auth, `/purchasing/orders/${id}/refunds/${refundId}/void`, {
        reason: 'Salah catat',
      });
    const batchOf = async (orderId: string) => {
      const [b] = await admin<{ qty_remaining: number }[]>`
        select qty_remaining from pos.stock_batches where source = 'purchase' and source_id = ${orderId}`;
      return b.qty_remaining;
    };
    const storeCash = async (s: Store) =>
      (await get(s.auth, '/store-cash').expect(200)).body.summary
        .balance as number;
    const figures = async (s: Store, id: string) =>
      (await detail(s, id)) as Awaited<ReturnType<typeof detail>> & {
        refunded: number;
        refundDue: number;
        refunds: Record<string, unknown>[];
      };

    /** Rp150.000 paid in full, 2 of 10 back: Rp30.000 due back from the supplier. */
    async function overpaid(s: Store) {
      const p = await product(s, 'Mentega', 15_000);
      const o = await order(s, [{ productId: p, qty: 10, unitCost: 15_000 }]);
      const paid = await pay(s.auth, o.id, {
        amount: 150_000,
        source: 'outside',
      }).expect(201);
      const back = await giveBack(s.auth, o.id, {
        reason: 'rusak',
        lines: [{ lineId: o.lines[0].id, qty: 2 }],
      }).expect(201);
      return {
        o,
        p,
        paymentId: paid.body.id as string,
        returnId: back.body.id as string,
      };
    }

    it('undoing a return puts its units back into the same batch, even after stock left it since, and the debt back up', async () => {
      const s = await createStore();
      const p = await product(s, 'Gula', 10_000);
      const o = await order(s, [{ productId: p, qty: 10, unitCost: 10_000 }]);
      await pay(s.auth, o.id, { amount: 40_000, source: 'outside' }).expect(
        201,
      );
      const back = await giveBack(s.auth, o.id, {
        reason: 'salah_kirim',
        lines: [{ lineId: o.lines[0].id, qty: 3 }],
      }).expect(201);
      expect(await detail(s, o.id)).toMatchObject({
        returned: 30_000,
        remaining: 30_000,
      });
      // 5 more units leave the batch after the return (counted 2 of 7).
      const op = await post(s.auth, '/stock-opnames', {
        lines: [{ productId: p, countedQty: 2 }],
      }).expect(201);
      await post(s.auth, `/stock-opnames/${op.body.id}/approve`).expect(200);
      expect(await batchOf(o.id)).toBe(2);
      // The screen warns before the undo: a count of this product came after the return.
      expect((await detail(s, o.id)).returns[0]).toMatchObject({
        countedSince: true,
      });

      const undone = await reverse(s.auth, o.id, back.body.id).expect(200);
      expect(undone.body).toMatchObject({
        id: back.body.id,
        total: 30_000,
        refundDue: 0,
        reversedAt: expect.any(String),
        reverseReason: 'Salah catat',
        reversedByName: 'Pemilik',
      });
      expect(await batchOf(o.id)).toBe(5);
      expect(await onHand(s, p)).toBe(5);
      expect(
        await admin`select delta, reason from pos.stock_movements
                     where tenant_id = ${s.tenantId} and reason = 'purchase_return_reversal'`,
      ).toEqual([{ delta: 3, reason: 'purchase_return_reversal' }]);
      const after = await detail(s, o.id);
      expect(after).toMatchObject({
        returned: 0,
        remaining: 60_000,
        paymentStatus: 'sebagian',
      });
      expect(after.lines[0]).toMatchObject({ returnedQty: 0, returnable: 5 });
      // The return stays in the history, marked undone.
      expect(after.returns).toHaveLength(1);

      // A repeat (another reason) answers the first reversal and changes nothing.
      const again = await reverse(s.auth, o.id, back.body.id, 'Lagi').expect(
        200,
      );
      expect(again.body).toEqual(undone.body);
      expect(await batchOf(o.id)).toBe(5);
      const [{ n }] = await admin<{ n: number }[]>`
        select count(*)::int as n from pos.purchase_return_reversals where tenant_id = ${s.tenantId}`;
      expect(n).toBe(1);
      expect(
        (await get(s.auth, '/purchasing/orders').expect(200)).body.summary
          .total,
      ).toBe(60_000);
      // A reason is required.
      await post(
        s.auth,
        `/purchasing/orders/${o.id}/returns/${back.body.id}/reverse`,
        {},
      ).expect(422);
    });

    it('money back into the drawer or the store cash: partial, never above what is due back, idempotent', async () => {
      const s = await createStore();
      // A store with staff, so the owner has no shift opened for them (UMK-2120 solo-owner mode).
      await createCashier(app, s);
      const { o } = await overpaid(s);
      expect(await figures(s, o.id)).toMatchObject({
        remaining: 0,
        credit: 30_000,
        refunded: 0,
        refundDue: 30_000,
        refunds: [],
      });
      const noShift = await refund(s.auth, o.id, {
        amount: 10_000,
        destination: 'drawer',
      }).expect(422);
      expect(noShift.body).toMatchObject({ code: 'SHIFT_REQUIRED' });

      await openShift(s, 100_000);
      const key = randomUUID();
      const first = await refund(
        s.auth,
        o.id,
        { amount: 10_000, destination: 'drawer', note: 'tunai dari sales' },
        key,
      ).expect(201);
      expect(first.body).toEqual({
        id: expect.any(String),
        amount: 10_000,
        destination: 'drawer',
        note: 'tunai dari sales',
        shiftId: expect.any(String),
        actorName: 'Pemilik',
        createdAt: expect.any(String),
        voidedAt: null,
        voidReason: null,
        drawerReversed: null,
      });
      expect(await current(s.auth)).toMatchObject({
        expectedCash: 110_000,
        purchaseRefunds: 10_000,
      });
      expect(await figures(s, o.id)).toMatchObject({
        remaining: 0,
        refunded: 10_000,
        refundDue: 20_000,
      });
      // A retry answers the first; another body under the key is refused.
      const replay = await refund(
        s.auth,
        o.id,
        { amount: 10_000, destination: 'drawer', note: 'tunai dari sales' },
        key,
      ).expect(201);
      expect(replay.body).toEqual(first.body);
      const reused = await refund(
        s.auth,
        o.id,
        { amount: 5_000, destination: 'drawer' },
        key,
      ).expect(422);
      expect(reused.body).toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });

      const over = await refund(s.auth, o.id, {
        amount: 25_000,
        destination: 'store_cash',
      }).expect(422);
      expect(over.body).toMatchObject({
        code: 'REFUND_EXCEEDS_DUE',
        refundDue: 20_000,
        errors: { amount: expect.any(String) },
      });
      await refund(s.auth, o.id, {
        amount: 20_000,
        destination: 'store_cash',
      }).expect(201);
      expect(await storeCash(s)).toBe(20_000);
      expect(await figures(s, o.id)).toMatchObject({
        refunded: 30_000,
        refundDue: 0,
        remaining: 0,
      });
      const none = await refund(s.auth, o.id, {
        amount: 1,
        destination: 'store_cash',
      }).expect(422);
      expect(none.body).toMatchObject({
        code: 'REFUND_EXCEEDS_DUE',
        refundDue: 0,
      });
      await refund(s.auth, o.id, { amount: 0, destination: 'drawer' }).expect(
        422,
      );
      await refund(s.auth, o.id, { amount: 1_000, destination: 'bank' }).expect(
        422,
      );

      const today = await storeDay(0);
      const report = await get(
        s.auth,
        `/reports/shifts?from=${today}&to=${today}`,
      ).expect(200);
      expect(report.body.rows[0]).toMatchObject({
        purchaseRefunds: 10_000,
        purchaseRefundReversals: 0,
        cashIn: 10_000,
      });
      const ledger = await get(
        s.auth,
        `/agent/ledger?from=${today}&to=${today}`,
      ).expect(200);
      const back = (
        ledger.body.entries as { kind: string; amount: number }[]
      ).filter((e) => e.kind === 'supplier_refund');
      expect(back.map((e) => e.amount).sort()).toEqual([10_000, 20_000]);
      expect(back[0]).toMatchObject({
        direction: 'in',
        category: 'retur_pemasok',
        method: 'Tunai',
      });
    });

    it('a refund is voided like a payment: out of its open drawer, else out of the store cash; repeating changes nothing', async () => {
      const s = await createStore();
      const { o } = await overpaid(s);
      const shift = await openShift(s, 0);
      const drawer = await refund(s.auth, o.id, {
        amount: 10_000,
        destination: 'drawer',
      }).expect(201);
      const store = await refund(s.auth, o.id, {
        amount: 5_000,
        destination: 'store_cash',
      }).expect(201);

      // The drawer no longer holds the 10.000 (a supplier paid from it): the void is refused.
      const q = await product(s, 'Kopi', 10_000);
      const o2 = await order(s, [{ productId: q, qty: 1, unitCost: 10_000 }]);
      const out = await pay(s.auth, o2.id, {
        amount: 10_000,
        source: 'drawer',
      }).expect(201);
      const short = await voidRefund(s.auth, o.id, drawer.body.id).expect(422);
      expect(short.body).toMatchObject({
        code: 'DRAWER_INSUFFICIENT',
        drawerCash: 0,
      });
      await post(
        s.auth,
        `/purchasing/orders/${o2.id}/payments/${out.body.id}/void`,
        { reason: 'Salah' },
      ).expect(200);

      const voided = await voidRefund(s.auth, o.id, drawer.body.id).expect(200);
      expect(voided.body).toMatchObject({
        id: drawer.body.id,
        voidReason: 'Salah catat',
        voidedAt: expect.any(String),
        drawerReversed: true,
      });
      expect(await current(s.auth)).toMatchObject({
        expectedCash: 0,
        purchaseRefunds: 10_000,
        purchaseRefundReversals: 10_000,
      });
      const again = await voidRefund(s.auth, o.id, drawer.body.id).expect(200);
      expect(again.body).toEqual(voided.body);

      await voidRefund(s.auth, o.id, store.body.id).expect(200);
      expect(await storeCash(s)).toBe(0);
      expect(await figures(s, o.id)).toMatchObject({
        refunded: 0,
        refundDue: 30_000,
      });

      // A drawer refund whose shift closed: the shift stays as it was, the cash leaves the store cash.
      const late = await refund(s.auth, o.id, {
        amount: 7_000,
        destination: 'drawer',
      }).expect(201);
      await post(s.auth, '/shifts/current/close', {
        countedCash: 7_000,
      }).expect(200);
      const before =
        await admin`select * from pos.shifts where id = ${shift.body.id}`;
      // The store cash is empty: it cannot give the 7.000 back (it never goes below zero, owner ruling 2026-11-27).
      const empty = await voidRefund(s.auth, o.id, late.body.id).expect(422);
      expect(empty.body).toMatchObject({
        code: 'STORE_CASH_INSUFFICIENT',
        available: 0,
      });
      expect(empty.body.message).toMatch(
        /Kas toko \(Rp0\) kurang dari Rp7\.000/,
      );
      await refund(s.auth, o.id, {
        amount: 7_000,
        destination: 'store_cash',
      }).expect(201);
      const closed = await voidRefund(s.auth, o.id, late.body.id).expect(200);
      expect(closed.body).toMatchObject({ drawerReversed: false });
      expect(
        await admin`select * from pos.shifts where id = ${shift.body.id}`,
      ).toEqual(before);
      expect(await storeCash(s)).toBe(0);
      expect((await figures(s, o.id)).refunds).toHaveLength(4);
    });

    it('what the supplier handed back blocks undoing the return and voiding the payment it came from', async () => {
      const s = await createStore();
      const { o, paymentId, returnId } = await overpaid(s);
      const got = await refund(s.auth, o.id, {
        amount: 10_000,
        destination: 'store_cash',
      }).expect(201);
      const undo = await reverse(s.auth, o.id, returnId).expect(422);
      expect(undo.body).toMatchObject({
        code: 'RETURN_REFUNDED',
        refunded: 10_000,
      });
      const unpay = await post(
        s.auth,
        `/purchasing/orders/${o.id}/payments/${paymentId}/void`,
        { reason: 'Transfer gagal' },
      ).expect(422);
      expect(unpay.body).toMatchObject({
        code: 'REFUND_RECEIVED',
        refunded: 10_000,
      });
      expect(await figures(s, o.id)).toMatchObject({
        paid: 150_000,
        returned: 30_000,
        refunded: 10_000,
        refundDue: 20_000,
      });
      // The refund voided first: both go through.
      await voidRefund(s.auth, o.id, got.body.id).expect(200);
      await reverse(s.auth, o.id, returnId).expect(200);
      await post(
        s.auth,
        `/purchasing/orders/${o.id}/payments/${paymentId}/void`,
        { reason: 'Transfer gagal' },
      ).expect(200);
      expect(await figures(s, o.id)).toMatchObject({
        paid: 0,
        returned: 0,
        refunded: 0,
        remaining: 150_000,
        refundDue: 0,
      });
    });

    const auditRows = (tenantId: string) =>
      admin<
        {
          event: string;
          target_label: string;
          details: Record<string, unknown>;
        }[]
      >`
        select event, target_label, details from pos.audit_log
         where tenant_id = ${tenantId} and event like 'purchase_%' order by seq`;

    it('every supplier money change writes one audit row in its transaction; a refused or repeated one writes none', async () => {
      const s = await createStore();
      const { o, paymentId, returnId } = await overpaid(s);
      await openShift(s, 100_000);

      // Refused first: nothing logged.
      await refund(s.auth, o.id, {
        amount: 99_000,
        destination: 'drawer',
      }).expect(422);
      await reverse(s.auth, o.id, returnId).expect(200);
      expect(await auditRows(s.tenantId)).toEqual([
        {
          event: 'purchase_return_undo',
          target_label: 'PB-0001',
          details: {
            orderId: o.id,
            returnId,
            reversalId: expect.any(String),
            total: 30_000,
            units: 2,
          },
        },
      ]);
      // A repeated undo writes no second row.
      await reverse(s.auth, o.id, returnId).expect(200);
      expect(await auditRows(s.tenantId)).toHaveLength(1);

      // Paid in full again and one more back: money due back, received into the drawer.
      await giveBack(s.auth, o.id, {
        reason: 'rusak',
        lines: [{ lineId: o.lines[0].id, qty: 1 }],
      }).expect(201);
      const key = randomUUID();
      const got = await refund(
        s.auth,
        o.id,
        {
          amount: 15_000,
          destination: 'drawer',
          note: 'diantar sales Budi 081234567890',
        },
        key,
      ).expect(201);
      // A replay writes no second row.
      await refund(
        s.auth,
        o.id,
        {
          amount: 15_000,
          destination: 'drawer',
          note: 'diantar sales Budi 081234567890',
        },
        key,
      ).expect(201);
      // Refused void of the payment (the refund depends on it): nothing logged.
      await post(
        s.auth,
        `/purchasing/orders/${o.id}/payments/${paymentId}/void`,
        { reason: 'Salah transfer' },
      ).expect(422);
      await voidRefund(s.auth, o.id, got.body.id).expect(200);
      await voidRefund(s.auth, o.id, got.body.id).expect(200);
      await post(
        s.auth,
        `/purchasing/orders/${o.id}/payments/${paymentId}/void`,
        { reason: 'Salah transfer' },
      ).expect(200);

      const rows = await auditRows(s.tenantId);
      expect(rows.map((r) => r.event)).toEqual([
        'purchase_return_undo',
        'purchase_refund',
        'purchase_refund_void',
        'purchase_payment_void',
      ]);
      expect(rows[1].details).toEqual({
        orderId: o.id,
        refundId: got.body.id,
        amount: 15_000,
        destination: 'drawer',
        shiftId: expect.any(String),
      });
      expect(rows[2].details).toMatchObject({
        refundId: got.body.id,
        amount: 15_000,
        drawerReversed: true,
      });
      expect(rows[3].details).toEqual({
        orderId: o.id,
        paymentId,
        amount: 150_000,
        source: 'outside',
        shiftId: null,
        drawerReversed: null,
      });
      // Ids and amounts only: no note, no reason text, no phone number. The ids are masked first: a random uuid
      // can hold the digits of a phone number ("…-272a895c0812" failed CI once).
      const text = JSON.stringify(rows).replace(
        /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g,
        '<id>',
      );
      expect(text).toContain('<id>');
      for (const word of ['diantar', '0812', 'Budi', 'Salah', 'note', 'reason'])
        expect(text).not.toContain(word);
    });

    it('the same refund key sent twice at once: one refund; on two purchases the loser meets the unique key and is refused', async () => {
      const s = await createStore();
      const one = await overpaid(s);
      const key = randomUUID();
      const body = { amount: 10_000, destination: 'store_cash' };
      // Same purchase: the second waits for the purchase lock, then finds the first under its key and answers it.
      const [a, b] = await racing(
        (sql) =>
          sql`select id from pos.purchase_orders where id = ${one.o.id} for update`,
        () => [
          refund(s.auth, one.o.id, body, key).then((r) => r),
          refund(s.auth, one.o.id, body, key).then((r) => r),
        ],
      );
      expect([a.status, b.status]).toEqual([201, 201]);
      expect(a.body).toEqual(b.body);

      // Two purchases, one new key: no shared row lock, so both pass every check and the second insert hits the
      // unique key (the unique-violation path), reads the winner and refuses the other body.
      const two = await overpaid(s);
      const three = await overpaid(s);
      const shared = randomUUID();
      const [c, d] = await racing(
        (sql) =>
          sql`select id from pos.purchase_orders where id in (${two.o.id}, ${three.o.id}) for update`,
        () => [
          refund(s.auth, two.o.id, body, shared).then((r) => r),
          refund(s.auth, three.o.id, body, shared).then((r) => r),
        ],
      );
      expect([c.status, d.status].sort()).toEqual([201, 422]);
      expect((c.status === 422 ? c : d).body).toMatchObject({
        code: 'IDEMPOTENCY_KEY_REUSED',
      });
      const [{ n }] = await admin<{ n: number }[]>`
        select count(*)::int as n from pos.purchase_refunds where tenant_id = ${s.tenantId}`;
      expect(n).toBe(2);
      // The loser's store cash entry and audit row rolled back with it.
      expect(await storeCash(s)).toBe(20_000);
      expect(await auditRows(s.tenantId)).toHaveLength(2);
    });

    it('the shift report after a drawer refund voided once its shift closed: the shift keeps the refund, the store cash gives it back', async () => {
      const s = await createStore();
      const { o } = await overpaid(s);
      await openShift(s, 50_000);
      const got = await refund(s.auth, o.id, {
        amount: 12_000,
        destination: 'drawer',
      }).expect(201);
      await post(s.auth, '/shifts/current/close', {
        countedCash: 62_000,
      }).expect(200);
      const today = await storeDay(0);
      const shiftRow = async () =>
        (
          await get(s.auth, `/reports/shifts?from=${today}&to=${today}`).expect(
            200,
          )
        ).body.rows[0] as Record<string, unknown>;
      const before = await shiftRow();
      expect(before).toMatchObject({
        purchaseRefunds: 12_000,
        purchaseRefundReversals: 0,
        cashIn: 12_000,
        expectedCash: 62_000,
        countedCash: 62_000,
        difference: 0,
      });
      // Refused while the store cash holds less than the 12.000; nothing changed.
      const short = await voidRefund(s.auth, o.id, got.body.id).expect(422);
      expect(short.body).toMatchObject({
        code: 'STORE_CASH_INSUFFICIENT',
        available: 0,
      });
      expect(await shiftRow()).toEqual(before);
      expect((await figures(s, o.id)).refunded).toBe(12_000);
      // The supplier hands 12.000 more into the store cash: now it can give the drawer's 12.000 back.
      await refund(s.auth, o.id, {
        amount: 12_000,
        destination: 'store_cash',
      }).expect(201);
      await voidRefund(s.auth, o.id, got.body.id).expect(200);
      // The closed shift's row is exactly as it was; the cash left the store cash instead.
      expect(await shiftRow()).toEqual(before);
      expect(await storeCash(s)).toBe(0);
      expect(
        await admin`select direction, kind, amount from pos.store_cash_entries where tenant_id = ${s.tenantId} order by created_at`,
      ).toEqual([
        { direction: 'in', kind: 'purchase_refund', amount: '12000' },
        { direction: 'out', kind: 'purchase_refund_void', amount: '12000' },
      ]);
      expect(await figures(s, o.id)).toMatchObject({
        refunded: 12_000,
        refundDue: 18_000,
      });
    });

    it('store cash never goes negative: a refund received into the store cash is not voided once that cash left, and two voids racing for the last of it get one 200 and one 422', async () => {
      const s = await createStore();
      const a = await overpaid(s);
      const b = await overpaid(s);
      const c = await overpaid(s);
      const intoStore = async (o: { id: string }) =>
        (
          await refund(s.auth, o.id, {
            amount: 5_000,
            destination: 'store_cash',
          }).expect(201)
        ).body.id as string;
      const ra = await intoStore(a.o);
      const rb = await intoStore(b.o);
      // C's refund went into a drawer whose shift then closed: its void takes 5.000 out of the store cash.
      await openShift(s, 0);
      const rc = await refund(s.auth, c.o.id, {
        amount: 5_000,
        destination: 'drawer',
      }).expect(201);
      await post(s.auth, '/shifts/current/close', {
        countedCash: 5_000,
      }).expect(200);
      expect(await storeCash(s)).toBe(10_000);
      await voidRefund(s.auth, c.o.id, rc.body.id).expect(200);
      expect(await storeCash(s)).toBe(5_000);

      // A and B each want their 5.000 back out of the 5.000 left. Two purchases share no row lock: the store
      // cash's own lock decides. The ledger is held against inserts (reads still pass) until both requests wait,
      // so without that lock both would read 5.000 and both would pass.
      const [x, y] = await racing(
        (sql) => sql`lock table pos.store_cash_entries in exclusive mode`,
        () => [
          voidRefund(s.auth, a.o.id, ra).then((r) => r),
          voidRefund(s.auth, b.o.id, rb).then((r) => r),
        ],
      );
      expect([x.status, y.status].sort()).toEqual([200, 422]);
      expect((x.status === 422 ? x : y).body).toMatchObject({
        code: 'STORE_CASH_INSUFFICIENT',
        available: 0,
      });
      expect(await storeCash(s)).toBe(0);
      // The loser is still live, its audit row rolled back with it.
      const [{ live }] = await admin<{ live: number }[]>`
        select count(*)::int as live from pos.purchase_refunds
         where tenant_id = ${s.tenantId} and voided_at is null and id in (${ra}, ${rb})`;
      expect(live).toBe(1);
      const [{ voids }] = await admin<{ voids: number }[]>`
        select count(*)::int as voids from pos.audit_log
         where tenant_id = ${s.tenantId} and event = 'purchase_refund_void'`;
      expect(voids).toBe(2);
    });

    it('a drawer refund is voided only by that shift’s cashier, an admin or the owner; purchasing staff and other cashiers get 403 DRAWER_REFUND_NOT_YOURS', async () => {
      const s = await createStore();
      const { o } = await overpaid(s);
      const rina = await createCashier(app, s, [
        'sales.create',
        'purchasing.manage',
      ]);
      const sari = await createCashier(app, s, [
        'sales.create',
        'purchasing.manage',
      ]);
      const buyer = await createCashier(app, s, ['purchasing.manage']);
      const adminStaff = await createCashier(app, s, [
        'purchasing.manage',
        'sales.void',
      ]);
      await post(rina.auth, '/shifts/open', { openingCash: 0 }).expect(201);
      const ids: string[] = [];
      for (let i = 0; i < 4; i++)
        ids.push(
          (
            await refund(rina.auth, o.id, {
              amount: 5_000,
              destination: 'drawer',
            }).expect(201)
          ).body.id as string,
        );
      const drawer = async () =>
        (await current(rina.auth)).expectedCash as number;
      expect(await drawer()).toBe(20_000);

      for (const who of [buyer, sari]) {
        const no = await voidRefund(who.auth, o.id, ids[0]).expect(403);
        expect(no.body).toMatchObject({ code: 'DRAWER_REFUND_NOT_YOURS' });
        expect(no.body.message).toMatch(
          /kasir shift tempat uang itu masuk, admin, atau pemilik/,
        );
      }
      // Nothing changed: the refund is live and the drawer still holds it.
      expect((await figures(s, o.id)).refunded).toBe(20_000);
      expect(await drawer()).toBe(20_000);

      await voidRefund(rina.auth, o.id, ids[0]).expect(200);
      await voidRefund(adminStaff.auth, o.id, ids[1]).expect(200);
      await voidRefund(s.auth, o.id, ids[2]).expect(200);
      expect(await drawer()).toBe(5_000);
      // A repeat by someone refused is still refused, also of a refund already voided.
      await voidRefund(buyer.auth, o.id, ids[0]).expect(403);

      // Its shift closed: still a drawer refund, still refused to the buyer (the cash would leave the store cash).
      await post(rina.auth, '/shifts/current/close', {
        countedCash: 5_000,
      }).expect(200);
      const late = await voidRefund(buyer.auth, o.id, ids[3]).expect(403);
      expect(late.body).toMatchObject({ code: 'DRAWER_REFUND_NOT_YOURS' });
      // A refund into the store cash is not drawer money: purchasing staff void it as before.
      const store = await refund(buyer.auth, o.id, {
        amount: 5_000,
        destination: 'store_cash',
      }).expect(201);
      await voidRefund(buyer.auth, o.id, store.body.id).expect(200);
      expect((await figures(s, o.id)).refunded).toBe(5_000);
    });

    it('races: two refunds of the whole amount, an undo against a refund, two undos of one return', async () => {
      const s = await createStore();
      const lockOrder = (id: string) => (sql: postgres.TransactionSql) =>
        sql`select id from pos.purchase_orders where id = ${id} for update`;

      const one = await overpaid(s);
      const [a, b] = await racing(lockOrder(one.o.id), () => [
        refund(s.auth, one.o.id, {
          amount: 30_000,
          destination: 'store_cash',
        }).then((r) => r),
        refund(s.auth, one.o.id, {
          amount: 30_000,
          destination: 'store_cash',
        }).then((r) => r),
      ]);
      expect([a.status, b.status].sort()).toEqual([201, 422]);
      expect((a.status === 422 ? a : b).body).toMatchObject({
        code: 'REFUND_EXCEEDS_DUE',
        refundDue: 0,
      });
      expect(await figures(s, one.o.id)).toMatchObject({ refunded: 30_000 });

      const two = await overpaid(s);
      const [c, d] = await racing(lockOrder(two.o.id), () => [
        reverse(s.auth, two.o.id, two.returnId).then((r) => r),
        refund(s.auth, two.o.id, {
          amount: 30_000,
          destination: 'store_cash',
        }).then((r) => r),
      ]);
      // Whichever came first, the other is refused: refunds never exceed what is due back.
      expect([c.status, d.status].filter((x) => x === 422)).toHaveLength(1);
      const f = await figures(s, two.o.id);
      expect(f.refunded).toBeLessThanOrEqual(f.credit);

      const three = await overpaid(s);
      const before = await batchOf(three.o.id);
      const [e, g] = await racing(lockOrder(three.o.id), () => [
        reverse(s.auth, three.o.id, three.returnId).then((r) => r),
        reverse(s.auth, three.o.id, three.returnId).then((r) => r),
      ]);
      expect([e.status, g.status]).toEqual([200, 200]);
      expect(e.body).toEqual(g.body);
      expect(await batchOf(three.o.id)).toBe(before + 2);
    });
  });

  describe('tenancy and permissions', () => {
    it("another store gets 404 on this store's purchase, payment and lines for every new route", async () => {
      const a = await createStore();
      const b = await createStore();
      const { o, line } = await designOrder(a);
      const paid = await pay(a.auth, o.id, {
        amount: 1_000,
        source: 'outside',
      }).expect(201);
      const own = await designOrder(b);

      await get(b.auth, `/purchasing/orders/${o.id}`).expect(404);
      await pay(b.auth, o.id, { amount: 1_000, source: 'outside' }).expect(404);
      await giveBack(b.auth, o.id, {
        reason: 'rusak',
        lines: [{ lineId: line.id, qty: 1 }],
      }).expect(404);
      await post(
        b.auth,
        `/purchasing/orders/${o.id}/payments/${paid.body.id}/void`,
        { reason: 'x' },
      ).expect(404);
      // B's own purchase with A's payment or A's line: not found either.
      await post(
        b.auth,
        `/purchasing/orders/${own.o.id}/payments/${paid.body.id}/void`,
        { reason: 'x' },
      ).expect(404);
      const foreign = await giveBack(b.auth, own.o.id, {
        reason: 'rusak',
        lines: [{ lineId: line.id, qty: 1 }],
      }).expect(422);
      expect(foreign.body.errors).toHaveProperty(['lines.0.lineId']);
      await http()
        .patch(`/purchasing/orders/${o.id}`)
        .set('Authorization', b.auth)
        .send({ dueDate: await storeDay(1) })
        .expect(404);
      // B's list and summary hold nothing of A.
      const list = await get(b.auth, '/purchasing/orders').expect(200);
      expect(
        (list.body.data as { id: string }[]).map((r) => r.id),
      ).not.toContain(o.id);
      expect(list.body.summary.total).toBe(2_400_000);
      // A is untouched.
      expect(await detail(a, o.id)).toMatchObject({
        paid: 1_000,
        returned: 0,
        dueDate: null,
      });
      expect(await onHand(a, line.productId)).toBe(40);
    });

    it("another store gets 404 on undoing this store's return and on its refunds (feature 29 additions)", async () => {
      const a = await createStore();
      const b = await createStore();
      const p = await product(a, 'Mentega', 15_000);
      const o = await order(a, [{ productId: p, qty: 10, unitCost: 15_000 }]);
      await pay(a.auth, o.id, { amount: 150_000, source: 'outside' }).expect(
        201,
      );
      const back = await giveBack(a.auth, o.id, {
        reason: 'rusak',
        lines: [{ lineId: o.lines[0].id, qty: 2 }],
      }).expect(201);
      const got = await http()
        .post(`/purchasing/orders/${o.id}/refunds`)
        .set('Authorization', a.auth)
        .set('Idempotency-Key', randomUUID())
        .send({ amount: 5_000, destination: 'store_cash' })
        .expect(201);
      const own = await designOrder(b);
      const send = (auth: string, url: string, body: object) =>
        http()
          .post(url)
          .set('Authorization', auth)
          .set('Idempotency-Key', randomUUID())
          .send(body);
      for (const id of [o.id, own.o.id]) {
        await send(
          b.auth,
          `/purchasing/orders/${id}/returns/${back.body.id}/reverse`,
          {
            reason: 'x',
          },
        ).expect(404);
        await send(
          b.auth,
          `/purchasing/orders/${id}/refunds/${got.body.id}/void`,
          {
            reason: 'x',
          },
        ).expect(404);
      }
      await send(b.auth, `/purchasing/orders/${o.id}/refunds`, {
        amount: 1_000,
        destination: 'store_cash',
      }).expect(404);
      // A is untouched.
      expect(await detail(a, o.id)).toMatchObject({ returned: 30_000 });
      expect(
        (await get(a.auth, `/purchasing/orders/${o.id}`).expect(200)).body
          .refunds,
      ).toMatchObject([{ id: got.body.id, voidedAt: null }]);
      expect(await onHand(a, p)).toBe(8);
    });

    it('paying, returning and voiding need purchasing.manage (403); a cashier sees no purchase money', async () => {
      const s = await createStore();
      const { o, line } = await designOrder(s);
      const paid = await pay(s.auth, o.id, {
        amount: 1_000,
        source: 'outside',
      }).expect(201);
      const kasir = await createCashier(app, s, ['sales.create']);
      await pay(kasir.auth, o.id, { amount: 1_000, source: 'outside' }).expect(
        403,
      );
      await giveBack(kasir.auth, o.id, {
        reason: 'rusak',
        lines: [{ lineId: line.id, qty: 1 }],
      }).expect(403);
      await post(
        kasir.auth,
        `/purchasing/orders/${o.id}/payments/${paid.body.id}/void`,
        { reason: 'x' },
      ).expect(403);
      await post(
        kasir.auth,
        `/purchasing/orders/${o.id}/returns/${paid.body.id}/reverse`,
        { reason: 'x' },
      ).expect(403);
      await http()
        .post(`/purchasing/orders/${o.id}/refunds`)
        .set('Authorization', kasir.auth)
        .set('Idempotency-Key', randomUUID())
        .send({ amount: 1_000, destination: 'drawer' })
        .expect(403);
      // A Kasir may void only their own drawer's refund (owner ruling 2026-11-27); any other id, an unknown one
      // included, answers the same 403.
      const noRefund = await post(
        kasir.auth,
        `/purchasing/orders/${o.id}/refunds/${paid.body.id}/void`,
        { reason: 'x' },
      ).expect(403);
      expect(noRefund.body).toMatchObject({ code: 'DRAWER_REFUND_NOT_YOURS' });
      const seen = await get(kasir.auth, `/purchasing/orders/${o.id}`).expect(
        200,
      );
      expect(seen.body).toMatchObject({ paymentStatus: 'sebagian' });
      for (const k of [
        'total',
        'paid',
        'returned',
        'remaining',
        'credit',
        'refunded',
        'refundDue',
        'payments',
        'returns',
        'refunds',
      ])
        expect(seen.body).not.toHaveProperty(k);
      const list = await get(kasir.auth, '/purchasing/orders').expect(200);
      expect(list.body).not.toHaveProperty('summary');
      expect(list.body.data[0]).not.toHaveProperty('remaining');
      expect(await detail(s, o.id)).toMatchObject({ paid: 1_000 });
    });
  });
});
