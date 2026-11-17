/**
 * The date value rule both `DateTimeInput`s share (UMK-1128).
 *
 * The WIRE FORMAT is the thing under test: the native field now sends what the web's
 * `<input type="date">` sends, into the same server-side template, so these assertions are the
 * bytes rather than a round trip. A round trip (`parse(format(d))`) would pass for ANY pair of
 * functions that agreed with each other — including a pair that both emitted `22/09/2026`.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  formatDisplayDate,
  formatIsoDate,
  formatIsoDateTime,
  formatIsoTime,
  isDateInRange,
  parseIsoDate,
  parseIsoDateTime,
  parseIsoTime,
} from './date-input';

/*
 * PINNED EAST OF UTC (PR #1116 review). The rule under test is "the LOCAL calendar day, never
 * toISOString()", and on a UTC host (every GitHub runner) the two spellings agree for every date,
 * so this suite was inert in CI. Asia/Jakarta is UTC+7: a Date made at 00:30 local is the previous
 * day in UTC, so a toISOString() regression reds here on any machine. The pin is ASSERTED, so a
 * runtime that ignores TZ fails loudly instead of passing trivially, and restored afterwards so it
 * cannot leak into other suites sharing the process (mobile jest runs --runInBand).
 */
const PINNED_TZ = 'Asia/Jakarta';
const previousTZ = process.env.TZ;
beforeAll(() => {
  process.env.TZ = PINNED_TZ;
  expect(new Date(2026, 0, 1).getTimezoneOffset(), 'the TZ pin did not take effect').toBe(-420);
});
afterAll(() => {
  if (previousTZ === undefined) delete process.env.TZ;
  else process.env.TZ = previousTZ;
});

describe('the shared date value', () => {
  it('emits the HTML date input value: zero-padded YYYY-MM-DD', () => {
    expect(formatIsoDate(new Date(2026, 8, 22))).toBe('2026-09-22');
    expect(formatIsoDate(new Date(2026, 0, 5))).toBe('2026-01-05');
  });

  /* The UTC trap: `toISOString()` shifts a date picked early in the morning in UTC+7 back a
     day. A LOCAL date late in the evening and early in the morning must both stay put. */
  it('formats the LOCAL calendar day, whatever the time of day', () => {
    expect(formatIsoDate(new Date(2026, 8, 22, 0, 30))).toBe('2026-09-22');
    expect(formatIsoDate(new Date(2026, 8, 22, 23, 59))).toBe('2026-09-22');
  });

  it('parses only real calendar dates, at local midnight', () => {
    expect(parseIsoDate('2026-02-31')).toBeUndefined();
    expect(parseIsoDate('2026-9-22')).toBeUndefined();
    expect(parseIsoDate('22/09/2026')).toBeUndefined();
    expect(parseIsoDate('')).toBeUndefined();
    const parsed = parseIsoDate('2026-09-22')!;
    expect([parsed.getFullYear(), parsed.getMonth(), parsed.getDate(), parsed.getHours()]).toEqual([2026, 8, 22, 0]);
  });

  it('checks the inclusive min/max pair, and an unparseable bound constrains nothing', () => {
    const day = parseIsoDate('2026-09-22')!;
    expect(isDateInRange(day, '2026-09-22', '2026-09-22')).toBe(true);
    expect(isDateInRange(day, '2026-09-23')).toBe(false);
    expect(isDateInRange(day, undefined, '2026-09-21')).toBe(false);
    expect(isDateInRange(day, 'nonsense', 'nonsense')).toBe(true);
  });

  it('displays the day-first date an Indonesian browser shows', () => {
    expect(formatDisplayDate(new Date(2026, 8, 2))).toBe('02/09/2026');
  });
});

describe('the shared date-time value (UMK-1185)', () => {
  it('round-trips YYYY-MM-DDTHH:mm', () => {
    expect(formatIsoDateTime(parseIsoDateTime('2026-03-09T07:05')!)).toBe('2026-03-09T07:05');
  });

  it('refuses 24:00 and a minute past 59', () => {
    expect(parseIsoDateTime('2026-03-09T24:00')).toBeUndefined();
    expect(parseIsoDateTime('2026-03-09T12:60')).toBeUndefined();
  });

  it('refuses a date-only string where a time is required', () => {
    expect(parseIsoDateTime('2026-03-09')).toBeUndefined();
  });

  /* Under the Jakarta pin above: a toISOString() spelling would emit 16:30 on this day. */
  it('formats the LOCAL time of day, not UTC', () => {
    expect(formatIsoDateTime(new Date(2026, 2, 9, 23, 30))).toBe('2026-03-09T23:30');
  });

  it('parses to that LOCAL day and time, not a UTC reading of it', () => {
    const parsed = parseIsoDateTime('2026-03-09T23:30')!;
    expect([parsed.getDate(), parsed.getHours(), parsed.getMinutes()]).toEqual([9, 23, 30]);
  });
});

describe('the shared time-of-day value (UMK-1358, the web `timeOnly` of UMK-1383)', () => {
  /* Under the Jakarta pin above: a toISOString() spelling would emit 17:30 for 00:30 local. */
  it('formats the LOCAL time of day as HH:mm, zero-padded', () => {
    expect(formatIsoTime(new Date(2026, 2, 9, 0, 30))).toBe('00:30');
    expect(formatIsoTime(new Date(2026, 2, 9, 7, 5))).toBe('07:05');
    expect(formatIsoTime(new Date(2026, 2, 9, 23, 59))).toBe('23:59');
  });

  it('parses to that LOCAL hour and minute, on a real Date', () => {
    const parsed = parseIsoTime('23:30')!;
    expect([parsed.getHours(), parsed.getMinutes(), parsed.getSeconds()]).toEqual([23, 30, 0]);
  });

  it('parses on a fixed day, not on today, so a daylight-saving gap today cannot move the time', () => {
    const parsed = parseIsoTime('02:30')!;
    expect([parsed.getFullYear(), parsed.getMonth(), parsed.getDate()]).toEqual([2000, 0, 1]);
  });

  it('refuses 24:00, a minute past 59, a missing zero and anything that is not a bare time', () => {
    for (const bad of ['24:00', '12:60', '9:05', '09:5', '09:05:00', '2026-03-09T09:05', '', 'abc']) {
      expect(parseIsoTime(bad), bad).toBeUndefined();
    }
  });
});
