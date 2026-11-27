import { z } from 'zod';
import { Uuid } from '../catalog/catalog.schemas';
import { VoidPin } from '../void/void.schemas';

const rupiah = z.number().int().nonnegative().max(1_000_000_000_000);

export const IdempotencyKey = z
  .string()
  .regex(/^[A-Za-z0-9_-]{8,100}$/, 'Idempotency-Key tidak valid');

// UMK-1985: a product may be on several lines, one per unit (12 pcs + 1 dus). The same product and unit
// twice is refused: the client adds the quantities.
const unitKey = (l: { productId: string; unit?: string }) =>
  `${l.productId}:${(l.unit ?? '').toLowerCase()}`;

const lineFields = {
  productId: Uuid,
  // In the line's unit: 2 with unit "dus" is two cartons.
  qty: z
    .number()
    .int('Jumlah harus bilangan bulat')
    .positive('Jumlah harus lebih dari 0')
    .max(100_000, 'Jumlah maksimal 100.000'),
  // Name of one of the product's units (any case); omitted = the base unit.
  unit: z
    .string()
    .trim()
    .min(1, 'Satuan tidak valid')
    .max(20, 'Satuan tidak valid')
    .optional(),
};

// UMK-1990: a line discount, as a whole percent (1-99) or in rupiah, never both; only with sales.price_override
// (403 otherwise). Above 30% of the line it names a PIN approval (`POST /sales/discount-approvals`).
const discountFields = {
  discountPercent: z
    .number()
    .int('Diskon persen harus bilangan bulat')
    .min(1, 'Diskon minimal 1%')
    .max(99, 'Diskon 100% tidak diperbolehkan')
    .optional(),
  discountAmount: rupiah.positive('Diskon harus lebih dari 0').optional(),
};
const noDoubleDiscount = (l: {
  discountPercent?: number;
  discountAmount?: number;
}) => l.discountPercent === undefined || l.discountAmount === undefined;
const DOUBLE_DISCOUNT = {
  message: 'Pilih diskon persen atau rupiah, tidak keduanya',
  path: ['discountAmount'],
};

const linesOf = <T extends z.ZodType<{ productId: string; unit?: string }>>(
  line: T,
) =>
  z
    .array(line)
    .min(1)
    .max(200)
    .refine(
      (ls) => new Set(ls.map(unitKey)).size === ls.length,
      'Satu produk dan satuan cukup satu baris',
    );

export const SaleInput = z
  .object({
    lines: linesOf(
      z
        .object({
          ...lineFields,
          // Honoured only with sales.price_override; otherwise the server's unit or wholesale price is used.
          price: rupiah.optional(),
          ...discountFields,
          discountApprovalId: Uuid.optional(),
        })
        .strict()
        .refine(noDoubleDiscount, DOUBLE_DISCOUNT),
    ),
    // The order discount (before UMK-1990; the cashier screen now gives line discounts). Honoured only with
    // sales.price_override; it comes off after the line discounts, before the voucher. Above 30% of what it comes
    // off (ruling 2026-11-26) it names an `order` PIN approval in `discountApprovalId`.
    discount: rupiah.optional(),
    discountApprovalId: Uuid.optional(),
    // U7: member (required for a credit method), voucher code, payment method (default Tunai).
    memberId: Uuid.optional(),
    voucherCode: z.string().trim().min(1).max(40).optional(),
    paymentMethodId: Uuid.optional(),
    // UMK-2037: the bank the customer chose, for an online method that needs one (a virtual account): one of
    // the codes of `GET /online-payments/methods`. Required for such a method, refused for any other.
    bank: z
      .string({ invalid_type_error: 'Bank tidak valid' })
      .regex(/^[A-Za-z0-9_-]{1,30}$/, 'Bank tidak valid')
      .optional(),
    paid: rupiah,
    note: z.string().trim().max(200).optional(),
  })
  .strict();

/**
 * What UMKMall's agent may send for a sale (UMK-1981, owner ruling 24 Nov 2026: the agent never sets a price): the
 * cart, a member, a voucher, one payment method and the amount paid. No line price, no manual discount, no bank.
 */
export const AgentSaleInput = z
  .object({
    lines: linesOf(z.object(lineFields).strict()),
    memberId: Uuid.optional(),
    voucherCode: z.string().trim().min(1).max(40).optional(),
    paymentMethodId: Uuid.optional(),
    paid: rupiah,
    note: z.string().trim().max(200).optional(),
  })
  .strict();

