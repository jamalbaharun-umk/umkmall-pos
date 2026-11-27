// The number and date words of a report, the same as the screen's (guideline "Panduan Dasar UI POS", section 1):
// integer rupiah `Rp1.234.000`, a negative `−Rp2.500` (a real minus sign), dates `24 Nov 2026`.
const MINUS = '−';
const group = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');

export const int = (n: number): string =>
  `${n < 0 ? MINUS : ''}${group(Math.abs(Math.round(n)))}`;
export const rp = (n: number): string =>
  `${n < 0 ? MINUS : ''}Rp${group(Math.abs(Math.round(n)))}`;

/** A drawer difference as the shift close screen words it: "Pas", "Kurang Rp500", "Lebih Rp500". */
export const cashDiff = (d: number): string =>
  d === 0 ? 'Pas' : `${d < 0 ? 'Kurang' : 'Lebih'} Rp${group(Math.abs(d))}`;

const MONTHS = [
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

/** `2026-11-26` → `26 Nov 2026`. */
export const dateLabel = (d: string): string =>
  `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;

/** `2026-11-26 14:05` → `26 Nov 2026, 14.05` (a store-local time). */
export const dateTimeLabel = (d: string): string =>
  `${dateLabel(d)}, ${d.slice(11, 13)}.${d.slice(14, 16)}`;
