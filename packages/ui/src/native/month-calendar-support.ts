/**
 * The month arithmetic behind `MonthCalendar` (UMK-1358), with no React and no `react-native`, so a vitest file can
 * read it (the same split as `profile-header-support.ts`).
 *
 * EVERYTHING HERE IS `Date.UTC` ARITHMETIC. A month and a day are calendar labels, not instants: asking the device zone
 * which weekday the 1st falls on would let a phone in another zone draw a different grid. The year, month and day come
 * from the strings; the only `Date` is a UTC one, used to find a weekday and a month length. Pinned by the scan in
 * `__tests__/month-calendar-support.test.ts`.
 *
 * The names are hand-written for the reason `formatDisplayDate` gives: Hermes ships a reduced `Intl` on Android, and a
 * month name that depends on the engine's locale data reads differently on the two platforms.
 */

/** Monday first, as Indonesian calendars (and Figma's `Sen Sel Rab Kam Jum Sab Min`) draw the week. */
export const WEEKDAYS = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'] as const;

const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'] as const;

/** `YYYY-MM`, the month the grid shows. */
const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;
/** `YYYY-MM-DD`, the wire form of one day (the same string `DateTimeInput` speaks). */
const DAY = /^(\d{4})-(0[1-9]|1[0-2])-(\d{2})$/;

const pad = (n: number): string => String(n).padStart(2, '0');

export const isMonth = (text: string): boolean => MONTH.test(text);

/** The `YYYY-MM` a `YYYY-MM-DD` belongs to. */
export const monthOf = (day: string): string => day.slice(0, 7);

/** "Januari 2026", or `''` for a string that is not a month. */
export const monthTitle = (month: string): string => {
  const match = MONTH.exec(month);
  return match ? `${MONTHS[Number(match[2]) - 1]} ${Number(match[1])}` : '';
};

/** The month `by` months away (negative goes back), across a year; a string that is not a month comes back as it was. */
export const shiftMonth = (month: string, by: number): string => {
  const match = MONTH.exec(month);
  if (!match) return month;
  const index = Number(match[1]) * 12 + (Number(match[2]) - 1) + by;
  return `${String(Math.floor(index / 12)).padStart(4, '0')}-${pad((index % 12) + 1)}`;
};

/** 28 to 31; `0` for a string that is not a month. */
export const daysInMonth = (month: string): number => {
  const match = MONTH.exec(month);
  return match ? new Date(Date.UTC(Number(match[1]), Number(match[2]), 0)).getUTCDate() : 0;
};

/**
 * The weeks of a month, Monday first: rows of seven cells, each `YYYY-MM-DD` or `null` for a blank before the 1st or
 * after the last day. The last row is padded to seven, so every row has the same width and the grid never reflows.
 * `[]` for a string that is not a month.
 */
export const monthGrid = (month: string): (string | null)[][] => {
  const match = MONTH.exec(month);
  if (!match) return [];
  const year = Number(match[1]);
  const index = Number(match[2]) - 1;
  /* getUTCDay: 0 is Sunday. Monday-first column of the 1st: (day + 6) % 7. */
  const lead = (new Date(Date.UTC(year, index, 1)).getUTCDay() + 6) % 7;
  const cells: (string | null)[] = Array.from({ length: lead }, () => null);
  for (let day = 1; day <= daysInMonth(month); day += 1) cells.push(`${month}-${pad(day)}`);
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
};

/** What the count chip says. A chip is a few points wide: past two digits it says `99+`. */
export const countLabel = (count: number): string => (count > 99 ? '99+' : String(count));

/** A day as a screen reader hears it: "19 Januari 2026, 2 jadwal", without the count when there is none. */
export const dayLabel = (day: string, count?: number): string => {
  const match = DAY.exec(day);
  if (!match) return day;
  const name = `${Number(match[3])} ${MONTHS[Number(match[2]) - 1]} ${Number(match[1])}`;
  return count !== undefined && count > 0 ? `${name}, ${count} jadwal` : name;
};
