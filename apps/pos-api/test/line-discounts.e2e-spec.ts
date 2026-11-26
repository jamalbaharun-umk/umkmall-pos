import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import postgres from 'postgres';
import request from 'supertest';
import { ADMIN_DATABASE_URL } from './support/env';
import { createApp, createStore } from './support/fixtures';
import { createCashier } from './support/staff';

type Store = Awaited<ReturnType<typeof createStore>>;
type Line = {
  productId: string;
  name: string;
  qty: number;
  unit: string;
  lineTotal: number;
  discount: number;
  discountPercent: number | null;
  discountApprovedBy: string | null;
  netTotal: number;
  appliedTier: { minQty: number; price: number } | null;
  savings: number;
};

const OWNER_PIN = '482913';
const ADMIN_PIN = '246810';
const today = () =>
  new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
const tomorrow = () =>
  new Date(Date.now() + 31 * 3_600_000).toISOString().slice(0, 10);

/**
 * UMK-1990, design feature 30 "Diskon baris". The design's cart: Indomie Goreng 5 × Rp3.500, Teh Botol
 * 4 × Rp5.000 with 10% off, Kopi Susu 1 × Rp12.500, voucher HEMAT3 (Rp3.000), PPN 11%:
 *   subtotal 50.000 − line discount 2.000 − voucher 3.000 = 45.000; PPN 4.950; total 49.950;
 *   cash rounding 50 → Rp50.000 (non-cash Rp49.950).
 * Costs: Indomie Rp2.500, Teh Rp3.000, Kopi Rp8.000 → cost 12.500 + 12.000 + 8.000 = 32.500.
 */
