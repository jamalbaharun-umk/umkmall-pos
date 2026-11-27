import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The chart components style their SVG with CSS classes and `rgb(var(--ds-chart-1))` custom properties, which a
// PDF engine does not read. This turns the markup into plain presentation attributes with the colours the
// design tokens resolve to (light theme), so the PDF carries exactly the screen's colours.

const GENERATED = join(__dirname, '..', '..', '..', 'generated');

let tokens: Record<string, string> | undefined;
const tokenTable = (): Record<string, string> =>
  (tokens ??= JSON.parse(
    readFileSync(join(GENERATED, 'chart-tokens.json'), 'utf8'),
  ) as Record<string, string>);

/** `--ds-chart-1: var(--brand-b400)` lines of the chart CSS's light block, merged over the design tokens. */
export function resolveTokens(chartCss: string): Record<string, string> {
  const light = chartCss.split('.dark ')[0];
  const table = { ...tokenTable() };
  for (const m of light.matchAll(/(--ds-chart-[a-z0-9-]+):\s*([^;]+);/g))
    table[m[1]] = m[2].trim();
  return table;
}

const hex = (n: number) =>
  Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0');

/** `rgb(var(--ds-chart-1))` → `#0074e7`; `transparent` and `none` stay. Unknown tokens throw: a silent default hides a broken palette. */
export function resolveColor(
  value: string,
  table: Record<string, string>,
): string {
  let v = value.trim();
  if (v === 'transparent' || v === 'none') return 'none';
  for (let i = 0; i < 8 && v.includes('var('); i++)
    v = v.replace(/var\((--[a-z0-9-]+)\)/g, (_, name: string) => {
      const found = table[name];
      if (found === undefined) throw new Error(`unknown chart token ${name}`);
      return found;
    });
  const m = /^rgb\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)\s*(?:\/\s*[\d.]+)?\)$/.exec(
    v,
  );
  if (!m) throw new Error(`cannot resolve colour "${value}"`);
  return `#${hex(+m[1])}${hex(+m[2])}${hex(+m[3])}`;
}

const REM = 16;

function declToAttr(
  prop: string,
  value: string,
  table: Record<string, string>,
): [string, string] | null {
  switch (prop) {
    case 'fill':
    case 'stroke':
      return [prop, resolveColor(value, table)];
    case 'stroke-width':
      return [prop, value.replace('px', '')];
    case 'font-size': {
      const rem = /^([\d.]+)rem$/.exec(value);
      return [
        'font-size',
        rem ? String(+rem[1] * REM) : value.replace('px', ''),
      ];
    }
    case 'font-weight':
      return [prop, value];
    default:
      return null;
  }
}

function parseDecls(body: string): Array<[string, string]> {
  return body
    .split(';')
    .map((d) => d.trim())
    .filter(Boolean)
    .map((d) => {
      const i = d.indexOf(':');
      return [d.slice(0, i).trim(), d.slice(i + 1).trim()] as [string, string];
    });
}

const unescapeAttr = (s: string) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&');

export interface InlinedSvg {
  svg: string;
  width: number;
  height: number;
}

