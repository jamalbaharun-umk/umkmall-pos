import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApp, createStore } from './support/fixtures';
import { createCashier } from './support/staff';

type Store = Awaited<ReturnType<typeof createStore>>;

/** YYYY-MM-DD today in the store's day (Asia/Jakarta, UTC+7). */
const today = () =>
  new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);

describe('shift cash ledger: receivable payments in expected cash (UMK-1963)', () => {
  let app: INestApplication;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createApp();
  });
  afterAll(async () => {
    await app.close();
  });

  const post = (auth: string, url: string, body: object) =>
    http().post(url).set('Authorization', auth).send(body);
  const get = (auth: string, url: string) =>
    http().get(url).set('Authorization', auth);
  const open = (auth: string, openingCash = 100_000) =>
    post(auth, '/shifts/open', { openingCash }).expect(201);
  const close = (auth: string, countedCash: number) =>
    post(auth, '/shifts/current/close', { countedCash });
  const current = async (auth: string) =>
    (await get(auth, '/shifts/current').expect(200)).body.shift as Record<
      string,
      unknown
    >;

  const pay = (
    auth: string,
    rid: string,
    body: object,
    key: string = randomUUID(),
  ) =>
    http()
      .post(`/receivables/${rid}/payments`)
      .set('Authorization', auth)
      .set('Idempotency-Key', key)
      .send(body);

  /**
   * A store with one product at Rp6.000, a member, the methods Kasbon and Kartu Debit, and an owner
   * shift (opening cash Rp100.000) in which a kasbon sale of Rp6.000 with `down` paid was rung up.
   */
  async function storeWithKasbon(down = 0) {
    const s = await createStore();
    const cat = await post(s.auth, '/catalog/categories', {
      name: 'Minuman',
    }).expect(201);
    const p = await post(s.auth, '/catalog/products', {
      categoryId: cat.body.id,
      name: 'Kopi Susu',
      costPrice: 1000,
      sellingPrice: 6000,
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
    const shift = await open(s.auth);
    const sell = (body: object, auth = s.auth) =>
      http()
        .post('/sales')
        .set('Authorization', auth)
        .set('Idempotency-Key', randomUUID())
        .send({ lines: [{ productId, qty: 1 }], ...body });
    const kasbonSale = (paid: number, auth = s.auth) =>
      sell(
        { memberId: member.body.id, paymentMethodId: kasbon.body.id, paid },
        auth,
      ).expect(201);
    const sale = await kasbonSale(down);
    return {
      ...s,
      shiftId: shift.body.id as string,
      rid: sale.body.receivableId as string,
      debitId: debit.body.id as string,
      sell,
      kasbonSale,
    };
  }

  it('a cash payment in an open shift is linked to it and raises expected cash, live and at close', async () => {
    const s = await storeWithKasbon();
    expect(await current(s.auth)).toMatchObject({
      expectedCash: 100_000,
      cashIn: 0,
      cashOut: 0,
      receivablePayments: 0,
    });

    const paid = await pay(s.auth, s.rid, { amount: 2500 }).expect(201);
    expect(paid.body.rest).toBe(3500);
    const paymentId = paid.body.payments[0].id as string;

    expect(await current(s.auth)).toMatchObject({
      id: s.shiftId,
      cashSales: 0,
      cashIn: 2500,
      cashOut: 0,
      receivablePayments: 2500,
      expectedCash: 102_500,
    });
    const detail = await get(s.auth, `/shifts/${s.shiftId}`).expect(200);
    expect(detail.body.cashEntries).toEqual([
      expect.objectContaining({
        direction: 'in',
        kind: 'receivable_payment',
        amount: 2500,
        refId: paymentId,
      }),
    ]);

    await pay(s.auth, s.rid, { amount: 500 }).expect(201);
    const closed = await close(s.auth, 103_500).expect(200);
    expect(closed.body).toMatchObject({
      id: s.shiftId,
      openingCash: 100_000,
      cashSales: 0,
      cashIn: 3000,
      cashOut: 0,
      receivablePayments: 3000,
      expectedCash: 103_000,
      countedCash: 103_500,
      difference: 500,
    });

    const list = await get(s.auth, '/shifts').expect(200);
    expect(list.body.data).toEqual([
      expect.objectContaining({
        id: s.shiftId,
        cashIn: 3000,
        cashOut: 0,
        receivablePayments: 3000,
        expectedCash: 103_000,
      }),
    ]);
  });

  it('a non-cash payment does not change expected cash and needs no shift', async () => {
    const s = await storeWithKasbon();
    const r = await pay(s.auth, s.rid, {
      amount: 2000,
      paymentMethodId: s.debitId,
    }).expect(201);
    expect(r.body.rest).toBe(4000);
    expect(await current(s.auth)).toMatchObject({
      cashIn: 0,
      receivablePayments: 0,
      expectedCash: 100_000,
    });
    const closed = await close(s.auth, 100_000).expect(200);
    expect(closed.body).toMatchObject({
      cashIn: 0,
      receivablePayments: 0,
      expectedCash: 100_000,
      difference: 0,
    });

    // No shift open: a transfer is still recorded, and no shift gets an entry.
    const r2 = await pay(s.auth, s.rid, {
      amount: 1000,
      paymentMethodId: s.debitId,
    }).expect(201);
    expect(r2.body.rest).toBe(3000);
    const detail = await get(s.auth, `/shifts/${s.shiftId}`).expect(200);
    expect(detail.body.cashEntries).toEqual([]);
  });

  it('a cash payment without an open shift is refused (422) and changes nothing', async () => {
    const s = await storeWithKasbon();
    await close(s.auth, 100_000).expect(200);
    const key = randomUUID();
    const res = await pay(s.auth, s.rid, { amount: 1000 }, key).expect(422);
    expect(res.body).toMatchObject({
      message: 'Buka shift dulu sebelum menerima pembayaran tunai',
    });
    const r = await get(s.auth, `/receivables/${s.rid}`).expect(200);
    expect(r.body).toMatchObject({ rest: 6000, payments: [] });
    const detail = await get(s.auth, `/shifts/${s.shiftId}`).expect(200);
    expect(detail.body).toMatchObject({ cashIn: 0, cashEntries: [] });

    // The refused request did not claim its key: the same request succeeds once a shift is open.
    await open(s.auth, 0);
    await pay(s.auth, s.rid, { amount: 1000 }, key).expect(201);
    expect(await current(s.auth)).toMatchObject({ expectedCash: 1000 });
  });

  it('cash sales and kasbon down payments keep counting; a down payment is not counted twice', async () => {
    const s = await storeWithKasbon(1000); // down payment Rp1.000
    await s.sell({ paid: 10_000 }).expect(201); // cash sale Rp6.000
    await s.sell({ paymentMethodId: s.debitId, paid: 6000 }).expect(201); // debit: no cash
    await pay(s.auth, s.rid, { amount: 2000 }).expect(201);
    const closed = await close(s.auth, 109_000).expect(200);
    expect(closed.body).toMatchObject({
      cashSales: 7000, // 6.000 cash + 1.000 down payment
      cashIn: 2000,
      receivablePayments: 2000,
      expectedCash: 109_000,
      difference: 0,
    });
    const detail = await get(s.auth, `/shifts/${s.shiftId}`).expect(200);
    expect(detail.body.cashEntries).toHaveLength(1); // the down payment is in cashSales, not the ledger
  });

  it('a closed shift never changes: a later payment goes to the next shift', async () => {
    const s = await storeWithKasbon();
    await pay(s.auth, s.rid, { amount: 1000 }).expect(201);
    await close(s.auth, 101_000).expect(200);
    const before = (await get(s.auth, `/shifts/${s.shiftId}`).expect(200)).body;

    const next = await open(s.auth, 50_000);
    await pay(s.auth, s.rid, { amount: 2000 }).expect(201);
    expect(await current(s.auth)).toMatchObject({
      id: next.body.id,
      cashIn: 2000,
      expectedCash: 52_000,
    });
    const after = (await get(s.auth, `/shifts/${s.shiftId}`).expect(200)).body;
    expect(after).toEqual(before);
    expect(after).toMatchObject({
      cashIn: 1000,
      expectedCash: 101_000,
      difference: 0,
    });
  });

  it('the payment is counted in the shift of the actor who took it', async () => {
    const s = await storeWithKasbon();
    const cashier = await createCashier(app, s, [
      'sales.create',
      'receivables.manage',
    ]);
    await pay(cashier.auth, s.rid, { amount: 1000 }).expect(422); // no shift of their own
    const shift = await open(cashier.auth, 0);
    await pay(cashier.auth, s.rid, { amount: 1000 }).expect(201);
    expect(await current(cashier.auth)).toMatchObject({
      id: shift.body.id,
      cashIn: 1000,
      expectedCash: 1000,
    });
    expect(await current(s.auth)).toMatchObject({
      cashIn: 0,
      expectedCash: 100_000,
    });
  });

  it('a replayed Idempotency-Key writes one entry, also after the shift closed', async () => {
    const s = await storeWithKasbon();
    const key = randomUUID();
    const first = await pay(s.auth, s.rid, { amount: 1500 }, key).expect(201);
    const again = await pay(s.auth, s.rid, { amount: 1500 }, key).expect(201);
    expect(again.body).toEqual(first.body);
    expect(await current(s.auth)).toMatchObject({
      cashIn: 1500,
      expectedCash: 101_500,
    });
    // Double tap: the same key in parallel still pays once.
    const key2 = randomUUID();
    const both = await Promise.all([
      pay(s.auth, s.rid, { amount: 500 }, key2),
      pay(s.auth, s.rid, { amount: 500 }, key2),
    ]);
    expect(both.map((r) => r.status)).toEqual([201, 201]);
    expect(await current(s.auth)).toMatchObject({ cashIn: 2000 });

    await close(s.auth, 102_000).expect(200);
    const late = await pay(s.auth, s.rid, { amount: 1500 }, key).expect(201);
    expect(late.body.rest).toBe(4000);
    const detail = await get(s.auth, `/shifts/${s.shiftId}`).expect(200);
    expect(detail.body.cashEntries).toHaveLength(2);
    expect(detail.body).toMatchObject({ cashIn: 2000, expectedCash: 102_000 });
  });

  it('a payment racing the close is counted in the close or refused, never lost', async () => {
    for (let i = 0; i < 5; i++) {
      const s = await storeWithKasbon();
      const [paid, closed] = await Promise.all([
        pay(s.auth, s.rid, { amount: 1000 }),
        close(s.auth, 100_000),
      ]);
      expect(closed.status).toBe(200);
      expect([201, 422]).toContain(paid.status);
      const counted = paid.status === 201 ? 1000 : 0;
      expect(closed.body).toMatchObject({
        cashIn: counted,
        expectedCash: 100_000 + counted,
      });
      const detail = await get(s.auth, `/shifts/${s.shiftId}`).expect(200);
      expect(detail.body).toMatchObject({
        cashIn: counted,
        expectedCash: 100_000 + counted,
      });
      const r = await get(s.auth, `/receivables/${s.rid}`).expect(200);
      expect(r.body.rest).toBe(6000 - counted);
    }
  });

  it('the shift report shows the receivable payments line and cash in/out (JSON and CSV)', async () => {
    const s = await storeWithKasbon();
    await pay(s.auth, s.rid, { amount: 2500 }).expect(201);
    await pay(s.auth, s.rid, {
      amount: 1000,
      paymentMethodId: s.debitId,
    }).expect(201);
    await close(s.auth, 102_500).expect(200);
    const q = `from=${today()}&to=${today()}`;
    const report = await get(s.auth, `/reports/shifts?${q}`).expect(200);
    expect(report.body.rows).toEqual([
      expect.objectContaining({
        shiftId: s.shiftId,
        salesCount: 1, // the ledger join does not multiply the shift's sales
        revenue: 6000,
        openingCash: 100_000,
        receivablePayments: 2500,
        cashIn: 2500,
        cashOut: 0,
        expectedCash: 102_500,
        countedCash: 102_500,
        difference: 0,
      }),
    ]);
    const csv = await get(s.auth, `/reports/shifts/csv?${q}`).expect(200);
    const [header, row] = csv.text.trim().split(/\r?\n/);
    const cols = header.split(',');
    const cells = row.split(',');
    const cell = (name: string) => cells[cols.indexOf(name)];
    expect(cell('Pembayaran piutang')).toBe('2500');
    expect(cell('Kas masuk')).toBe('2500');
    expect(cell('Kas keluar')).toBe('0');
    expect(cell('Kas seharusnya')).toBe('102500');
  });

  it("cross-tenant: store B gets 404 on store A's shift and receivable; A's ledger is unchanged", async () => {
    const a = await storeWithKasbon();
    const b = await storeWithKasbon();
    await pay(a.auth, a.rid, { amount: 1000 }).expect(201);

    await get(b.auth, `/shifts/${a.shiftId}`).expect(404);
    await get(b.auth, `/receivables/${a.rid}`).expect(404);
    await pay(b.auth, a.rid, { amount: 1000 }).expect(404);
    expect((await get(b.auth, '/shifts').expect(200)).body.data).toEqual([
      expect.objectContaining({ id: b.shiftId, cashIn: 0 }),
    ]);
    expect(await current(b.auth)).toMatchObject({
      id: b.shiftId,
      cashIn: 0,
      expectedCash: 100_000,
    });
    const q = `from=${today()}&to=${today()}`;
    const report = await get(b.auth, `/reports/shifts?${q}`).expect(200);
    expect(report.body.rows).toEqual([
      expect.objectContaining({ shiftId: b.shiftId, cashIn: 0 }),
    ]);

    const detail = await get(a.auth, `/shifts/${a.shiftId}`).expect(200);
    expect(detail.body.cashIn).toBe(1000);
    expect(detail.body.cashEntries).toHaveLength(1);
    expect(await current(a.auth)).toMatchObject({ expectedCash: 101_000 });
    const r = await get(a.auth, `/receivables/${a.rid}`).expect(200);
    expect(r.body.rest).toBe(5000);
  });

  it("a cashier without reports.view gets 404 on another actor's shift and its ledger", async () => {
    const s: Store & { shiftId: string; rid: string } = await storeWithKasbon();
    await pay(s.auth, s.rid, { amount: 1000 }).expect(201);
    const cashier = await createCashier(app, s, ['sales.create']);
    await get(cashier.auth, `/shifts/${s.shiftId}`).expect(404);
    expect((await get(cashier.auth, '/shifts').expect(200)).body.data).toEqual(
      [],
    );
  });
});
