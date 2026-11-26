import { describe, expect, it } from 'vitest';
import {
  formatInt,
  formatIntShort,
  formatPercent,
  formatRupiah,
  formatRupiahShort,
  percentOf,
  resolveFormats,
  truncate,
} from './format';
import {
  areaPath,
  bands,
  heatLevel,
  labelStride,
  layoutSegments,
  linear,
  niceDomain,
  percents,
  sequentialSteps,
  toSlices,
} from './scale';

describe('rupiah and number formatting', () => {
  it('writes full rupiah with dots and no decimals', () => {
    expect(formatRupiah(1234000)).toBe('Rp1.234.000');
    expect(formatRupiah(0)).toBe('Rp0');
    expect(formatRupiah(999)).toBe('Rp999');
    expect(formatRupiah(1000)).toBe('Rp1.000');
    expect(formatRupiah(1_390_000)).toBe('Rp1.390.000');
  });
  it('writes a negative amount with a real minus sign', () => {
    expect(formatRupiah(-2500)).toBe('−Rp2.500');
    expect(formatInt(-5)).toBe('−5');
  });
  it('never prints a fraction, whatever it is given', () => {
    expect(formatRupiah(1234.6)).toBe('Rp1.235');
    expect(formatRupiah(Number.NaN)).toBe('Rp0');
  });
  it('writes the short form for axes', () => {
    expect(formatRupiahShort(1_350_000)).toBe('Rp1,35 jt');
    expect(formatRupiahShort(350_000)).toBe('Rp350 rb');
    expect(formatRupiahShort(900)).toBe('Rp900');
    expect(formatRupiahShort(2_100_000_000)).toBe('Rp2,1 M');
    expect(formatRupiahShort(1_000_000)).toBe('Rp1 jt');
    expect(formatRupiahShort(1_500)).toBe('Rp1,5 rb');
    expect(formatRupiahShort(0)).toBe('Rp0');
    expect(formatRupiahShort(-1_350_000)).toBe('−Rp1,35 jt');
  });
  it('rounds up into the next unit instead of writing 1000 rb', () => {
    expect(formatRupiahShort(999_600)).toBe('Rp999,6 rb');
    expect(formatRupiahShort(999_996)).toBe('Rp1 jt');
    expect(formatRupiahShort(999_999_999)).toBe('Rp1 M');
  });
  it('writes counts and percents as integers', () => {
    expect(formatIntShort(1200)).toBe('1,2 rb');
    expect(formatIntShort(350)).toBe('350');
    expect(formatPercent(11)).toBe('11%');
    expect(percentOf(1, 3)).toBe(33);
    expect(percentOf(5, 0)).toBe(0);
  });
  it('picks full and short formats from the unit', () => {
    const f = resolveFormats('rupiah');
    expect(f.full(1_350_000)).toBe('Rp1.350.000');
    expect(f.short(1_350_000)).toBe('Rp1,35 jt');
    const custom = resolveFormats('count', (n) => `${n} pcs`);
    expect(custom.short(4)).toBe('4 pcs');
  });
  it('cuts long labels with an ellipsis', () => {
    expect(truncate('Indomie Goreng', 500)).toBe('Indomie Goreng');
    expect(truncate('Indomie Goreng Rasa Ayam Bawang', 60).endsWith('…')).toBe(true);
  });
});

describe('niceDomain (bars start at zero, ticks are whole numbers)', () => {
  it('always includes zero and rounds the top up', () => {
    const d = niceDomain(0, 1_390_000, 4);
    expect(d.min).toBe(0);
    expect(d.max).toBeGreaterThanOrEqual(1_390_000);
    expect(d.ticks[0]).toBe(0);
    expect(d.ticks.every((t) => Number.isInteger(t))).toBe(true);
    expect(d.ticks.length).toBeLessThanOrEqual(8);
  });
  it('keeps zero when every value is far from it', () => {
    const d = niceDomain(900, 1000, 4);
    expect(d.min).toBe(0);
  });
  it('reaches below zero for a negative value (a bridge)', () => {
    const d = niceDomain(-6_100_000, 10_180_000, 4);
    expect(d.min).toBeLessThanOrEqual(-6_100_000);
    expect(d.ticks).toContain(0);
  });
  it('survives all zeros and tiny counts with integer steps', () => {
    const z = niceDomain(0, 0);
    expect(z.max).toBeGreaterThan(0);
    const small = niceDomain(0, 3, 4);
    expect(small.step).toBeGreaterThanOrEqual(1);
    expect(small.ticks.every((t) => Number.isInteger(t))).toBe(true);
  });
});

