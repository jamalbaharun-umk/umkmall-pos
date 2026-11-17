/**
 * The date VALUE rule `DateTimeInput` uses on both platforms (UMK-1128).
 *
 * Extracted for the reason `select.ts` next door gives: the web component that owned these
 * imports Radix and the class tables, so `@umkmall/ui/native` cannot reach them, and a second
 * native copy of a wire format would agree with the first only until someone edited one. This
 * module imports NOTHING.
 *
 * THE WIRE FORMAT IS `YYYY-MM-DD`, and it is the same bytes an HTML `<input type="date">` emits:
 * the spec's "valid date string", zero-padded, whatever the browser's locale DISPLAYS. The two
 * screens that ask for a date (the Teman AI template form and onboarding's template step) render
 * exactly that input on the web and send its `value` straight into a server-side template, so a
 * native field that sent `22/09/2026`, an ISO timestamp or an unpadded month would put different
 * text into the same prompt. The empty value is `''`, as the web input's is.
 */

/** ISO date only — the typed format the field accepts and emits. */
const ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A LOCAL calendar date, formatted as the wire string.
 *
 * Local getters, never `toISOString()`: that converts to UTC first, so a date picked at 06:00 in
 * Jakarta (UTC+7) would serialise as the PREVIOUS day.
 */
export const formatIsoDate = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

/**
 * `undefined` for anything that is not a real calendar date, so a typed 2026-02-31 is rejected
 * rather than rolled forward. The result is LOCAL midnight of that day.
 */
export const parseIsoDate = (text: string): Date | undefined => {
  if (!ISO.test(text)) return undefined;
  const parsed = new Date(`${text}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return formatIsoDate(parsed) === text ? parsed : undefined;
};

/** Is this date inside the optional `min`/`max` pair? An unparseable bound constrains nothing. */
export const isDateInRange = (date: Date, min?: string, max?: string): boolean => {
  const lower = min ? parseIsoDate(min) : undefined;
  const upper = max ? parseIsoDate(max) : undefined;
  return !(lower && date < lower) && !(upper && date > upper);
};

/**
 * What a person READS in the field on native: `DD/MM/YYYY`, the day-first numeric date an
 * Indonesian-locale browser shows inside the same `<input type="date">`. Display only — the
 * value that leaves the field is always `formatIsoDate`'s.
 *
 * Hand-built rather than `Intl.DateTimeFormat('id-ID')`: Hermes ships a reduced `Intl` on
 * Android, and a display that depends on the engine's locale data is one that renders
 * differently on the two platforms.
 */
export const formatDisplayDate = (date: Date): string =>
  `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`;

/** ISO date and time of day, LOCAL, no zone — what `DateTimeInput` emits with `withTime`. */
const ISO_DATE_TIME = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/;

/**
 * A local date and time as `YYYY-MM-DDTHH:mm` (UMK-1185) — the bytes an HTML
 * `<input type="datetime-local">` sends. Local getters for the reason `formatIsoDate` gives; a
 * caller that sends this to a server as UTC converts it itself.
 */
export const formatIsoDateTime = (date: Date): string =>
  `${formatIsoDate(date)}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;

/** A time of day, `HH:mm` — the bytes an HTML `<input type="time">` sends (`timeOnly`, UMK-1383 on the web, UMK-1358 on native). */
const ISO_TIME = /^(\d{2}):(\d{2})$/;

/**
 * A LOCAL time of day as `HH:mm`, from the local getters for the reason `formatIsoDate` gives: `toISOString()` would
 * turn 00:30 in Jakarta into `17:30`. No zone is carried; a caller that needs one (a post time in WIB) adds it.
 */
export const formatIsoTime = (date: Date): string => `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;

/**
 * `undefined` for anything but a real hour (00 to 23) and minute (00 to 59). The result is the 1st of January 2000 at that local
 * time, so a picker has a `Date` to open on; only its hour and minute mean anything. Not TODAY: on a phone in a zone with daylight
 * saving, a time inside today's spring-forward gap (02:30) would shift an hour and the box would show a time nobody picked.
 */
export const parseIsoTime = (text: string): Date | undefined => {
  const match = ISO_TIME.exec(text);
  if (!match) return undefined;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return undefined;
  return new Date(2000, 0, 1, hours, minutes, 0, 0);
};

/** `undefined` for anything but a real local date with an in-range hour and minute. */
export const parseIsoDateTime = (text: string): Date | undefined => {
  const match = ISO_DATE_TIME.exec(text);
  if (!match) return undefined;
  const day = parseIsoDate(match[1]);
  const hours = Number(match[2]);
  const minutes = Number(match[3]);
  if (!day || hours > 23 || minutes > 59) return undefined;
  day.setHours(hours, minutes);
  return day;
};
