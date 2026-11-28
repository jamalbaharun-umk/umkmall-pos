import {
  marginPermille,
  permille,
  risePermille,
  roseEnough,
  suggestedPrice,
} from './suggest';

describe('suggestedPrice', () => {
  it('rounds up to the next Rp100 (design 43: Rp7.864 at 60% is Rp19.700)', () => {
    expect(suggestedPrice(7_864, 60)).toBe(19_700); // 19.660
    expect(suggestedPrice(7_232, 60)).toBe(18_100); // 18.080
    expect(suggestedPrice(1, 60)).toBe(100); // 2,5
  });
  it('keeps an exact multiple of Rp100', () => {
    expect(suggestedPrice(6_000, 40)).toBe(10_000); // 6.000 / 0,6
    expect(suggestedPrice(4_000, 60)).toBe(10_000); // 4.000 / 0,4
    expect(suggestedPrice(1_000, 50)).toBe(2_000);
  });
  it('accepts 1 to 90 and nothing else; no price for a free recipe', () => {
    expect(suggestedPrice(1_000, 1)).toBe(1_100); // 1.010,1
    expect(suggestedPrice(1_000, 90)).toBe(10_000);
    for (const m of [0, 91, 1.5, -5, Number.NaN])
      expect(suggestedPrice(1_000, m)).toBeNull();
    expect(suggestedPrice(0, 60)).toBeNull();
  });
  it('stays exact for a huge cost and refuses one past the safe range', () => {
    expect(suggestedPrice(1_000_000_000_000, 60)).toBe(2_500_000_000_000);
    expect(suggestedPrice(Number.MAX_SAFE_INTEGER, 90)).toBeNull();
  });
});

describe('rise and margin', () => {
  it('flags 5% or more, with integers', () => {
    expect(roseEnough(105, 100)).toBe(true);
    expect(roseEnough(104, 100)).toBe(false);
    expect(roseEnough(7_864, 7_232)).toBe(true);
    expect(roseEnough(7_593, 7_232)).toBe(false); // 4,99%
    expect(roseEnough(7_594, 7_232)).toBe(true); // just over 5%: 7.232 × 1,05 = 7.593,6
    expect(roseEnough(10, 0)).toBe(false);
  });
  it('gives tenths of a percent, half up', () => {
    expect(risePermille(7_864, 7_232)).toBe(87); // 8,74%
    expect(marginPermille(18_000, 7_864)).toBe(563); // 56,3%
    expect(marginPermille(0, 100)).toBeNull();
    expect(permille(1, 8)).toBe(125);
    expect(permille(-1, 8)).toBe(-125);
    expect(permille(1, 3)).toBe(333);
    expect(permille(2, 3)).toBe(667);
  });
});
