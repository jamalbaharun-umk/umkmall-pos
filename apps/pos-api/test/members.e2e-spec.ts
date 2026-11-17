import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createApp, createStore } from './support/fixtures';
import { createCashier } from './support/staff';

type Store = Awaited<ReturnType<typeof createStore>>;

/** YYYY-MM-DD in the store's day (Asia/Jakarta, UTC+7), shifted by `days`. */
const jakartaDay = (days = 0) =>
  new Date(Date.now() + 7 * 3_600_000 + days * 86_400_000)
    .toISOString()
    .slice(0, 10);

const ids = (rows: unknown) => (rows as { id: string }[]).map((r) => r.id);

describe('members, vouchers and credit sales (U7)', () => {
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

  /** A store with an open owner shift and one product at `price` with opening stock `qty`. */
  async function store(price = 2000, qty = 50) {
    const s = await createStore();
    const cat = await post(s.auth, '/catalog/categories', {
      name: 'Minuman',
    }).expect(201);
    const p = await post(s.auth, '/catalog/products', {
      categoryId: cat.body.id,
      name: 'Kopi Susu',
      costPrice: 1000,
      sellingPrice: price,
    }).expect(201);
    await post(s.auth, '/stock/opening', {
      productId: p.body.id,
      qty,
    }).expect(201);
    await post(s.auth, '/shifts/open', { openingCash: 100_000 }).expect(201);
    return { ...s, productId: p.body.id as string };
  }

  const sell = (auth: string, body: object) =>
    http()
      .post('/sales')
      .set('Authorization', auth)
      .set('Idempotency-Key', randomUUID())
      .send(body);

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

  const voucher = (s: Store, body: object = {}) =>
    post(s.auth, '/vouchers', {
      name: 'Hemat',
      code: `V${Math.random().toString(36).slice(2, 8)}`,
      type: 'percentage',
      nominal: 10,
      kuota: 10,
      startDate: jakartaDay(-1),
      expired: jakartaDay(1),
      ...body,
    }).expect(201);

  const method = (s: Store, kind: string, name = kind) =>
    post(s.auth, '/payment-methods', { name, kind }).expect(201);

  const member = (s: Store, name = 'Bu Sari') =>
    post(s.auth, '/members', {
      name,
      code: `M${Math.random().toString(36).slice(2, 8)}`,
      phone: '081234567890',
    }).expect(201);

  it('tax after discounts: 2 × Rp2.000, discount Rp500, voucher 10 %, tax 10 % → Rp3.465', async () => {
    const s = await store(2000);
    await http()
      .put('/sales/settings')
      .set('Authorization', s.auth)
      .send({ taxBps: 1000 })
      .expect(200);
    const v = await voucher(s, { nominal: 10 });
    const res = await sell(s.auth, {
      lines: [{ productId: s.productId, qty: 2 }],
      discount: 500,
      voucherCode: (v.body.code as string).toLowerCase(),
      paid: 5000,
    }).expect(201);
    // 4.000 − 500 = 3.500; voucher 10 % = 350 → 3.150 taxable; tax 315; total 3.465.
    expect(res.body).toMatchObject({
      subtotal: 4000,
      discount: 500,
      voucherDiscount: 350,
      tax: 315,
      total: 3465,
      paid: 5000,
      change: 1535,
    });
    // History (riwayat) rows and summary carry the voucher so a row adds up: 4.000 − 500 − 350 + 315 = 3.465.
    const list = await get(s.auth, '/sales').expect(200);
    expect(list.body.data[0]).toMatchObject({
      subtotal: 4000,
      discount: 500,
      voucherDiscount: 350,
      tax: 315,
      total: 3465,
    });
    expect(list.body.summary).toMatchObject({
      revenue: 3465,
      discount: 500,
      voucherDiscount: 350,
    });
  });

  it('a quota-1 voucher works exactly once; a failed sale does not consume it', async () => {
    const s = await store(2000, 5);
    const v = await voucher(s, { kuota: 1, type: 'flat', nominal: 1000 });
    // Fails on stock after the voucher was validated: rolls back, quota stays 1.
    await sell(s.auth, {
      lines: [{ productId: s.productId, qty: 99 }],
      voucherCode: v.body.code,
      paid: 1_000_000,
    }).expect(422);
    expect((await get(s.auth, `/vouchers/${v.body.id}`)).body.kuota).toBe(1);

    const ok = await sell(s.auth, {
      lines: [{ productId: s.productId, qty: 1 }],
      voucherCode: v.body.code,
      paid: 1000,
    }).expect(201);
    expect(ok.body).toMatchObject({ voucherDiscount: 1000, total: 1000 });
    expect((await get(s.auth, `/vouchers/${v.body.id}`)).body.kuota).toBe(0);

    const again = await sell(s.auth, {
      lines: [{ productId: s.productId, qty: 1 }],
      voucherCode: v.body.code,
      paid: 2000,
    }).expect(422);
    expect(again.body).toMatchObject({
      message: 'Voucher sudah habis',
      errors: { voucherCode: 'Voucher sudah habis' },
    });
  });

  it('refuses expired, not started, unknown and below-minimum vouchers (422); check takes no quota', async () => {
    const s = await store(2000);
    const expired = await voucher(s, {
      startDate: jakartaDay(-10),
      expired: jakartaDay(-1),
    });
    const later = await voucher(s, {
      startDate: jakartaDay(1),
      expired: jakartaDay(5),
    });
    const min = await voucher(s, { minimalBuying: 10_000, kuota: 1 });
    for (const code of [
      expired.body.code,
      later.body.code,
      'NOPE',
      min.body.code,
    ]) {
      await post(s.auth, '/vouchers/check', { code, amount: 4000 }).expect(422);
      await sell(s.auth, {
        lines: [{ productId: s.productId, qty: 2 }],
        voucherCode: code,
        paid: 4000,
      }).expect(422);
    }
    const check = await post(s.auth, '/vouchers/check', {
      code: min.body.code,
      amount: 10_000,
    }).expect(200);
    expect(check.body.discount).toBe(1000);
    expect((await get(s.auth, `/vouchers/${min.body.id}`)).body.kuota).toBe(1);
    // Bad voucher input answers 422, never 500.
    await voucher(s).then(() => undefined);
    await post(s.auth, '/vouchers', {
      name: 'x',
      code: 'BAD',
      type: 'percentage',
      nominal: 150,
      kuota: 1,
      startDate: jakartaDay(),
      expired: jakartaDay(),
    }).expect(422);
  });

  it('slice check: kasbon Rp6.000 to "Bu Sari" without client prices, pay Rp2.500 → Rp3.500 left, then settled', async () => {
    const s = await store(6000);
    const kasbon = await method(s, 'credit', 'Kasbon');
    const sari = await member(s, 'Bu Sari');
    const sale = await sell(s.auth, {
      lines: [{ productId: s.productId, qty: 1 }],
      memberId: sari.body.id,
      paymentMethodId: kasbon.body.id,
      paid: 0,
    }).expect(201);
    expect(sale.body).toMatchObject({
      total: 6000,
      paid: 0,
      change: 0,
      memberName: 'Bu Sari',
      receivableRest: 6000,
    });
    const rid = sale.body.receivableId as string;

    const r1 = await pay(s.auth, rid, {
      amount: 2500,
    }).expect(201);
    expect(r1.body).toMatchObject({
      total: 6000,
      rest: 3500,
      memberName: 'Bu Sari',
    });
    expect(r1.body.lines).toEqual([
      expect.objectContaining({ qty: 1, unitPrice: 6000, lineTotal: 6000 }),
    ]);
    expect(r1.body.payments).toEqual([
      expect.objectContaining({
        amount: 2500,
        restBefore: 6000,
        paymentMethod: 'Tunai',
      }),
    ]);

    await pay(s.auth, rid, { amount: 4000 }).expect(422);
    // A kasbon is not paid with another kasbon.
    await pay(s.auth, rid, {
      amount: 100,
      paymentMethodId: kasbon.body.id,
    }).expect(422);
    const r2 = await pay(s.auth, rid, {
      amount: 3500,
    }).expect(201);
    expect(r2.body.rest).toBe(0);
    await pay(s.auth, rid, { amount: 1 }).expect(422);

    const open = await get(s.auth, '/receivables?status=open').expect(200);
    const settled = await get(s.auth, '/receivables?status=settled').expect(
      200,
    );
    expect(open.body.data).toHaveLength(0);
    expect(ids(settled.body.data)).toEqual([rid]);

    const receipt = await get(s.auth, `/sales/${sale.body.id}/receipt`).expect(
      200,
    );
    expect(receipt.body).toMatchObject({
      memberName: 'Bu Sari',
      receivableRest: 0,
    });
  });

  it('kasbon rules: member required, must leave a balance; a down payment is the first payment', async () => {
    const s = await store(6000);
    const kasbon = await method(s, 'credit', 'Kasbon');
    const sari = await member(s);
    const line = [{ productId: s.productId, qty: 1 }];
    await sell(s.auth, {
      lines: line,
      paymentMethodId: kasbon.body.id,
      paid: 0,
    }).expect(422);
    await sell(s.auth, {
      lines: line,
      memberId: sari.body.id,
      paymentMethodId: kasbon.body.id,
      paid: 6000,
    }).expect(422);
    // Cash sale cannot be underpaid even with a member.
    await sell(s.auth, {
      lines: line,
      memberId: sari.body.id,
      paid: 1000,
    }).expect(422);

    // Owner holds price_override, so a cashier without it proves the client price is ignored.
    const cashier = await createCashier(app, s, ['sales.create']);
    await post(cashier.auth, '/shifts/open', { openingCash: 0 }).expect(201);
    const sale = await sell(cashier.auth, {
      lines: [{ productId: s.productId, qty: 1, price: 1 }],
      memberId: sari.body.id,
      paymentMethodId: kasbon.body.id,
      paid: 1000,
    }).expect(201);
    expect(sale.body).toMatchObject({
      total: 6000,
      paid: 1000,
      receivableRest: 5000,
    });
    const r = await get(
      s.auth,
      `/receivables/${sale.body.receivableId}`,
    ).expect(200);
    expect(r.body.payments).toEqual([
      expect.objectContaining({
        amount: 1000,
        restBefore: 6000,
        paymentMethod: 'Tunai',
      }),
    ]);
  });

  it('shift close counts cash and kasbon down payments only; debit must be exact', async () => {
    const s = await store(6000);
    const debit = await method(s, 'debit', 'Kartu Debit');
    const kasbon = await method(s, 'credit', 'Kasbon');
    const sari = await member(s);
    const line = [{ productId: s.productId, qty: 1 }];
    await sell(s.auth, { lines: line, paid: 10_000 }).expect(201); // cash 6.000
    await sell(s.auth, {
      lines: line,
      paymentMethodId: debit.body.id,
      paid: 7000,
    }).expect(422);
    await sell(s.auth, {
      lines: line,
      paymentMethodId: debit.body.id,
      paid: 6000,
    }).expect(201);
    await sell(s.auth, {
      lines: line,
      memberId: sari.body.id,
      paymentMethodId: kasbon.body.id,
      paid: 1000,
    }).expect(201);
    const closed = await post(s.auth, '/shifts/current/close', {
      countedCash: 107_000,
    }).expect(200);
    expect(closed.body).toMatchObject({ expectedCash: 107_000, difference: 0 });
  });

  it('payment methods: Tunai is fixed, names are unique, kinds are validated', async () => {
    const s = await createStore();
    const list = await get(s.auth, '/payment-methods').expect(200);
    expect(list.body.data).toEqual([
      expect.objectContaining({ name: 'Tunai', kind: 'cash' }),
    ]);
    const tunai = list.body.data[0].id as string;
    await http()
      .patch(`/payment-methods/${tunai}`)
      .set('Authorization', s.auth)
      .send({ name: 'Cash' })
      .expect(422);
    await http()
      .delete(`/payment-methods/${tunai}`)
      .set('Authorization', s.auth)
      .expect(422);
    await post(s.auth, '/payment-methods', {
      name: 'Tunai',
      kind: 'credit',
    }).expect(409);
    await post(s.auth, '/payment-methods', { name: 'X', kind: 'qris' }).expect(
      422,
    );
    const ovo = await method(s, 'wallet', 'OVO');
    expect(ovo.body).toMatchObject({ name: 'OVO', kind: 'wallet' });
    await http()
      .delete(`/payment-methods/${ovo.body.id}`)
      .set('Authorization', s.auth)
      .expect(204);
    expect((await get(s.auth, '/payment-methods')).body.data).toHaveLength(1);
  });

  it('members: search, unique code, soft delete', async () => {
    const s = await createStore();
    const m = await member(s, 'Pak Budi');
    await post(s.auth, '/members', { name: 'Lain', code: m.body.code }).expect(
      409,
    );
    const found = await get(s.auth, '/members?q=bud').expect(200);
    expect(ids(found.body.data)).toEqual([m.body.id]);
    await http()
      .patch(`/members/${m.body.id}`)
      .set('Authorization', s.auth)
      .send({ address: 'Jl. Melati 1' })
      .expect(200);
    await http()
      .delete(`/members/${m.body.id}`)
      .set('Authorization', s.auth)
      .expect(204);
    await get(s.auth, `/members/${m.body.id}`).expect(404);
    // Its code is free again once deleted.
    await post(s.auth, '/members', { name: 'Baru', code: m.body.code }).expect(
      201,
    );
  });

  it('refuses writes without the permission (403)', async () => {
    const s = await store(6000);
    const kasbon = await method(s, 'credit', 'Kasbon');
    const sari = await member(s);
    const v = await voucher(s);
    const sale = await sell(s.auth, {
      lines: [{ productId: s.productId, qty: 1 }],
      memberId: sari.body.id,
      paymentMethodId: kasbon.body.id,
      paid: 0,
    }).expect(201);
    const rid = sale.body.receivableId as string;
    const c = await createCashier(app, s, ['sales.create']);

    await post(c.auth, '/members', { name: 'x', code: 'x1' }).expect(403);
    await http()
      .patch(`/members/${sari.body.id}`)
      .set('Authorization', c.auth)
      .send({ name: 'y' })
      .expect(403);
    await http()
      .delete(`/members/${sari.body.id}`)
      .set('Authorization', c.auth)
      .expect(403);
    await get(c.auth, '/vouchers').expect(403);
    await post(c.auth, '/vouchers', {}).expect(403);
    await http()
      .delete(`/vouchers/${v.body.id}`)
      .set('Authorization', c.auth)
      .expect(403);
    await post(c.auth, '/payment-methods', { name: 'Z', kind: 'cash' }).expect(
      403,
    );
    await http()
      .delete(`/payment-methods/${kasbon.body.id}`)
      .set('Authorization', c.auth)
      .expect(403);
    await get(c.auth, '/receivables').expect(403);
    await get(c.auth, `/receivables/${rid}`).expect(403);
    await pay(c.auth, rid, { amount: 1 }).expect(403);
    // What the cashier needs at the till.
    await get(c.auth, '/members').expect(403);
    await get(c.auth, `/members/${sari.body.id}`).expect(403);
    const picked = await get(c.auth, '/members/picker?q=sari').expect(200);
    expect(picked.body.data).toEqual([
      { id: sari.body.id, name: 'Bu Sari', code: sari.body.code },
    ]);
    await get(c.auth, '/payment-methods').expect(200);
    await post(c.auth, '/vouchers/check', {
      code: v.body.code,
      amount: 6000,
    }).expect(200);

    const granted = await createCashier(app, s, ['receivables.manage']);
    await pay(granted.auth, rid, {
      amount: 1,
    }).expect(201);
  });

  it('cross-tenant: store B gets 404 on store A ids and cannot use them in a sale', async () => {
    const a = await store(6000);
    const b = await store(6000);
    const kasbon = await method(a, 'credit', 'Kasbon');
    const sari = await member(a);
    const v = await voucher(a);
    const sale = await sell(a.auth, {
      lines: [{ productId: a.productId, qty: 1 }],
      memberId: sari.body.id,
      paymentMethodId: kasbon.body.id,
      paid: 0,
    }).expect(201);
    const rid = sale.body.receivableId as string;

    for (const url of [
      `/members/${sari.body.id}`,
      `/vouchers/${v.body.id}`,
      `/payment-methods/${kasbon.body.id}`,
    ]) {
      await get(b.auth, url).expect(404);
      await http()
        .patch(url)
        .set('Authorization', b.auth)
        .send({ name: 'Diambil' })
        .expect(404);
      await http().delete(url).set('Authorization', b.auth).expect(404);
    }
    await get(b.auth, `/receivables/${rid}`).expect(404);
    await pay(b.auth, rid, { amount: 1 }).expect(404);

    for (const list of ['/members', '/vouchers', '/receivables']) {
      expect(ids((await get(b.auth, list).expect(200)).body.data)).toEqual([]);
    }
    const bMethods = (await get(b.auth, '/payment-methods')).body.data;
    expect(ids(bMethods)).not.toContain(kasbon.body.id);

    const line = [{ productId: b.productId, qty: 1 }];
    await sell(b.auth, {
      lines: line,
      memberId: sari.body.id,
      paid: 6000,
    }).expect(422);
    await sell(b.auth, {
      lines: line,
      voucherCode: v.body.code,
      paid: 6000,
    }).expect(422);
    await sell(b.auth, {
      lines: line,
      paymentMethodId: kasbon.body.id,
      paid: 6000,
    }).expect(422);
    await post(b.auth, '/vouchers/check', {
      code: v.body.code,
      amount: 6000,
    }).expect(422);

    // A's receivable is untouched.
    expect((await get(a.auth, `/receivables/${rid}`)).body.rest).toBe(6000);
  });
});
