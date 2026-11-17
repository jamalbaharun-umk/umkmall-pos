/**
 * UMK-1548 U11 on native: the `compact` rungs and `muted` mirror the web's, from the same tokens.
 * The native suite cannot load `react-native`, so this reads the style tables, which import none,
 * and the two component files as text for the wiring.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BADGE_COMPACT_WEIGHT, BADGE_SIZE, CHIP_COMPACT_IDLE_BORDER, CHIP_STATE } from '../content-styles';
import { BOX_HEIGHT_COMPACT, BOX_SIZE_COMPACT, BOX_STATE_COMPACT, FIELD_STACK_COMPACT } from '../field-styles';
import { TEXT_COLOR_VALUES, tokens } from '../theme';

const read = (f: string) => readFileSync(resolve(__dirname, '..', f), 'utf8');

describe('native compact variants', () => {
  it('Text muted resolves the Text group muted value', () => {
    expect(TEXT_COLOR_VALUES.muted).toBe(tokens.text.default.muted);
    expect(TEXT_COLOR_VALUES.muted).not.toBe(TEXT_COLOR_VALUES.secondary);
  });

  it('the compact field box is 14px, 10/12 padding, r12, with a 4px stack', () => {
    expect(BOX_SIZE_COMPACT).toMatchObject({
      paddingHorizontal: tokens.spacing.sm,
      paddingVertical: tokens.spacing.xs,
      borderRadius: tokens.radius.lg,
      role: 'paragraph',
    });
    expect(FIELD_STACK_COMPACT.gap).toBe(tokens.spacing['4xs']);
  });

  it('TextField wires the compact box, stack and muted caption', () => {
    const src = read('TextField.tsx');
    expect(src).toContain('compact: BOX_SIZE_COMPACT');
    expect(src).toMatch(/size === 'compact' \? FIELD_STACK_COMPACT/);
    expect(src).toMatch(/muted=\{size === 'compact'\}/);
  });

  it('Button compact is 6/12 at 12px, semibold', () => {
    const src = read('Button.tsx');
    expect(src).toMatch(/compact: \{ paddingHorizontal: tokens\.spacing\.sm, paddingVertical: tokens\.spacing\['3xs'\], role: 'bodyLg' \}/);
    expect(src).toMatch(/weight=\{size === 'compact' \? 'semibold' : 'bold'\}/);
  });

  it('Badge compact rungs are 14px bold, 6/10 and 4/12', () => {
    expect(BADGE_SIZE.compact).toEqual({ paddingHorizontal: tokens.spacing.xs, paddingVertical: tokens.spacing['3xs'], role: 'paragraph' });
    expect(BADGE_SIZE.compactTight).toEqual({ paddingHorizontal: tokens.spacing.sm, paddingVertical: tokens.spacing['4xs'], role: 'paragraph' });
    expect(BADGE_COMPACT_WEIGHT).toBe('bold');
    expect(read('Badge.tsx')).toMatch(/size === 'compact' \|\| size === 'compactTight' \? BADGE_COMPACT_WEIGHT/);
  });

  it('Chip compact idle border is n40 and wired for the idle compact chip only', () => {
    expect(CHIP_COMPACT_IDLE_BORDER).toBe(tokens.border.default.invert);
    expect(CHIP_COMPACT_IDLE_BORDER).not.toBe(CHIP_STATE.default.border);
    expect(read('Chip.tsx')).toMatch(/size === 'compact' && \(state \?\? 'default'\) === 'default' \? CHIP_COMPACT_IDLE_BORDER/);
  });

  it('the compact field rests on n40, is 44 on one line and a 24 line on several', () => {
    expect(BOX_STATE_COMPACT.default.borderColor).toBe(tokens.border.default.invert);
    expect(BOX_STATE_COMPACT.filled.borderColor).toBe(tokens.border.default.invert);
    expect(BOX_HEIGHT_COMPACT.single.minHeight).toBe(tokens.measurement['2-75']);
    expect(BOX_HEIGHT_COMPACT.multilineLineHeight).toBe(tokens.font.lineHeight.md);
    const src = read('TextField.tsx');
    expect(src).toMatch(/BOX_STATE_COMPACT\[state\]/);
    expect(src).toMatch(/compact && !multiline \? BOX_HEIGHT_COMPACT\.single/);
    /* The 24 line is multiplied by the reader's text size (UMK-1832), so it grows with the font. */
    expect(src).toMatch(/compact && multiline \? \{ lineHeight: Math\.round\(BOX_HEIGHT_COMPACT\.multilineLineHeight \* scale\)/);
  });
});
