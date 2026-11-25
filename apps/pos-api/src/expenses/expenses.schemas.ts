import { z } from 'zod';
import { LocalDate, Paging, Rupiah } from '../common/validation';
import { EXPENSE_CATEGORIES, EXPENSE_SOURCES } from '../db/schema';

const Category = z.enum(EXPENSE_CATEGORIES, {
  errorMap: () => ({ message: 'Pilih salah satu kategori' }),
});
const Amount = Rupiah.positive('Harus lebih dari 0');
const Note = z.string().trim().max(200);
/** Not before 2000: a typo like 0206-11-25 is refused instead of filed centuries back. */
const ExpenseDate = LocalDate.refine(
  (d) => d >= '2000-01-01',
  'Tanggal tidak valid',
);

export const ExpenseInput = z
  .object({
    amount: Amount,
    category: Category,
    source: z.enum(EXPENSE_SOURCES, {
      errorMap: () => ({
        message: 'Pilih sumber uang: laci kasir atau di luar laci',
      }),
    }),
    note: Note.optional(),
    // Default: today in the store's timezone.
    date: ExpenseDate.optional(),
  })
  .strict();
export type ExpenseInput = z.infer<typeof ExpenseInput>;

export const ExpenseUpdate = z
  .object({
    category: Category.optional(),
    // null or '' clears the note.
    note: Note.nullable().optional(),
    amount: Amount.optional(),
    date: ExpenseDate.optional(),
  })
  .strict()
  .refine((u) => Object.keys(u).length > 0, {
    message: 'Tidak ada yang diubah',
    path: ['_'],
  });
export type ExpenseUpdate = z.infer<typeof ExpenseUpdate>;

export const VoidInput = z.object({ reason: Note.optional() }).strict();

export const EXPENSE_PERIODS = ['today', 'week', 'month'] as const;
export type ExpensePeriod = (typeof EXPENSE_PERIODS)[number];

const DAY = 86_400_000;
const MAX_SPAN_DAYS = 366;

/** `period` (default today), or `from` and `to` together; never both. */
const periodShape = {
  period: z
    .enum(EXPENSE_PERIODS, {
      errorMap: () => ({
        message: 'Periode harus hari ini, minggu ini atau bulan ini',
      }),
    })
    .optional(),
  from: ExpenseDate.optional(),
  to: ExpenseDate.optional(),
};
type PeriodShape = {
  period?: ExpensePeriod;
  from?: string;
  to?: string;
};
const checkPeriod = (q: PeriodShape, ctx: z.RefinementCtx) => {
  const issue = (path: string, message: string) =>
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
  if (q.period && (q.from || q.to))
    return issue(
      'period',
      'Pilih periode atau rentang tanggal, bukan keduanya',
    );
  if (q.from && !q.to) return issue('to', 'Tanggal akhir wajib diisi');
  if (q.to && !q.from) return issue('from', 'Tanggal mulai wajib diisi');
  if (q.from && q.to) {
    if (q.from > q.to)
      return issue('to', 'Tanggal akhir tidak boleh sebelum tanggal mulai');
    if ((Date.parse(q.to) - Date.parse(q.from)) / DAY >= MAX_SPAN_DAYS)
      return issue('to', `Rentang tanggal paling lama ${MAX_SPAN_DAYS} hari`);
  }
};

export const PeriodQuery = z.object(periodShape).superRefine(checkPeriod);
export type PeriodQuery = z.infer<typeof PeriodQuery>;

export const ExpenseListQuery = z
  .object({
    ...periodShape,
    status: z.enum(['active', 'voided', 'all']).default('active'),
    ...Paging,
  })
  .superRefine(checkPeriod);
export type ExpenseListQuery = z.infer<typeof ExpenseListQuery>;
