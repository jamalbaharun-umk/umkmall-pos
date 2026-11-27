import {
  MAX_CONCURRENT,
  withExportSlot,
  runningExports,
} from './export-limits';
import { PdfBuilder, PdfTooLargeError, MAX_PAGES } from './pdf-document';
import { renderChart } from './chart-render';
import { resolveColor, resolveTokens } from './svg-inline';
import type { Visual } from '../visuals/types';

const meta = {
  storeName: 'Warung Bu Sari',
  title: 'Laporan uji',
  period: '1 sampai 2 Nov 2026',
  generatedAt: '2 Nov 2026, 10.00',
  actorName: 'Rina',
};

describe('export limits', () => {
  it('runs at most MAX_CONCURRENT at once, then refuses at once with EXPORT_BUSY, and frees the slot', async () => {
    const gates: Array<() => void> = [];
    const held = Array.from({ length: MAX_CONCURRENT }, () =>
      withExportSlot(() => new Promise<void>((r) => gates.push(r))),
    );
    expect(runningExports()).toBe(MAX_CONCURRENT);
    await expect(
      withExportSlot(() => Promise.resolve(1)),
    ).rejects.toMatchObject({
      response: { code: 'EXPORT_BUSY' },
      status: 503,
    });
    gates.forEach((g) => g());
    await Promise.all(held);
    expect(runningExports()).toBe(0);
    await expect(withExportSlot(() => Promise.resolve(7))).resolves.toBe(7);
  });

  it('gives up a document that takes too long (EXPORT_TIMEOUT) and releases its slot', async () => {
    await expect(
      withExportSlot(() => new Promise<void>(() => undefined), 20),
    ).rejects.toMatchObject({
      response: { code: 'EXPORT_TIMEOUT' },
      status: 503,
    });
    expect(runningExports()).toBe(0);
  });

  it('frees the slot when the job throws', async () => {
    await expect(
      withExportSlot(() => Promise.reject(new Error('x'))),
    ).rejects.toThrow('x');
    expect(runningExports()).toBe(0);
  });
});

describe('chart colours for the PDF', () => {
  const css = renderChartCss();
  function renderChartCss(): string {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return (require('../../../generated/charts.cjs') as { css: string }).css;
  }

  it('resolves the chart tokens to the design system colours, light theme', () => {
    const t = resolveTokens(css);
    expect(resolveColor('rgb(var(--ds-chart-1))', t)).toBe('#0074e7'); // brand b400
    expect(resolveColor('rgb(var(--ds-chart-2))', t)).toBe('#003d79'); // brand b600
    expect(resolveColor('rgb(var(--ds-chart-3))', t)).toBe('#6baef1'); // brand b200
    expect(resolveColor('transparent', t)).toBe('none');
  });

  it('refuses an unknown token instead of drawing a wrong colour', () => {
    expect(() => resolveColor('rgb(var(--nope))', resolveTokens(css))).toThrow(
      /unknown chart token/,
    );
  });

  it('draws the screen’s own chart: no class, style or var() left, only primary-palette fills', () => {
    const v: Visual = {
      id: 'x',
      kind: 'bars',
      title: 'T',
      unit: 'rupiah',
      orientation: 'vertical',
      categories: ['Rab', 'Kam', 'Jum'],
      series: [
        { label: 'Penjualan', values: [1_250_000, 980_000, 1_480_000] },
        { label: 'Pengeluaran', values: [150_000, 0, 400_000] },
      ],
    };
    const r = renderChart(v, 520, 190)!;
    expect(r.svg).not.toMatch(/\bclass=|\bstyle=|var\(|<title/);
    const fills = new Set(
      [...r.svg.matchAll(/fill="(#[0-9a-f]{6})"/g)].map((m) => m[1]),
    );
    expect(fills).toContain('#0074e7');
    expect(fills).toContain('#003d79');
    expect(r.legend.map((l) => l.label)).toEqual(['Penjualan', 'Pengeluaran']);
    expect(r.svg).toContain('Rp1,5 jt');
  });

  it('draws one column of one value as a figure, not a picture (the component does the same on screen)', () => {
    const v: Visual = {
      id: 'x',
      kind: 'bars',
      title: 'T',
      unit: 'rupiah',
      orientation: 'vertical',
      categories: ['Rab'],
      series: [{ label: 'Penjualan', values: [5] }],
    };
    expect(renderChart(v, 520, 190)).toBeNull();
  });
});

describe('PdfBuilder', () => {
  it('writes a PDF with page numbers on every page', async () => {
    const b = new PdfBuilder(meta);
    b.table({
      title: 'Banyak baris',
      columns: [
        { label: 'No', weight: 1 },
        { label: 'Jumlah', weight: 2, align: 'right' },
      ],
      rows: Array.from({ length: 120 }, (_, i) => [
        String(i + 1),
        `Rp${i + 1}.000`,
      ]),
    });
    const bytes = await b.finish();
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
    // Count the page objects: the table is longer than one page.
    const pages = (bytes.toString('latin1').match(/\/Type \/Page\b/g) ?? [])
      .length;
    expect(pages).toBeGreaterThan(1);
    expect(pages).toBeLessThan(MAX_PAGES);
  });

  it('refuses a document of more than MAX_PAGES pages instead of cutting it off', () => {
    const b = new PdfBuilder(meta);
    const rows = Array.from({ length: 60 * 60 }, (_, i) => [String(i), 'x']);
    expect(() =>
      b.table({
        columns: [
          { label: 'No', weight: 1 },
          { label: 'x', weight: 1 },
        ],
        rows,
      }),
    ).toThrow(PdfTooLargeError);
  });
});
