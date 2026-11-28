import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import postgres from 'postgres';
import request from 'supertest';
import { ADMIN_DATABASE_URL } from './support/env';
import { createApp, createStore } from './support/fixtures';
import { createCashier } from './support/staff';

// UMK-2122 "Tutup hari": the owner counts the drawer, sees the shift's sales and profit (tax excluded), and takes
// some cash home at the close. The take is a "Diambil pemilik" cash-out of the closing shift, so the next
// automatic opening (UMK-2120) is what stayed in the drawer.

describe('Tutup hari: the owner takes cash at the close (UMK-2122)', () => {
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

  const post = (auth: string, url: string, body: object) =>
    http().post(url).set('Authorization', auth).send(body);
  /** The screen's close: a take names the shift the owner counted (`shiftId`), read just before. */
  const close = async (
    auth: string,
    body: Record<string, unknown>,
    status: number,
  ) => {
    const named =
      'ownerTakes' in body && !('shiftId' in body)
        ? { ...body, shiftId: (await current(auth)).shift?.id ?? randomUUID() }
        : body;
    return post(auth, '/shifts/current/close', named).expect(status);
  };
  const current = async (auth: string) =>
    (await http().get('/shifts/current').set('Authorization', auth).expect(200))
      .body as {
      shift: {
        id: string;
        openingCash: number;
        expectedCash: number;
        revenue: number;
        grossProfit: number;
      } | null;
    };
  const takes = (tenantId: string) =>
    admin<{ reason: string; amount: number; shift_id: string }[]>`
      select reason, amount::int as amount, shift_id from pos.manual_cash_entries
       where tenant_id = ${tenantId} order by created_at`;
  const audits = (tenantId: string, event: string) =>
    admin<{ details: Record<string, unknown> }[]>`
      select details from pos.audit_log where tenant_id = ${tenantId} and event = ${event}
       order by occurred_at, id`;

  /** A store without staff: Es Teh at Rp5.000 (cost Rp2.000), tax 10%. */
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
    await http()
      .put('/sales/settings')
      .set('Authorization', s.auth)
      .send({ taxBps: 1000 })
      .expect(200);
    const sell = (auth = s.auth, qty = 1) =>
      http()
        .post('/sales')
        .set('Authorization', auth)
        .set('Idempotency-Key', randomUUID())
        .send({ lines: [{ productId, qty }], paid: 5500 * qty });
    return { ...s, productId, sell };
  }

  it('shows the shift profit without tax, and the take lowers the next automatic opening', async () => {
    const s = await shop();
    await s.sell().expect(201);
    await s.sell().expect(201);
    const before = (await current(s.auth)).shift!;
    // 2 × (5.000 + 10% tax) = 11.000 paid; profit = 11.000 − 1.000 tax − 4.000 cost
    expect(before).toMatchObject({
      openingCash: 0,
      expectedCash: 11_000,
      revenue: 11_000,
      grossProfit: 6000,
    });

    const res = await close(
      s.auth,
      {
        countedCash: 11_000,
        ownerTakes: 8000,
      },
      200,
    );
    expect(res.body).toMatchObject({
      countedCash: 3000,
      expectedCash: 3000,
      difference: 0,
      ownerTakes: 8000,
    });
    expect(await takes(s.tenantId)).toEqual([
      { reason: 'ambil_pemilik', amount: 8000, shift_id: before.id },
    ]);
    expect(await audits(s.tenantId, 'drawer_cash_out')).toEqual([
      {
        details: {
          shiftId: before.id,
          amount: 8000,
          reason: 'ambil_pemilik',
          drawerCashBefore: 11_000,
          atClose: true,
        },
      },
    ]);
    expect((await audits(s.tenantId, 'shift_close'))[0].details).toMatchObject({
      countedCash: 3000,
      expectedCash: 3000,
      difference: 0,
      ownerTakes: 8000,
    });

    // the next day's first sale opens the shift with what stayed in the drawer
    await s.sell().expect(201);
    expect((await current(s.auth)).shift).toMatchObject({
      openingCash: 3000,
      revenue: 5500,
      grossProfit: 3000,
    });
  });

  it('keeps a short count visible: the difference is the count’s, and the next opening is the drawer', async () => {
    const s = await shop();
    await s.sell(s.auth, 2).expect(201);
    const res = await close(
      s.auth,
      {
        countedCash: 10_000,
        ownerTakes: 4000,
      },
      200,
    );
    expect(res.body).toMatchObject({
      countedCash: 6000,
      expectedCash: 7000,
      difference: -1000,
    });
    await s.sell().expect(201);
    expect((await current(s.auth)).shift).toMatchObject({ openingCash: 6000 });
  });

  it('a close without a take is unchanged, also a day without sales', async () => {
    const s = await shop();
    await post(s.auth, '/shifts/open', { openingCash: 20_000 }).expect(201);
    expect((await current(s.auth)).shift).toMatchObject({
      revenue: 0,
      grossProfit: 0,
    });
    const res = await close(s.auth, { countedCash: 20_000 }, 200);
    expect(res.body).toMatchObject({
      countedCash: 20_000,
      difference: 0,
      ownerTakes: 0,
    });
    expect(await takes(s.tenantId)).toEqual([]);
  });

  it('refuses a take above the count, a missing count and a negative take, and leaves the shift open', async () => {
    const s = await shop();
    await s.sell().expect(201);
    const over = await close(
      s.auth,
      {
        countedCash: 5500,
        ownerTakes: 6000,
      },
      422,
    );
    expect(over.body.errors.ownerTakes).toMatch(
      /lebih besar dari uang di laci/,
    );
    const noCount = await close(s.auth, { ownerTakes: 1000 }, 422);
    expect(noCount.body.errors.countedCash).toBeDefined();
    await close(s.auth, { countedCash: 5500, ownerTakes: -1 }, 422);
    expect((await current(s.auth)).shift).not.toBeNull();
    expect(await takes(s.tenantId)).toEqual([]);
  });

  it('still refuses while a sale awaits payment, and writes no take', async () => {
    const s = await shop();
    const sale = await s.sell().expect(201);
    await admin`update pos.sales set status = 'awaiting_payment', hold_number = 1,
                  hold_day = (now() at time zone 'Asia/Jakarta')::date
                where id = ${sale.body.id}`;
    const res = await close(
      s.auth,
      {
        countedCash: 5500,
        ownerTakes: 1000,
      },
      409,
    );
    expect(res.body.code).toBe('sales_awaiting_payment');
    expect(await takes(s.tenantId)).toEqual([]);
    expect((await current(s.auth)).shift).not.toBeNull();
    // Put the sale back: pos-api refuses to boot with payment-api off while a sale awaits payment, and the
    // database is shared by the suites that run after this one.
    await admin`update pos.sales set status = 'completed', hold_number = null, hold_day = null
                where id = ${sale.body.id}`;
  });

  it('refuses a take above what the drawer should hold, also when the count is over', async () => {
    const s = await shop();
    await post(s.auth, '/shifts/open', { openingCash: 1000 }).expect(201);
    // expected 1.000, counted 5.000 (4.000 over): taking 5.000 would leave the drawer at −4.000
    const res = await close(
      s.auth,
      { countedCash: 5000, ownerTakes: 5000 },
      422,
    );
    expect(res.body.code).toBe('OWNER_TAKES_TOO_MUCH');
    expect(res.body.errors.ownerTakes).toMatch(
      /seharusnya ada di laci \(Rp1\.000\)/,
    );
    expect(await takes(s.tenantId)).toEqual([]);
    // up to the expected cash is fine, and the overage stays visible
    const ok = await close(
      s.auth,
      { countedCash: 5000, ownerTakes: 1000 },
      200,
    );
    expect(ok.body).toMatchObject({
      countedCash: 4000,
      expectedCash: 0,
      difference: 4000,
    });
    expect(
      (await audits(s.tenantId, 'drawer_cash_out'))[0].details,
    ).toMatchObject({
      drawerCashBefore: 1000,
    });
  });

  it('is tied to the counted shift: a repeat after a new shift opened, or a second close at once, takes nothing more', async () => {
    const s = await shop();
    await s.sell().expect(201);
    const counted = (await current(s.auth)).shift!.id;
    const body = { countedCash: 5500, ownerTakes: 5000, shiftId: counted };
    // the answer is lost and the next sale opens a new shift (solo owner): the repeat must not close it
    await post(s.auth, '/shifts/current/close', body).expect(200);
    await s.sell().expect(201);
    const repeat = await post(s.auth, '/shifts/current/close', body).expect(
      409,
    );
    expect(repeat.body.code).toBe('shift_changed');
    expect((await current(s.auth)).shift).not.toBeNull();
    // with no open shift at all, the same answer
    const next = (await current(s.auth)).shift!.id;
    await post(s.auth, '/shifts/current/close', { countedCash: 5500 }).expect(
      200,
    );
    await post(s.auth, '/shifts/current/close', body).expect(409);
    expect(next).not.toBe(counted);
    expect(await takes(s.tenantId)).toEqual([
      { reason: 'ambil_pemilik', amount: 5000, shift_id: counted },
    ]);

    // two closes of the same shift at once: one closes, the other answers 409, one take
    await s.sell().expect(201);
    const third = (await current(s.auth)).shift!.id;
    const both = { countedCash: 5500, ownerTakes: 2000, shiftId: third };
    const codes = (
      await Promise.all([
        post(s.auth, '/shifts/current/close', both),
        post(s.auth, '/shifts/current/close', both),
      ])
    )
      .map((r) => r.status)
      .sort();
    expect(codes).toEqual([200, 409]);
    expect(
      (await takes(s.tenantId)).filter((t) => t.shift_id === third),
    ).toEqual([{ reason: 'ambil_pemilik', amount: 2000, shift_id: third }]);
  });

  it('a take needs the shift it counted', async () => {
    const s = await shop();
    await s.sell().expect(201);
    const res = await post(s.auth, '/shifts/current/close', {
      countedCash: 5500,
      ownerTakes: 1000,
    }).expect(422);
    expect(res.body.errors.shiftId).toBeDefined();
  });

  it('counts profit after a discount and less a void done in the shift, and answers it at the close', async () => {
    const s = await shop();
    await http()
      .put('/void-pin')
      .set('Authorization', s.freshAuth)
      .send({ pin: '135790' })
      .expect(200);
    // Rp1.000 off a 5.000 line: 4.000 + 400 tax = 4.400 paid; profit 4.400 − 400 − 2.000 = 2.000
    await http()
      .post('/sales')
      .set('Authorization', s.auth)
      .set('Idempotency-Key', randomUUID())
      .send({
        lines: [{ productId: s.productId, qty: 1, discountAmount: 1000 }],
        paid: 4400,
      })
      .expect(201);
    const voided = await s.sell().expect(201);
    expect((await current(s.auth)).shift).toMatchObject({
      revenue: 9900,
      grossProfit: 5000,
    });
    await http()
      .post(`/sales/${voided.body.id}/void`)
      .set('Authorization', s.auth)
      .set('Idempotency-Key', randomUUID())
      .send({
        reasonCode: 'wrong_item_or_qty',
        approverId: s.userId,
        pin: '135790',
      })
      .expect(201);
    expect((await current(s.auth)).shift).toMatchObject({
      revenue: 4400,
      grossProfit: 2000,
    });
    const res = await close(s.auth, { countedCash: 4400 }, 200);
    expect(res.body).toMatchObject({
      revenue: 4400,
      grossProfit: 2000,
      difference: 0,
    });
  });

  it('is the owner’s alone: a cashier’s take is refused, the cashier’s plain close works', async () => {
    const s = await shop();
    const cashier = await createCashier(app, s);
    await post(cashier.auth, '/shifts/open', { openingCash: 0 }).expect(201);
    await s.sell(cashier.auth).expect(201);
    await close(cashier.auth, { countedCash: 5500, ownerTakes: 1000 }, 403);
    expect(await takes(s.tenantId)).toEqual([]);
    await close(cashier.auth, { countedCash: 5500 }, 200);
  });

  it('store B’s close touches nothing of store A', async () => {
    const a = await shop();
    const b = await shop();
    await a.sell().expect(201);
    await b.sell().expect(201);
    await close(b.auth, { countedCash: 5500, ownerTakes: 5000 }, 200);
    expect(await takes(a.tenantId)).toEqual([]);
    expect((await current(a.auth)).shift).toMatchObject({ expectedCash: 5500 });
  });
});
