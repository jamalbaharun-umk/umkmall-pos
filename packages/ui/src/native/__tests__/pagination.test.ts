/**
 * Native `Pagination` (UMK-1601 / UMK-1614): Paket Teman AI's numbered pager, Figma `Mobile/Package`
 * 14987:94832 — the page-size field, then the page squares with the current one in brand, an ellipsis
 * over each gap, the last page and `›`.
 *
 * The strip's rule is asserted by IMPORT (`shared/page-items.ts` is pure, and the web pager reads the
 * same module); the wiring by SOURCE SCAN, because `Pagination.tsx` loads `react-native`, which vitest
 * cannot. The render — what a press hands the host, the brand square, the disabled `›`, the page-size
 * sheet — is `apps/mobile`'s `design/__tests__/pagination.test.tsx`. This half exists because a guard
 * only guards its own package (docs/solutions/conventions/a-guard-test-only-guards-its-own-package.md).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contract } from '../../contract';
import { pageItems as webPageItems } from '../../primitives/Pagination/page-items';
import { pageItems } from '../../shared/page-items';
import { tokens } from '../../tokens';

const read = (file: string) => readFileSync(resolve(__dirname, '..', file), 'utf8');

/** Line comments first, then block comments — so prose naming a pattern cannot satisfy it. */
const code = (file: string) =>
  read(file)
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .replace(/\/\*[\s\S]*?\*\//g, '');

describe('the page strip rule', () => {
  it('is ONE module the web and native pagers both read', () => {
    expect(webPageItems).toBe(pageItems);
    expect(code('Pagination.tsx')).toMatch(/import \{ pageItems \} from '\.\.\/shared\/page-items';/);
  });

  it('keeps first, last, the current page and its neighbours, with an ellipsis over each gap', () => {
    expect(pageItems(1, 1)).toEqual([1]);
    expect(pageItems(1, 3)).toEqual([1, 2, 3]);
    expect(pageItems(1, 100)).toEqual([1, 2, 'ellipsis', 100]);
    expect(pageItems(5, 10)).toEqual([1, 'ellipsis', 4, 5, 6, 'ellipsis', 10]);
    /* A one-page gap shows that page: an ellipsis would take the same slot and hide it. */
    expect(pageItems(4, 10)).toEqual([1, 2, 3, 4, 5, 'ellipsis', 10]);
  });

  it('always holds the page before the current one, which is why native draws no ‹', () => {
    for (const [current, total] of [[2, 9], [5, 10], [50, 100], [100, 100]] as const) {
      expect(pageItems(current, total)).toContain(current - 1);
    }
  });
});

describe('Pagination', () => {
  const src = code('Pagination.tsx');

  it('clamps the page into 1..pageCount and draws one page for a count of 0', () => {
    expect(src).toMatch(/const total = Math\.max\(Math\.floor\(pageCount\) \|\| 0, 1\);/);
    expect(src).toMatch(/const current = Math\.min\(Math\.max\(Math\.floor\(page\) \|\| 1, 1\), total\);/);
  });

  it('paints the current page as the brand square with the white number, and does nothing on its press', () => {
    expect(src).toMatch(/p === current && \{ backgroundColor: tokens\.surface\.default\.brand \}/);
    expect(src).toMatch(/color=\{p === current \? 'invert' : 'primary'\}/);
    expect(src).toMatch(/accessibilityState=\{\{ selected: p === current, disabled \}\}/);
    expect(src).toMatch(/onPress=\{\(\) => p !== current && onPageChange\(p\)\}/);
  });

  it('disables › on the last page, derived from the page rather than passed', () => {
    expect(src).toMatch(/const canNext = current < total;/);
    expect(src).toMatch(/disabled=\{disabled \|\| !canNext\}\s*onPress=\{\(\) => onPageChange\(current \+ 1\)\}/);
    expect(src).toMatch(/<Icon name="chevron-right"/);
    expect(src).not.toMatch(/chevron-left/);
  });

  it('sizes its squares off the measurement ladder, by the contract size axis', () => {
    expect(src).toMatch(/export type PaginationSize = Of<'size'>;/);
    expect(src).toMatch(/large: \{ width: measure\['2-25'\], height: measure\['2-25'\], borderRadius: tokens\.radius\.md/);
    expect(src).toMatch(/small: \{ width: measure\['2'\], height: measure\['2'\], borderRadius: tokens\.radius\.sm/);
    expect([tokens.measurement['2-25'], tokens.measurement['2']]).toEqual([36, 32]);
    expect([...contract.Pagination.axes.size]).toEqual(['large', 'small']);
  });

  it('shows the page-size Select only when the host passes both halves, and always lists the size in force', () => {
    expect(src).toMatch(/const showPageSize = onPageSizeChange !== undefined && pageSize !== undefined;/);
    expect(src).toMatch(/\[\.\.\.new Set\(\[\.\.\.pageSizeOptions, pageSize\]\)\]/);
    expect(src).toMatch(/onValueChange=\{\(v\) => onPageSizeChange\(Number\(v\)\)\}/);
    expect(src).toMatch(/const DEFAULT_PAGE_SIZES: readonly number\[\] = \[10, 20, 50\];/);
  });

  it('presses through PressableScale and draws no pressed paint of its own', () => {
    expect(src).toMatch(/<PressableScale[\s\S]*?scale="icon"/);
    expect(src).not.toMatch(/\(\{\s*pressed\s*[,}]/);
  });

  it('is a partial native sibling: the strip and the page size, without density, cursor mode or a summary', () => {
    const native = contract.Pagination.native;
    expect(native.state).toBe('partial');
    if (native.state !== 'partial') return;
    expect(native.missingAxes).toEqual(['density']);
    expect(native.missingProps).toEqual(['hasPrev', 'hasNext', 'summary']);
    expect(native.owner).toBe('UMK-1614');
  });
});
