import {
  MAX_CONCURRENT,
  withExportSlot,
  runningExports,
} from './export-limits';
import { PdfBuilder, PdfTooLargeError, MAX_PAGES } from './pdf-document';
import { renderChart } from './chart-render';
import { resolveColor, resolveTokens } from './svg-inline';
import type { Visual } from '../visuals/types';
import { pdfText } from '../../../test/support/pdf-text';

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
    const held = Array.from({ length: MAX_CONCURRENT }, (_, i) =>
      withExportSlot(`t${i}`, () => new Promise<void>((r) => gates.push(r))),
    );
    expect(runningExports()).toBe(MAX_CONCURRENT);
    await expect(
      withExportSlot('t9', () => Promise.resolve(1)),
    ).rejects.toMatchObject({
      response: { code: 'EXPORT_BUSY' },
      status: 503,
    });
    gates.forEach((g) => g());
    await Promise.all(held);
    expect(runningExports()).toBe(0);
    await expect(withExportSlot('t1', () => Promise.resolve(7))).resolves.toBe(
      7,
    );
  });

  it("lets one store hold only MAX_PER_TENANT slots, and keeps a timed-out job's slot until it settles", async () => {
    let finish: () => void = () => undefined;
    const first = withExportSlot(
      'one',
      () => new Promise<void>((r) => (finish = r)),
      20,
    );
    await expect(first).rejects.toMatchObject({
      response: { code: 'EXPORT_TIMEOUT' },
    });
    // Timed out for the caller, still running: the slot is not free yet.
    expect(runningExports()).toBe(1);
    await expect(
      withExportSlot('one', () => Promise.resolve(1)),
    ).rejects.toMatchObject({
      response: { code: 'EXPORT_BUSY' },
    });
    // Another store is served.
    await expect(withExportSlot('two', () => Promise.resolve(2))).resolves.toBe(
      2,
    );
    finish();
    await new Promise((r) => setImmediate(r));
    expect(runningExports()).toBe(0);
  });

  it('gives up a document that takes too long (EXPORT_TIMEOUT) and frees its slot once the job ends', async () => {
    await expect(
      withExportSlot(
        't5',
        () => new Promise<void>((r) => setTimeout(r, 60)),
        20,
      ),
    ).rejects.toMatchObject({
      response: { code: 'EXPORT_TIMEOUT' },
      status: 503,
    });
    await new Promise((r) => setTimeout(r, 100));
    expect(runningExports()).toBe(0);
  });

  it('frees the slot when the job throws', async () => {
    await expect(
      withExportSlot('t6', () => Promise.reject(new Error('x'))),
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

  it('keeps & < > " \' and non-Latin names in a label from breaking the drawing or the PDF', async () => {
    const names = [`Kopi & Teh <b> "x" 'y'`, '日本語 كوب', 'Normal'];
    const v: Visual = {
      id: 'x',
      kind: 'bars',
      title: 'T',
      unit: 'rupiah',
      orientation: 'vertical',
      categories: names,
      series: [{ label: 'Penjualan', values: [100_000, 200_000, 300_000] }],
    };
    const r = renderChart(v, 520, 190)!;
    // Well-formed: the markup of a name is escaped, never read as markup.
    expect(r.svg).not.toContain('<b>');
    expect(r.svg).not.toMatch(/&(?!amp;|lt;|gt;|quot;|#x?[0-9a-f]+;|apos;)/);
    const b = new PdfBuilder(meta);
    b.chart(v);
    const bytes = await b.finish();
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
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

  it('keeps a chart’s heading on the page of its chart, wherever the page break falls', async () => {
    const visual: Visual = {
      kind: 'bars',
      title: 'Judul diagram uji',
      unit: 'count',
      orientation: 'vertical',
      categories: ['Kolomsatu', 'Koloma dua', 'Kolomc tiga'],
      series: [{ label: 'Jumlah', values: [3, 5, 4] }],
    } as Visual;
    for (let filler = 14; filler <= 46; filler++) {
      const b = new PdfBuilder(meta);
      for (let i = 0; i < filler; i++) b.note(`Baris pengisi ${i}`);
      b.chart(visual);
      const { text } = pdfText(await b.finish());
      const pages = text.split(/-- \d+ of \d+ --/);
      const withTitle = pages.filter((p) => p.includes('Judul diagram uji'));
      expect(withTitle).toHaveLength(1);
      expect(withTitle[0]).toContain('Kolomsatu');
    }
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
