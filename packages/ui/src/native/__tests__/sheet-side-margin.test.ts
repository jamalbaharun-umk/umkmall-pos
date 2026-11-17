/**
 * The bottom sheet's sides are the mobile page margin (16), for the heading and the body alike.
 *
 * They were 24 (body) and 32 (heading): on a 360dp phone the sheet lost 48dp to gutters, the coin
 * packs clipped at the edge and text wrapped early — and the heading sat 8dp right of everything
 * under it. `tokens.margin.mobile` is the design system's own mobile page margin.
 *
 * Sited HERE because a guard only guards its own package: `apps/mobile`'s overlay tests render the
 * same values, but turbo does not re-run them when only this package changes.
 *
 * Proven red, each alone: the body back to `padding` only (no `paddingHorizontal`); the title back
 * to `tokens.spacing['2xl']`.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { tokens } from '../../tokens';

const read = (file: string) => readFileSync(resolve(__dirname, '..', file), 'utf8');

describe('the sheet side margin', () => {
  it('is the mobile page margin', () => {
    expect(tokens.margin.mobile).toBe(16);
  });

  /* Scoped to the CONTENT box's own style object — the one that also carries `flexShrink: 1`, the
     bounded-scroll rule — so the line moving to any other style in the file reds this (review P3). */
  it("sets the body's sides from it", () => {
    const source = read('Dialog.tsx');
    const start = source.indexOf('flexShrink: 1,');
    expect(start).toBeGreaterThan(-1);
    const body = source.slice(start, source.indexOf('}}', start));
    expect(body).toMatch(/paddingHorizontal:\s*tokens\.margin\.mobile/);
  });

  it("sets the heading's sides from it, so both share one left edge", () => {
    const styles = read('overlay-styles.ts');
    const title = styles.slice(styles.indexOf('export const DIALOG_TITLE = {'));
    expect(title.slice(0, title.indexOf('}'))).toMatch(/paddingHorizontal:\s*tokens\.margin\.mobile/);
  });
});
