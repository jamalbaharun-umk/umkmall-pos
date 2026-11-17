/**
 * The month arithmetic `MonthCalendar` draws from (UMK-1358): which weekday a month starts on, how many days it has, the
 * Monday-first grid, the Indonesian names. Pure, so it runs under vitest like `profile-header-support`.
 *
 * ZONE-FREE ON PURPOSE. The grid is built from `Date.UTC` arithmetic, never from a local getter, so it cannot depend on the
 * device zone: a phone in another zone must draw the same month. The static scan at the bottom is what pins that, because a
 * test that sets `TZ` inside a file does not reach Node's clock (apps/mobile/jest.config.js:3).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { countLabel, dayLabel, daysInMonth, isMonth, monthGrid, monthOf, monthTitle, shiftMonth, WEEKDAYS } from '../month-calendar-support';

describe('month names and the weekday row', () => {
  it('starts the week on Monday, in Indonesian', () => {
    expect([...WEEKDAYS]).toEqual(['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min']);
  });

  it('titles a month in Indonesian, and says nothing for a string that is not a month', () => {
    expect(monthTitle('2026-01')).toBe('Januari 2026');
    expect(monthTitle('2026-08')).toBe('Agustus 2026');
    expect(monthTitle('2026-12')).toBe('Desember 2026');
    for (const bad of ['', '2026-13', '2026-00', '2026-1', '2026-01-05', 'January 2026']) expect(monthTitle(bad), bad).toBe('');
  });

  it('knows a month from a day', () => {
    expect(isMonth('2026-02')).toBe(true);
    expect(isMonth('2026-02-01')).toBe(false);
    expect(monthOf('2026-02-17')).toBe('2026-02');
  });
});

describe('shiftMonth', () => {
  it('crosses a year both ways', () => {
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-05', 1)).toBe('2026-06');
    expect(shiftMonth('2026-05', -1)).toBe('2026-04');
  });

  it('leaves a string that is not a month alone', () => {
    expect(shiftMonth('nope', 1)).toBe('nope');
  });
});

describe('daysInMonth', () => {
  it('counts every month, and February in a leap year', () => {
    expect(daysInMonth('2026-01')).toBe(31);
    expect(daysInMonth('2026-04')).toBe(30);
    expect(daysInMonth('2026-02')).toBe(28);
    expect(daysInMonth('2024-02')).toBe(29);
    expect(daysInMonth('2100-02')).toBe(28); // a century that is not a leap year
    expect(daysInMonth('2000-02')).toBe(29); // one that is
  });
});

describe('monthGrid', () => {
  const week = (cells: (string | null)[]) => cells;

  it('puts the 1st of January 2026 (a Thursday) in the fourth column, and pads the tail with empty cells', () => {
    const grid = monthGrid('2026-01');
    expect(grid[0]).toEqual(week([null, null, null, '2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04']));
    expect(grid).toHaveLength(5);
    expect(grid[4]).toEqual(week(['2026-01-26', '2026-01-27', '2026-01-28', '2026-01-29', '2026-01-30', '2026-01-31', null]));
  });

  it('puts a month that starts on a Sunday in the last column', () => {
    const grid = monthGrid('2026-02');
    expect(grid[0]).toEqual(week([null, null, null, null, null, null, '2026-02-01']));
    expect(grid.flat().filter(Boolean)).toHaveLength(28);
  });

  it('draws exactly four rows for a 28-day month that starts on a Monday, with no empty cell', () => {
    const grid = monthGrid('2021-02');
    expect(grid).toHaveLength(4);
    expect(grid.flat().every((cell) => cell !== null)).toBe(true);
  });

  it('draws six rows when a 31-day month starts late in the week', () => {
    expect(monthGrid('2026-08')).toHaveLength(6); // Saturday 1st, 31 days
  });

  it('holds every day once, in order, in every month of a leap year', () => {
    for (let m = 1; m <= 12; m += 1) {
      const month = `2024-${String(m).padStart(2, '0')}`;
      const days = monthGrid(month).flat().filter((cell): cell is string => cell !== null);
      expect(days, month).toHaveLength(daysInMonth(month));
      expect(days[0], month).toBe(`${month}-01`);
      expect(days[days.length - 1], month).toBe(`${month}-${String(daysInMonth(month)).padStart(2, '0')}`);
      expect([...days].sort(), month).toEqual(days);
    }
  });

  it('keeps every row seven cells wide', () => {
    for (const row of monthGrid('2026-03')) expect(row).toHaveLength(7);
  });

  it('is empty for a string that is not a month', () => {
    expect(monthGrid('nope')).toEqual([]);
  });
});

describe('what the numbers say', () => {
  it('caps a count that would not fit its chip', () => {
    expect(countLabel(1)).toBe('1');
    expect(countLabel(99)).toBe('99');
    expect(countLabel(100)).toBe('99+');
  });

  it('names a day for a screen reader, with its count when there is one', () => {
    expect(dayLabel('2026-01-19', 2)).toBe('19 Januari 2026, 2 jadwal');
    expect(dayLabel('2026-01-05', 0)).toBe('5 Januari 2026');
    expect(dayLabel('2026-01-05')).toBe('5 Januari 2026');
  });
});

/**
 * Every `new Date(...)` call in `code` that has more than one top-level argument. A Date built from
 * parts (`new Date(y, m, d)`) is built in the DEVICE zone; the sound spellings take one argument
 * (`new Date(ms)`, `new Date(Date.UTC(...))`). The old one-line regex stopped at the first `(` inside
 * the arguments, so `new Date(Number(a), Number(b) - 1, Number(c))` slipped past it (UMK-900): this
 * walks the balanced parentheses and counts only the commas at the top level, ignoring commas inside
 * (), [], {} and string / template literals.
 */