describe('line discounts (UMK-1990)', () => {
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

  async function product(
    s: Store,
    categoryId: string,
    name: string,
    sellingPrice: number,
    costPrice: number,
    extra: object = {},
  ) {
    const p = await post(s.auth, '/catalog/products', {
      categoryId,
      name,
      sellingPrice,
      costPrice,
      ...extra,
    }).expect(201);
    await post(s.auth, '/stock/opening', {
      productId: p.body.id,
      qty: 100,
    }).expect(201);
    return p.body.id as string;
  }

  /** The design's store: three products (100 each), voucher HEMAT3, Kasbon and Debit, a member, owner PIN, open shift. */
  async function shop(taxBps = 1100) {
    const s = await createStore();
    const cat = await post(s.auth, '/catalog/categories', {
      name: 'Toko',
    }).expect(201);
    const indomie = await product(s, cat.body.id, 'Indomie Goreng', 3500, 2500);
    const teh = await product(s, cat.body.id, 'Teh Botol', 5000, 3000);
    const kopi = await product(s, cat.body.id, 'Kopi Susu', 12_500, 8000);
    await post(s.auth, '/vouchers', {
      name: 'Hemat tiga ribu',
      code: 'HEMAT3',
      type: 'flat',
      nominal: 3000,
      kuota: 10,
      startDate: today(),
      expired: tomorrow(),
    }).expect(201);
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
    await post(s.auth, '/shifts/open', { openingCash: 100_000 }).expect(201);
    const designLines = (tehDiscount: object = { discountPercent: 10 }) => [
      { productId: indomie, qty: 5 },
      { productId: teh, qty: 4, ...tehDiscount },
      { productId: kopi, qty: 1 },
    ];
    return {
      ...s,
      categoryId: cat.body.id as string,
      indomie,
      teh,
      kopi,
      kasbonId: kasbon.body.id as string,
      debitId: debit.body.id as string,
      memberId: member.body.id as string,
      designLines,
    };
  }

  const sell = (auth: string, body: object, key?: string) =>
    keyed(auth, '/sales', body, key);
  const onHand = async (s: Store, productId: string) =>
    (await get(s.auth, `/stock/products/${productId}`).expect(200)).body
      .onHand as number;
  const lineOf = (body: { lines: Line[] }, productId: string) =>
    body.lines.find((l) => l.productId === productId)!;
  const salesCount = async (s: Store) =>
    Number(
      (
        await admin<
          { n: string }[]
        >`select count(*) as n from pos.sales where tenant_id = ${s.tenantId}`
      )[0].n,
    );

  /** A staff member with `permissions` and their own void PIN (setting one needs sales.void). */
  async function staffWithPin(s: Store, permissions: string[], pin: string) {
    const c = await createCashier(app, s, permissions as never);
    await put(c.auth, '/void-pin', { pin }).expect(200);
    return c;
  }

  describe('the design example, exact numbers', () => {
    it('cash: subtotal 50.000, line −2.000, voucher −3.000, PPN 4.950, total 49.950, rounding 50, due 50.000; the receipt and the quote agree', async () => {
      const s = await shop();
      const body = {
        lines: s.designLines(),
        voucherCode: 'HEMAT3',
        paid: 50_000,
      };
      const quote = await post(s.auth, '/sales/quote', {
        lines: s.designLines(),
        voucherCode: 'HEMAT3',
      }).expect(200);
      expect(quote.body).toMatchObject({
        subtotal: 50_000,
        lineDiscount: 2000,
        voucherDiscount: 3000,
        tax: 4950,
        total: 49_950,
        rounding: 0, // no method named: the exact total
      });
      expect(lineOf(quote.body, s.teh)).toMatchObject({
        lineTotal: 20_000,
        discount: 2000,
        discountPercent: 10,
        netTotal: 18_000,
        discountNeedsApproval: false,
      });

      const res = await sell(s.auth, body).expect(201);
      expect(res.body).toMatchObject({
        status: 'completed',
        subtotal: 50_000,
        lineDiscount: 2000,
        discount: 2000,
        voucherDiscount: 3000,
        taxBps: 1100,
        tax: 4950,
        total: 49_950,
        rounding: 50,
        amountDue: 50_000,
        paid: 50_000,
        change: 0,
        costTotal: 32_500,
        overrideBy: s.userId,
      });
      expect(lineOf(res.body, s.teh)).toMatchObject({
        qty: 4,
        lineTotal: 20_000,
        discount: 2000,
        discountPercent: 10,
        netTotal: 18_000,
        discountApprovedBy: null,
      });
      expect(lineOf(res.body, s.indomie)).toMatchObject({
        lineTotal: 17_500,
        discount: 0,
        discountPercent: null,
        netTotal: 17_500,
      });
      const receipt = await get(s.auth, `/sales/${res.body.id}/receipt`).expect(
        200,
      );
      expect(receipt.body).toMatchObject({
        subtotal: 50_000,
        lineDiscount: 2000,
        discount: 2000,
        voucherDiscount: 3000,
        tax: 4950,
        total: 49_950,
        rounding: 50,
        amountDue: 50_000,
      });
      expect(
        (receipt.body.lines as Line[]).find((l) => l.name === 'Teh Botol'),
      ).toMatchObject({
        qty: 4,
        unitPrice: 5000,
        lineTotal: 20_000,
        discount: 2000,
        discountPercent: 10,
        netTotal: 18_000,
      });
      // The cash rounding is the last step: the quote with the cash method says the same.
      const methods = (await get(s.auth, '/payment-methods').expect(200)).body
        .data as { id: string; kind: string }[];
      const cashQuote = await post(s.auth, '/sales/quote', {
        lines: s.designLines(),
        voucherCode: 'HEMAT3',
        paymentMethodId: methods.find((m) => m.kind === 'cash')!.id,
      }).expect(200);
      expect(cashQuote.body).toMatchObject({
        total: 49_950,
        rounding: 50,
        amountDue: 50_000,
      });
    });

    it('debit owes the exact 49.950 (no rounding); kasbon is never rounded either', async () => {
      const s = await shop();
      const debit = await sell(s.auth, {
        lines: s.designLines(),
        voucherCode: 'HEMAT3',
        paymentMethodId: s.debitId,
        paid: 49_950,
      }).expect(201);
      expect(debit.body).toMatchObject({
        total: 49_950,
        rounding: 0,
        amountDue: 49_950,
      });
      // Kasbon, no voucher: 50.000 − 2.000 = 48.000; PPN 11% 5.280; total 53.280, receivable 53.280.
      const kasbon = await sell(s.auth, {
        lines: s.designLines(),
        paymentMethodId: s.kasbonId,
        memberId: s.memberId,
        paid: 0,
      }).expect(201);
      expect(kasbon.body).toMatchObject({
        subtotal: 50_000,
        lineDiscount: 2000,
        tax: 5280,
        total: 53_280,
        rounding: 0,
        amountDue: 53_280,
        receivableRest: 53_280,
      });
    });
  });

  describe('percent and amount', () => {
    it('percent is rounded half up in whole rupiah on the line total; an amount is taken as given', async () => {
      const s = await shop(0);
      const odd = await product(s, s.categoryId, 'Roti', 3333, 1000);
      // 3 × 3.333 = 9.999: 15% = 1.499,85 → 1.500 (net 8.499). Kopi: Rp999 off 12.500 → 11.501. Total 20.000.
      const res = await sell(s.auth, {
        lines: [
          { productId: odd, qty: 3, discountPercent: 15 },
          { productId: s.kopi, qty: 1, discountAmount: 999 },
        ],
        paid: 20_000,
      }).expect(201);
      expect(lineOf(res.body, odd)).toMatchObject({
        lineTotal: 9999,
        discount: 1500,
        discountPercent: 15,
        netTotal: 8499,
      });
      expect(lineOf(res.body, s.kopi)).toMatchObject({
        lineTotal: 12_500,
        discount: 999,
        discountPercent: null,
        netTotal: 11_501,
      });
      expect(res.body).toMatchObject({
        subtotal: 22_499,
        lineDiscount: 2499,
        total: 20_000,
        rounding: 0,
      });
      // 5% of 9.999 = 499,95 → 500.
      const five = await post(s.auth, '/sales/quote', {
        lines: [{ productId: odd, qty: 3, discountPercent: 5 }],
      }).expect(200);
      expect(five.body.lines[0]).toMatchObject({
        discount: 500,
        netTotal: 9499,
      });
    });

    it('a discount of the whole line or more, 100%, both kinds, or a manual price with a discount is refused, and nothing is taken', async () => {
      const s = await shop(0);
      const refused = async (line: object, field: string, code?: string) => {
        const res = await sell(s.auth, {
          lines: [{ productId: s.teh, qty: 4, ...line }],
          paid: 100_000,
        }).expect(422);
        expect(Object.keys(res.body.errors)).toEqual([field]);
        if (code) expect(res.body.code).toBe(code);
        return res;
      };
      const equal = await refused(
        { discountAmount: 20_000 },
        'lines.0.discountAmount',
        'DISCOUNT_INVALID',
      );
      expect(equal.body.message).toBe(
        'Diskon 100% tidak diperbolehkan untuk satu baris',
      );
      const over = await refused(
        { discountAmount: 20_001 },
        'lines.0.discountAmount',
        'DISCOUNT_INVALID',
      );
      expect(over.body.message).toBe('Diskon melebihi harga baris');
      await refused({ discountPercent: 100 }, 'lines.0.discountPercent');
      await refused({ discountPercent: 0 }, 'lines.0.discountPercent');
      await refused({ discountPercent: 10.5 }, 'lines.0.discountPercent');
      await refused({ discountAmount: -1 }, 'lines.0.discountAmount');
      await refused(
        { discountPercent: 10, discountAmount: 1000 },
        'lines.0.discountAmount',
      );
      const manual = await refused(
        { price: 4000, discountPercent: 10 },
        'lines.0.discountPercent',
        'DISCOUNT_INVALID',
      );
      expect(manual.body.message).toBe(
        'Harga manual dan diskon tidak bisa dipakai bersama pada satu baris',
      );
      // The quote refuses the same.
      await post(s.auth, '/sales/quote', {
        lines: [{ productId: s.teh, qty: 4, discountAmount: 20_000 }],
      }).expect(422);
      expect(await onHand(s, s.teh)).toBe(100);
      expect(await salesCount(s)).toBe(0);
      // A price equal to the server's (not a manual price) leaves the discount on.
      const same = await sell(s.auth, {
        lines: [{ productId: s.teh, qty: 4, price: 5000, discountPercent: 10 }],
        paid: 18_000,
      }).expect(201);
      expect(same.body.lines[0]).toMatchObject({
        unitPrice: 5000,
        discount: 2000,
        netTotal: 18_000,
        manualPrice: false,
      });
    });
  });

  describe('the server computes; the permission', () => {
    it('a client total or line amount is refused, a client price without the permission is ignored, a discount without it is 403 and takes nothing', async () => {
      const s = await shop(0);
      // Totals are never input: unknown keys are refused.
      for (const extra of [{ total: 1 }, { lineDiscount: 19_999 }])
        await sell(s.auth, {
          lines: [{ productId: s.teh, qty: 4 }],
          paid: 20_000,
          ...extra,
        }).expect(422);
      await sell(s.auth, {
        lines: [{ productId: s.teh, qty: 4, netTotal: 1 }],
        paid: 20_000,
      }).expect(422);

      const kasir = await createCashier(app, s, ['sales.create']);
      await post(kasir.auth, '/shifts/open', { openingCash: 0 }).expect(201);
      const denied = await sell(kasir.auth, {
        lines: [{ productId: s.teh, qty: 4, discountPercent: 10 }],
        paid: 20_000,
      }).expect(403);
      expect(denied.body).toMatchObject({
        message:
          'Anda belum punya izin memberi diskon. Minta admin atau pemilik.',
        code: 'DISCOUNT_FORBIDDEN',
      });
      await post(kasir.auth, '/sales/quote', {
        lines: [{ productId: s.teh, qty: 4, discountAmount: 1000 }],
      }).expect(403);
      await get(kasir.auth, '/sales/discount-approvers').expect(403);
      await post(kasir.auth, '/sales/discount-approvals', {
        approverId: s.userId,
        pin: OWNER_PIN,
        productId: s.teh,
        maxBps: 4000,
      }).expect(403);
      expect(await onHand(s, s.teh)).toBe(100);
      // The cashier's client price is ignored: charged the server's 4 × 5.000.
      const plain = await sell(kasir.auth, {
        lines: [{ productId: s.teh, qty: 4, price: 1 }],
        paid: 20_000,
      }).expect(201);
      expect(plain.body).toMatchObject({ total: 20_000, discount: 0 });

      // A cashier given sales.price_override discounts up to 30% without anyone's PIN.
      const senior = await createCashier(app, s, [
        'sales.create',
        'sales.price_override',
      ]);
      await post(senior.auth, '/shifts/open', { openingCash: 0 }).expect(201);
      const ok = await sell(senior.auth, {
        lines: [{ productId: s.teh, qty: 4, discountAmount: 6000 }],
        paid: 14_000,
      }).expect(201);
      expect(ok.body).toMatchObject({
        total: 14_000,
        lineDiscount: 6000,
        overrideBy: senior.staffId,
      });
    });

    it('idempotent: a repeat of the sale answers the first one, takes stock and the approval once; another body under the key is refused', async () => {
      const s = await shop(0);
      const approval = await post(s.auth, '/sales/discount-approvals', {
        approverId: s.userId,
        pin: OWNER_PIN,
        productId: s.teh,
        maxBps: 4000,
      }).expect(201);
      const body = {
        lines: [
          {
            productId: s.teh,
            qty: 4,
            discountPercent: 40,
            discountApprovalId: approval.body.id,
          },
        ],
        paid: 12_000,
      };
      const key = randomUUID();
      const first = await sell(s.auth, body, key).expect(201);
      const again = await sell(s.auth, body, key).expect(201);
      expect(again.body.id).toBe(first.body.id);
      expect(again.body).toMatchObject({ total: 12_000, lineDiscount: 8000 });
      expect(await onHand(s, s.teh)).toBe(96);
      expect(await salesCount(s)).toBe(1);
      await sell(
        s.auth,
        {
          ...body,
          lines: [{ ...body.lines[0], discountPercent: 39 }],
        },
        key,
      ).expect(422);
    });
  });

  describe('above 30%: a PIN approval', () => {
    async function withAdmin() {
      const s = await shop(0);
      // Admin-like: may discount and approve, and has a PIN.
      const rina = await staffWithPin(
        s,
        ['sales.create', 'sales.price_override', 'sales.void'],
        ADMIN_PIN,
      );
      // May void but not discount: has a PIN, cannot approve a discount.
      const tono = await staffWithPin(
        s,
        ['sales.create', 'sales.void'],
        '135790',
      );
      const ayu = await createCashier(app, s, [
        'sales.create',
        'sales.price_override',
      ]);
      await post(ayu.auth, '/shifts/open', { openingCash: 0 }).expect(201);
      return { s, rina, tono, ayu };
    }
    const ask = (
      auth: string,
      body: {
        approverId: string;
        pin: string;
        productId: string;
        maxBps: number;
      },
    ) => post(auth, '/sales/discount-approvals', body);

    it('exactly 30% needs none; more needs one; the approvers are the holders of sales.price_override', async () => {
      const { s, rina, tono, ayu } = await withAdmin();
      await sell(ayu.auth, {
        lines: [{ productId: s.teh, qty: 4, discountAmount: 6000 }],
        paid: 14_000,
      }).expect(201);
      for (const line of [{ discountAmount: 6001 }, { discountPercent: 31 }]) {
        const res = await sell(ayu.auth, {
          lines: [{ productId: s.teh, qty: 4, ...line }],
          paid: 20_000,
        }).expect(422);
        expect(res.body).toMatchObject({
          code: 'DISCOUNT_APPROVAL_REQUIRED',
          errors: {
            'lines.0.discountApprovalId':
              'Diskon lebih dari 30% perlu PIN admin',
          },
        });
      }
      const quote = await post(ayu.auth, '/sales/quote', {
        lines: [{ productId: s.teh, qty: 4, discountPercent: 40 }],
      }).expect(200);
      expect(quote.body.lines[0]).toMatchObject({
        discount: 8000,
        netTotal: 12_000,
        discountNeedsApproval: true,
      });
      const approvers = await get(ayu.auth, '/sales/discount-approvers').expect(
        200,
      );
      const ids = (approvers.body as { id: string }[]).map((a) => a.id);
      expect(ids).toEqual(
        expect.arrayContaining([s.userId, rina.staffId, ayu.staffId]),
      );
      expect(ids).not.toContain(tono.staffId);
      expect(JSON.stringify(approvers.body)).not.toMatch(/hash/i);
    });

    it('an admin approves with their own PIN: 40% goes through, the line records the approver, the approval is used once', async () => {
      const { s, rina, ayu } = await withAdmin();
      const approval = await ask(ayu.auth, {
        approverId: rina.staffId,
        pin: ADMIN_PIN,
        productId: s.teh,
        maxBps: 4000,
      }).expect(201);
      expect(approval.body).toMatchObject({
        id: expect.any(String),
        maxBps: 4000,
        approver: { id: rina.staffId, name: expect.any(String) },
      });
      const line = {
        productId: s.teh,
        qty: 4,
        discountPercent: 40,
        discountApprovalId: approval.body.id,
      };
      const res = await sell(ayu.auth, { lines: [line], paid: 12_000 }).expect(
        201,
      );
      expect(res.body).toMatchObject({ total: 12_000, lineDiscount: 8000 });
      expect(res.body.lines[0]).toMatchObject({
        discount: 8000,
        discountPercent: 40,
        discountApprovedBy: rina.staffId,
      });
      // Used: a second sale with it is refused.
      const reuse = await sell(ayu.auth, {
        lines: [line],
        paid: 12_000,
      }).expect(422);
      expect(reuse.body.code).toBe('DISCOUNT_APPROVAL_REQUIRED');
      const [row] = await admin<{ sale_id: string; used_at: Date | null }[]>`
        select sale_id, used_at from pos.discount_approvals where id = ${approval.body.id}`;
      expect(row.sale_id).toBe(res.body.id);
      expect(row.used_at).not.toBeNull();
    });

    it('refused: a wrong PIN, an approver without the permission, a share too small, under 30%, another product, expired, another actor', async () => {
      const { s, rina, tono, ayu } = await withAdmin();
      const wrong = await ask(ayu.auth, {
        approverId: rina.staffId,
        pin: '000000',
        productId: s.teh,
        maxBps: 4000,
      }).expect(422);
      expect(wrong.body.errors).toEqual({ pin: 'PIN salah' });
      // Tono's right PIN: he cannot approve a discount, so it reads as a wrong PIN.
      await ask(ayu.auth, {
        approverId: tono.staffId,
        pin: '135790',
        productId: s.teh,
        maxBps: 4000,
      }).expect(422);
      await ask(ayu.auth, {
        approverId: rina.staffId,
        pin: ADMIN_PIN,
        productId: s.teh,
        maxBps: 3000,
      }).expect(422);

      const approve = async (
        productId = s.teh,
        maxBps = 4000,
        auth = ayu.auth,
      ) =>
        (
          await ask(auth, {
            approverId: rina.staffId,
            pin: ADMIN_PIN,
            productId,
            maxBps,
          }).expect(201)
        ).body.id as string;
      const tryWith = (discountApprovalId: string, discountPercent = 40) =>
        sell(ayu.auth, {
          lines: [
            { productId: s.teh, qty: 4, discountPercent, discountApprovalId },
          ],
          paid: 20_000,
        });
      const expectRefused = async (id: string, percent?: number) => {
        const res = await tryWith(id, percent).expect(422);
        expect(res.body.code).toBe('DISCOUNT_APPROVAL_REQUIRED');
      };
      // 41% on an approval of 40%.
      await expectRefused(await approve(), 41);
      // For Kopi, used on Teh.
      await expectRefused(await approve(s.kopi));
      // Expired.
      const old = await approve();
      await admin`update pos.discount_approvals set expires_at = now() - interval '1 second' where id = ${old}`;
      await expectRefused(old);
      // Asked by the owner, used by Ayu.
      await expectRefused(await approve(s.teh, 4000, s.auth));
      // Unknown id.
      await expectRefused(randomUUID());
      expect(await onHand(s, s.teh)).toBe(100);
    });
  });

  it("cross-tenant: store B cannot list, use or ask for store A's approvers, approvals or products", async () => {
    const a = await shop(0);
    const rina = await staffWithPin(
      a,
      ['sales.create', 'sales.price_override', 'sales.void'],
      ADMIN_PIN,
    );
    const approval = await post(a.auth, '/sales/discount-approvals', {
      approverId: rina.staffId,
      pin: ADMIN_PIN,
      productId: a.teh,
      maxBps: 4000,
    }).expect(201);
    const b = await shop(0);
    const listed = await get(b.auth, '/sales/discount-approvers').expect(200);
    expect((listed.body as { id: string }[]).map((x) => x.id)).toEqual([
      b.userId,
    ]);
    // A's admin and her right PIN, in store B: a wrong PIN.
    await post(b.auth, '/sales/discount-approvals', {
      approverId: rina.staffId,
      pin: ADMIN_PIN,
      productId: b.teh,
      maxBps: 4000,
    }).expect(422);
    // A's product.
    const foreign = await post(b.auth, '/sales/discount-approvals', {
      approverId: b.userId,
      pin: OWNER_PIN,
      productId: a.teh,
      maxBps: 4000,
    }).expect(422);
    expect(foreign.body.errors).toEqual({
      productId: 'Produk tidak ditemukan',
    });
    // A's approval on B's sale.
    const res = await sell(b.auth, {
      lines: [
        {
          productId: b.teh,
          qty: 4,
          discountPercent: 40,
          discountApprovalId: approval.body.id,
        },
      ],
      paid: 12_000,
    }).expect(422);
    expect(res.body.code).toBe('DISCOUNT_APPROVAL_REQUIRED');
    // A's approval is untouched.
    const [row] = await admin<{ used_at: Date | null }[]>`
      select used_at from pos.discount_approvals where id = ${approval.body.id}`;
    expect(row.used_at).toBeNull();
  });

  it("wholesale: the tier is chosen by the product's base units as before, the discount comes off the tier price, the 30% is measured there", async () => {
    const s = await shop(0);
    // Teh Botol 350ml: Rp3.500 a pcs, a dus of 24 at Rp78.000 (fixed), 12+ pcs → Rp3.300, 48+ → Rp3.200.
    const teh = await product(s, s.categoryId, 'Teh Botol 350ml', 3500, 2000, {
      unit: 'pcs',
      units: [{ name: 'dus', unitQty: 24, price: 78_000 }],
      priceTiers: [
        { minQty: 12, price: 3300 },
        { minQty: 48, price: 3200 },
      ],
    });
    // 12 pcs + 1 dus = 36 base units → the 12+ tier. pcs line: 12 × 3.300 = 39.600, 10% = 3.960 → 35.640.
    // The dus stays 78.000. Subtotal 117.600, line discount 3.960, total 113.640.
    const res = await sell(s.auth, {
      lines: [
        { productId: teh, qty: 12, discountPercent: 10 },
        { productId: teh, qty: 1, unit: 'dus' },
      ],
      paid: 113_700, // cash: rounded up to the next Rp100 (+60)
    }).expect(201);
    const pcs = (res.body.lines as Line[]).find((l) => l.unit === 'pcs')!;
    const dus = (res.body.lines as Line[]).find((l) => l.unit === 'dus')!;
    expect(pcs).toMatchObject({
      unitPrice: 3300,
      lineTotal: 39_600,
      discount: 3960,
      netTotal: 35_640,
      appliedTier: { minQty: 12, price: 3300 },
      savings: 2400, // (3.500 − 3.300) × 12: the tier is still shown
    });
    expect(dus).toMatchObject({ lineTotal: 78_000, discount: 0 });
    expect(res.body).toMatchObject({
      subtotal: 117_600,
      lineDiscount: 3960,
      total: 113_640,
      rounding: 60,
    });
    expect(await onHand(s, teh)).toBe(100 - 36);
    // 30% of 39.600 is 11.880: that much needs no PIN, one rupiah more does.
    const at = (discountAmount: number) =>
      post(s.auth, '/sales/quote', {
        lines: [
          { productId: teh, qty: 12, discountAmount },
          { productId: teh, qty: 1, unit: 'dus' },
        ],
      }).expect(200);
    expect((await at(11_880)).body.lines[0].discountNeedsApproval).toBe(false);
    expect((await at(11_881)).body.lines[0].discountNeedsApproval).toBe(true);
  });

  it('void after a discounted sale: stock back, the void record and the reports reverse the exact amounts; profit is on the discounted revenue', async () => {
    const s = await shop();
    const res = await sell(s.auth, {
      lines: s.designLines(),
      voucherCode: 'HEMAT3',
      paid: 50_000,
    }).expect(201);
    const q = `from=${today()}&to=${today()}`;
    const report = await get(s.auth, `/reports/sales?${q}`).expect(200);
    // revenue 49.950; gross profit = revenue − tax − cost = 49.950 − 4.950 − 32.500 = 12.500.
    expect(report.body.totals).toMatchObject({
      salesCount: 1,
      grossSales: 50_000,
      discount: 2000,
      voucher: 3000,
      tax: 4950,
      revenue: 49_950,
      cost: 32_500,
      grossProfit: 12_500,
      rounding: 50,
    });
    expect(
      (report.body.rows as { name: string }[]).find(
        (r) => r.name === 'Teh Botol',
      ),
    ).toMatchObject({
      qty: 4,
      unitPrice: 5000,
      lineTotal: 20_000,
      discount: 2000,
      cost: 12_000,
      grossProfit: 6000, // 20.000 − 2.000 − 12.000
    });
    const products = await get(s.auth, `/reports/products?${q}`).expect(200);
    expect(
      (products.body.rows as { name: string }[]).find(
        (r) => r.name === 'Teh Botol',
      ),
    ).toMatchObject({ qty: 4, sales: 18_000, cost: 12_000, grossProfit: 6000 });
    const csv = await get(s.auth, `/reports/sales/csv?${q}`).expect(200);
    const csvLines = csv.text.split('\r\n');
    expect(csvLines[0]).toBe(
      'No. struk,Waktu,Kasir,SKU,Produk,Qty,Harga,Jumlah,Diskon,Modal,Laba kotor',
    );
    expect(
      csvLines.some((l) =>
        l.endsWith(',Teh Botol,4,5000,20000,2000,12000,6000'),
      ),
    ).toBe(true);
    expect(csvLines).toContain('Diskon,,,,,,,2000,,,');

    const voided = await keyed(s.auth, `/sales/${res.body.id}/void`, {
      reasonCode: 'wrong_item_or_qty',
      approverId: s.userId,
      pin: OWNER_PIN,
    }).expect(201);
    expect(voided.body).toMatchObject({
      status: 'void',
      subtotal: 50_000,
      discount: 2000,
      voucherDiscount: 3000,
      tax: 4950,
      total: 49_950,
      rounding: 50,
      cashReturned: 50_000,
    });
    expect(await onHand(s, s.teh)).toBe(100);
    expect(await onHand(s, s.indomie)).toBe(100);
    expect(await onHand(s, s.kopi)).toBe(100);
    const after = await get(s.auth, `/reports/sales?${q}`).expect(200);
    expect(after.body.totals).toMatchObject({
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
    const productsAfter = await get(s.auth, `/reports/products?${q}`).expect(
      200,
    );
    expect(productsAfter.body.rows).toEqual([]);
    // The reprinted receipt still lists the discount, marked void.
    const receipt = await get(s.auth, `/sales/${res.body.id}/receipt`).expect(
      200,
    );
    expect(receipt.body).toMatchObject({ status: 'void', lineDiscount: 2000 });
  });
});
