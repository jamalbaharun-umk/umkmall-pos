import { accountNameOf } from './sale-payment.service';

/** A high surrogate without its low half, or a low one without its high half. */
const LONE_SURROGATE =
  /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

describe('accountNameOf: the VA holder name as the screen may show it (UMK-2045, UMK-2055)', () => {
  it('drops control characters and every invisible mark, also U+061C and U+2060-2064', () => {
    const marks = [
      '\u0000',
      '\u0007',
      '\u009f',
      '؜',
      '​',
      '‏',
      '‮',
      '⁠',
      '⁡',
      '⁢',
      '⁣',
      '⁤',
      '⁦',
      '⁩',
      '﻿',
    ];
    for (const m of marks)
      expect(accountNameOf(`WARUNG${m} BU SARI`)).toBe('WARUNG BU SARI');
    expect(accountNameOf(marks.join(''))).toBeNull();
    expect(accountNameOf('  \n ')).toBeNull();
  });

  it('cuts at 100 characters counted by code point: a pair outside the BMP is never split', () => {
    // 99 letters and an emoji (two UTF-16 units): the emoji is the 100th character and stays whole.
    const name = `${'A'.repeat(99)}\u{1F600}TAIL`;
    const cut = accountNameOf(name)!;
    expect([...cut]).toHaveLength(100);
    expect(cut.endsWith('\u{1F600}')).toBe(true);
    // No lone surrogate anywhere.
    expect(cut).not.toMatch(LONE_SURROGATE);
    const emojis = '\u{1F600}'.repeat(150);
    const all = accountNameOf(emojis)!;
    expect([...all]).toHaveLength(100);
    expect(all).not.toMatch(LONE_SURROGATE);
  });

  it('keeps ordinary text, Indonesian and Arabic letters alike', () => {
    expect(accountNameOf('Toko Ibu Siti')).toBe('Toko Ibu Siti');
    expect(accountNameOf('مطعم')).toBe('مطعم');
  });
});
