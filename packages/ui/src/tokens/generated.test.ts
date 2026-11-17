import { describe, expect, it } from 'vitest';
import { tokens } from './generated';

describe('generated tokens', () => {
  it('exposes a brand ramp step as a hex string', () => {
    expect(tokens.brand.b400).toBe('#0074e7');
  });

  // Measurements must stay numbers: React Native styles take numeric values, so a
  // stringified token here would break the portability the token export exists for.
  it('exposes a measurement as a number, not a string', () => {
    expect(tokens.measurement['1']).toBe(16);
  });
});
