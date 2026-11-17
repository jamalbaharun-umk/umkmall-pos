import { z } from 'zod';

const DAY = 86_400_000;
export const MAX_SPAN_DAYS = 366;

const isDate = (d: string) => {
  const t = Date.parse(`${d}T00:00:00Z`);
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(d) &&
    !Number.isNaN(t) &&
    new Date(t).toISOString().startsWith(d)
  );
};

/**
 * The shared error map (common/validation) answers a missing or non-text value generically; a check's own message
 * wins. So a missing value becomes '' (→ "… wajib diisi") and a non-text one (a repeated query param, a number) a
 * string no check accepts (→ the field's format message).
 */
const asText = (v: unknown) =>
  v === undefined ? '' : typeof v === 'string' ? v : '\u0000';

/** A real calendar date `YYYY-MM-DD` (2026-02-30 is refused, not rolled over); `label` names it in messages. */
const localDate = (label: string) =>
  z.preprocess(
    asText,
    z
      .string()
      .min(1, `${label} wajib diisi`)
      .regex(/^\d{4}-\d{2}-\d{2}$/, `${label} harus berformat TTTT-BB-HH`)
      .refine(isDate, `${label} tidak ada di kalender`),
  );

export const DateRange = z
  .object({ from: localDate('Tanggal mulai'), to: localDate('Tanggal akhir') })
  // Range checks judge two valid dates only; a bad date already has its own message.
  .refine((r) => !isDate(r.from) || !isDate(r.to) || r.from <= r.to, {
    message: 'Tanggal akhir tidak boleh sebelum tanggal mulai',
    path: ['to'],
  })
  .refine(
    (r) =>
      !isDate(r.from) ||
      !isDate(r.to) ||
      (Date.parse(r.to) - Date.parse(r.from)) / DAY < MAX_SPAN_DAYS,
    {
      message: `Rentang tanggal paling lama ${MAX_SPAN_DAYS} hari`,
      path: ['to'],
    },
  );

export const PERIODS = ['today', 'week', 'month', 'year'] as const;
export const DashboardQuery = z.object({
  period: z.preprocess(
    (v) => (v === undefined ? 'today' : asText(v)),
    z
      .string()
      .refine(
        (v): v is Period => (PERIODS as readonly string[]).includes(v),
        'Periode harus hari ini, minggu ini, bulan ini atau tahun ini',
      ),
  ),
});

export const TIMEZONE_UNKNOWN = 'Zona waktu tidak dikenal';

// Shape only; the name must also exist in Postgres's pg_timezone_names (checked by the service).
export const SettingsInput = z
  .object({
    timezone: z.preprocess(
      asText,
      z
        .string()
        .min(1, 'Zona waktu wajib diisi')
        .max(64, TIMEZONE_UNKNOWN)
        .regex(/^[A-Za-z][A-Za-z0-9_+\-/]*$/, TIMEZONE_UNKNOWN),
    ),
  })
  .strict();

export type DateRange = z.infer<typeof DateRange>;
export type Period = (typeof PERIODS)[number];
