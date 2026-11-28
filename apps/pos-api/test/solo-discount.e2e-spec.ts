import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import postgres from 'postgres';
import request from 'supertest';
import { ADMIN_DATABASE_URL } from './support/env';
import { createApp, createStore } from './support/fixtures';
import { createCashier } from './support/staff';

const OWNER_PIN = '482913';

/**
 * UMK-2123 (owner decision 2026-11-28): in a store without active staff the owner's own reduction above 30% (a line
 * discount, a manual price, the order discount) sells without a second person's PIN, recorded as the owner's
 * `solo_owner` approval. Every store with staff, and every cashier, keeps the UMK-1990 gate. Teh Botol Rp5.000, tax 0.
 */
describe('a solo owner’s own discount above 30% needs no PIN (UMK-2123)', () => {
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
  const sell = (auth: string, body: object) =>
    http()
      .post('/sales')
      .set('Authorization', auth)
      .set('Idempotency-Key', randomUUID())
      .send(body);
  const pinRequired = async (auth: string) =>
    (await http().get('/shifts/current').set('Authorization', auth).expect(200))
      .body.discountPinRequired as boolean;

  /** A store without staff: Teh Botol Rp5.000 (100 on hand), the owner's void PIN. */
  async function shop() {
    const s = await createStore();
    const cat = await post(s.auth, '/catalog/categories', {
      name: 'Toko',
    }).expect(201);
    const p = await post(s.auth, '/catalog/products', {
      categoryId: cat.body.id,
      name: 'Teh Botol',
      sellingPrice: 5000,
      costPrice: 3000,
    }).expect(201);
    const teh = p.body.id as string;
    await post(s.auth, '/stock/opening', { productId: teh, qty: 100 }).expect(
      201,
    );
    await http()
      .put('/void-pin')
      .set('Authorization', s.freshAuth)
      .send({ pin: OWNER_PIN })
      .expect(200);
    return { ...s, teh };
  }
  type Shop = Awaited<ReturnType<typeof shop>>;

  // 4 × Rp5.000 = 20.000; 30% = 6.000.
  const orderOver = (s: Shop) => ({
    lines: [{ productId: s.teh, qty: 4 }],
    discount: 10_000,
    paid: 10_000,
  });
  const lineOver = (s: Shop) => ({
    lines: [{ productId: s.teh, qty: 2, discountPercent: 50 }],
    paid: 5000,
  });
  const priceOver = (s: Shop) => ({
    lines: [{ productId: s.teh, qty: 2, price: 2000 }],
    paid: 4000,
  });

  const approvalAudits = (tenantId: string) =>
    admin<{ details: Record<string, unknown> }[]>`
      select details from pos.audit_log
       where tenant_id = ${tenantId} and event = 'discount_approval'
       order by occurred_at, id`;
  const lineApprovers = (saleId: string) =>
    admin<{ discount_approved_by: string | null }[]>`
      select discount_approved_by from pos.sale_lines where sale_id = ${saleId}`;

  it('the order discount, a line discount and a manual price above 30% sell without an approval, approved by the owner as solo_owner', async () => {
    const s = await shop();
    expect(await pinRequired(s.auth)).toBe(false);
    const quote = await post(s.auth, '/sales/quote', {
      lines: orderOver(s).lines,
      discount: 10_000,
    }).expect(200);
    expect(quote.body).toMatchObject({
      orderDiscountNeedsApproval: true,
      discountPinRequired: false,
    });

    const order = await sell(s.auth, orderOver(s)).expect(201);
    expect(order.body).toMatchObject({
      subtotal: 20_000,
      discount: 10_000,
      total: 10_000,
      discountApprovedBy: s.userId,
    });
    const line = await sell(s.auth, lineOver(s)).expect(201);
    expect(line.body).toMatchObject({ lineDiscount: 5000, total: 5000 });
    expect(await lineApprovers(line.body.id)).toEqual([
      { discount_approved_by: s.userId },
    ]);
    const price = await sell(s.auth, priceOver(s)).expect(201);
    expect(price.body).toMatchObject({ total: 4000 });
    expect(await lineApprovers(price.body.id)).toEqual([
      { discount_approved_by: s.userId },
    ]);

    expect(await approvalAudits(s.tenantId)).toEqual([
      {
        details: expect.objectContaining({
          saleId: order.body.id,
          scope: 'order',
          approvedBy: s.userId,
          approval: 'solo_owner',
        }),
      },
      {
        details: expect.objectContaining({
          saleId: line.body.id,
          approvedBy: s.userId,
          approval: 'solo_owner',
        }),
      },
      {
        details: expect.objectContaining({
          saleId: price.body.id,
          priceCut: 6000,
          approvedBy: s.userId,
          approval: 'solo_owner',
        }),
      },
    ]);
    // No PIN approval was asked or taken.
    expect(
      await admin`select id from pos.discount_approvals where tenant_id = ${s.tenantId}`,
    ).toEqual([]);
  });

  it('one active staff member brings the PIN back for the owner; deactivating them makes the store solo again', async () => {
    const s = await shop();
    const cashier = await createCashier(app, s, [
      'sales.create',
      'sales.price_override',
    ] as never);
    // With staff the owner sells in a shift they open (no auto-open, UMK-2120).
    await post(s.auth, '/shifts/open', { openingCash: 0 }).expect(201);
    expect(await pinRequired(s.auth)).toBe(true);
    const quote = await post(s.auth, '/sales/quote', {
      lines: orderOver(s).lines,
      discount: 10_000,
    }).expect(200);
    expect(quote.body.discountPinRequired).toBe(true);
    for (const body of [orderOver(s), lineOver(s), priceOver(s)]) {
      const res = await sell(s.auth, body).expect(422);
      expect(res.body.code).toBe('DISCOUNT_APPROVAL_REQUIRED');
    }

    await http()
      .patch(`/staff/${cashier.staffId}`)
      .set('Authorization', s.auth)
      .send({ active: false })
      .expect(200);
    expect(await pinRequired(s.auth)).toBe(false);
    await sell(s.auth, orderOver(s)).expect(201);
  });

  it('a cashier never gets it: refused without an approval, and told a PIN is required', async () => {
    const s = await shop();
    const cashier = await createCashier(app, s, [
      'sales.create',
      'sales.price_override',
    ] as never);
    await post(cashier.auth, '/shifts/open', { openingCash: 0 }).expect(201);
    expect(await pinRequired(cashier.auth)).toBe(true);
    for (const body of [orderOver(s), lineOver(s), priceOver(s)]) {
      const res = await sell(cashier.auth, body).expect(422);
      expect(res.body.code).toBe('DISCOUNT_APPROVAL_REQUIRED');
    }
  });

  it('the 100% refusals stay for a solo owner', async () => {
    const s = await shop();
    const all = await sell(s.auth, {
      lines: [{ productId: s.teh, qty: 4 }],
      discount: 20_000,
      paid: 0,
    }).expect(422);
    expect(all.body).toMatchObject({
      code: 'DISCOUNT_INVALID',
      errors: { discount: 'Diskon 100% tidak diperbolehkan' },
    });
    await sell(s.auth, {
      lines: [{ productId: s.teh, qty: 1, discountPercent: 100 }],
      paid: 0,
    }).expect(422);
    const zero = await sell(s.auth, {
      lines: [{ productId: s.teh, qty: 1, price: 0 }],
      paid: 0,
    }).expect(422);
    expect(zero.body.errors).toMatchObject({
      'lines.0.price': 'Harga manual tidak boleh Rp0',
    });
    expect(
      await admin`select id from pos.sales where tenant_id = ${s.tenantId}`,
    ).toEqual([]);
  });

  it('a void still needs the PIN in a solo store', async () => {
    const s = await shop();
    const sale = await sell(s.auth, orderOver(s)).expect(201);
    const voidIt = (body: object) =>
      http()
        .post(`/sales/${sale.body.id}/void`)
        .set('Authorization', s.auth)
        .set('Idempotency-Key', randomUUID())
        .send({ reasonCode: 'wrong_item_or_qty', ...body });
    await voidIt({}).expect(422);
    await voidIt({ approverId: s.userId }).expect(422);
    await voidIt({ approverId: s.userId, pin: '000000' }).expect(422);
    await voidIt({ approverId: s.userId, pin: OWNER_PIN }).expect(201);
  });

  it('cross-tenant: store B being solo does not unlock store A, which has staff', async () => {
    const a = await shop();
    await createCashier(app, a, ['sales.create'] as never);
    await post(a.auth, '/shifts/open', { openingCash: 0 }).expect(201);
    const b = await shop();
    await sell(b.auth, orderOver(b)).expect(201);
    const res = await sell(a.auth, orderOver(a)).expect(422);
    expect(res.body.code).toBe('DISCOUNT_APPROVAL_REQUIRED');
    expect(await pinRequired(a.auth)).toBe(true);
    expect(await pinRequired(b.auth)).toBe(false);
  });
});
