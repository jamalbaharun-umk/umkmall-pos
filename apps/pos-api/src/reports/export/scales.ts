import { z } from 'zod';

// "Penjualan dan pengeluaran" (design feature 37): a window of days, months or years, ending at the bucket that
// holds `to`. Calendar arithmetic on `YYYY-MM-DD` strings in UTC, so the store's timezone only decides what
// "today" is, never the maths.

export const SCALES = ['day', 'month', 'year'] as const;
export type Scale = (typeof SCALES)[number];

/** How many buckets one report may span (design: 92 days, 36 months, 10 years). */
export const MAX_BUCKETS: Record<Scale, number> = {
  day: 92,
  month: 36,
  year: 10,
};
/** What the screen shows first: a week, six months, three years. */
export const DEFAULT_BUCKETS: Record<Scale, number> = {
  day: 7,
  month: 6,
  year: 3,
};

const DAYS = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
export const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'Mei',
  'Jun',
  'Jul',
  'Agu',
  'Sep',
  'Okt',
  'Nov',
  'Des',
];

const ymd = (t: number) => new Date(t).toISOString().slice(0, 10);
const parse = (d: string) => Date.parse(`${d}T00:00:00Z`);

export function addDays(d: string, n: number): string {
  return ymd(parse(d) + n * 86_400_000);
}

/** The first day of the bucket that holds `d`. */
export function bucketStart(scale: Scale, d: string): string {
  return scale === 'day'
    ? d
    : scale === 'month'
      ? `${d.slice(0, 7)}-01`
      : `${d.slice(0, 4)}-01-01`;
}

export function nextBucket(scale: Scale, start: string): string {
  if (scale === 'day') return addDays(start, 1);
  const y = Number(start.slice(0, 4));
  const m = Number(start.slice(5, 7));
  if (scale === 'year') return `${y + 1}-01-01`;
  return m === 12
    ? `${y + 1}-01-01`
    : `${y}-${String(m + 1).padStart(2, '0')}-01`;
}

export function prevBucket(scale: Scale, start: string): string {
  if (scale === 'day') return addDays(start, -1);
  const y = Number(start.slice(0, 4));
  const m = Number(start.slice(5, 7));
  if (scale === 'year') return `${y - 1}-01-01`;
  return m === 1
    ? `${y - 1}-12-01`
    : `${y}-${String(m - 1).padStart(2, '0')}-01`;
}

/** The `count` bucket starts ending at the bucket that holds `to`, oldest first. */
export function bucketStarts(
  scale: Scale,
  to: string,
  count: number,
): string[] {
  const out: string[] = [];
  let s = bucketStart(scale, to);
  for (let i = 0; i < count; i++) {
    out.unshift(s);
    s = prevBucket(scale, s);
  }
  return out;
}

/** The last day of the bucket that starts at `start`. */
export function bucketEnd(scale: Scale, start: string): string {
  return addDays(nextBucket(scale, start), -1);
}

/** "Rab" for a short day window, "20 Nov" for a long one, "Nov" and "2026" for months and years. */
export function bucketLabel(
  scale: Scale,
  start: string,
  count: number,
): string {
  const y = start.slice(0, 4);
  const m = Number(start.slice(5, 7));
  if (scale === 'year') return y;
  if (scale === 'month')
    return count > 12 ? `${MONTHS[m - 1]} ${y.slice(2)}` : MONTHS[m - 1];
  const day = Number(start.slice(8, 10));
  return count <= 7
    ? DAYS[new Date(parse(start)).getUTCDay()]
    : `${day} ${MONTHS[m - 1]}`;
}

/** "20 sampai 26 Nov 2026", "Jun sampai Nov 2026", "2024 sampai 2026": the period as a person reads it. */
export function periodLabel(scale: Scale, from: string, to: string): string {
  const [fy, fm, fd] = [
    from.slice(0, 4),
    Number(from.slice(5, 7)),
    Number(from.slice(8, 10)),
  ];
  const [ty, tm, td] = [
    to.slice(0, 4),
    Number(to.slice(5, 7)),
    Number(to.slice(8, 10)),
  ];
  if (scale === 'year') return fy === ty ? fy : `${fy} sampai ${ty}`;
  if (scale === 'month') {
    if (from.slice(0, 7) === to.slice(0, 7)) return `${MONTHS[fm - 1]} ${fy}`;
    return fy === ty
      ? `${MONTHS[fm - 1]} sampai ${MONTHS[tm - 1]} ${ty}`
      : `${MONTHS[fm - 1]} ${fy} sampai ${MONTHS[tm - 1]} ${ty}`;
  }
  if (from === to) return `${fd} ${MONTHS[fm - 1]} ${fy}`;
  if (fy === ty && fm === tm)
    return `${fd} sampai ${td} ${MONTHS[tm - 1]} ${ty}`;
  if (fy === ty)
    return `${fd} ${MONTHS[fm - 1]} sampai ${td} ${MONTHS[tm - 1]} ${ty}`;
  return `${fd} ${MONTHS[fm - 1]} ${fy} sampai ${td} ${MONTHS[tm - 1]} ${ty}`;
}

export const SCALE_NAMES: Record<
  Scale,
  { adj: string; unit: string; per: string }
> = {
  day: { adj: 'Harian', unit: 'hari', per: 'per hari' },
  month: { adj: 'Bulanan', unit: 'bulan', per: 'per bulan' },
  year: { adj: 'Tahunan', unit: 'tahun', per: 'per tahun' },
};

/** Integer percent change from `previous` to `current`; null when there is nothing to compare with. */
export function percentChange(
  current: number,
  previous: number,
): number | null {
  return previous === 0
    ? null
    : Math.round(((current - previous) / Math.abs(previous)) * 100);
}

const asText = (v: unknown) =>
  v === undefined ? '' : typeof v === 'string' ? v : '\u0000';
const isDate = (d: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(d) &&
  !Number.isNaN(parse(d)) &&
  ymd(parse(d)) === d;

/** `scale`, `to` (any day in the last bucket; default today) and `count` (default per scale). */
export const TrendQuery = z.object({
  scale: z.preprocess(
    (v) => (v === undefined ? 'day' : asText(v)),
    z
      .string()
      .refine(
        (v): v is Scale => (SCALES as readonly string[]).includes(v),
        'Skala harus harian, bulanan atau tahunan',
      ),
  ),
  to: z.preprocess(
    (v) => (v === undefined || v === '' ? undefined : asText(v)),
    z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Tanggal harus berformat TTTT-BB-HH')
      .refine(isDate, 'Tanggal tidak ada di kalender')
      .optional(),
  ),
  count: z.preprocess(
    (v) =>
      v === undefined || v === ''
        ? undefined
        : Number(typeof v === 'string' ? v : NaN),
    z
      .number()
      .int('Jumlah harus bilangan bulat')
      .min(1, 'Jumlah paling sedikit 1')
      .optional(),
  ),
});
export type TrendQuery = z.infer<typeof TrendQuery>;
