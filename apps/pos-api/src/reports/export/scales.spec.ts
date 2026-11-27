import {
  bucketEnd,
  bucketLabel,
  bucketStarts,
  comparisonEnd,
  nextBucket,
  percentChange,
  periodLabel,
  prevBucket,
  TrendQuery,
} from './scales';

describe('report scales', () => {
  it('lists the last seven days, oldest first', () => {
    expect(bucketStarts('day', '2026-11-26', 7)).toEqual([
      '2026-11-20',
      '2026-11-21',
      '2026-11-22',
      '2026-11-23',
      '2026-11-24',
      '2026-11-25',
      '2026-11-26',
    ]);
  });
  it('walks months across a year end and years', () => {
    expect(bucketStarts('month', '2026-02-10', 4)).toEqual([
      '2025-11-01',
      '2025-12-01',
      '2026-01-01',
      '2026-02-01',
    ]);
    expect(nextBucket('month', '2026-12-01')).toBe('2027-01-01');
    expect(prevBucket('month', '2026-01-01')).toBe('2025-12-01');
    expect(bucketStarts('year', '2026-11-26', 3)).toEqual([
      '2024-01-01',
      '2025-01-01',
      '2026-01-01',
    ]);
    expect(bucketEnd('month', '2024-02-01')).toBe('2024-02-29');
    expect(bucketEnd('year', '2026-01-01')).toBe('2026-12-31');
  });
  it('labels a bucket the way the design does', () => {
    expect(bucketLabel('day', '2026-11-25', 7)).toBe('Rab');
    expect(bucketLabel('day', '2026-11-25', 30)).toBe('25 Nov');
    expect(bucketLabel('month', '2026-06-01', 6)).toBe('Jun');
    expect(bucketLabel('month', '2026-06-01', 24)).toBe('Jun 26');
    expect(bucketLabel('year', '2026-01-01', 3)).toBe('2026');
  });
  it('words the period', () => {
    expect(periodLabel('day', '2026-11-20', '2026-11-26')).toBe(
      '20 sampai 26 Nov 2026',
    );
    expect(periodLabel('day', '2026-10-30', '2026-11-05')).toBe(
      '30 Okt sampai 5 Nov 2026',
    );
    expect(periodLabel('day', '2025-12-30', '2026-01-05')).toBe(
      '30 Des 2025 sampai 5 Jan 2026',
    );
    expect(periodLabel('month', '2026-06-01', '2026-11-30')).toBe(
      'Jun sampai Nov 2026',
    );
    expect(periodLabel('year', '2024-01-01', '2026-11-26')).toBe(
      '2024 sampai 2026',
    );
  });
  it('rounds the change to a whole percent and says null without a base', () => {
    expect(percentChange(10_180_000, 9_426_000)).toBe(8);
    expect(percentChange(5, 0)).toBeNull();
    expect(percentChange(-50, 100)).toBe(-150);
  });
  it('validates the query', () => {
    expect(TrendQuery.parse({}).scale).toBe('day');
    expect(TrendQuery.safeParse({ scale: 'week' }).success).toBe(false);
    expect(TrendQuery.safeParse({ to: '2026-02-30' }).success).toBe(false);
    expect(TrendQuery.safeParse({ count: '0' }).success).toBe(false);
    expect(TrendQuery.parse({ count: '12' }).count).toBe(12);
  });
});

describe('comparisonEnd', () => {
  it('compares a finished window with the whole window before it', () => {
    // 20 to 26 Nov, finished: the one before is 13 to 19 Nov.
    expect(comparisonEnd(false, '2026-11-20', '2026-11-26', '2026-11-13')).toBe(
      '2026-11-19',
    );
  });
  it('compares a window still running with the same elapsed days of the one before', () => {
    // 3 days of a 7-day window have passed (20 to 22 Nov): the one before counts 13 to 15 Nov only.
    expect(comparisonEnd(true, '2026-11-20', '2026-11-22', '2026-11-13')).toBe(
      '2026-11-15',
    );
    // A running year: Jan 1 to Nov 26 against Jan 1 to Nov 26 of the year before.
    expect(comparisonEnd(true, '2026-01-01', '2026-11-26', '2025-01-01')).toBe(
      '2025-11-26',
    );
  });
});
