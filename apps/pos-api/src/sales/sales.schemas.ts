import { z } from 'zod';
import { Uuid } from '../catalog/catalog.schemas';

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
        })
        .strict(),
    ),
    // Honoured only with sales.price_override.
    discount: rupiah.optional(),
    // U7: member (required for a credit method), voucher code, payment method (default Tunai).
    memberId: Uuid.optional(),
    voucherCode: z.string().trim().min(1).max(40).optional(),
    paymentMethodId: Uuid.optional(),
    paid: rupiah,
    note: z.string().trim().max(200).optional(),
  })
  .strict();

/** `POST /sales/quote`: the cart's lines only; nothing is written. */
export const QuoteInput = z
  .object({ lines: linesOf(z.object(lineFields).strict()) })
  .strict();

export const SalesQuery = z.object({
  shiftId: Uuid.optional(),
  // UMK-1991: sales that are not receipts are listed only when asked for.
  status: z.enum(['awaiting_payment', 'cancelled']).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(20),
});

/** `GET /sales/paid-since` (UMK-2046): the time the till last looked, with its offset. */
export const PaidSinceQuery = z.object({
  since: z
    .string({ required_error: 'Wajib diisi' })
    .datetime({ offset: true, message: 'Waktu tidak valid' }),
});

export const SettingsInput = z
  .object({ taxBps: z.number().int().min(0).max(10_000) })
  .strict();

export type SaleInput = z.infer<typeof SaleInput>;
export type QuoteInput = z.infer<typeof QuoteInput>;
export type SalesQuery = z.infer<typeof SalesQuery>;
export type PaidSinceQuery = z.infer<typeof PaidSinceQuery>;
