import { addDays, monthBefore, resolvePeriod } from './expenses.service';

describe('expense periods (store days, no clock)', () => {
  it('today: the day itself, compared with the day before', () => {
    expect(resolvePeriod({}, '2026-11-25')).toEqual({
      period: 'today',
      from: '2026-11-25',
      to: '2026-11-25',
      previous: { from: '2026-11-24', to: '2026-11-24' },
      step: '1 day',
    });
  });

  it('week: Monday to today, compared with the same days one week earlier', () => {
    // 2026-11-25 is a Wednesday.
    expect(resolvePeriod({ period: 'week' }, '2026-11-25')).toMatchObject({
      from: '2026-11-23',
      to: '2026-11-25',
      previous: { from: '2026-11-16', to: '2026-11-18' },
      step: '7 days',
    });
    // A Sunday belongs to the week that began six days before; a Monday starts its own.
    expect(resolvePeriod({ period: 'week' }, '2026-11-29').from).toBe(
      '2026-11-23',
    );
    expect(resolvePeriod({ period: 'week' }, '2026-11-23').from).toBe(
      '2026-11-23',
    );
  });

  it('month: the 1st to today, compared with last month up to the same date', () => {
    expect(resolvePeriod({ period: 'month' }, '2026-11-25')).toMatchObject({
      from: '2026-11-01',
      to: '2026-11-25',
      previous: { from: '2026-10-01', to: '2026-10-25' },
      step: '1 month',
    });
    // The 31st has no twin in a shorter month: the last day of that month; January looks back a year.
    expect(resolvePeriod({ period: 'month' }, '2026-03-31').previous).toEqual({
      from: '2026-02-01',
      to: '2026-02-28',
    });
    expect(resolvePeriod({ period: 'month' }, '2028-03-30').previous.to).toBe(
      '2028-02-29',
    );
    expect(resolvePeriod({ period: 'month' }, '2026-01-15').previous).toEqual({
      from: '2025-12-01',
      to: '2025-12-15',
    });
  });

  it('from/to: compared with the same number of days just before', () => {
    expect(
      resolvePeriod({ from: '2026-11-10', to: '2026-11-16' }, '2026-11-25'),
    ).toEqual({
      period: null,
      from: '2026-11-10',
      to: '2026-11-16',
      previous: { from: '2026-11-03', to: '2026-11-09' },
      step: null,
    });
  });

  it('day arithmetic crosses months and years', () => {
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(monthBefore('2026-05-31')).toBe('2026-04-30');
  });
});
