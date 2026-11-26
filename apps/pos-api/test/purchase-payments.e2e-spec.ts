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
      // Due in 8 days: outside the window. No due date: never late.
      await order(s, line(2), { dueDate: await storeDay(8) });
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
        total: 30_000 + 100_000 + 10_000 + 20_000 + 30_000,
        overdue: 30_000,
        dueSoon: 100_000 + 10_000,
        openCount: 5,
        overdueCount: 1,
      });
      const rows = list.body.data as Record<string, unknown>[];
      expect(rows).toHaveLength(7);
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
        'payments',
        'returns',
      ])
        expect(seen.body).not.toHaveProperty(k);
      const list = await get(kasir.auth, '/purchasing/orders').expect(200);
      expect(list.body).not.toHaveProperty('summary');
      expect(list.body.data[0]).not.toHaveProperty('remaining');
      expect(await detail(s, o.id)).toMatchObject({ paid: 1_000 });
    });
  });
});
