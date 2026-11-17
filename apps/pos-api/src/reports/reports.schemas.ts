import { z } from 'zod';

const DAY = 86_400_000;
export const MAX_SPAN_DAYS = 366;

/** A real calendar date `YYYY-MM-DD` (2026-02-30 is refused, not rolled over). */
const LocalDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((d) => {
    const t = Date.parse(`${d}T00:00:00Z`);
    return !Number.isNaN(t) && new Date(t).toISOString().startsWith(d);
  }, 'tanggal tidak valid');

export const DateRange = z
  .object({ from: LocalDate, to: LocalDate })
  .refine((r) => r.from <= r.to, { message: 'dari ≤ sampai', path: ['to'] })
  .refine(
    (r) => (Date.parse(r.to) - Date.parse(r.from)) / DAY < MAX_SPAN_DAYS,
    { message: `paling lama ${MAX_SPAN_DAYS} hari`, path: ['to'] },
  );

export const PERIODS = ['today', 'week', 'month', 'year'] as const;
export const DashboardQuery = z.object({
  period: z.enum(PERIODS).default('today'),
});

// Shape only; the name must also exist in Postgres's pg_timezone_names (checked by the service).
export const SettingsInput = z
  .object({
    timezone: z
      .string()
      .max(64)
      .regex(/^[A-Za-z][A-Za-z0-9_+\-/]*$/),
  })
  .strict();

export type DateRange = z.infer<typeof DateRange>;
export type Period = (typeof PERIODS)[number];
