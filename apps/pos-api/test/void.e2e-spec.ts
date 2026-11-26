import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import postgres from 'postgres';
import request from 'supertest';
import { ADMIN_DATABASE_URL } from './support/env';
import { signSession } from '../src/tenancy/session';
import { createApp, createStore } from './support/fixtures';
import { createCashier } from './support/staff';

const OWNER_PIN = '482913';
const today = () =>
  new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
const jakartaDay = (days: number) =>
  new Date(Date.now() + 7 * 3_600_000 + days * 86_400_000)
    .toISOString()
    .slice(0, 10);

describe('void a full sale (UMK-1962)', () => {
  let app: INestApplication;
  const admin = postgres(ADMIN_DATABASE_URL, { max: 1, onnotice: () => {} });
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createApp();
  });
  afterAll(async () => {
    await app.close();
    await admin.end();
  });

  const post = (auth: string, url: string, body: object = {}) =>
    http().post(url).set('Authorization', auth).send(body);
  const put = (auth: string, url: string, body: object) =>
    http().put(url).set('Authorization', auth).send(body);
  const get = (auth: string, url: string) =>
    http().get(url).set('Authorization', auth);
  const keyed = (
    auth: string,
    url: string,
    body: object,
    key: string | null = randomUUID(),
  ) => {
    const req = http().post(url).set('Authorization', auth);
    if (key !== null) req.set('Idempotency-Key', key);
    return req.send(body);
  };
  const open = (auth: string, openingCash = 100_000) =>
    post(auth, '/shifts/open', { openingCash }).expect(201);
  const close = (auth: string, countedCash: number) =>
    post(auth, '/shifts/current/close', { countedCash }).expect(200);
  const current = async (auth: string) =>
    (await get(auth, '/shifts/current').expect(200)).body.shift as Record<
      string,
      unknown
    >;
  const sell = (auth: string, body: object) =>
    keyed(auth, '/sales', body).expect(201);
  const setPin = (auth: string, pin: string, currentPin?: string) =>
    put(auth, '/void-pin', { pin, currentPin });
  const voidSale = (
    auth: string,
    saleId: string,
    body: object,
    key: string | null = randomUUID(),
  ) => keyed(auth, `/sales/${saleId}/void`, body, key);
  const batches = async (auth: string, productId: string) =>
    (await get(auth, `/stock/products/${productId}`).expect(200)).body as {
      onHand: number;
      batches: { qtyRemaining: number; unitCost: number }[];
    };
  const pinRow = async (actorId: string) =>
    (
      await admin<
        { failures: number; locked_until: Date | null; pin_hash: string }[]
      >`select failures, locked_until, pin_hash from pos.void_pins where actor_id = ${actorId}`
    )[0];
  const ledger = (tenantId: string) =>
    admin<
      {
        shift_id: string;
        direction: string;
        kind: string;
        amount: string;
        ref_id: string;
      }[]
    >`select shift_id, direction, kind, amount, ref_id from pos.shift_cash_entries
       where tenant_id = ${tenantId} order by created_at`;
  const statusOf = async (saleId: string) =>
    (await admin`select status from pos.sales where id = ${saleId}`)[0]
      .status as string;

  /**
   * A store with one product (cost Rp2.000, price Rp5.000, 50 on hand in one batch), the methods Kasbon
   * and Kartu Debit, a member, and the owner as an approver with a void PIN. No shift is open yet.
   */
  async function shop() {
    const s = await createStore();
    const cat = await post(s.auth, '/catalog/categories', {
      name: 'Minuman',
    }).expect(201);
    const p = await post(s.auth, '/catalog/products', {
      categoryId: cat.body.id,
      name: 'Es Teh',
      costPrice: 2000,
      sellingPrice: 5000,
    }).expect(201);
    const productId = p.body.id as string;
    await post(s.auth, '/stock/opening', { productId, qty: 50 }).expect(201);
    const kasbon = await post(s.auth, '/payment-methods', {
      name: 'Kasbon',
      kind: 'credit',
    }).expect(201);
    const debit = await post(s.auth, '/payment-methods', {
      name: 'Kartu Debit',
      kind: 'debit',
    }).expect(201);
    const member = await post(s.auth, '/members', {
      name: 'Bu Sari',
      code: `M${randomUUID().slice(0, 6)}`,
      phone: '081234567890',
    }).expect(201);
    await setPin(s.freshAuth, OWNER_PIN).expect(200);
    /** The owner approving with their own PIN. */
    const approval = {
      reasonCode: 'wrong_item_or_qty',
      approverId: s.userId,
      pin: OWNER_PIN,
    };
    return {
      ...s,
      productId,
      kasbonId: kasbon.body.id as string,
      debitId: debit.body.id as string,
      memberId: member.body.id as string,
      approval,
    };
  }

  describe('cash sale', () => {
    it('same shift: status void, stock back, cash out of the drawer, the sale rows untouched', async () => {
      const s = await shop();
      const shift = await open(s.auth);
      const sale = await sell(s.auth, {
        lines: [{ productId: s.productId, qty: 3 }],
        paid: 20_000,
      });
      expect((await batches(s.auth, s.productId)).onHand).toBe(47);
      const snapshot = () =>
        Promise.all([
          admin`select to_jsonb(x) - 'status' - 'voided_at' as row from pos.sales x where id = ${sale.body.id}`,
          admin`select to_jsonb(x) as row from pos.sale_lines x where sale_id = ${sale.body.id} order by id`,
        ]);
      const before = await snapshot();

      const res = await voidSale(s.auth, sale.body.id, s.approval).expect(201);
      expect(res.body).toMatchObject({
        saleId: sale.body.id,
        saleNumber: 1,
        status: 'void',
        reasonCode: 'wrong_item_or_qty',
        note: null,
        shiftId: shift.body.id,
        cashReturned: 15_000, // the total, not the Rp20.000 tendered
        transferReturned: 0,
        receivableCancelled: 0,
        subtotal: 15_000,
        total: 15_000,
        costTotal: 6_000,
        initiatedBy: { id: s.userId, kind: 'owner', name: 'Pemilik' },
        approvedBy: { id: s.userId, kind: 'owner', name: 'Pemilik' },
        returns: [
          {
            amount: 15_000,
            paymentMethod: 'Tunai',
            fromDrawer: true,
            receivablePaymentId: null,
          },
        ],
      });
      expect(JSON.stringify(res.body)).not.toMatch(/pin|hash/i);

      expect(await snapshot()).toEqual(before);
      const stock = await batches(s.auth, s.productId);
      expect(stock.onHand).toBe(50);
      expect(stock.batches).toEqual([
        expect.objectContaining({ qtyRemaining: 50, unitCost: 2000 }),
      ]);
      const moves = await get(
        s.auth,
        `/stock/products/${s.productId}/movements`,
      ).expect(200);
      expect(
        (moves.body as { delta: number; reason: string }[]).filter(
          (m) => m.reason !== 'opening',
        ),
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ delta: -3, reason: 'sale' }),
          expect.objectContaining({ delta: 3, reason: 'sale_void' }),
        ]),
      );

      // The cash did come in and went out again: both stay visible.
      expect(await current(s.auth)).toMatchObject({
        cashSales: 15_000,
        salesCount: 1,
        cashOut: 15_000,
        voidRefunds: 15_000,
        expectedCash: 100_000,
      });
      expect(await ledger(s.tenantId)).toEqual([
        expect.objectContaining({
          shift_id: shift.body.id,
          direction: 'out',
          kind: 'void_refund',
          amount: '15000',
          ref_id: res.body.id,
        }),
      ]);

      const read = await get(s.auth, `/sales/${sale.body.id}`).expect(200);
      expect(read.body).toMatchObject({ status: 'void', total: 15_000 });
      expect(read.body.voidedAt).toEqual(expect.any(String));
      const receipt = await get(s.auth, `/sales/${sale.body.id}/receipt`);
      expect(receipt.body.status).toBe('void');
      const audit = await get(s.auth, `/sales/${sale.body.id}/void`);
      expect(audit.body).toEqual(res.body);

      const closed = await close(s.auth, 100_000);
      expect(closed.body).toMatchObject({
        cashSales: 15_000,
        salesCount: 1,
        cashOut: 15_000,
        voidRefunds: 15_000,
        expectedCash: 100_000,
        difference: 0,
      });
    });

    it('with tax, discount and voucher: gives back the total and the voucher use', async () => {
      const s = await shop();
      await put(s.auth, '/sales/settings', { taxBps: 1000 }).expect(200);
      const v = await post(s.auth, '/vouchers', {
        name: 'Hemat',
        code: `V${randomUUID().slice(0, 6)}`,
        type: 'flat',
        nominal: 1500,
        kuota: 5,
        startDate: jakartaDay(-1),
        expired: jakartaDay(1),
      }).expect(201);
      await open(s.auth);
      const sale = await sell(s.auth, {
        lines: [{ productId: s.productId, qty: 4 }],
        discount: 500,
        voucherCode: v.body.code,
        paid: 50_000,
      });
      // 20.000 − 500 − 1.500 = 18.000; tax 10% = 1.800; total 19.800.
      expect(sale.body).toMatchObject({ total: 19_800, change: 30_200 });
      const quota = async () =>
        (await get(s.auth, `/vouchers/${v.body.id}`).expect(200)).body
          .kuota as number;
      expect(await quota()).toBe(4);

      const res = await voidSale(s.auth, sale.body.id, s.approval).expect(201);
      expect(res.body).toMatchObject({
        cashReturned: 19_800,
        subtotal: 20_000,
        discount: 500,
        voucherDiscount: 1500,
        tax: 1800,
        total: 19_800,
        costTotal: 8000,
      });
      expect(await quota()).toBe(5);
      expect((await current(s.auth)).expectedCash).toBe(100_000);
    });

    it('stock from two FIFO batches returns to those batches at their own cost', async () => {
      const s = await createStore();
      const cat = await post(s.auth, '/catalog/categories', { name: 'A' });
      const p = await post(s.auth, '/catalog/products', {
        categoryId: cat.body.id,
        name: 'Gula',
        costPrice: 2000,
        sellingPrice: 5000,
      }).expect(201);
      const productId = p.body.id as string;
      await post(s.auth, '/stock/opening', { productId, qty: 2 }).expect(201);
      const sup = await post(s.auth, '/suppliers', {
        name: 'CV Sumber',
        phone: '081234567890',
        address: 'Jl. Pasar 1',
      }).expect(201);
      const po = await post(s.auth, '/purchasing/orders', {
        supplierId: sup.body.id,
        paymentMethod: 'Tunai',
        lines: [{ productId, qty: 10, unitCost: 2400 }],
      }).expect(201);
      await post(s.auth, `/purchasing/orders/${po.body.id}/approve`).expect(
        200,
      );
      await setPin(s.freshAuth, OWNER_PIN).expect(200);
      await open(s.auth);
      const sale = await sell(s.auth, {
        lines: [{ productId, qty: 5 }],
        paid: 25_000,
      });
      expect(sale.body.costTotal).toBe(2 * 2000 + 3 * 2400);
      expect(
        (await batches(s.auth, productId)).batches.map((b) => b.qtyRemaining),
      ).toEqual([7]);

      // The product's cost changes after the sale: the void must not use it.
      await admin`update pos.products set cost_price = 9999 where id = ${productId}`;
      const res = await voidSale(s.auth, sale.body.id, {
        reasonCode: 'goods_returned',
        approverId: s.userId,
        pin: OWNER_PIN,
      }).expect(201);
      expect(res.body.costTotal).toBe(11_200);
      expect(
        (await batches(s.auth, productId)).batches.map((b) => [
          b.qtyRemaining,
          b.unitCost,
        ]),
      ).toEqual([
        [2, 2000],
        [10, 2400],
      ]);
    });

    it('a sale from a closed shift: the closed shift never changes, the cash leaves the shift open now', async () => {
      const s = await shop();
      const ayu = await createCashier(app, s, ['sales.create']);
      const ayuShift = await open(ayu.auth);
      const sale = await sell(ayu.auth, {
        lines: [{ productId: s.productId, qty: 3 }],
        paid: 15_000,
      });
      await close(ayu.auth, 115_000);
      const closedRow = () =>
        admin`select to_jsonb(x) as row from pos.shifts x where id = ${ayuShift.body.id}`;
      const before = await closedRow();

      const mine = await open(s.auth);
      const res = await voidSale(s.auth, sale.body.id, s.approval).expect(201);
      expect(res.body).toMatchObject({
        shiftId: mine.body.id,
        cashReturned: 15_000,
      });
      expect(await closedRow()).toEqual(before);
      expect(before[0].row).toMatchObject({
        expected_cash: 115_000,
        cash_sales: 15_000,
        sales_count: 1,
      });
      expect((await ledger(s.tenantId)).map((e) => e.shift_id)).toEqual([
        mine.body.id,
      ]);
      expect(await current(s.auth)).toMatchObject({
        cashSales: 0,
        voidRefunds: 15_000,
        expectedCash: 85_000,
      });
      const detail = await get(s.auth, `/shifts/${ayuShift.body.id}`);
      expect(detail.body).toMatchObject({
        expectedCash: 115_000,
        cashOut: 0,
        cashEntries: [],
      });
    });

    it('no open shift: 422 with a clear message, nothing changes and no PIN attempt is counted', async () => {
      const s = await shop();
      await open(s.auth);
      const sale = await sell(s.auth, {
        lines: [{ productId: s.productId, qty: 3 }],
        paid: 15_000,
      });
      await close(s.auth, 115_000);

      for (const pin of [OWNER_PIN, '000000']) {
        const res = await voidSale(s.auth, sale.body.id, {
          ...s.approval,
          pin,
        }).expect(422);
        expect(res.body.message).toBe(
          'Buka shift dulu untuk membatalkan struk tunai',
        );
      }
      expect(await statusOf(sale.body.id)).toBe('completed');
      expect((await batches(s.auth, s.productId)).onHand).toBe(47);
      expect(await ledger(s.tenantId)).toEqual([]);
      expect((await pinRow(s.userId)).failures).toBe(0);
      expect((await get(s.auth, '/shifts/current')).body.shift).toBeNull();
    });

    it('a failure midway leaves nothing behind; the retry succeeds once', async () => {
      const s = await shop();
      const v = await post(s.auth, '/vouchers', {
        name: 'Hemat',
        code: `V${randomUUID().slice(0, 6)}`,
        type: 'flat',
        nominal: 1000,
        kuota: 5,
        startDate: jakartaDay(-1),
        expired: jakartaDay(1),
      }).expect(201);
      await open(s.auth);
      const sale = await sell(s.auth, {
        lines: [{ productId: s.productId, qty: 3 }],
        voucherCode: v.body.code,
        paid: 14_000,
      });
      // Fault: the batch can no longer take the units back (its check constraint refuses the restore),
      // after the ledger row and the voucher were already written in the transaction.
      await admin`update pos.stock_batches set qty_initial = qty_remaining where product_id = ${s.productId}`;
      const key = randomUUID();
      const failed = await voidSale(s.auth, sale.body.id, s.approval, key);
      expect(failed.status).toBeGreaterThanOrEqual(400);
      expect(JSON.stringify(failed.body)).not.toMatch(/stock_batches|qty_/);
      expect(await statusOf(sale.body.id)).toBe('completed');
      expect(await ledger(s.tenantId)).toEqual([]);
      expect(
        (await get(s.auth, `/vouchers/${v.body.id}`).expect(200)).body.kuota,
      ).toBe(4);
      expect(
        await admin`select 1 from pos.sale_voids where sale_id = ${sale.body.id}`,
      ).toHaveLength(0);

      await admin`update pos.stock_batches set qty_initial = 50 where product_id = ${s.productId}`;
      await voidSale(s.auth, sale.body.id, s.approval, key).expect(201);
      expect((await batches(s.auth, s.productId)).onHand).toBe(50);
      expect(await ledger(s.tenantId)).toHaveLength(1);
      expect(
        (await get(s.auth, `/vouchers/${v.body.id}`).expect(200)).body.kuota,
      ).toBe(5);
    });
  });

  describe('non-cash sale (EDC, transfer, the store QRIS)', () => {
    it('is returned by transfer: no ledger entry, expected cash unchanged, no open shift needed', async () => {
      const s = await shop();
      await open(s.auth);
      const sale = await sell(s.auth, {
        lines: [{ productId: s.productId, qty: 2 }],
        paymentMethodId: s.debitId,
        paid: 10_000,
      });
      await close(s.auth, 100_000);

      const res = await voidSale(s.auth, sale.body.id, {
        ...s.approval,
        reasonCode: 'wrong_payment_method',
      }).expect(201);
      expect(res.body).toMatchObject({
        shiftId: null,
        cashReturned: 0,
        transferReturned: 10_000,
        returns: [
          { amount: 10_000, paymentMethod: 'Kartu Debit', fromDrawer: false },
        ],
      });
      expect(await ledger(s.tenantId)).toEqual([]);
      expect((await batches(s.auth, s.productId)).onHand).toBe(50);

      // With a shift open, its expected cash still does not move.
      await open(s.auth);
      const second = await sell(s.auth, {
        lines: [{ productId: s.productId, qty: 1 }],
        paymentMethodId: s.debitId,
        paid: 5000,
      });
      await voidSale(s.auth, second.body.id, s.approval).expect(201);
      expect(await current(s.auth)).toMatchObject({
        expectedCash: 100_000,
        cashOut: 0,
        voidRefunds: 0,
      });
    });
  });

  describe('kasbon sale', () => {
    const kasbonSale = (s: Awaited<ReturnType<typeof shop>>, paid: number) =>
      sell(s.auth, {
        lines: [{ productId: s.productId, qty: 2 }],
        memberId: s.memberId,
        paymentMethodId: s.kasbonId,
        paid,
      });
    const pay = (auth: string, rid: string, body: object) =>
      keyed(auth, `/receivables/${rid}/payments`, body);

    it('unpaid: the receivable is cancelled, nothing is returned, no shift is needed', async () => {
      const s = await shop();
      await open(s.auth);
      const sale = await kasbonSale(s, 0);
      const rid = sale.body.receivableId as string;
      await close(s.auth, 100_000);

      const res = await voidSale(s.auth, sale.body.id, s.approval).expect(201);
      expect(res.body).toMatchObject({
        shiftId: null,
        cashReturned: 0,
        transferReturned: 0,
        receivableCancelled: 10_000,
        total: 10_000,
        returns: [],
      });
      const r = await get(s.auth, `/receivables/${rid}`).expect(200);
      expect(r.body).toMatchObject({ rest: 0, cancelledAmount: 10_000 });
      expect(r.body.cancelledAt).toEqual(expect.any(String));
      expect((await batches(s.auth, s.productId)).onHand).toBe(50);

      await open(s.auth);
      const refused = await pay(s.auth, rid, { amount: 1000 }).expect(422);
      expect(refused.body.message).toMatch(/dibatalkan/);
      const lists = await Promise.all(
        ['open', 'settled', 'cancelled'].map((st) =>
          get(s.auth, `/receivables?status=${st}`).expect(200),
        ),
      );
      expect(lists.map((l) => l.body.total as number)).toEqual([0, 0, 1]);
      expect(lists[2].body.summary).toEqual({
        openRest: 0,
        openCount: 0,
        outsideShiftCollected: 0,
      });
    });

    it('partly paid: the rest is cancelled, cash payments leave the drawer, a debit payment goes back by transfer', async () => {
      const s = await shop();
      await open(s.auth);
      const sale = await kasbonSale(s, 1000); // down payment, counted in the shift's cash sales
      const rid = sale.body.receivableId as string;
      await pay(s.auth, rid, { amount: 2500 }).expect(201);
      await pay(s.auth, rid, {
        amount: 500,
        paymentMethodId: s.debitId,
      }).expect(201);
      expect((await current(s.auth)).expectedCash).toBe(103_500);
      const shiftId = (await current(s.auth)).id as string;
      const before = await get(s.auth, `/shifts/${shiftId}`).expect(200);
      expect(before.body.cashEntries).toMatchObject([
        { kind: 'receivable_payment', reversed: false, reversalOf: null },
      ]);

      const res = await voidSale(s.auth, sale.body.id, s.approval).expect(201);
      expect(res.body).toMatchObject({
        cashReturned: 3500,
        transferReturned: 500,
        receivableCancelled: 6000,
        total: 10_000,
      });
      expect(
        (res.body.returns as { amount: number; fromDrawer: boolean }[]).map(
          (r) => [r.amount, r.fromDrawer],
        ),
      ).toEqual([
        [1000, true],
        [2500, true],
        [500, false],
      ]);
      expect(
        (res.body.returns as { receivablePaymentId: string | null }[]).every(
          (r) => r.receivablePaymentId,
        ),
      ).toBe(true);
      expect(await current(s.auth)).toMatchObject({
        cashSales: 1000,
        receivablePayments: 2500,
        voidRefunds: 3500,
        expectedCash: 100_000,
      });
      const r = await get(s.auth, `/receivables/${rid}`).expect(200);
      expect(r.body).toMatchObject({ rest: 0, cancelledAmount: 6000 });
      expect(r.body.payments).toHaveLength(3); // the payment history is kept
      // The drawer list marks both sides (design fitur 20: "Dibatalkan" and "Pembalik"): the instalment
      // whose kasbon was cancelled, and the cash-out that undoes the sale.
      const after = await get(s.auth, `/shifts/${shiftId}`).expect(200);
      expect(after.body.cashEntries).toMatchObject([
        {
          kind: 'receivable_payment',
          amount: 2500,
          reversed: true,
          reversalOf: null,
          actorKind: 'owner',
          actorName: 'Pemilik',
        },
        {
          kind: 'void_refund',
          amount: 3500,
          refId: res.body.id,
          reversed: false,
          reversalOf: { type: 'sale', id: sale.body.id, entryId: null },
          actorKind: 'owner',
          actorName: 'Pemilik',
        },
      ]);

      // One instant for the whole void: sale, receivable, void record and ledger entry.
      const [t] = await admin`
        select s.voided_at, r.cancelled_at, v.created_at as void_at, e.created_at as entry_at
          from pos.sale_voids v
          join pos.sales s on s.id = v.sale_id
          join pos.receivables r on r.sale_id = v.sale_id
          join pos.shift_cash_entries e on e.ref_id = v.id
         where v.id = ${res.body.id}`;
      expect(t.voided_at).toBeInstanceOf(Date);
      expect([t.cancelled_at, t.void_at, t.entry_at]).toEqual([
        t.voided_at,
        t.voided_at,
        t.voided_at,
      ]);
      expect(r.body.cancelledAt).toBe((t.voided_at as Date).toISOString());
    });

    it('partly paid in a closed shift: needs an open shift, and pays out of that one', async () => {
      const s = await shop();
      const first = await open(s.auth);
      const sale = await kasbonSale(s, 0);
      await pay(s.auth, sale.body.receivableId, { amount: 2500 }).expect(201);
      await close(s.auth, 102_500);

      const blocked = await voidSale(s.auth, sale.body.id, s.approval);
      expect(blocked.status).toBe(422);
      expect(await statusOf(sale.body.id)).toBe('completed');

      const second = await open(s.auth);
      const res = await voidSale(s.auth, sale.body.id, s.approval).expect(201);
      expect(res.body).toMatchObject({
        shiftId: second.body.id,
        cashReturned: 2500,
        receivableCancelled: 7500,
      });
      expect((await current(s.auth)).expectedCash).toBe(97_500);
      const old = await get(s.auth, `/shifts/${first.body.id}`).expect(200);
      expect(old.body).toMatchObject({ expectedCash: 102_500, cashOut: 0 });
    });

    it('an instalment collected outside any shift: needs an open shift, and is paid out of that drawer', async () => {
      const s = await shop();
      const first = await open(s.auth);
      const sale = await kasbonSale(s, 0);
      const rid = sale.body.receivableId as string;
      await close(s.auth, 100_000);
      // Taken by an actor who cannot open a shift (UMK-1963 ruling): in the store cash, in no shift.
      const collector = await createCashier(app, s, ['receivables.manage']);
      const paid = await pay(collector.auth, rid, { amount: 2500 }).expect(201);
      expect(paid.body.payments).toEqual([
        expect.objectContaining({ collectedOutsideShift: true, shiftId: null }),
      ]);
      expect(await ledger(s.tenantId)).toEqual([]);

      // No drawer to give the cash back from: refused, and nothing changes.
      const blocked = await voidSale(s.auth, sale.body.id, s.approval);
      expect(blocked.status).toBe(422);
      expect(blocked.body.message).toBe(
        'Buka shift dulu untuk membatalkan struk tunai',
      );
      expect(await statusOf(sale.body.id)).toBe('completed');
      expect(
        (await get(s.auth, `/receivables/${rid}`).expect(200)).body,
      ).toMatchObject({ rest: 7500, cancelledAt: null });

      const second = await open(s.auth);
      const res = await voidSale(s.auth, sale.body.id, s.approval).expect(201);
      expect(res.body).toMatchObject({
        shiftId: second.body.id,
        cashReturned: 2500,
        transferReturned: 0,
        receivableCancelled: 7500,
        returns: [
          {
            amount: 2500,
            fromDrawer: true,
            receivablePaymentId: paid.body.payments[0].id,
            collectedOutsideShift: true,
          },
        ],
      });
      // The cash leaves the drawer open now, like an instalment taken in another shift.
      expect(await current(s.auth)).toMatchObject({
        cashIn: 0,
        cashOut: 2500,
        voidRefunds: 2500,
        expectedCash: 97_500,
      });
      expect(await ledger(s.tenantId)).toEqual([
        expect.objectContaining({
          shift_id: second.body.id,
          direction: 'out',
          kind: 'void_refund',
          amount: '2500',
          ref_id: res.body.id,
        }),
      ]);
      const old = await get(s.auth, `/shifts/${first.body.id}`).expect(200);
      expect(old.body).toMatchObject({ expectedCash: 100_000, cashOut: 0 });
      // The store cash still holds what the collector took in: the drawer paid the customer back.
      const cash = await get(s.auth, '/store-cash').expect(200);
      expect(cash.body.summary).toEqual({
        cashIn: 2500,
        cashOut: 0,
        balance: 2500,
        // Nothing handed over to the safe yet (UMK-1924 U3).
        outstanding: 2500,
        handedOver: 0,
      });
      // The payment row keeps its audit: still marked, still not in a shift.
      const r = await get(s.auth, `/receivables/${rid}`).expect(200);
      expect(r.body).toMatchObject({
        rest: 0,
        cancelledAmount: 7500,
        outsideShiftCollected: 2500,
        payments: [{ collectedOutsideShift: true, shiftId: null }],
      });
    });

    it('fully paid: every payment is returned and nothing is left to cancel', async () => {
      const s = await shop();
      await open(s.auth);
      const sale = await kasbonSale(s, 0);
      const rid = sale.body.receivableId as string;
      await pay(s.auth, rid, { amount: 4000 }).expect(201);
      await pay(s.auth, rid, { amount: 6000 }).expect(201);
      expect((await current(s.auth)).expectedCash).toBe(110_000);

      const res = await voidSale(s.auth, sale.body.id, s.approval).expect(201);
      expect(res.body).toMatchObject({
        cashReturned: 10_000,
        transferReturned: 0,
        receivableCancelled: 0,
      });
      expect(await current(s.auth)).toMatchObject({
        receivablePayments: 10_000,
        voidRefunds: 10_000,
        expectedCash: 100_000,
      });
      const r = await get(s.auth, `/receivables/${rid}`).expect(200);
      expect(r.body).toMatchObject({ rest: 0, cancelledAmount: 0 });
      expect(r.body.cancelledAt).toEqual(expect.any(String));
    });
  });

  describe('idempotency and double void', () => {
    it('a replay returns the first result and changes nothing, even with another PIN', async () => {
      const s = await shop();
      await open(s.auth);
      const sale = await sell(s.auth, {
        lines: [{ productId: s.productId, qty: 3 }],
        paid: 15_000,
      });
      const other = await sell(s.auth, {
        lines: [{ productId: s.productId, qty: 1 }],
        paid: 5000,
      });
      const key = randomUUID();
      const first = await voidSale(s.auth, sale.body.id, s.approval, key);
      expect(first.status).toBe(201);
      const again = await voidSale(s.auth, sale.body.id, s.approval, key);
      expect(again.body).toEqual(first.body);
      const wrongPin = await voidSale(
        s.auth,
        sale.body.id,
        { ...s.approval, pin: '000000' },
        key,
      ).expect(201);
      expect(wrongPin.body.id).toBe(first.body.id);
      expect((await pinRow(s.userId)).failures).toBe(0);

      expect((await batches(s.auth, s.productId)).onHand).toBe(49);
      expect(await ledger(s.tenantId)).toHaveLength(1);
      expect((await current(s.auth)).expectedCash).toBe(105_000);

      // The key on another sale, or with another reason, is refused.
      const reused = await voidSale(s.auth, other.body.id, s.approval, key);
      expect(reused.status).toBe(422);
      expect(reused.body.errors.idempotencyKey).toEqual(expect.any(String));
      await voidSale(
        s.auth,
        sale.body.id,
        { ...s.approval, reasonCode: 'customer_cancelled' },
        key,
      ).expect(422);
      expect(await statusOf(other.body.id)).toBe('completed');

      // A new key on the voided sale: 409, not a second reversal.
      const second = await voidSale(s.auth, sale.body.id, s.approval);
      expect(second.status).toBe(409);
      expect(second.body.message).toBe('Struk ini sudah dibatalkan');
      expect(await ledger(s.tenantId)).toHaveLength(1);

      await voidSale(s.auth, other.body.id, s.approval, null).expect(422);
      await voidSale(s.auth, other.body.id, s.approval, 'x').expect(422);
      expect(await statusOf(other.body.id)).toBe('completed');
    });

    it('two voids of one sale at the same time: exactly one wins', async () => {
      const s = await shop();
      await open(s.auth);
      for (let round = 0; round < 3; round++) {
        const sale = await sell(s.auth, {
          lines: [{ productId: s.productId, qty: 3 }],
          paid: 15_000,
        });
        const results = await Promise.all([
          voidSale(s.auth, sale.body.id, s.approval),
          voidSale(s.auth, sale.body.id, s.approval),
          voidSale(s.auth, sale.body.id, s.approval),
        ]);
        expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409]);
        // The losers waited on the sale's row lock and get the plain answer, not a constraint error.
        expect(
          results
            .filter((r) => r.status === 409)
            .map((r) => (r.body as { message: string }).message),
        ).toEqual(['Struk ini sudah dibatalkan', 'Struk ini sudah dibatalkan']);
        expect((await batches(s.auth, s.productId)).onHand).toBe(50);
        expect(await ledger(s.tenantId)).toHaveLength(round + 1);
      }
      expect((await current(s.auth)).expectedCash).toBe(100_000);
    });

    it('the same request sent twice at once returns one void to both', async () => {
      const s = await shop();
      await open(s.auth);
      const sale = await sell(s.auth, {
        lines: [{ productId: s.productId, qty: 3 }],
        paid: 15_000,
      });
      const key = randomUUID();
      const [a, b] = await Promise.all([
        voidSale(s.auth, sale.body.id, s.approval, key),
        voidSale(s.auth, sale.body.id, s.approval, key),
      ]);
      expect([a.status, b.status]).toEqual([201, 201]);
      expect(a.body.id).toBe(b.body.id);
      expect(await ledger(s.tenantId)).toHaveLength(1);
      expect((await batches(s.auth, s.productId)).onHand).toBe(50);
    });
  });

  describe('approval: sales.void and the PIN', () => {
    /** Ayu sells (no sales.void); Rina and Tono hold sales.void, only Rina has a PIN; Budi holds neither. */
    async function crew() {
      const s = await shop();
      const ayu = await createCashier(app, s, ['sales.create']);
      const rina = await createCashier(app, s, ['sales.create', 'sales.void']);
      const tono = await createCashier(app, s, ['sales.create', 'sales.void']);
      const budi = await createCashier(app, s, ['sales.create']);
      await setPin(rina.auth, '715064').expect(200);
      await open(ayu.auth);
      const newSale = async (auth = ayu.auth) =>
        (
          await sell(auth, {
            lines: [{ productId: s.productId, qty: 1 }],
            paid: 5000,
          })
        ).body.id as string;
      const by = (approverId: string, pin: string) => ({
        reasonCode: 'customer_cancelled',
        approverId,
        pin,
      });
      return { s, ayu, rina, tono, budi, newSale, by };
    }

    it('a cashier starts, an admin approves; an admin or the owner may approve their own void', async () => {
      const { s, ayu, rina, newSale, by } = await crew();
      const res = await voidSale(
        ayu.auth,
        await newSale(),
        by(rina.staffId, '715064'),
      ).expect(201);
      expect(res.body.initiatedBy).toMatchObject({
        id: ayu.staffId,
        kind: 'cashier',
        name: 'Sari',
      });
      expect(res.body.approvedBy).toMatchObject({
        id: rina.staffId,
        kind: 'cashier',
        name: 'Sari 2',
      });
      expect(res.body.costTotal).toBeUndefined(); // cost only with reports.view

      // Rina voids her own sale with her own PIN.
      await open(rina.auth);
      const own = await voidSale(
        rina.auth,
        await newSale(rina.auth),
        by(rina.staffId, '715064'),
      ).expect(201);
      expect(own.body.initiatedBy.id).toBe(rina.staffId);
      expect(own.body.approvedBy.id).toBe(rina.staffId);

      // The owner's PIN approves a cashier's void too.
      const byOwner = await voidSale(
        ayu.auth,
        await newSale(),
        by(s.userId, OWNER_PIN),
      ).expect(201);
      expect(byOwner.body.approvedBy).toMatchObject({ kind: 'owner' });
    });

    it('refuses an approver without sales.void, unknown, from another store or deactivated like a wrong PIN, and counts nothing', async () => {
      const { s, ayu, rina, budi, newSale, by } = await crew();
      const other = await shop();
      const saleId = await newSale();

      const wrong = await voidSale(
        ayu.auth,
        saleId,
        by(rina.staffId, '000000'),
      );
      expect(wrong.status).toBe(422);
      expect(wrong.body).toEqual({
        message: 'PIN salah',
        errors: { pin: 'PIN salah' },
      });
      expect((await pinRow(rina.staffId)).failures).toBe(1);

      for (const approverId of [budi.staffId, randomUUID(), other.userId]) {
        const res = await voidSale(ayu.auth, saleId, by(approverId, OWNER_PIN));
        expect(res.status).toBe(422);
        expect(res.body).toEqual(wrong.body);
      }
      expect((await pinRow(other.userId)).failures).toBe(0);
      expect((await pinRow(rina.staffId)).failures).toBe(1);

      // Rina's PIN with someone else's id counts for that someone, not for Rina.
      await voidSale(ayu.auth, saleId, by(s.userId, '715064')).expect(422);
      expect((await pinRow(s.userId)).failures).toBe(1);
      expect((await pinRow(rina.staffId)).failures).toBe(1);

      await http()
        .patch(`/staff/${rina.staffId}`)
        .set('Authorization', s.auth)
        .send({ active: false })
        .expect(200);
      const gone = await voidSale(ayu.auth, saleId, by(rina.staffId, '715064'));
      expect(gone.status).toBe(422);
      expect(gone.body).toEqual(wrong.body);
      expect(await statusOf(saleId)).toBe('completed');
    });

    it('an approver without a PIN gets a clear message; the picker shows who can approve', async () => {
      const { s, ayu, rina, tono, newSale, by } = await crew();
      const saleId = await newSale();
      const res = await voidSale(ayu.auth, saleId, by(tono.staffId, '123456'));
      expect(res.status).toBe(422);
      expect(res.body.errors.approverId).toMatch(/belum membuat PIN/);
      expect(await statusOf(saleId)).toBe('completed');

      const list = await get(ayu.auth, '/void-pin/approvers').expect(200);
      expect(list.body).toEqual([
        {
          id: s.userId,
          kind: 'owner',
          name: 'Pemilik',
          hasPin: true,
          lockedUntil: null,
        },
        {
          id: rina.staffId,
          kind: 'cashier',
          name: 'Sari 2',
          hasPin: true,
          lockedUntil: null,
        },
        {
          id: tono.staffId,
          kind: 'cashier',
          name: 'Sari 3',
          hasPin: false,
          lockedUntil: null,
        },
      ]);
    });

    it('needs sales.create to start a void', async () => {
      const { s, rina, newSale, by } = await crew();
      const viewer = await createCashier(app, s, ['reports.view']);
      await voidSale(
        viewer.auth,
        await newSale(),
        by(rina.staffId, '715064'),
      ).expect(403);
    });

    it('setting a PIN: six digits, own PIN only, sales.void required, the current PIN to change it', async () => {
      const { s, ayu, rina, tono, newSale, by } = await crew();
      for (const pin of ['12345', '1234567', '12a456', ' 482913', 482913, null])
        await put(tono.auth, '/void-pin', { pin: pin as string }).expect(422);
      await put(tono.auth, '/void-pin', { pin: '111111', x: 1 }).expect(422);
      await setPin(ayu.auth, '111111').expect(403);
      await get(ayu.auth, '/void-pin').expect(403);
      expect((await get(tono.auth, '/void-pin').expect(200)).body).toEqual({
        hasPin: false,
        lockedUntil: null,
      });

      // Same PIN as Rina on purpose: the hashes must differ, and no response carries a PIN or a hash.
      const set = await setPin(tono.auth, '715064').expect(200);
      expect(set.body).toEqual({ hasPin: true, lockedUntil: null });
      const [a, b] = [await pinRow(rina.staffId), await pinRow(tono.staffId)];
      expect(a.pin_hash).not.toBe(b.pin_hash);
      expect(a.pin_hash).toMatch(/^scrypt\$/);
      expect(a.pin_hash).not.toContain('715064');
      for (const url of ['/staff', `/staff/${rina.staffId}`, '/void-pin'])
        expect(JSON.stringify((await get(s.auth, url)).body)).not.toMatch(
          /715064|scrypt|pinHash|pin_hash/,
        );

      // Changing needs the current PIN; a wrong one counts as a failed try.
      const missing = await setPin(tono.auth, '222222').expect(422);
      expect(missing.body.errors.currentPin).toMatch(/PIN lama/);
      await setPin(tono.auth, '222222', '000000').expect(422);
      expect((await pinRow(tono.staffId)).failures).toBe(1);
      await setPin(tono.auth, '222222', '715064').expect(200);
      expect((await pinRow(tono.staffId)).failures).toBe(0);
      const saleId = await newSale();
      await voidSale(ayu.auth, saleId, by(tono.staffId, '715064')).expect(422);
      await voidSale(ayu.auth, saleId, by(tono.staffId, '222222')).expect(201);
    });

    it('5 wrong PINs lock that approver for 5 minutes; only the owner unlocks', async () => {
      const { s, ayu, rina, tono, newSale, by } = await crew();
      const other = await shop();
      const saleId = await newSale();
      const guess = (pin: string) =>
        voidSale(ayu.auth, saleId, by(rina.staffId, pin));

      for (let i = 0; i < 4; i++) await guess('000000').expect(422);
      // A correct PIN resets the count: four more wrong ones do not lock.
      await guess('715064').expect(201);
      expect((await pinRow(rina.staffId)).failures).toBe(0);
      const next = await newSale();
      const guessNext = (pin: string) =>
        voidSale(ayu.auth, next, by(rina.staffId, pin));
      for (let i = 0; i < 4; i++) await guessNext('000000').expect(422);

      const fifth = await guessNext('000000').expect(429);
      expect(fifth.body.retryAfter).toBe(300);
      expect(fifth.headers['retry-after']).toBe('300');
      expect(fifth.body.message).toMatch(/Terlalu banyak PIN salah/);
      const lockedUntil = (await pinRow(rina.staffId)).locked_until!;
      expect(lockedUntil.getTime() - Date.now()).toBeGreaterThan(295_000);
      expect(lockedUntil.getTime() - Date.now()).toBeLessThanOrEqual(300_000);

      // During the lock a correct PIN is refused too, and trying does not extend the lock.
      const during = await guessNext('715064').expect(429);
      expect(during.body.retryAfter).toBeLessThanOrEqual(300);
      await guessNext('000000').expect(429);
      expect((await pinRow(rina.staffId)).locked_until).toEqual(lockedUntil);
      expect(await statusOf(next)).toBe('completed');
      const picker = await get(ayu.auth, '/void-pin/approvers').expect(200);
      expect(
        (picker.body as { id: string; lockedUntil: string | null }[]).find(
          (a) => a.id === rina.staffId,
        )!.lockedUntil,
      ).toEqual(lockedUntil.toISOString());

      // The lock is per approver: the owner's PIN still works for the same cashier.
      expect((await pinRow(s.userId)).failures).toBe(0);

      // Unlock: not the cashier, not an admin, not herself, not another store's owner. The owner can.
      const unlock = (auth: string) =>
        post(auth, `/void-pin/${rina.staffId}/unlock`);
      await setPin(tono.auth, '333333').expect(200);
      await unlock(ayu.auth).expect(403);
      await unlock(tono.auth).expect(403);
      await unlock(rina.auth).expect(403);
      await unlock(other.auth).expect(404);
      expect((await pinRow(rina.staffId)).locked_until).toEqual(lockedUntil);
      const unlocked = await unlock(s.auth).expect(200);
      expect(unlocked.body).toEqual({
        actorId: rina.staffId,
        hasPin: true,
        lockedUntil: null,
      });
      const [audit] =
        await admin`select unlocked_by, unlocked_at from pos.void_pins where actor_id = ${rina.staffId}`;
      expect(audit.unlocked_by).toBe(s.userId);
      expect(audit.unlocked_at).toBeInstanceOf(Date);
      await guessNext('715064').expect(201);
    });

    it('after a lock runs out the count starts again at 0', async () => {
      const { ayu, rina, newSale, by } = await crew();
      const saleId = await newSale();
      const guess = (pin: string) =>
        voidSale(ayu.auth, saleId, by(rina.staffId, pin));
      for (let i = 0; i < 4; i++) await guess('000000').expect(422);
      await guess('000000').expect(429);
      await admin`update pos.void_pins set locked_until = now() - interval '1 second' where actor_id = ${rina.staffId}`;

      await guess('000000').expect(422); // counts as 1, no lock at once
      expect(await pinRow(rina.staffId)).toMatchObject({
        failures: 1,
        locked_until: null,
      });
      await guess('715064').expect(201);
    });

    it('parallel guesses cannot beat the counter', async () => {
      const { ayu, rina, newSale, by } = await crew();
      const saleId = await newSale();
      const results = await Promise.all(
        Array.from({ length: 9 }, (_, i) =>
          voidSale(
            ayu.auth,
            saleId,
            by(rina.staffId, `00000${i}`), // nine different wrong PINs
          ),
        ),
      );
      const statuses = results.map((r) => r.status).sort();
      expect(statuses).toEqual([422, 422, 422, 422, 429, 429, 429, 429, 429]);
      expect((await pinRow(rina.staffId)).failures).toBe(5);
      expect(await statusOf(saleId)).toBe('completed');
    });

    it('the owner removes a forgotten PIN; its holder sets a new one', async () => {
      const { s, ayu, rina, tono, newSale, by } = await crew();
      const other = await shop();
      const reset = (auth: string) =>
        http().delete(`/void-pin/${rina.staffId}`).set('Authorization', auth);
      await setPin(tono.auth, '333333').expect(200);
      await reset(tono.auth).expect(403);
      await reset(rina.auth).expect(403);
      await reset(other.auth).expect(404);
      await reset(s.auth).expect(200);
      await reset(s.auth).expect(404);
      await post(s.auth, `/void-pin/${rina.staffId}/unlock`).expect(404);

      const saleId = await newSale();
      const res = await voidSale(ayu.auth, saleId, by(rina.staffId, '715064'));
      expect(res.status).toBe(422);
      expect(res.body.errors.approverId).toMatch(/belum membuat PIN/);
      await setPin(rina.auth, '909090').expect(200);
      await voidSale(ayu.auth, saleId, by(rina.staffId, '909090')).expect(201);
    });
  });

  describe("the owner's own PIN (UMK-2054)", () => {
    const reset = (auth: string, actorId: string) =>
      http().delete(`/void-pin/${actorId}`).set('Authorization', auth);
    const unlock = (auth: string, actorId: string) =>
      post(auth, `/void-pin/${actorId}/unlock`);
    /** An owner session whose sign-in was `ageSeconds` ago. */
    const signedIn = async (
      s: { tenantId: string; userId: string },
      ageSeconds: number,
    ) =>
      `Bearer ${await signSession(
        {
          tenantId: s.tenantId,
          actorId: s.userId,
          kind: 'owner',
          signedInAt: Math.floor(Date.now() / 1000) - ageSeconds,
        },
        process.env.POS_SESSION_SECRET!,
      )}`;
    const FRESH = {
      message: expect.stringMatching(/masuk lagi/i),
      code: 'fresh_sign_in_required',
    };

    it('changing it needs the old PIN: missing or wrong changes nothing, and wrong ones count toward the lock', async () => {
      const s = await shop();
      const hash = (await pinRow(s.userId)).pin_hash;
      // A fresh sign-in does not stand in for the old PIN either.
      for (const auth of [s.auth, s.freshAuth]) {
        const missing = await setPin(auth, '270183').expect(422);
        expect(missing.body.errors.currentPin).toMatch(/PIN lama/);
      }
      expect((await pinRow(s.userId)).failures).toBe(0);
      const wrong = await setPin(s.auth, '270183', '000000').expect(422);
      expect(wrong.body.errors).toEqual({ currentPin: 'PIN salah' });
      expect(await pinRow(s.userId)).toMatchObject({
        failures: 1,
        pin_hash: hash,
      });
      for (let i = 0; i < 3; i++)
        await setPin(s.freshAuth, '270183', '000000').expect(422);
      // The 5th wrong old PIN locks the PIN itself: the void's lock, so the right old PIN waits too.
      const fifth = await setPin(s.auth, '270183', '000000').expect(429);
      expect(fifth.body.retryAfter).toBe(300);
      await setPin(s.auth, '270183', OWNER_PIN).expect(429);
      expect((await pinRow(s.userId)).pin_hash).toBe(hash);
      await open(s.auth);
      const sale = await sell(s.auth, {
        lines: [{ productId: s.productId, qty: 1 }],
        paid: 5000,
      });
      await voidSale(s.auth, sale.body.id, s.approval).expect(429);

      await admin`update pos.void_pins set locked_until = now() - interval '1 second' where actor_id = ${s.userId}`;
      // With the old PIN it changes, in a session that is not fresh.
      expect(
        (await setPin(s.auth, '270183', OWNER_PIN).expect(200)).body,
      ).toEqual({ hasPin: true, lockedUntil: null });
      await voidSale(s.auth, sale.body.id, s.approval).expect(422);
      await voidSale(s.auth, sale.body.id, {
        ...s.approval,
        pin: '270183',
      }).expect(201);
    });

    it('removing it (forgot PIN) needs a fresh sign-in: 403 fresh_sign_in_required otherwise, and nothing changes', async () => {
      const s = await shop();
      const hash = (await pinRow(s.userId)).pin_hash;
      const stale = [
        s.auth, // no sign-in time: a refreshed session
        await signedIn(s, 301), // signed in more than 5 minutes ago
        await signedIn(s, -60), // a sign-in time in the future
      ];
      for (const auth of stale) {
        const res = await reset(auth, s.userId).expect(403);
        expect(res.body).toEqual(FRESH);
      }
      expect((await pinRow(s.userId)).pin_hash).toBe(hash);

      await reset(await signedIn(s, 290), s.userId).expect(200);
      expect(await pinRow(s.userId)).toBeUndefined();
      // The first PIN after it has no old PIN to ask for: it needs the fresh sign-in too.
      for (const auth of stale) {
        const res = await setPin(auth, '270183').expect(403);
        expect(res.body).toEqual(FRESH);
        expect(
          (await setPin(auth, '270183', OWNER_PIN).expect(403)).body,
        ).toEqual(FRESH);
      }
      expect(await pinRow(s.userId)).toBeUndefined();
      await setPin(s.freshAuth, '270183').expect(200);
      expect((await get(s.auth, '/void-pin').expect(200)).body).toEqual({
        hasPin: true,
        lockedUntil: null,
      });
    });

    it('clearing its lock needs a fresh sign-in; the lock and the count stay otherwise', async () => {
      const s = await shop();
      for (let i = 0; i < 4; i++)
        await setPin(s.auth, '270183', '000000').expect(422);
      await setPin(s.auth, '270183', '000000').expect(429);
      const lockedUntil = (await pinRow(s.userId)).locked_until;
      for (const auth of [s.auth, await signedIn(s, 301)])
        expect((await unlock(auth, s.userId).expect(403)).body).toEqual(FRESH);
      expect(await pinRow(s.userId)).toMatchObject({
        failures: 5,
        locked_until: lockedUntil,
      });
      await setPin(s.auth, '270183', OWNER_PIN).expect(429);

      await unlock(s.freshAuth, s.userId).expect(200);
      expect(await pinRow(s.userId)).toMatchObject({
        failures: 0,
        locked_until: null,
      });
      await setPin(s.auth, '270183', OWNER_PIN).expect(200);
    });

    it("an admin's PIN works as before: first PIN, reset and unlock by the owner need no fresh sign-in", async () => {
      const s = await shop();
      const rina = await createCashier(app, s, ['sales.create', 'sales.void']);
      await setPin(rina.auth, '715064').expect(200);
      await admin`update pos.void_pins set failures = 5, locked_until = now() + interval '5 minutes' where actor_id = ${rina.staffId}`;
      await unlock(s.auth, rina.staffId).expect(200);
      await reset(s.auth, rina.staffId).expect(200);
      await setPin(rina.auth, '909090').expect(200);
      // An admin never reaches the owner's PIN, fresh or not.
      await reset(rina.auth, s.userId).expect(403);
      await unlock(rina.auth, s.userId).expect(403);
      expect((await pinRow(s.userId)).pin_hash).toMatch(/^scrypt\$/);
    });

    it("another store's owner, freshly signed in, gets 404 on this owner's PIN", async () => {
      const a = await shop();
      const b = await shop();
      const hash = (await pinRow(a.userId)).pin_hash;
      await admin`update pos.void_pins set failures = 5, locked_until = now() + interval '5 minutes' where actor_id = ${a.userId}`;
      await reset(b.freshAuth, a.userId).expect(404);
      await unlock(b.freshAuth, a.userId).expect(404);
      expect(await pinRow(a.userId)).toMatchObject({
        failures: 5,
        pin_hash: hash,
      });
      // And B's own fresh session changes B's PIN only.
      await reset(b.freshAuth, b.userId).expect(200);
      expect((await pinRow(a.userId)).pin_hash).toBe(hash);
    });
  });

  describe('validation', () => {
    it('refuses a bad reason, a partial void and a malformed PIN with 422, without a PIN attempt', async () => {
      const s = await shop();
      await open(s.auth);
      const sale = await sell(s.auth, {
        lines: [{ productId: s.productId, qty: 3 }],
        paid: 15_000,
      });
      const ok = s.approval;
      const bad: object[] = [
        { ...ok, reasonCode: undefined },
        { ...ok, reasonCode: '' },
        { ...ok, reasonCode: 'Salah input barang' },
        { ...ok, reasonCode: 'wrong_item' }, // the code is wrong_item_or_qty
        { ...ok, reasonCode: 'other' },
        { ...ok, reasonCode: 'other', note: '   ' },
        { ...ok, note: 'x'.repeat(201) },
        { ...ok, lines: [{ productId: s.productId, qty: 1 }] },
        { ...ok, amount: 5000 },
        { ...ok, qty: 1 },
        { ...ok, approverId: undefined },
        { ...ok, approverId: 'rina' },
        { ...ok, pin: undefined },
        { ...ok, pin: '12345' },
        { ...ok, pin: '1234567' },
        { ...ok, pin: 'abcdef' },
        { ...ok, pin: 482913 },
        { ...ok, pin: null },
        { ...ok, pin: '9'.repeat(10_000) },
      ];
      for (const body of bad) {
        const res = await voidSale(s.auth, sale.body.id, body);
        expect([res.status, JSON.stringify(body).slice(0, 80)]).toEqual([
          422,
          JSON.stringify(body).slice(0, 80),
        ]);
        expect(res.body.errors).toEqual(expect.any(Object));
        expect(JSON.stringify(res.body)).not.toContain('482913');
      }
      expect((await pinRow(s.userId)).failures).toBe(0);
      expect(await statusOf(sale.body.id)).toBe('completed');

      const res = await voidSale(s.auth, sale.body.id, {
        ...ok,
        reasonCode: 'other',
        note: '  Salah pelanggan  ',
      }).expect(201);
      expect(res.body).toMatchObject({
        reasonCode: 'other',
        note: 'Salah pelanggan',
      });
    });

    it('accepts each of the six reason codes', async () => {
      const s = await shop();
      await open(s.auth);
      for (const reasonCode of [
        'wrong_item_or_qty',
        'wrong_payment_method',
        'customer_cancelled',
        'duplicate_transaction',
        'goods_returned',
      ]) {
        const sale = await sell(s.auth, {
          lines: [{ productId: s.productId, qty: 1 }],
          paid: 5000,
        });
        const res = await voidSale(s.auth, sale.body.id, {
          ...s.approval,
          reasonCode,
        }).expect(201);
        expect(res.body.reasonCode).toBe(reasonCode);
      }
    });
  });

  describe('reports', () => {
    it('a same-day void nets to zero in the dashboard, sales, product and shift reports', async () => {
      const s = await shop();
      const shift = await open(s.auth);
      const kept = await sell(s.auth, {
        lines: [{ productId: s.productId, qty: 2 }],
        paid: 10_000,
      });
      const gone = await sell(s.auth, {
        lines: [{ productId: s.productId, qty: 3 }],
        paid: 15_000,
      });
      const range = `from=${today()}&to=${today()}`;
      const read = async () => {
        const [dash, sales, products, shifts, history] = await Promise.all([
          get(s.auth, '/reports/dashboard?period=today').expect(200),
          get(s.auth, `/reports/sales?${range}`).expect(200),
          get(s.auth, `/reports/products?${range}`).expect(200),
          get(s.auth, `/reports/shifts?${range}`).expect(200),
          get(s.auth, '/sales').expect(200),
        ]);
        return {
          dash: dash.body.current,
          sales: sales.body,
          products: products.body,
          shifts: shifts.body,
          history: history.body,
        };
      };
      const before = await read();
      expect(before.dash).toMatchObject({ salesCount: 2, revenue: 25_000 });

      await voidSale(s.auth, gone.body.id, s.approval).expect(201);
      const after = await read();
      const one = {
        salesCount: 1,
        grossSales: 10_000,
        revenue: 10_000,
        cost: 4000,
        grossProfit: 6000,
      };
      expect(after.dash).toMatchObject(one);
      expect(after.sales.totals).toMatchObject({ ...one, qty: 2 });
      // The voided receipt stays as rung up; its reversal follows with the same figures, negative.
      expect(
        (
          after.sales.rows as {
            number: number;
            kind: string;
            qty: number;
            lineTotal: number;
            cost: number;
          }[]
        ).map((r) => [r.number, r.kind, r.qty, r.lineTotal, r.cost]),
      ).toEqual([
        [kept.body.number, 'sale', 2, 10_000, 4000],
        [gone.body.number, 'sale', 3, 15_000, 6000],
        [gone.body.number, 'void', -3, -15_000, -6000],
      ]);
      expect(after.products.totals).toMatchObject({ ...one, qty: 2 });
      expect(after.products.rows).toEqual([
        expect.objectContaining({ qty: 2, sales: 10_000, cost: 4000 }),
      ]);
      expect(after.shifts.rows).toEqual([
        expect.objectContaining({
          shiftId: shift.body.id,
          ...one,
          cashOut: 15_000,
          voidRefunds: 15_000,
          voidCount: 1,
        }),
      ]);
      expect(after.shifts.totals).toMatchObject(one);
      expect(after.dash.voidCount).toBe(1);

      // History still lists both receipts, with their status; the money summary counts one.
      expect(after.history.total).toBe(2);
      expect(
        (after.history.data as { id: string; status: string }[])
          .map((r) => [r.id, r.status])
          .sort(),
      ).toEqual(
        [
          [kept.body.id, 'completed'],
          [gone.body.id, 'void'],
        ].sort(),
      );
      expect(after.history.summary).toEqual({
        count: 1,
        revenue: 10_000,
        rounding: 0,
        discount: 0,
        voucherDiscount: 0,
        voidedCount: 1,
      });
    });

    it("a void of yesterday's receipt is a reversal in today's reports; yesterday's never change", async () => {
      const s = await shop();
      await put(s.auth, '/sales/settings', { taxBps: 1000 }).expect(200);
      const oldShift = await open(s.auth);
      // Yesterday: 3 × Rp5.000 + 10% tax = Rp16.500, cost Rp6.000, in a shift that was closed.
      const old = await sell(s.auth, {
        lines: [{ productId: s.productId, qty: 3 }],
        paid: 16_500,
      });
      await close(s.auth, 116_500);
      await admin`update pos.sales set created_at = created_at - interval '1 day', paid_at = paid_at - interval '1 day' where id = ${old.body.id}`;
      await admin`update pos.shifts set opened_at = opened_at - interval '1 day',
        closed_at = closed_at - interval '1 day' where id = ${oldShift.body.id}`;

      const day = (from: string, to = from) => `from=${from}&to=${to}`;
      const read = async (range: string) => {
        const [sales, products, shifts] = await Promise.all(
          ['sales', 'products', 'shifts'].map((r) =>
            get(s.auth, `/reports/${r}?${range}`).expect(200),
          ),
        );
        return {
          sales: sales.body as {
            totals: object;
            rows: Record<string, unknown>[];
          },
          products: products.body as { totals: object; rows: object[] },
          shifts: shifts.body as { totals: object; rows: object[] },
        };
      };
      const yesterday = day(jakartaDay(-1));
      const before = await read(yesterday);
      // The receipt history of a window (GET /sales) follows the same dating.
      const history = async (from: string, to: string) =>
        (
          await get(
            s.auth,
            `/sales?from=${from}T00:00:00%2B07:00&to=${to}T00:00:00%2B07:00`,
          ).expect(200)
        ).body.summary as Record<string, number>;
      const historyBefore = await history(jakartaDay(-1), today());
      expect(historyBefore).toEqual({
        count: 1,
        revenue: 16_500,
        rounding: 0,
        discount: 0,
        voucherDiscount: 0,
        voidedCount: 0,
      });
      expect(before.sales.totals).toMatchObject({
        salesCount: 1,
        qty: 3,
        grossSales: 15_000,
        tax: 1500,
        revenue: 16_500,
        cost: 6000,
        grossProfit: 9000,
        voidCount: 0,
      });

      // Today: one sale of 1 × Rp5.000 + tax = Rp5.500 (cost Rp2.000), then the void of yesterday's receipt.
      const shift = await open(s.auth);
      const kept = await sell(s.auth, {
        lines: [{ productId: s.productId, qty: 1 }],
        paid: 5500,
      });
      await voidSale(s.auth, old.body.id, s.approval).expect(201);

      // Yesterday is exactly as it was: totals, rows, the closed shift's row.
      expect(await read(yesterday)).toEqual(before);

      expect(await history(jakartaDay(-1), today())).toEqual(historyBefore);
      expect(await history(today(), jakartaDay(1))).toEqual({
        count: 0,
        revenue: -11_000,
        rounding: 0,
        discount: 0,
        voucherDiscount: 0,
        voidedCount: 1,
      });
      expect(await history(jakartaDay(-1), jakartaDay(1))).toEqual({
        count: 1,
        revenue: 5500,
        rounding: 0,
        discount: 0,
        voucherDiscount: 0,
        voidedCount: 1,
      });

      // Today carries the reversal: 5.500 − 16.500, and so on for every figure.
      const net = {
        salesCount: 0,
        grossSales: -10_000,
        discount: 0,
        voucher: 0,
        tax: -1000,
        revenue: -11_000,
        cost: -4000,
        grossProfit: -6000,
      };
      const now = await read(day(today()));
      expect(now.sales.totals).toMatchObject({ ...net, qty: -2, voidCount: 1 });
      expect(
        now.sales.rows.map((r) => [
          r.number,
          r.kind,
          r.qty,
          r.lineTotal,
          r.cost,
          r.grossProfit,
        ]),
      ).toEqual([
        [kept.body.number, 'sale', 1, 5000, 2000, 3000],
        [old.body.number, 'void', -3, -15_000, -6000, -9000],
      ]);
      expect(now.products.totals).toMatchObject({ ...net, qty: -2 });
      expect(now.products.rows).toEqual([
        expect.objectContaining({
          qty: -2,
          sales: -10_000,
          cost: -4000,
          grossProfit: -6000,
        }),
      ]);
      expect(now.shifts.rows).toEqual([
        expect.objectContaining({
          shiftId: shift.body.id,
          ...net,
          voidCount: 1,
          voidRefunds: 16_500,
          cashOut: 16_500,
        }),
      ]);
      expect(now.shifts.totals).toMatchObject(net);
      const dash = await get(s.auth, '/reports/dashboard?period=today');
      expect(dash.body.current).toMatchObject({ ...net, voidCount: 1 });

      // Both days together: only today's sale is left.
      const both = await read(day(jakartaDay(-1), today()));
      const left = {
        salesCount: 1,
        grossSales: 5000,
        tax: 500,
        revenue: 5500,
        cost: 2000,
        grossProfit: 3000,
      };
      expect(both.sales.totals).toMatchObject({ ...left, qty: 1 });
      expect(both.products.totals).toMatchObject({ ...left, qty: 1 });
      expect(both.products.rows).toEqual([
        expect.objectContaining({ qty: 1, sales: 5000, cost: 2000 }),
      ]);
      expect(both.shifts.totals).toMatchObject(left);
      expect(both.shifts.rows).toHaveLength(2);
    });

    it('a void without drawer cash is a reversal in the shift open at the void, or in no shift', async () => {
      const s = await shop();
      const first = await open(s.auth);
      const sale = (qty: number) =>
        sell(s.auth, {
          lines: [{ productId: s.productId, qty }],
          paymentMethodId: s.debitId,
          paid: qty * 5000,
        });
      const a = await sale(1);
      const b = await sale(2);
      await close(s.auth, 100_000);
      // No open shift: the day's figures carry the reversal, no shift row does.
      const noShift = await voidSale(s.auth, a.body.id, s.approval).expect(201);
      expect(noShift.body.shiftId).toBeNull();
      const second = await open(s.auth);
      const inShift = await voidSale(s.auth, b.body.id, s.approval).expect(201);
      expect(inShift.body.shiftId).toBe(second.body.id);

      const range = `from=${today()}&to=${today()}`;
      const shifts = await get(s.auth, `/reports/shifts?${range}`).expect(200);
      expect(
        (shifts.body.rows as Record<string, unknown>[]).map((r) => [
          r.shiftId,
          r.salesCount,
          r.revenue,
          r.voidCount,
          r.cashOut,
        ]),
      ).toEqual([
        [first.body.id, 2, 15_000, 0, 0],
        [second.body.id, -1, -10_000, 1, 0],
      ]);
      const sales = await get(s.auth, `/reports/sales?${range}`).expect(200);
      expect(sales.body.totals).toMatchObject({
        salesCount: 0,
        revenue: 0,
        cost: 0,
        qty: 0,
        voidCount: 2,
      });
      const products = await get(s.auth, `/reports/products?${range}`);
      expect(products.body.rows).toEqual([]);
    });
  });

  describe('tenancy', () => {
    it("store B gets 404 on store A's sale, void and approver", async () => {
      const a = await shop();
      const b = await shop();
      await open(a.auth);
      await open(b.auth);
      const sale = await sell(a.auth, {
        lines: [{ productId: a.productId, qty: 3 }],
        paid: 15_000,
      });

      await voidSale(b.auth, sale.body.id, b.approval).expect(404);
      // Store A's approver and PIN in a store B session change nothing either.
      await voidSale(b.auth, sale.body.id, a.approval).expect(404);
      await voidSale(b.auth, 'not-a-uuid', b.approval).expect(404);
      expect(await statusOf(sale.body.id)).toBe('completed');
      expect((await batches(a.auth, a.productId)).onHand).toBe(47);
      expect((await pinRow(a.userId)).failures).toBe(0);

      await voidSale(a.auth, sale.body.id, a.approval).expect(201);
      await get(b.auth, `/sales/${sale.body.id}/void`).expect(404);
      await get(b.auth, `/sales/${sale.body.id}`).expect(404);
      await get(a.auth, `/sales/${sale.body.id}/void`).expect(200);
      await post(b.auth, `/void-pin/${a.userId}/unlock`).expect(404);
      await http()
        .delete(`/void-pin/${a.userId}`)
        .set('Authorization', b.auth)
        .expect(404);
      expect((await pinRow(a.userId)).pin_hash).toMatch(/^scrypt\$/);
      const approvers = await get(b.auth, '/void-pin/approvers').expect(200);
      expect((approvers.body as { id: string }[]).map((x) => x.id)).toEqual([
        b.userId,
      ]);
    });

    it("a cashier reads the void of their own sale, not of a colleague's", async () => {
      const s = await shop();
      const ayu = await createCashier(app, s, ['sales.create']);
      const budi = await createCashier(app, s, ['sales.create']);
      await open(ayu.auth);
      const sale = await sell(ayu.auth, {
        lines: [{ productId: s.productId, qty: 1 }],
        paid: 5000,
      });
      await get(ayu.auth, `/sales/${sale.body.id}/void`).expect(404); // not voided yet
      await voidSale(ayu.auth, sale.body.id, s.approval).expect(201);
      await get(ayu.auth, `/sales/${sale.body.id}/void`).expect(200);
      await get(budi.auth, `/sales/${sale.body.id}/void`).expect(404);
    });
  });
});
