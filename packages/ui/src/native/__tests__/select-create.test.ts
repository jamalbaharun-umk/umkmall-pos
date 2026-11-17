/**
 * Native `Select` offers the create row by the SHARED rule (UMK-1119).
 *
 * SOURCE-SCANNED, not rendered: `react-native` does not load under vitest (its entry is Flow),
 * the same reason `menu-inset.test.ts` reads its component as text. What a scan can pin is the
 * part that drifts silently — a second, native-only show rule, or a create that selects the
 * untrimmed query — while the rule's behaviour is proven in `shared/select.test.ts`.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SELECT = readFileSync(resolve(__dirname, '..', 'Select.tsx'), 'utf8');

describe('native Select create row', () => {
  it('decides visibility with the shared canCreateOption rule', () => {
    expect(SELECT).toMatch(/import \{[^}]*\bcanCreateOption\b[^}]*\} from '\.\.\/shared\/select'/);
    expect(SELECT).toMatch(/canCreateOption\(visible\.length, query,/);
  });

  it('creates with the trimmed query and selects what comes back', () => {
    expect(SELECT).toMatch(/await onCreate\(query\.trim\(\)\)/);
    expect(SELECT).toMatch(/onValueChange\?\.\(option\.value\)/);
  });

  it('renders the row in place of the empty message', () => {
    expect(SELECT.indexOf(': showCreate ? (')).toBeGreaterThan(-1);
    expect(SELECT.indexOf(': showCreate ? (')).toBeLessThan(SELECT.indexOf('{emptyMessage}'));
  });
});
