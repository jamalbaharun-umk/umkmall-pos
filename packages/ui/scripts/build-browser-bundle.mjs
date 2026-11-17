/**
 * Browser bundle for `@umkmall/ui` — an esbuild IIFE that puts the whole library,
 * plus React and ReactDOM's client, on `window.UmkmallUI`.
 *
 * React 19 ships no UMD build, so a plain `<script>` tag cannot pick React up from a
 * CDN global. React is therefore bundled in (KTD1), which also makes a version mismatch
 * between the host page and the library impossible: a prototype needs exactly one script tag.
 *
 * The entry is `src/index.ts`, which does NOT export the `./native` subpath — so
 * `react-native` never enters the graph. Do not widen the entry.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as esbuild from 'esbuild';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Where the bundle lands. Covered by `.gitignore`'s `dist/` rule — it is a build artifact. */
export const BUNDLE_PATH = join(packageRoot, 'dist', 'umkmall-ui.browser.js');

/**
 * Size ceiling, in bytes. This is not a performance budget: it is how an accidental
 * dependency addition becomes visible instead of silently doubling every starter.
 * Raising it is fine — doing so deliberately is the point.
 */
export const BUNDLE_SIZE_CEILING_BYTES = 1_600_000;

/**
 * The entry re-exports React alongside the library so one script tag suffices.
 * Written as a stdin module rather than a committed file: it exists only for this bundle,
 * and a real file under `src/` would be walked by the package's own source guards.
 */
const ENTRY_SOURCE = `
export * from './src/index.ts';
export * as React from 'react';
export * as ReactDOMClient from 'react-dom/client';
`;

export async function buildBrowserBundle({ write = true } = {}) {
  const result = await esbuild.build({
    stdin: {
      contents: ENTRY_SOURCE,
      resolveDir: packageRoot,
      sourcefile: 'browser-bundle-entry.ts',
      loader: 'ts',
    },
    bundle: true,
    format: 'iife',
    globalName: 'UmkmallUI',
    platform: 'browser',
    target: ['es2020'],
    jsx: 'automatic',
    minify: true,
    // Without this, React's dev build ships and warns on every render.
    define: { 'process.env.NODE_ENV': '"production"' },
    // Deliberately off: `apps/design`'s server serves any file that reaches `dist`
    // (its `TYPES` map is a content-type fallback, not an allowlist), so a sourcemap
    // here would publish unminified library source on a public domain.
    sourcemap: false,
    write: false,
  });

  const [output] = result.outputFiles;
  const code = output.text;

  if (write) {
    mkdirSync(dirname(BUNDLE_PATH), { recursive: true });
    writeFileSync(BUNDLE_PATH, code, 'utf8');
  }

  return { code, bytes: Buffer.byteLength(code, 'utf8') };
}

const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (invokedDirectly) {
  const { bytes } = await buildBrowserBundle();
  const kb = (bytes / 1024).toFixed(0);
  console.log(`@umkmall/ui browser bundle: ${BUNDLE_PATH} (${kb} KB)`);
  if (bytes > BUNDLE_SIZE_CEILING_BYTES) {
    console.error(
      `bundle is ${bytes} bytes, over the ${BUNDLE_SIZE_CEILING_BYTES} ceiling — ` +
        'raise the ceiling deliberately or drop the dependency that grew it',
    );
    process.exit(1);
  }
}
