import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import postgres from 'postgres';
import request from 'supertest';
import { ADMIN_DATABASE_URL } from './support/env';
import { createApp, createStore } from './support/fixtures';
import { createCashier } from './support/staff';

const OWNER_PIN = '482913';
const ADMIN_PIN = '246810';

/**
 * Owner ruling 2026-11-26 (UMK-1990): the 30% PIN gate of a line discount also covers the order discount and a
 * manual price more than 30% below the server's price, with the same single-use approvals. Tax 0 unless said:
 * Teh Botol Rp5.000 (cost 3.000), Kopi Susu Rp12.500 (cost 8.000), 100 of each.
 */
describe('the 30% gate on the order discount and a manual price (UMK-1990)', () => {
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
  const sell = (auth: string, body: object, key: string = randomUUID()) =>
    http()
      .post('/sales')
      .set('Authorization', auth)
      .set('Idempotency-Key', key)
      .send(body);

  async function product(
    s: Awaited<ReturnType<typeof createStore>>,
    categoryId: string,
    name: string,
    sellingPrice: number,
    costPrice: number,
  ) {
    const p = await post(s.auth, '/catalog/products', {
      categoryId,
      name,
      sellingPrice,
      costPrice,
    }).expect(201);
    await post(s.auth, '/stock/opening', {
      productId: p.body.id,
      qty: 100,
    }).expect(201);
    return p.body.id as string;
  }

  /** A store with Rina (may discount and approve, PIN), Ayu (may discount, no PIN), Budi (may only sell). */
  async function shop(taxBps = 0) {
    const s = await createStore();
    const cat = await post(s.auth, '/catalog/categories', {
      name: 'Toko',
    }).expect(201);
    const teh = await product(s, cat.body.id, 'Teh Botol', 5000, 3000);
    const kopi = await product(s, cat.body.id, 'Kopi Susu', 12_500, 8000);
    await put(s.auth, '/sales/settings', { taxBps }).expect(200);
    await put(s.freshAuth, '/void-pin', { pin: OWNER_PIN }).expect(200);
    await post(s.auth, '/shifts/open', { openingCash: 0 }).expect(201);
    const rina = await createCashier(app, s, [
      'sales.create',
      'sales.price_override',
      'sales.void',
    ] as never);
    await put(rina.auth, '/void-pin', { pin: ADMIN_PIN }).expect(200);
    const ayu = await createCashier(app, s, [
      'sales.create',
      'sales.price_override',
    ] as never);
    await post(ayu.auth, '/shifts/open', { openingCash: 0 }).expect(201);
    const budi = await createCashier(app, s, ['sales.create'] as never);
    await post(budi.auth, '/shifts/open', { openingCash: 0 }).expect(201);
    return { ...s, teh, kopi, rina, ayu, budi };
  }
  type Shop = Awaited<ReturnType<typeof shop>>;

  const approve = (
    s: Shop,
    auth: string,
    body: { scope?: string; productId?: string; maxBps: number },
  ) =>
    post(auth, '/sales/discount-approvals', {
      approverId: s.rina.staffId,
      pin: ADMIN_PIN,
      ...body,
    });
  const onHand = async (s: Shop, productId: string) =>
    (await get(s.auth, `/stock/products/${productId}`).expect(200)).body
      .onHand as number;
  const salesCount = async (s: Shop) =>
    Number(
      (
        await admin<
          { n: string }[]
        >`select count(*) as n from pos.sales where tenant_id = ${s.tenantId}`
      )[0].n,
    );
  const usedAt = async (id: string) =>
    (
      await admin<
        { used_at: Date | null }[]
      >`select used_at from pos.discount_approvals where id = ${id}`
    )[0].used_at;

  describe('the order discount', () => {
    it('exactly 30% of what is left after the line discounts needs none; Rp1 more needs an order approval; 100% is refused', async () => {
      const s = await shop();
      // 4 × Rp5.000 = 20.000: 30% = 6.000.
      const exact = await sell(s.ayu.auth, {
        lines: [{ productId: s.teh, qty: 4 }],
        discount: 6000,
        paid: 14_000,
      }).expect(201);
      expect(exact.body).toMatchObject({
        subtotal: 20_000,
        discount: 6000,
        lineDiscount: 0,
        total: 14_000,
        discountApprovedBy: null,
      });
      const over = await sell(s.ayu.auth, {
        lines: [{ productId: s.teh, qty: 4 }],
        discount: 6001,
        paid: 13_999,
      }).expect(422);
      expect(over.body).toMatchObject({
        code: 'DISCOUNT_APPROVAL_REQUIRED',
        errors: { discountApprovalId: 'Diskon lebih dari 30% perlu PIN admin' },
      });
      // A line discount of 2.000 first: the order discount is measured on 18.000, 30% = 5.400.
      const line = { productId: s.teh, qty: 4, discountAmount: 2000 };
      await sell(s.ayu.auth, {
        lines: [line],
        discount: 5400,
        paid: 12_600,
      }).expect(201);
      await sell(s.ayu.auth, {
        lines: [line],
        discount: 5401,
        paid: 12_599,
      }).expect(422);
      const all = await sell(s.ayu.auth, {
        lines: [{ productId: s.teh, qty: 4 }],
        discount: 20_000,
        paid: 0,
      }).expect(422);
      expect(all.body).toMatchObject({
        code: 'DISCOUNT_INVALID',
        errors: { discount: 'Diskon 100% tidak diperbolehkan' },
      });
      const more = await sell(s.ayu.auth, {
        lines: [{ productId: s.teh, qty: 4 }],
        discount: 20_001,
        paid: 0,
      }).expect(422);
      expect(more.body.errors).toEqual({
        discount: 'Diskon melebihi subtotal',
      });
      expect(await onHand(s, s.teh)).toBe(92);
      // Without sales.price_override an order discount is ignored, as before: no approval is asked.
      const plain = await sell(s.budi.auth, {
        lines: [{ productId: s.teh, qty: 1 }],
        discount: 4000,
        paid: 5000,
      }).expect(201);
      expect(plain.body).toMatchObject({ discount: 0, total: 5000 });
    });

    it('an order approval lets 50% through once; the sale and the audit record the approver; a line approval does not serve it, nor it a line', async () => {
      const s = await shop(1100);
      const order = await approve(s, s.ayu.auth, {
        scope: 'order',
        maxBps: 5000,
      }).expect(201);
      expect(order.body).toMatchObject({ scope: 'order', maxBps: 5000 });
      const lineApproval = await approve(s, s.ayu.auth, {
        productId: s.teh,
        maxBps: 5000,
      }).expect(201);
      expect(lineApproval.body.scope).toBe('line');
      // A line approval named as the order's: refused.
      const wrong = await sell(s.ayu.auth, {
        lines: [{ productId: s.teh, qty: 4, discountAmount: 2000 }],
        discount: 9000,
        discountApprovalId: lineApproval.body.id,
        paid: 10_000,
      }).expect(422);
      expect(wrong.body.code).toBe('DISCOUNT_APPROVAL_REQUIRED');
      // The order approval named on a line: refused.
      await sell(s.ayu.auth, {
        lines: [
          {
            productId: s.teh,
            qty: 4,
            discountPercent: 40,
            discountApprovalId: order.body.id,
          },
        ],
        paid: 13_320,
      }).expect(422);
      // 20.000 − line 2.000 = 18.000; order 9.000 (50%); PPN 11% of 9.000 = 990; total 9.990; cash rounds to 10.000.
      const sold = await sell(s.ayu.auth, {
        lines: [{ productId: s.teh, qty: 4, discountAmount: 2000 }],
        discount: 9000,
        discountApprovalId: order.body.id,
        paid: 10_000,
      }).expect(201);
      expect(sold.body).toMatchObject({
        subtotal: 20_000,
        lineDiscount: 2000,
        discount: 11_000,
        tax: 990,
        total: 9990,
        discountApprovedBy: s.rina.staffId,
      });
      expect(await usedAt(order.body.id)).not.toBeNull();
      expect(await usedAt(lineApproval.body.id)).toBeNull();
      const [audit] = await admin<{ details: Record<string, unknown> }[]>`
        select details from pos.audit_log
        where tenant_id = ${s.tenantId} and event = 'discount_approval' and target_type = 'sale'`;
      expect(audit.details).toMatchObject({
        saleId: sold.body.id,
        scope: 'order',
        discount: 9000,
        approvedBy: s.rina.staffId,
      });
      // Used once.
      const again = await sell(s.ayu.auth, {
        lines: [{ productId: s.teh, qty: 4, discountAmount: 2000 }],
        discount: 9000,
        discountApprovalId: order.body.id,
        paid: 10_000,
      }).expect(422);
      expect(again.body.errors).toEqual({
        discountApprovalId:
          'Persetujuan diskon tidak berlaku lagi. Minta PIN admin sekali lagi.',
      });
      // A share larger than approved.
      const small = await approve(s, s.ayu.auth, {
        scope: 'order',
        maxBps: 4000,
      }).expect(201);
      const bigger = await sell(s.ayu.auth, {
        lines: [{ productId: s.teh, qty: 4 }],
        discount: 8001,
        discountApprovalId: small.body.id,
        paid: 13_319,
      }).expect(422);
      expect(bigger.body.errors.discountApprovalId).toBe(
        'Diskon lebih besar dari yang disetujui. Minta PIN admin sekali lagi.',
      );
    });

    it('the approval route: scope defaults to line, an order approval names no product, a line approval names one, a cashier cannot approve their own order discount', async () => {
      const s = await shop();
      await approve(s, s.ayu.auth, {
        scope: 'order',
        productId: s.teh,
        maxBps: 4000,
      })
        .expect(422)
        .expect((r) =>
          expect(r.body.errors).toEqual({
            productId: 'Diskon transaksi tidak memakai produk',
          }),
        );
      await approve(s, s.ayu.auth, { maxBps: 4000 })
        .expect(422)
        .expect((r) =>
          expect(r.body.errors).toEqual({ productId: 'Wajib diisi' }),
        );
      await approve(s, s.ayu.auth, { scope: 'shop', maxBps: 4000 }).expect(422);
      const self = await approve(s, s.rina.auth, {
        scope: 'order',
        maxBps: 4000,
      }).expect(422);
      expect(self.body.code).toBe('DISCOUNT_SELF_APPROVAL');
      // The owner may confirm their own.
      await post(s.auth, '/sales/discount-approvals', {
        approverId: s.userId,
        pin: OWNER_PIN,
        scope: 'order',
        maxBps: 4000,
      }).expect(201);
      // A wrong PIN.
      await post(s.ayu.auth, '/sales/discount-approvals', {
        approverId: s.rina.staffId,
        pin: '000000',
        scope: 'order',
        maxBps: 4000,
      }).expect(422);
      // Only holders of sales.price_override ask.
      await approve(s, s.budi.auth, { scope: 'order', maxBps: 4000 }).expect(
        403,
      );
    });

    it('idempotent: a repeat and a double tap answer the first sale; the approval and the stock are taken once; two sales on one approval let one through', async () => {
      const s = await shop();
      const body = (approvalId: string) => ({
        lines: [{ productId: s.teh, qty: 4 }],
        discount: 8000,
        discountApprovalId: approvalId,
        paid: 12_000,
      });
      const a1 = await approve(s, s.ayu.auth, {
        scope: 'order',
        maxBps: 4000,
      }).expect(201);
      const key = randomUUID();
      const first = await sell(s.ayu.auth, body(a1.body.id), key).expect(201);
      const again = await sell(s.ayu.auth, body(a1.body.id), key).expect(201);
      expect(again.body.id).toBe(first.body.id);
      expect(again.body).toMatchObject({ discount: 8000, total: 12_000 });
      for (let round = 0; round < 3; round++) {
        const a = await approve(s, s.ayu.auth, {
          scope: 'order',
          maxBps: 4000,
        }).expect(201);
        const k = randomUUID();
        const [x, y] = await Promise.all([
          sell(s.ayu.auth, body(a.body.id), k),
          sell(s.ayu.auth, body(a.body.id), k),
        ]);
        expect([x.status, y.status]).toEqual([201, 201]);
        expect(y.body.id).toBe(x.body.id);
      }
      expect(await onHand(s, s.teh)).toBe(84);
      expect(await salesCount(s)).toBe(4);
      // Two different sales (two keys) on one approval at once: one goes through.
      const shared = await approve(s, s.ayu.auth, {
        scope: 'order',
        maxBps: 4000,
      }).expect(201);
      const results = await Promise.all([
        sell(s.ayu.auth, body(shared.body.id)),
        sell(s.ayu.auth, body(shared.body.id)),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 422]);
      expect(results.find((r) => r.status === 422)?.body.code).toBe(
        'DISCOUNT_APPROVAL_REQUIRED',
      );
      expect(await onHand(s, s.teh)).toBe(80);
      const used = await admin<{ n: string }[]>`
        select count(*) as n from pos.discount_approvals
        where tenant_id = ${s.tenantId} and used_at is not null`;
      expect(Number(used[0].n)).toBe(5);
    });
  });

  describe('a manual price', () => {
    it('30% below the price needs none, more needs a line approval of that product, above the price needs none, Rp0 is refused; without the permission the price is ignored', async () => {
      const s = await shop();
      // 4 × Rp3.500 = 14.000: 6.000 below 20.000, exactly 30%.
      const exact = await sell(s.ayu.auth, {
        lines: [{ productId: s.teh, qty: 4, price: 3500 }],
        paid: 14_000,
      }).expect(201);
      expect(exact.body.lines[0]).toMatchObject({
        unitPrice: 3500,
        lineTotal: 14_000,
        discountApprovedBy: null,
      });
      const over = await sell(s.ayu.auth, {
        lines: [{ productId: s.teh, qty: 4, price: 3499 }],
        paid: 13_996,
      }).expect(422);
      expect(over.body).toMatchObject({
        code: 'DISCOUNT_APPROVAL_REQUIRED',
        errors: {
          'lines.0.discountApprovalId':
            'Harga manual lebih dari 30% di bawah harga normal perlu PIN admin',
        },
      });
      const higher = await sell(s.ayu.auth, {
        lines: [{ productId: s.teh, qty: 1, price: 6000 }],
        paid: 6000,
      }).expect(201);
      expect(higher.body).toMatchObject({ total: 6000 });
      const zero = await sell(s.ayu.auth, {
        lines: [{ productId: s.teh, qty: 1, price: 0 }],
        paid: 0,
      }).expect(422);
      expect(zero.body).toMatchObject({
        code: 'DISCOUNT_INVALID',
        errors: { 'lines.0.price': 'Harga manual tidak boleh Rp0' },
      });
      // Approval for another product does not serve Teh.
      const forKopi = await approve(s, s.ayu.auth, {
        productId: s.kopi,
        maxBps: 5000,
      }).expect(201);
      await sell(s.ayu.auth, {
        lines: [
          {
            productId: s.teh,
            qty: 4,
            price: 2500,
            discountApprovalId: forKopi.body.id,
          },
        ],
        paid: 10_000,
      }).expect(422);
      // An order approval does not serve a line either.
      const order = await approve(s, s.ayu.auth, {
        scope: 'order',
        maxBps: 5000,
      }).expect(201);
      await sell(s.ayu.auth, {
        lines: [
          {
            productId: s.teh,
            qty: 4,
            price: 2500,
            discountApprovalId: order.body.id,
          },
        ],
        paid: 10_000,
      }).expect(422);
      // 50% below with a line approval of Teh: the line keeps the approver, the price is stored, cost is FIFO.
      const forTeh = await approve(s, s.ayu.auth, {
        productId: s.teh,
        maxBps: 5000,
      }).expect(201);
      const sold = await sell(s.ayu.auth, {
        lines: [
          {
            productId: s.teh,
            qty: 4,
            price: 2500,
            discountApprovalId: forTeh.body.id,
          },
        ],
        paid: 10_000,
      }).expect(201);
      expect(sold.body).toMatchObject({
        subtotal: 10_000,
        discount: 0,
        total: 10_000,
      });
      expect(sold.body.lines[0]).toMatchObject({
        unitPrice: 2500,
        lineTotal: 10_000,
        discountApprovedBy: s.rina.staffId,
      });
      expect(await usedAt(forTeh.body.id)).not.toBeNull();
      expect(await usedAt(forKopi.body.id)).toBeNull();
      // 51% is more than approved.
      const small = await approve(s, s.ayu.auth, {
        productId: s.teh,
        maxBps: 5000,
      }).expect(201);
      await sell(s.ayu.auth, {
        lines: [
          {
            productId: s.teh,
            qty: 4,
            price: 2450,
            discountApprovalId: small.body.id,
          },
        ],
        paid: 9800,
      }).expect(422);
      // Budi has no sales.price_override: his price is ignored, no approval is asked (as before).
      const plain = await sell(s.budi.auth, {
        lines: [{ productId: s.teh, qty: 1, price: 1 }],
        paid: 5000,
      }).expect(201);
      expect(plain.body).toMatchObject({ total: 5000 });
      expect(await onHand(s, s.teh)).toBe(90);
    });
  });

  it("the quote answers whether a manual price or the order discount needs a PIN, with the sale's figures", async () => {
    const s = await shop();
    // Teh 4 × Rp3.000 = 12.000 (40% below 20.000); Kopi 1 × 12.500 with 10% off = 11.250; base 23.250.
    const q = await post(s.ayu.auth, '/sales/quote', {
      lines: [
        { productId: s.teh, qty: 4, price: 3000 },
        { productId: s.kopi, qty: 1, discountPercent: 10 },
      ],
      discount: 6976,
    }).expect(200);
    expect(q.body).toMatchObject({
      subtotal: 24_500,
      lineDiscount: 1250,
      orderDiscount: 6976,
      // 6.976 × 10.000 = 69.760.000 > 23.250 × 3.000 = 69.750.000.
      orderDiscountNeedsApproval: true,
    });
    expect(q.body.lines[0]).toMatchObject({
      unitPrice: 3000,
      lineTotal: 12_000,
      listPrice: 5000,
      manualPrice: true,
      priceNeedsApproval: true,
      discountNeedsApproval: false,
    });
    expect(q.body.lines[1]).toMatchObject({
      lineTotal: 12_500,
      discount: 1250,
      priceNeedsApproval: false,
      discountNeedsApproval: false,
    });
    const at30 = await post(s.ayu.auth, '/sales/quote', {
      lines: [
        { productId: s.teh, qty: 4, price: 3500 },
        { productId: s.kopi, qty: 1, discountPercent: 10 },
      ],
      discount: 7425,
    }).expect(200);
    // Base 14.000 + 11.250 = 25.250; 30% = 7.575 ≥ 7.425.
    expect(at30.body).toMatchObject({
      subtotal: 26_500,
      orderDiscountNeedsApproval: false,
    });
    expect(at30.body.lines[0].priceNeedsApproval).toBe(false);
    // Without the permission the price and the order discount are ignored, as the sale does.
    const plain = await post(s.budi.auth, '/sales/quote', {
      lines: [{ productId: s.teh, qty: 4, price: 1 }],
      discount: 5000,
    }).expect(200);
    expect(plain.body).toMatchObject({
      subtotal: 20_000,
      orderDiscount: 0,
      orderDiscountNeedsApproval: false,
    });
    expect(plain.body.lines[0]).toMatchObject({
      unitPrice: 5000,
      priceNeedsApproval: false,
    });
  });

  it("cross-tenant: store B cannot use store A's order or price approval, nor approve with A's admin", async () => {
    const a = await shop();
    const order = await approve(a, a.ayu.auth, {
      scope: 'order',
      maxBps: 5000,
    }).expect(201);
    const price = await approve(a, a.ayu.auth, {
      productId: a.teh,
      maxBps: 5000,
    }).expect(201);
    const b = await shop();
    const res = await sell(b.auth, {
      lines: [{ productId: b.teh, qty: 4 }],
      discount: 9000,
      discountApprovalId: order.body.id,
      paid: 11_000,
    }).expect(422);
    expect(res.body.code).toBe('DISCOUNT_APPROVAL_REQUIRED');
    await sell(b.auth, {
      lines: [
        {
          productId: b.teh,
          qty: 4,
          price: 2500,
          discountApprovalId: price.body.id,
        },
      ],
      paid: 10_000,
    }).expect(422);
    // A's admin and her right PIN, in store B: refused.
    await post(b.auth, '/sales/discount-approvals', {
      approverId: a.rina.staffId,
      pin: ADMIN_PIN,
      scope: 'order',
      maxBps: 5000,
    }).expect(422);
    expect(await usedAt(order.body.id)).toBeNull();
    expect(await usedAt(price.body.id)).toBeNull();
    expect(await onHand(b, b.teh)).toBe(100);
  });
});
