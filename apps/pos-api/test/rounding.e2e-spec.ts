import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import postgres from 'postgres';
import request from 'supertest';
import { cashRounding } from '../src/sales/sales.service';
import { ADMIN_DATABASE_URL } from './support/env';
import { createApp, createStore } from './support/fixtures';

const OWNER_PIN = '482913';
const today = () =>
  new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);

// One product: price Rp12.345, cost Rp5.000. With tax 11 %: tax 1.358 (half up), total 13.703,
// rounding 97, amount due 13.800.
const PRICE = 12_345;
const COST = 5_000;
const TAX = 1_358;
const TOTAL = 13_703;
const ROUNDING = 97;
const DUE = 13_800;

describe('cash rounding to the next Rp100 (UMK-1993)', () => {
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
    key: string = randomUUID(),
  ) =>
    http()
      .post(url)
      .set('Authorization', auth)
      .set('Idempotency-Key', key)
      .send(body);
  const current = async (auth: string) =>
    (await get(auth, '/shifts/current').expect(200)).body.shift as Record<
      string,
      unknown
    >;

  /**
   * A store with the product above (50 on hand), the methods Kasbon and Kartu Debit, a member, the owner's
   * void PIN and an open shift with Rp100.000. `taxBps` 1100 unless given.
   */
  async function shop(taxBps = 1100, price = PRICE) {
    const s = await createStore();
    const cat = await post(s.auth, '/catalog/categories', {
      name: 'Minuman',
    }).expect(201);
    const p = await post(s.auth, '/catalog/products', {
      categoryId: cat.body.id,
      name: 'Kopi Susu',
      costPrice: Math.min(COST, price), // a cost above the price is refused
      sellingPrice: price,
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
    await put(s.auth, '/sales/settings', { taxBps }).expect(200);
    await put(s.freshAuth, '/void-pin', { pin: OWNER_PIN }).expect(200);
    const shift = await post(s.auth, '/shifts/open', {
      openingCash: 100_000,
    }).expect(201);
    const sell = (body: object, key?: string) =>
      keyed(s.auth, '/sales', { lines: [{ productId, qty: 1 }], ...body }, key);
    const voidSale = (saleId: string) =>
      keyed(s.auth, `/sales/${saleId}/void`, {
        reasonCode: 'wrong_item_or_qty',
        approverId: s.userId,
        pin: OWNER_PIN,
      });
    return {
      ...s,
      productId,
      shiftId: shift.body.id as string,
      kasbonId: kasbon.body.id as string,
      debitId: debit.body.id as string,
      memberId: member.body.id as string,
      sell,
      voidSale,
    };
  }

  describe('the formula', () => {
    it.each([
      [0, 0],
      [100, 0],
      [1, 99],
      [99, 1],
      [200_123, 77],
      [200_200, 0],
      [999_999_999_901, 99],
    ])('total %d → rounding %d', (total, rounding) => {
      expect(cashRounding(total)).toBe(rounding);
      expect((total + cashRounding(total)) % 100).toBe(0);
    });

    it('is always 0..99, whole rupiah, and never rounds down', () => {
      for (let total = 0; total <= 1000; total++) {
        const r = cashRounding(total);
        expect(Number.isInteger(r)).toBe(true);
        expect(r).toBeGreaterThanOrEqual(0);
        expect(r).toBeLessThan(100);
        expect((total + r) % 100).toBe(0);
      }
    });
  });

  describe('cash sale', () => {
    // No tax, one item: the total is the price.
    it.each([
      [100, 0],
      [1, 99],
      [99, 1],
      [200_123, 77],
    ])(
      'a total of Rp%d is charged with rounding %d',
      async (price, rounding) => {
        const s = await shop(0, price);
        const due = price + rounding;
        // One rupiah short of the amount due is refused; the amount due itself leaves no change.
        const short = await s.sell({ paid: due - 1 }).expect(422);
        expect(short.body).toMatchObject({
          errors: {
            paid: 'Uang dibayar kurang dari jumlah yang harus dibayar',
          },
          total: price,
          rounding,
          amountDue: due,
        });
        const sale = await s.sell({ paid: due }).expect(201);
        expect(sale.body).toMatchObject({
          subtotal: price,
          tax: 0,
          total: price,
          rounding,
          amountDue: due,
          paid: due,
          change: 0,
        });
      },
    );

    it('a total of Rp0 (discount = subtotal) has no rounding', async () => {
      const s = await shop(0);
      const sale = await s.sell({ discount: PRICE, paid: 0 }).expect(201);
      expect(sale.body).toMatchObject({
        total: 0,
        rounding: 0,
        amountDue: 0,
        change: 0,
      });
    });

    it('rounds after tax, outside total: sale, history row, receipt and the stored row agree', async () => {
      const s = await shop();
      const sale = await s.sell({ paid: 20_000 }).expect(201);
      const figures = {
        subtotal: PRICE,
        discount: 0,
        voucherDiscount: 0,
        tax: TAX, // on the unrounded amount
        total: TOTAL, // as before UMK-1993
        rounding: ROUNDING,
        amountDue: DUE,
        paid: 20_000,
        change: 20_000 - DUE,
      };
      expect(sale.body).toMatchObject({ ...figures, paymentMethod: 'Tunai' });

      const one = await get(s.auth, `/sales/${sale.body.id}`).expect(200);
      expect(one.body).toMatchObject(figures);
      const list = await get(s.auth, '/sales').expect(200);
      expect(list.body.data[0]).toMatchObject(figures);
      const receipt = await get(
        s.auth,
        `/sales/${sale.body.id}/receipt`,
      ).expect(200);
      expect(receipt.body).toMatchObject({
        tax: TAX,
        total: TOTAL,
        rounding: ROUNDING,
        amountDue: DUE,
        paid: 20_000,
        change: 6_200,
      });

      const [row] = await admin`
        select total, rounding, paid, change from pos.sales where id = ${sale.body.id}`;
      expect({
        total: Number(row.total),
        rounding: Number(row.rounding),
        paid: Number(row.paid),
        change: Number(row.change),
      }).toEqual({
        total: TOTAL,
        rounding: ROUNDING,
        paid: 20_000,
        change: 6_200,
      });
    });

    it('needs the amount due, not the total; a replay returns the same rounding', async () => {
      const s = await shop();
      // The unrounded total no longer settles a cash sale.
      const short = await s.sell({ paid: TOTAL }).expect(422);
      expect(short.body).toMatchObject({
        errors: { paid: 'Uang dibayar kurang dari jumlah yang harus dibayar' },
        total: TOTAL,
        rounding: ROUNDING,
        amountDue: DUE,
      });
      await s.sell({ paid: DUE - 1 }).expect(422);
      expect((await get(s.auth, '/sales').expect(200)).body.total).toBe(0);

      const key = randomUUID();
      const first = await s.sell({ paid: DUE }, key).expect(201);
      expect(first.body).toMatchObject({
        total: TOTAL,
        rounding: ROUNDING,
        amountDue: DUE,
        change: 0,
      });
      const again = await s.sell({ paid: DUE }, key).expect(201);
      expect(again.body).toEqual(first.body);
      expect((await get(s.auth, '/sales').expect(200)).body.total).toBe(1);
    });

    it('a client cannot send its own rounding (strict schema)', async () => {
      const s = await shop();
      await s.sell({ paid: DUE, rounding: 0 }).expect(422);
      await s.sell({ paid: DUE, amountDue: TOTAL }).expect(422);
    });
  });

  describe('other methods are exact', () => {
    it('debit: rounding 0, paid must equal the total', async () => {
      const s = await shop();
      await s.sell({ paymentMethodId: s.debitId, paid: DUE }).expect(422);
      const sale = await s
        .sell({ paymentMethodId: s.debitId, paid: TOTAL })
        .expect(201);
      expect(sale.body).toMatchObject({
        tax: TAX,
        total: TOTAL,
        rounding: 0,
        amountDue: TOTAL,
        paid: TOTAL,
        change: 0,
      });
      const receipt = await get(
        s.auth,
        `/sales/${sale.body.id}/receipt`,
      ).expect(200);
      expect(receipt.body).toMatchObject({ rounding: 0, amountDue: TOTAL });
    });

    it('kasbon: the sale is not rounded and a cash instalment is taken as handed over', async () => {
      const s = await shop();
      const kasbon = (paid: number) =>
        s.sell({ memberId: s.memberId, paymentMethodId: s.kasbonId, paid });
      const unpaid = await kasbon(0).expect(201);
      expect(unpaid.body).toMatchObject({
        total: TOTAL,
        rounding: 0,
        amountDue: TOTAL,
        receivableRest: TOTAL,
      });
      // A cash down payment that is not a multiple of Rp100 stays as it is.
      const down = await kasbon(703).expect(201);
      expect(down.body).toMatchObject({
        total: TOTAL,
        rounding: 0,
        paid: 703,
        change: 0,
        receivableRest: 13_000,
      });
      // A cash instalment of Rp1.234 lowers the rest by Rp1.234.
      const paid = await keyed(
        s.auth,
        `/receivables/${unpaid.body.receivableId}/payments`,
        { amount: 1234 },
      ).expect(201);
      expect(paid.body.rest).toBe(TOTAL - 1234);
      // Drawer: the down payment as cash sales, the instalment as cash in; nothing rounded.
      expect(await current(s.auth)).toMatchObject({
        cashSales: 703,
        receivablePayments: 1234,
        expectedCash: 100_000 + 703 + 1234,
      });
      const dash = await get(s.auth, '/reports/dashboard?period=today').expect(
        200,
      );
      expect(dash.body.current).toMatchObject({
        revenue: 2 * TOTAL,
        rounding: 0,
      });
    });
  });

  describe('check constraints', () => {
    it('sales_money_ck counts rounding once and only up to the next Rp100', async () => {
      const s = await shop();
      const sale = await s.sell({ paid: 20_000 }).expect(201);
      const id = sale.body.id as string;
      const refused = (q: Promise<unknown>) =>
        expect(q).rejects.toThrow(/sales_money_ck/);
      // Rounding inside total: total is still subtotal − discounts + tax.
      await refused(
        admin`update pos.sales set total = ${DUE} where id = ${id}`,
      );
      await refused(
        admin`update pos.sales set total = ${DUE}, rounding = 0 where id = ${id}`,
      );
      // 100 and negative are not a rounding.
      await refused(
        admin`update pos.sales set rounding = 100, change = 6197 where id = ${id}`,
      );
      await refused(
        admin`update pos.sales set rounding = -3, change = 6300 where id = ${id}`,
      );
      // A rounding that does not land on a Rp100 boundary.
      await refused(
        admin`update pos.sales set rounding = 96, change = 6201 where id = ${id}`,
      );
      // Change that forgets the rounding (paid − total).
      await refused(admin`update pos.sales set change = 6297 where id = ${id}`);
      // Paid below the amount due without a member.
      await refused(
        admin`update pos.sales set paid = ${TOTAL}, change = 0 where id = ${id}`,
      );
      // The row as the service wrote it is accepted again.
      await admin`update pos.sales set rounding = ${ROUNDING}, change = 6200 where id = ${id}`;
    });

    it('sale_voids_ck: what is given back equals total + rounding', async () => {
      const s = await shop();
      const sale = await s.sell({ paid: DUE }).expect(201);
      const v = await s.voidSale(sale.body.id).expect(201);
      const refused = (q: Promise<unknown>) =>
        expect(q).rejects.toThrow(/sale_voids_ck/);
      await refused(
        admin`update pos.sale_voids set cash_returned = ${TOTAL} where id = ${v.body.id}`,
      );
      await refused(
        admin`update pos.sale_voids set rounding = 0 where id = ${v.body.id}`,
      );
    });
  });

  describe('shift', () => {
    it('cash sales and expected cash include total + rounding once, open and closed', async () => {
      const s = await shop();
      await s.sell({ paid: 20_000 }).expect(201); // drawer + 13.800
      await s.sell({ paid: DUE }).expect(201); // drawer + 13.800
      await s.sell({ paymentMethodId: s.debitId, paid: TOTAL }).expect(201);
      await s
        .sell({ memberId: s.memberId, paymentMethodId: s.kasbonId, paid: 0 })
        .expect(201);

      expect(await current(s.auth)).toMatchObject({
        salesCount: 4,
        cashSales: 2 * DUE,
        cashIn: 0,
        cashOut: 0,
        expectedCash: 100_000 + 2 * DUE,
      });
      const closed = await post(s.auth, '/shifts/current/close', {
        countedCash: 100_000 + 2 * DUE,
      }).expect(200);
      expect(closed.body).toMatchObject({
        cashSales: 2 * DUE,
        expectedCash: 100_000 + 2 * DUE,
        difference: 0,
      });
      // The shift report: revenue without rounding, rounding apart, the drawer with it.
      const q = `from=${today()}&to=${today()}`;
      const report = await get(s.auth, `/reports/shifts?${q}`).expect(200);
      expect(report.body.rows[0]).toMatchObject({
        salesCount: 4,
        revenue: 4 * TOTAL,
        tax: 4 * TAX,
        rounding: 2 * ROUNDING,
        expectedCash: 100_000 + 2 * DUE,
        difference: 0,
      });
      expect(report.body.totals).toMatchObject({
        revenue: 4 * TOTAL,
        rounding: 2 * ROUNDING,
      });
    });
  });

  describe('void', () => {
    it('a rounded cash sale gives back the amount paid in: total + rounding', async () => {
      const s = await shop();
      const sale = await s.sell({ paid: 20_000 }).expect(201);
      expect(await current(s.auth)).toMatchObject({
        expectedCash: 100_000 + DUE,
      });

      const v = await s.voidSale(sale.body.id).expect(201);
      expect(v.body).toMatchObject({
        status: 'void',
        shiftId: s.shiftId,
        tax: TAX,
        total: TOTAL,
        rounding: ROUNDING,
        cashReturned: DUE,
        transferReturned: 0,
        receivableCancelled: 0,
        returns: [
          {
            amount: DUE,
            paymentMethod: 'Tunai',
            fromDrawer: true,
            receivablePaymentId: null,
          },
        ],
      });
      const entries = await admin`
        select direction, kind, amount, ref_id from pos.shift_cash_entries where tenant_id = ${s.tenantId}`;
      expect(entries.map((e) => ({ ...e, amount: Number(e.amount) }))).toEqual([
        {
          direction: 'out',
          kind: 'void_refund',
          amount: DUE,
          ref_id: v.body.id,
        },
      ]);
      // The drawer is back where it started: in 13.800, out 13.800.
      expect(await current(s.auth)).toMatchObject({
        cashSales: DUE,
        cashOut: DUE,
        voidRefunds: DUE,
        expectedCash: 100_000,
      });
      // The sale keeps its figures; the reprint still shows the rounding.
      const receipt = await get(
        s.auth,
        `/sales/${sale.body.id}/receipt`,
      ).expect(200);
      expect(receipt.body).toMatchObject({
        status: 'void',
        total: TOTAL,
        rounding: ROUNDING,
        amountDue: DUE,
      });
      const seen = await get(s.auth, `/sales/${sale.body.id}/void`).expect(200);
      expect(seen.body).toMatchObject({
        rounding: ROUNDING,
        cashReturned: DUE,
      });
    });

    it('a debit sale gives back the exact total by transfer', async () => {
      const s = await shop();
      const sale = await s
        .sell({ paymentMethodId: s.debitId, paid: TOTAL })
        .expect(201);
      const v = await s.voidSale(sale.body.id).expect(201);
      expect(v.body).toMatchObject({
        total: TOTAL,
        rounding: 0,
        cashReturned: 0,
        transferReturned: TOTAL,
      });
      expect(await current(s.auth)).toMatchObject({ expectedCash: 100_000 });
    });
  });

  describe('reports', () => {
    it('show rounding as its own figure, outside revenue, tax and gross profit; a same-day void nets it to zero', async () => {
      const s = await shop();
      const cash = await s.sell({ paid: 20_000 }).expect(201);
      await s.sell({ paymentMethodId: s.debitId, paid: TOTAL }).expect(201);
      const q = `from=${today()}&to=${today()}`;
      const read = async () => ({
        dashboard: (
          await get(s.auth, '/reports/dashboard?period=today').expect(200)
        ).body.current as Record<string, number>,
        sales: (await get(s.auth, `/reports/sales?${q}`).expect(200)).body
          .totals as Record<string, number>,
        products: (await get(s.auth, `/reports/products?${q}`).expect(200))
          .body as {
          totals: Record<string, number>;
          rows: Record<string, number>[];
        },
        shifts: (await get(s.auth, `/reports/shifts?${q}`).expect(200)).body
          .totals as Record<string, number>,
        history: (await get(s.auth, '/sales').expect(200)).body
          .summary as Record<string, number>,
        salesCsv: (
          await get(s.auth, `/reports/sales/csv?${q}`).expect(200)
        ).text.split('\r\n'),
        productsCsv: (
          await get(s.auth, `/reports/products/csv?${q}`).expect(200)
        ).text.split('\r\n'),
        shiftsCsv: (
          await get(s.auth, `/reports/shifts/csv?${q}`).expect(200)
        ).text.split('\r\n'),
      });

      // Two sales of 13.703 (one cash, rounded by 97; one debit).
      const two = {
        salesCount: 2,
        grossSales: 2 * PRICE,
        tax: 2 * TAX,
        revenue: 2 * TOTAL, // Σ total: the cash sale's 97 is not in it
        cost: 2 * COST,
        grossProfit: 2 * TOTAL - 2 * TAX - 2 * COST,
        rounding: ROUNDING,
      };
      const before = await read();
      expect(before.dashboard).toMatchObject(two);
      expect(before.sales).toMatchObject(two);
      expect(before.products.totals).toMatchObject(two);
      expect(before.shifts).toMatchObject(two);
      // Product lines carry no rounding.
      expect(before.products.rows).toEqual([
        expect.objectContaining({ qty: 2, sales: 2 * PRICE, cost: 2 * COST }),
      ]);
      expect(before.history).toMatchObject({
        count: 2,
        revenue: 2 * TOTAL,
        rounding: ROUNDING,
      });
      expect(before.salesCsv).toContain(`Pendapatan,,,,,,,${2 * TOTAL},,,`);
      expect(before.salesCsv).toContain(`Pembulatan,,,,,,,${ROUNDING},,,`);
      expect(before.productsCsv).toContain(`Pembulatan,,,${ROUNDING},,`);
      expect(before.shiftsCsv[0]).toBe(
        'Kasir,Buka,Tutup,Transaksi,Pendapatan,Modal,Laba kotor,Pembulatan,Kas awal,Pembayaran piutang,Kas masuk,Kas keluar,Kas seharusnya,Kas dihitung,Selisih',
      );
      expect(before.shiftsCsv[1].split(',').slice(3, 8)).toEqual(
        [2, two.revenue, two.cost, two.grossProfit, ROUNDING].map(String),
      );

      // Void the rounded cash sale on the same day: only the debit sale is left, rounding 0.
      await s.voidSale(cash.body.id).expect(201);
      const one = {
        salesCount: 1,
        grossSales: PRICE,
        tax: TAX,
        revenue: TOTAL,
        cost: COST,
        grossProfit: TOTAL - TAX - COST,
        rounding: 0,
        voidCount: 1,
      };
      const after = await read();
      expect(after.dashboard).toMatchObject(one);
      expect(after.sales).toMatchObject(one);
      expect(after.products.totals).toMatchObject(one);
      expect(after.shifts).toMatchObject(one);
      expect(after.history).toMatchObject({
        count: 1,
        revenue: TOTAL,
        rounding: 0,
        voidedCount: 1,
      });
      expect(after.salesCsv).toContain('Pembulatan,,,,,,,0,,,');
      // Money: the drawer holds what it opened with.
      expect(await current(s.auth)).toMatchObject({ expectedCash: 100_000 });
    });

    it('a void of the only sale nets every figure, rounding too, to zero', async () => {
      const s = await shop();
      const cash = await s.sell({ paid: DUE }).expect(201);
      await s.voidSale(cash.body.id).expect(201);
      const dash = await get(s.auth, '/reports/dashboard?period=today').expect(
        200,
      );
      expect(dash.body.current).toEqual({
        salesCount: 0,
        grossSales: 0,
        discount: 0,
        voucher: 0,
        tax: 0,
        revenue: 0,
        cost: 0,
        grossProfit: 0,
        rounding: 0,
        voidCount: 1,
      });
    });
  });
});
