/**
 * The browser bundle is what the prototyping kit hands the learning team: one script tag
 * carrying the whole library. Nothing in CI builds it, so these tests build it in-process
 * (KTD6) — the shape `docs-generated.test.ts` and `tailwind.config.test.ts` already use.
 *
 * SITED IN `src/`, NOT BESIDE THE GENERATOR. `packages/ui/vitest.config.ts` includes only
 * `src/**‌/*.{test,spec}.{ts,tsx}`, so a `.mjs` test under `scripts/` is collected by nothing
 * and every scenario below would exist unrun. `src/` also supplies the happy-dom environment
 * the first scenario needs. `inline-classes.purge.test.ts` excludes `*.test.*` from its walk,
 * so this file does not land in that guard's enumerated list.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  BUNDLE_SIZE_CEILING_BYTES,
  buildBrowserBundle,
} from '../scripts/build-browser-bundle.mjs';

const packageRoot = join(__dirname, '..');
const repoRoot = join(packageRoot, '..', '..');

/** One build shared by every scenario — bundling the whole library is not cheap. */
const bundle = await buildBrowserBundle({ write: false });

describe('browser bundle', () => {
  it('exposes the library plus React on a single global', () => {
    const evaluate = new Function(`${bundle.code};\nreturn UmkmallUI;`) as () => Record<
      string,
      unknown
    >;
    const api = evaluate();

    for (const name of ['Button', 'AppShell', 'ChatMessageBubble', 'React', 'ReactDOMClient']) {
      expect(api[name], `window.UmkmallUI.${name} is missing`).toBeDefined();
    }
    expect(typeof (api.React as { createElement?: unknown }).createElement).toBe('function');
    expect(typeof (api.ReactDOMClient as { createRoot?: unknown }).createRoot).toBe('function');
  });

  it('keeps react-native out of the graph', () => {
    // `src/index.ts` does not export the `./native` subpath. If someone widens the entry,
    // the bundle pulls in a runtime that cannot evaluate in a browser at all.
    expect(bundle.code).not.toMatch(/require\(\s*["']react-native/);
    expect(bundle.code).not.toMatch(/from\s*["']react-native/);
  });

  it('stays under the recorded size ceiling', () => {
    // Not a performance budget — this is how an accidental dependency addition becomes
    // visible. Raising the ceiling is fine; raising it by accident is not.
    expect(bundle.bytes).toBeLessThan(BUNDLE_SIZE_CEILING_BYTES);
  });
});

describe('package exports', () => {
  const manifestText = readFileSync(join(packageRoot, 'package.json'), 'utf8');

  it('declares no export subpath twice', () => {
    // `JSON.parse` silently keeps the last duplicate, so the raw text is the only witness.
    const keys = [...manifestText.matchAll(/^ {4}"(\.[^"]*)":/gm)].map((match) => match[1]);
    const duplicates = keys.filter((key, index) => keys.indexOf(key) !== index);
    expect(duplicates).toEqual([]);
  });

  it('still resolves ./docs — apps/mobile’s playbook registry imports it', () => {
    const manifest = JSON.parse(manifestText) as { exports: Record<string, string> };
    expect(manifest.exports['./docs']).toBe('./src/docs/index.ts');
  });
});

describe('turbo build inputs', () => {
  it('folds the starter’s inputs into the design app’s build hash', () => {
    /*
     * WHAT THE MEASUREMENT ACTUALLY SHOWED, which is not what the plan predicted (KTD5).
     *
     * A `packages/ui/src` edit misses the design app's build cache WITHOUT this entry —
     * `dependsOn: ["^build"]` folds a dependency task's hash into its dependents', and U1
     * gave this package a `build` script for the first time. Those globs are redundant
     * today; they are kept because they are the only thing holding the guarantee if that
     * script ever goes away, and they cost nothing.
     *
     * `scripts/proto/**` is the half that is genuinely load-bearing, and the plan did not
     * anticipate it: those generators belong to NO workspace, so without an explicit input
     * an edit to `build-assets.mjs` replays a cached `dist` and republishes the previous
     * starter. Observed directly — cache hit without the entry, cache miss with it.
     *
     * `DESIGN_BASE_URL` is in `env` for the same reason: it is baked into the docs pages at
     * BUILD time, so a changed URL must rebuild rather than replay one with the old value.
     */
    const turbo = JSON.parse(readFileSync(join(repoRoot, 'turbo.json'), 'utf8')) as {
      tasks: Record<string, { inputs?: string[]; dependsOn?: string[]; outputs?: string[]; env?: string[] }>;
    };
    const task = turbo.tasks['@umkmall/design#build'];

    expect(task, '@umkmall/design#build entry is missing from turbo.json').toBeDefined();
    expect(task.inputs).toContain('$TURBO_ROOT$/scripts/proto/**');
    expect(task.inputs).toContain('$TURBO_ROOT$/packages/ui/src/**/*.{ts,tsx}');
    expect(task.env).toContain('DESIGN_BASE_URL');
    // A `<package>#<task>` entry REPLACES the base definition rather than merging with it,
    // so dropping either of these silently unbuilds or uncaches the design app.
    expect(task.dependsOn).toContain('^build');
    expect(task.outputs).toContain('dist/**');
    // `passThroughEnv` is hand-copied from the base task for the same replace-not-merge
    // reason, and nothing links the two copies. A variable added to the base task and not
    // here stops reaching the design build, which is not an error — just a build that no
    // longer sees it.
    expect(task.passThroughEnv).toEqual(turbo.tasks.build.passThroughEnv);
  });

  it('folds them into the design app’s TEST hash too', () => {
    /*
     * THE SIBLING ENTRY, AND IT WAS THE ONE THAT MATTERED. The generator assertions used to
     * run behind a repo-root `node --test` line in CI; they now live in the design app's
     * suite. A task hash covers a package's own files (UMK-852), so without these inputs an
     * edit to a generator leaves `@umkmall/design#test`'s hash unchanged and `turbo test`
     * replays a cached PASS over a broken generator — fail-open, green, wrong.
     *
     * The `#build` entry above had this from the start; the `#test` entry did not, while a
     * comment in the guard it protects claimed it did. Four reviewers found that
     * independently, which is what a contradiction between a comment and a config buys.
     */
    const turbo = JSON.parse(readFileSync(join(repoRoot, 'turbo.json'), 'utf8')) as {
      tasks: Record<string, { inputs?: string[] }>;
    };
    const testTask = turbo.tasks['@umkmall/design#test'];

    expect(testTask, '@umkmall/design#test entry is missing from turbo.json').toBeDefined();
    expect(testTask.inputs).toContain('$TURBO_ROOT$/scripts/proto/**');
    expect(testTask.inputs).toContain('$TURBO_ROOT$/packages/ui/scripts/**');
    expect(testTask.inputs).toContain('$TURBO_ROOT$/packages/ui/tokens.css');

    /*
     * THE CONTRACT GLOB, which this guard omitted while pinning its neighbours.
     *
     * It is the sole link folding `contract/variants.ts` into the `#test` hash, and that hash is
     * what makes the regenerate-and-compare check see a stale `contract-reference.generated.ts`.
     * Drop this line from `turbo.json` while tidying and every assertion above stays green, a
     * contract change stops invalidating `#test`, and a stale reference ships — teaching every
     * AI-written prototype axis values the library no longer has, which renders unstyled with no
     * error. A guard over N contributors that pins only N-1 of them cannot see the last one
     * disappear (UMK-956).
     */
    expect(testTask.inputs).toContain('$TURBO_ROOT$/packages/ui/src/**/*.{ts,tsx}');

    /*
     * `tokens.preset.js` is REACHED, not merely nearby. The suite executes `build-assets.mjs`,
     * which calls `starterTailwindConfig()`, which requires `packages/ui/tailwind.preset.js`,
     * which requires `./tokens.preset.js` — the generated token file. Without it in the inputs,
     * regenerating tokens and running `turbo test` replays a cached green over assertions that
     * compare the freshly-derived theme against the published asset.
     */
    expect(testTask.inputs).toContain('$TURBO_ROOT$/packages/ui/tokens.preset.js');
  });

  /*
   * A `<package>#<task>` entry REPLACES the base task rather than merging with it — the same rule
   * this PR documents for `inputs`, one field over. `@umkmall/design#test` therefore inherits none
   * of the base `test` task's `passThroughEnv`. That is harmless for this app, which needs no
   * secret to run its suite; it is pinned so the next editor finds out here rather than by
   * debugging a variable that silently never arrives.
   */
  it('the design test entry inherits no passThroughEnv, deliberately', () => {
    const turbo = JSON.parse(readFileSync(join(repoRoot, 'turbo.json'), 'utf8')) as {
      tasks: Record<string, { passThroughEnv?: string[] }>;
    };
    expect(turbo.tasks['@umkmall/design#test'].passThroughEnv).toBeUndefined();
    // The base entry does have one — so this is a replacement, not an empty world.
    expect(turbo.tasks.test.passThroughEnv?.length ?? 0).toBeGreaterThan(0);
  });
});
