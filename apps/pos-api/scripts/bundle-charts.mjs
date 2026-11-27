// Builds generated/charts.cjs (the shared chart components, server side) and generated/chart-tokens.json
// (the design tokens of packages/ui/tokens.css the charts read). Run by `npm run build`, `npm test` (global
// setup) and the Dockerfile. UMK-2074 charts are vendored in packages/ui and never edited here.
import { build } from 'esbuild'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const out = resolve(root, 'generated')
mkdirSync(out, { recursive: true })

await build({
  entryPoints: [resolve(root, 'charts/entry.js')],
  outfile: resolve(out, 'charts.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  minify: true,
  jsx: 'transform',
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'warning',
})

const css = readFileSync(resolve(root, '../../packages/ui/tokens.css'), 'utf8')
const tokens = {}
for (const m of css.matchAll(/^\s*(--[a-z0-9-]+):\s*([^;]+);/gim)) tokens[m[1]] ??= m[2].trim()
writeFileSync(resolve(out, 'chart-tokens.json'), JSON.stringify(tokens))
