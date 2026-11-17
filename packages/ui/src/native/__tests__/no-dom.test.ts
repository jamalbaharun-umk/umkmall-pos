/**
 * The native entry may not reach the DOM.
 *
 * Metro resolving `react-dom`, `@radix-ui/*` or `lucide-react` into the app bundle is the
 * failure `@umkmall/ui/native` exists to prevent — at bundle time if you are lucky, at
 * runtime if you are not. One import of the shared barrel is all it takes, because
 * `src/index.ts` re-exports every web primitive.
 *
 * Sited in `packages/ui`, deliberately. `turbo.json`'s `test` task is cacheable with no
 * `inputs` or `dependsOn`, so a task hash covers a package's OWN files and not its workspace
 * dependencies'. The same guard written in `apps/mobile` would replay a cached PASS over a
 * live regression here.
 * See docs/solutions/conventions/a-guard-test-only-guards-its-own-package.md
 *
 * Unlike the contract's guard next door, this is a DENY-LIST rather than a bare-specifier
 * ban: this entry legitimately imports `react` and `react-native`, so "imports nothing"
 * is not the requirement here. A deny-list has the weakness that the first DOM package
 * nobody thought to list walks through it — so `classifies every dependency` below requires
 * every declared dependency to be named in ONE of the two lists. That is deliberately not a
 * name heuristic: the previous version matched a `radix` substring and a `-dom` suffix, and
 * `sonner` matched neither, so it could have been added without being banned and without
 * reddening anything.
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import pkg from '../../../package.json';

const NATIVE_ENTRY = resolve(__dirname, '..', 'index.ts');

/** Packages that pull in a DOM. `react` is fine — React Native uses it too. */
const FORBIDDEN = [
  'react-dom',
  'lucide-react',
  '@radix-ui',
  'tailwind-merge',
  'class-variance-authority',
  'react-day-picker',
  'sonner',
  // web-only by decision: Table is native-absent (UMK-1184). Native `Pagination` (UMK-1601) takes
  // no tanstack either — it is page, pageCount and two callbacks, as the web one is.
  '@tanstack/react-table',
];

/** The other half of the same decision: a dependency that is safe on the native entry.
 *  Every dependency this package declares has to be in one list or the other, so adding
 *  one forces the question rather than defaulting to "probably fine". */
/** `lucide-react-native` is the RN port of the banned `lucide-react`, and the ONLY
 *  dependency this entry legitimately reaches — its peers are `react-native` and
 *  `react-native-svg`, neither of which is a DOM. */
const NOT_DOM = ['clsx', 'tailwindcss-animate', 'lucide-react-native'];

/** Every module-load form, keyed on the SPECIFIER rather than a bound name, so that
 *  `export * from '<module>'` — which has no brace list and no import keyword — is caught. */
const SPECIFIER = /(?:from|import|require)\s*\(?\s*['"]([^'"]+)['"]/g;

const readSpecifiers = (file: string): string[] => {
  const src = readFileSync(file, 'utf8');
  return [...src.matchAll(SPECIFIER)].map((m) => m[1]);
};

/** Resolves a relative specifier to a real file, trying the extensions this package uses. */
const resolveLocal = (fromFile: string, spec: string): string | null => {
  const base = join(dirname(fromFile), spec);
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, 'index.ts'),
    join(base, 'index.tsx'),
  ]) {
    if (existsSync(candidate) && !candidate.endsWith('/')) {
      try {
        if (readFileSync(candidate)) return candidate;
      } catch {
        /* a directory — keep trying */
      }
    }
  }
  return null;
};

/** Walks the whole reachable graph, not just the entry's own imports. The regression this
 *  guards against arrives two or three hops down, via a helper someone reused. */
const walk = (entry: string): { files: string[]; bare: string[] } => {
  const seen = new Set<string>();
  const bare = new Set<string>();
  const queue = [entry];

  while (queue.length) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);

    for (const spec of readSpecifiers(file)) {
      if (spec.startsWith('.')) {
        const next = resolveLocal(file, spec);
        if (next) queue.push(next);
        continue;
      }
      bare.add(spec);
    }
  }
  return { files: [...seen], bare: [...bare] };
};

describe('@umkmall/ui/native import graph', () => {
  const { files, bare } = walk(NATIVE_ENTRY);

  it('reaches more than the entry file, so the walk is actually walking', () => {
    // Without this, a broken resolver would silently check one file and pass forever.
    expect(files.length).toBeGreaterThan(3);
  });

  it.each(FORBIDDEN)('never reaches %s', (forbidden) => {
    const hits = bare.filter((s) => s === forbidden || s.startsWith(`${forbidden}/`));
    expect(hits).toEqual([]);
  });

  // `lucide-react-native` is the RN port and belongs on this entry; `lucide-react` is the web
  // one and does not. A rule matching on prefix alone would reject both, so the first person
  // to add an icon would see a red guard for a correct import and "fix" it by weakening the
  // rule. Asserted here so the distinction survives.
  it('bans lucide-react without banning lucide-react-native', () => {
    const matches = (spec: string) =>
      FORBIDDEN.some((f) => spec === f || spec.startsWith(`${f}/`));

    expect(matches('lucide-react')).toBe(true);
    expect(matches('lucide-react/icons/x')).toBe(true);
    expect(matches('lucide-react-native')).toBe(false);
  });

  // The deny-list's weakness is a package nobody thought to add, and this used to be
  // guarded by NAME HEURISTICS — a `radix` substring, a `-dom` suffix, two literals. That
  // is a guard whose promise weakens every time it passes: `sonner` matched none of them
  // and neither did `react-day-picker`, so both could be added without being banned AND
  // without reddening anything. Every declared dependency now has to appear in one of the
  // two lists, which makes the omission itself the failure.
  it('classifies every dependency this package declares', () => {
    const named = (d: string) =>
      FORBIDDEN.some((f) => d === f || d.startsWith(`${f}/`)) || NOT_DOM.includes(d);
    expect(Object.keys(pkg.dependencies ?? {}).filter((d) => !named(d))).toEqual([]);
  });
});