describe('linear and bands', () => {
  it('maps the domain onto the range, also backwards (y axis)', () => {
    const y = linear(0, 100, 200, 0);
    expect(y(0)).toBe(200);
    expect(y(100)).toBe(0);
    expect(y(50)).toBe(100);
  });
  it('divides the width into equal bands', () => {
    const b = bands(5, 500, 0.2);
    expect(b.step).toBe(100);
    expect(b.bandwidth).toBe(80);
    expect(b.start(0)).toBe(10);
    expect(b.start(4)).toBe(410);
  });
  it('thins labels so they do not touch', () => {
    expect(labelStride(30, 100)).toBe(1);
    expect(labelStride(40, 20)).toBe(3);
  });
});

describe('percents and slices (donut)', () => {
  it('adds up to exactly 100', () => {
    expect(percents([1, 1, 1])).toEqual([34, 33, 33]);
    expect(percents([620_000, 410_000, 180_000, 140_000]).reduce((a, b) => a + b, 0)).toBe(100);
    expect(percents([0, 0])).toEqual([0, 0]);
  });
  it('orders from the largest and gives each a start and a length', () => {
    const s = toSlices([
      { label: 'Kasbon', value: 140 },
      { label: 'Tunai', value: 620 },
      { label: 'QRIS', value: 410 },
    ]);
    expect(s.map((x) => x.label)).toEqual(['Tunai', 'QRIS', 'Kasbon']);
    expect(s[0].start).toBe(0);
    expect(Math.round(s[2].start + s[2].length)).toBe(100);
    expect(s.reduce((a, x) => a + x.percent, 0)).toBe(100);
  });
  it('folds everything past five parts into "Lainnya", last', () => {
    const parts = ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((label, i) => ({ label, value: 100 - i * 10 }));
    const s = toSlices(parts, 5);
    expect(s).toHaveLength(5);
    expect(s[4].label).toBe('Lainnya');
    expect(s[4].merged).toBe(true);
    expect(s[4].value).toBe(60 + 50 + 40);
    expect(s.slice(0, 4).map((x) => x.label)).toEqual(['A', 'B', 'C', 'D']);
  });
  it('drops parts with no value', () => {
    expect(toSlices([{ label: 'A', value: 0 }, { label: 'B', value: 5 }]).map((x) => x.label)).toEqual(['B']);
  });
});

describe('layoutSegments (segmented bar)', () => {
  it('splits the width in proportion, with a gap between segments', () => {
    const s = layoutSegments([50, 50], 202, 2);
    expect(s[0].width).toBe(100);
    expect(s[1].x).toBe(102);
    expect(s[1].width).toBe(100);
  });
  it('keeps a small value visible and takes the room from the others', () => {
    const s = layoutSegments([1, 1000], 300, 2, 4);
    expect(s[0].width).toBe(4);
    expect(s[0].width + s[1].width + 2).toBeCloseTo(300, 5);
  });
  it('gives no segment to a zero value and no gap for it', () => {
    const s = layoutSegments([10, 0, 10], 102, 2);
    expect(s[1].width).toBe(0);
    expect(s[2].x).toBe(52);
  });
  it('returns zero widths for no data', () => {
    expect(layoutSegments([0, 0], 100).every((x) => x.width === 0)).toBe(true);
  });
});

describe('heat and ramp steps', () => {
  it('maps a value to step 0 to 5 by share of the maximum', () => {
    expect(heatLevel(0, 10)).toBe(0);
    expect(heatLevel(1, 10)).toBe(1);
    expect(heatLevel(10, 10)).toBe(5);
    expect(heatLevel(5, 10)).toBe(3);
    expect(heatLevel(5, 0)).toBe(0);
  });
  it('spreads ramp steps over ordered buckets', () => {
    expect(sequentialSteps(4)).toEqual([1, 2, 4, 5]);
    expect(sequentialSteps(5)).toEqual([1, 2, 3, 4, 5]);
    expect(sequentialSteps(2)).toEqual([1, 5]);
    expect(sequentialSteps(1)).toEqual([5]);
  });
  it('closes an area down to its baseline', () => {
    expect(areaPath([[0, 10], [10, 5]], 20)).toBe('M0,20 L0,10 L10,5 L10,20 Z');
  });
});