/**
 * `POST /sales/quote`: the cart's lines and, when a voucher or a payment method is given (UMK-1981), the whole
 * amount the sale would ask: voucher discount, tax, total, cash rounding, amount due. Nothing is written.
 */
export const QuoteInput = z
  .object({
    // UMK-1990: with line discounts (sales.price_override), so the cart shows the server's discounted lines; a
    // manual price and the order discount as the sale takes them, to answer whether each needs a PIN approval.
    lines: linesOf(
      z
        .object({ ...lineFields, price: rupiah.optional(), ...discountFields })
        .strict()
        .refine(noDoubleDiscount, DOUBLE_DISCOUNT),
    ),
    discount: rupiah.optional(),
    voucherCode: z.string().trim().min(1).max(40).optional(),
    paymentMethodId: Uuid.optional(),
  })
  .strict();

/** UMK-1981: the agent's quote, which never carries a discount (the agent never sets a price). */
export const AgentQuoteInput = z
  .object({
    lines: linesOf(z.object(lineFields).strict()),
    voucherCode: z.string().trim().min(1).max(40).optional(),
    paymentMethodId: Uuid.optional(),
  })
  .strict();

/**
 * UMK-1990: a PIN approval of a reduction above 30%: whose PIN (`approverId`, the owner or staff holding
 * sales.price_override), what it covers (`scope`: `line`, the default, a line of `productId`, by discount or manual
 * price; `order`, the order discount, no product, ruling 2026-11-26), and the largest share approved, in basis
 * points (3001-9999).
 */
export const DiscountApprovalInput = z
  .object({
    approverId: Uuid,
    pin: VoidPin,
    scope: z.enum(['line', 'order']).default('line'),
    productId: Uuid.optional(),
    maxBps: z
      .number()
      .int('Harus bilangan bulat')
      .min(3001, 'Diskon sampai 30% tidak perlu persetujuan')
      .max(9999, 'Diskon 100% tidak diperbolehkan'),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.scope === 'line' && v.productId === undefined)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['productId'],
        message: 'Wajib diisi',
      });
    if (v.scope === 'order' && v.productId !== undefined)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['productId'],
        message: 'Diskon transaksi tidak memakai produk',
      });
  });

export const SalesQuery = z.object({
  shiftId: Uuid.optional(),
  // UMK-1991: sales that are not receipts are listed only when asked for.
  status: z.enum(['awaiting_payment', 'cancelled']).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(20),
});

/**
 * `GET /sales/paid-since` (UMK-2046): the time the till last looked, with its offset; `afterId` with it when
 * the answer before said `hasMore`. A time the database cannot hold, or one that is no time of a POS sale
 * (before 2020, more than a day ahead, an offset past 14 hours), is a 422, never a query that fails.
 */
const PAID_SINCE_EARLIEST = Date.parse('2020-01-01T00:00:00Z');
// No place on earth is further from UTC than +14:00. zod and JavaScript take any offset up to +23:59, and
// Postgres, which is given the text as it came (the cursor is to the microsecond), refuses one past 15:59.
const MAX_OFFSET_MINUTES = 14 * 60;
const offsetMinutes = (v: string) => {
  const m = /[+-](\d{2}):?(\d{2})$/.exec(v);
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
};
export const PaidSinceQuery = z.object({
  since: z
    .string({ required_error: 'Wajib diisi' })
    .datetime({ offset: true, message: 'Waktu tidak valid' })
    .refine((v) => {
      const t = Date.parse(v);
      return (
        t >= PAID_SINCE_EARLIEST &&
        t <= Date.now() + 86_400_000 &&
        offsetMinutes(v) <= MAX_OFFSET_MINUTES
      );
    }, 'Waktu tidak valid'),
  afterId: Uuid.optional(),
});

export const SettingsInput = z
  .object({ taxBps: z.number().int().min(0).max(10_000) })
  .strict();

export type SaleInput = z.infer<typeof SaleInput>;
export type QuoteInput = z.infer<typeof QuoteInput>;
export type AgentQuoteInput = z.infer<typeof AgentQuoteInput>;
export type DiscountApprovalInput = z.infer<typeof DiscountApprovalInput>;
export type SalesQuery = z.infer<typeof SalesQuery>;
export type PaidSinceQuery = z.infer<typeof PaidSinceQuery>;