function datesBuiltFromParts(code: string): string[] {
  const hits: string[] = [];
  const open = /\bnew\s+Date\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = open.exec(code)) !== null) {
    const stack: string[] = []; // '(' '[' '{' for brackets, '`' inside template text, '${' inside a template hole
    let args = 0;
    let filled = false; // the current top-level argument has content
    let i = match.index + match[0].length;
    for (; i < code.length; i += 1) {
      const c = code[i];
      const top = stack[stack.length - 1];
      if (top === '`') {
        if (c === '\\') i += 1;
        else if (c === '`') stack.pop();
        else if (c === '$' && code[i + 1] === '{') {
          stack.push('${');
          i += 1;
        }
        continue;
      }
      if (/\s/.test(c)) continue;
      if (stack.length === 0 && c === ',') {
        if (filled) args += 1;
        filled = false;
        continue;
      }
      if (stack.length === 0 && c === ')') {
        if (filled) args += 1;
        break;
      }
      if (stack.length === 0) filled = true;
      if (c === "'" || c === '"') {
        for (i += 1; i < code.length && code[i] !== c; i += 1) if (code[i] === '\\') i += 1;
      } else if (c === '`') stack.push('`');
      else if (c === '(' || c === '[' || c === '{') stack.push(c);
      else if (c === ')' || c === ']' || c === '}') stack.pop();
    }
    if (args > 1) hits.push(code.slice(match.index, i + 1));
  }
  return hits;
}

describe('datesBuiltFromParts: the scan that finds a Date built in the device zone', () => {
  it.each([
    'new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))',
    'new Date(y, m)',
    'new Date(2026, 0, 1)',
    'new Date(y, m - 1, d, h, min)',
    'new Date(`${y}`, 0)',
    'new Date(parse(a, b), 0)',
    'new Date([a, b][0], 1)',
    'new Date("a,b", 1)',
    'new Date(\n  y,\n  m,\n)',
  ])('flags %s', (src) => {
    expect(datesBuiltFromParts(`const d = ${src};`)).toHaveLength(1);
  });

  it.each([
    'new Date(ms + WIB_OFFSET_MS)',
    'new Date(Date.UTC(year, month - 1, date))',
    'new Date()',
    'new Date(nowMs + HORIZON_MS)',
    'new Date("a,b")',
    'new Date(`${a},${b}`)',
    'new Date(pick([a, b], c))',
    'new Date(ms,)',
  ])('does not flag %s', (src) => {
    expect(datesBuiltFromParts(`const d = ${src};`)).toEqual([]);
  });

  it('finds the bad call among good ones', () => {
    const code = 'a(new Date(ms)); b(new Date(Date.UTC(y, m))); c(new Date(y, m, d));';
    expect(datesBuiltFromParts(code)).toEqual(['new Date(y, m, d)']);
  });
});

describe('the module reads no local-time API', () => {
  it('has no local getter, no Intl and no toLocale call', () => {
    const source = readFileSync(resolve(__dirname, '..', 'month-calendar-support.ts'), 'utf8');
    /* Comments first: this file's own prose names the getters it forbids. */
    const code = source.replace(/(^|[^:])\/\/.*$/gm, '$1').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(code).not.toMatch(/\.get(FullYear|Month|Date|Day|Hours|Minutes|TimezoneOffset)\s*\(/);
    expect(code).not.toMatch(/\bIntl\b|toLocale|\.set(FullYear|Month|Date|Hours|Minutes|Seconds|Milliseconds)\s*\(/);
    expect(code).not.toMatch(/\.get(Seconds|Milliseconds)\s*\(|\.to(Date|Time)String\s*\(/);
    expect(datesBuiltFromParts(code)).toEqual([]); // a Date built from parts is built in the DEVICE zone
    expect(code.length, 'read nothing').toBeGreaterThan(200);
  });
});
