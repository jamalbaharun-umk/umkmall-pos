import { z } from 'zod';
import { Uuid } from '../catalog/catalog.schemas';

const rupiah = z.number().int().nonnegative().max(1_000_000_000_000);

export const IdempotencyKey = z
  .string()
  .regex(/^[A-Za-z0-9_-]{8,100}$/, 'Idempotency-Key tidak valid');

export const SaleInput = z
  .object({
    lines: z
      .array(
        z
          .object({
            productId: Uuid,
            qty: z
              .number()
              .int('Jumlah harus bilangan bulat')
              .positive('Jumlah harus lebih dari 0')
              .max(100_000, 'Jumlah maksimal 100.000'),
            // Honoured only with sales.price_override; otherwise the catalog price is used.
            price: rupiah.optional(),
          })
          .strict(),
      )
      .min(1)
      .max(200)
      .refine(
        (ls) => new Set(ls.map((l) => l.productId)).size === ls.length,
        'Satu produk cukup satu baris',
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

export const SalesQuery = z.object({
  shiftId: Uuid.optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(20),
});

export const SettingsInput = z
  .object({ taxBps: z.number().int().min(0).max(10_000) })
  .strict();

export type SaleInput = z.infer<typeof SaleInput>;
export type SalesQuery = z.infer<typeof SalesQuery>;