/** The first `<svg>` of a chart's markup, with classes and `style` replaced by attributes pdfkit understands. */
export function inlineSvg(html: string, chartCss: string): InlinedSvg {
  const table = resolveTokens(chartCss);
  const classAttrs = new Map<string, Array<[string, string]>>();
  for (const m of chartCss.matchAll(/^\.(ds-chart-[a-z-]+)\{([^}]*)\}$/gm)) {
    const attrs = parseDecls(m[2]).flatMap(([p, v]) => {
      const a = declToAttr(p, v, table);
      return a ? [a] : [];
    });
    classAttrs.set(m[1], attrs);
  }
  const start = html.indexOf('<svg');
  const end = html.indexOf('</svg>', start);
  if (start < 0 || end < 0) throw new Error('chart markup has no svg');
  let svg = html.slice(start, end + 6);
  // Hit areas and focus rings are for fingers and keyboards.
  svg = svg.replace(/<rect class="ds-chart-(?:hit|ring)"[^>]*><\/rect>/g, '');
  svg = svg.replace(/<title>[\s\S]*?<\/title>/g, '');
  svg = svg.replace(
    /<(g|rect|line|text|path|circle|polyline|polygon)\b([^>]*?)(\/?)>/g,
    (_all, tag: string, rest: string, self: string) => {
      const attrs = new Map<string, string>();
      for (const m of rest.matchAll(/([A-Za-z][\w:-]*)="([^"]*)"/g))
        attrs.set(m[1], unescapeAttr(m[2]));
      for (const drop of [
        'tabindex',
        'role',
        'aria-label',
        'data-datum',
        'aria-hidden',
      ])
        attrs.delete(drop);
      const fromClass = new Map<string, string>();
      for (const c of (attrs.get('class') ?? '').split(/\s+/))
        for (const [k, v] of classAttrs.get(c) ?? []) fromClass.set(k, v);
      attrs.delete('class');
      const style = attrs.get('style');
      attrs.delete('style');
      for (const [p, v] of style ? parseDecls(style) : []) {
        const a = declToAttr(p, v, table);
        if (a) fromClass.set(a[0], a[1]);
      }
      for (const [k, v] of fromClass) attrs.set(k, v);
      if (tag === 'text' && attrs.get('dominant-baseline') === 'central') {
        const size = Number(attrs.get('font-size') ?? 12);
        attrs.set(
          'y',
          String(
            Math.round((Number(attrs.get('y') ?? 0) + size * 0.35) * 10) / 10,
          ),
        );
      }
      attrs.delete('dominant-baseline');
      const out = [...attrs]
        .map(([k, v]) => `${k}="${v.replace(/"/g, '&quot;')}"`)
        .join(' ');
      return `<${tag}${out ? ` ${out}` : ''}${self}>`;
    },
  );
  const w = /<svg[^>]*\swidth="(\d+(?:\.\d+)?)"/.exec(svg);
  const h = /<svg[^>]*\sheight="(\d+(?:\.\d+)?)"/.exec(svg);
  if (!w || !h) throw new Error('chart svg has no size');
  // `role` and `aria-label` of the svg root: the root keeps only what a PDF needs.
  svg = svg.replace(/^<svg\b[^>]*>/, (root) =>
    root.replace(/\s(role|aria-label)="[^"]*"/g, ''),
  );
  return { svg, width: +w[1], height: +h[1] };
}

export interface LegendEntry {
  label: string;
  value?: string;
  percent?: string;
  color: string;
}

/** The legend the chart wrote (`<ul class="ds-chart-legend">`), with swatch colours resolved. */
export function parseLegend(html: string, chartCss: string): LegendEntry[] {
  const table = resolveTokens(chartCss);
  const out: LegendEntry[] = [];
  const text = (s: string) =>
    s
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&#x27;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>');
  for (const li of html.matchAll(/<li>([\s\S]*?)<\/li>/g)) {
    const body = li[1];
    const sw =
      /class="ds-chart-sw"[^>]*style="background:([^"]+)"/.exec(body) ??
      /stroke:([^";]+)/.exec(body);
    if (!sw) continue;
    const pick = (cls: string) =>
      new RegExp(`class="${cls}"[^>]*>([\\s\\S]*?)</span>`).exec(body)?.[1];
    const label = pick('ds-chart-legend-label');
    if (label === undefined) continue;
    const value = pick('ds-chart-legend-value');
    const percent = pick('ds-chart-legend-pct');
    out.push({
      label: text(label),
      ...(value !== undefined ? { value: text(value) } : {}),
      ...(percent !== undefined ? { percent: text(percent) } : {}),
      color: resolveColor(unescapeAttr(sw[1]), table),
    });
  }
  return out;
}
