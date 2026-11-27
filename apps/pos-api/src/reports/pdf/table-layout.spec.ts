import PDFDocument from 'pdfkit';
import { PdfBuilder } from './pdf-document';
import { PdfFonts, visualOrder } from './pdf-fonts';
import { splitRuns, type Weight } from './fonts';
import { layoutColumns, truncate, type LayoutColumn } from './table-layout';

// UMK-2117: report tables keep every cell on one line inside its column.

/** A monospace stand-in: every character is half the font size wide, the header a little wider. */
const mono = (t: string, size: number, bold: boolean) =>
  [...t].length * size * (bold ? 0.55 : 0.5);

const col = (
  label: string,
  kind: LayoutColumn['kind'],
  weight = 1,
): LayoutColumn => ({ label, kind, weight });

describe('layoutColumns', () => {
  const cols = [
    col('SKU', 'code', 1.3),
    col('Produk', 'text', 3),
    col('Qty', 'number', 0.8),
    col('Jumlah', 'number', 1.6),
  ];
  const rows = [
    ['SEM-TEH-0001', 'Teh Botol', '3', 'Rp15.000'],
    [
      'ELK-TV-65-4K-UHD-SMART-GARANSI-5TH-0001',
      'Televisi LED Pintar 65 Inci Resolusi 4K Ultra HD dengan Garansi Resmi Lima Tahun',
      '1',
      '−Rp123.456.789',
    ],
  ];
  const opts = { pad: 8, size: 7.5, minSize: 6 };

  it('gives a number column at least its widest value, never more than the page in all', () => {
    const { widths, size } = layoutColumns(cols, rows, 300, mono, opts);
    expect(size).toBe(7.5);
    expect(widths.reduce((a, b) => a + b, 0)).toBeCloseTo(300, 6);
    expect(widths[3]).toBeGreaterThanOrEqual(
      mono('−Rp123.456.789', 7.5, false) + 8,
    );
    expect(widths[2]).toBeGreaterThanOrEqual(mono('Qty', 7.5, true) + 8);
  });

  it('caps a code column, and gives the name what is left (at least its minimum)', () => {
    const { widths } = layoutColumns(cols, rows, 300, mono, opts);
    expect(widths[0]).toBeLessThanOrEqual(14 * 7.5 + 8 + 1e-6);
    expect(widths[1]).toBeGreaterThanOrEqual(8 * 7.5 + 8 - 1e-6);
    // A short code is not padded out to the cap when the page is narrow.
    const short = layoutColumns(cols, [rows[0]], 200, mono, opts);
    expect(short.widths[0]).toBeLessThan(14 * 7.5);
  });

  it('keeps the proportions of a roomy table once every column has what it wants', () => {
    const { widths } = layoutColumns(cols, [rows[0]], 1000, mono, opts);
    expect(widths.reduce((a, b) => a + b, 0)).toBeCloseTo(1000, 6);
    expect(widths[1]).toBeGreaterThan(widths[0]);
    expect(widths[3]).toBeGreaterThan(widths[2]);
  });

  it('steps the font down when the numbers do not fit at the normal size', () => {
    const money = Array.from({ length: 8 }, (_, i) =>
      col(`Kas ${i}`, 'number'),
    );
    const row = money.map(() => 'Rp123.456.789');
    const { widths, size } = layoutColumns(money, [row], 400, mono, opts);
    expect(size).toBeLessThan(7.5);
    for (const w of widths)
      expect(w).toBeGreaterThanOrEqual(
        mono('Rp123.456.789', size, false) + 8 - 1e-6,
      );
  });

  it('measures totals rows in the bold face', () => {
    const c = [col('A', 'number')];
    const plain = layoutColumns(c, [['Rp1.000.000']], 500, mono, opts, 1);
    const bold = layoutColumns(c, [['Rp1.000.000']], 500, mono, opts, 0);
    expect(plain.widths[0]).toBe(500);
    expect(bold.widths[0]).toBe(500);
    const tight = (from: number) =>
      layoutColumns(
        [c[0], col('B', 'text')],
        [['Rp1.000.000', 'x'.repeat(200)]],
        200,
        mono,
        opts,
        from,
      ).widths[0];
    expect(tight(0)).toBeGreaterThan(tight(1));
  });
});

describe('truncate', () => {
  const w = (t: string) => [...t].length * 5;

  it('leaves a string that fits, and cuts one that does not with an ellipsis within the width', () => {
    expect(truncate('Teh Botol', 100, w)).toBe('Teh Botol');
    const out = truncate('Televisi LED Pintar 65 Inci', 60, w);
    expect(out.endsWith('…')).toBe(true);
    expect(w(out)).toBeLessThanOrEqual(60);
    expect('Televisi LED Pintar 65 Inci'.startsWith(out.slice(0, -1))).toBe(
      true,
    );
  });

  it('keeps a value in a column exactly its width, floating point notwithstanding', () => {
    // 0.1 + 0.2 > 0.3 in floating point: the widest value of a column must still fit it.
    expect(truncate('2026-11-27 21:13', 0.3, () => 0.1 + 0.2)).toBe(
      '2026-11-27 21:13',
    );
  });

  it('never splits a Thai or Devanagari mark from its letter', () => {
    for (const s of ['ชาไทย เย็น', 'मसाला चाय']) {
      for (let width = 5; width <= 60; width += 5) {
        const out = truncate(s, width, w);
        const kept = out.replace(/…$/, '');
        expect(/^\p{M}/u.test(s.slice(kept.length))).toBe(false);
      }
    }
  });
});

describe('PdfFonts with the real faces', () => {
  const fonts = () => {
    const doc = new PDFDocument({ size: 'A4' });
    const f = new PdfFonts(doc, (wt: Weight) =>
      require.resolve(
        `@fontsource/be-vietnam-pro/files/be-vietnam-pro-latin-${wt}-normal.woff`,
      ),
    );
    doc.fontSize(7.5);
    return f;
  };

  it('truncates a mixed-script name to the width, measured with every face it uses', () => {
    const f = fonts();
    for (const name of [
      'Televisi LED Pintar 65 Inci Resolusi 4K Ultra HD dengan Garansi',
      'قهوة عربية ممتازة من اليمن مع الهيل والزعفران الطبيعي',
      'ชาไทย เย็น สูตรต้นตำรับ หวานน้อย ใส่นมข้นจืด',
      'Toko 北京烤鸭 Jaya Кофе с молоком मसाला चाय',
    ]) {
      const out = f.fit(name, 60, 400);
      expect([name, out.endsWith('…')]).toEqual([name, true]);
      expect(f.widthOfString(out, 400)).toBeLessThanOrEqual(60);
    }
    expect(f.fit('Rp123.456.789', 200, 400)).toBe('Rp123.456.789');
  });

  it('draws a right-to-left string last run first, its spaces on the other side', () => {
    expect(visualOrder(splitRuns('محفظة QRIS')).map((r) => r.text)).toEqual([
      'QRIS ',
      'محفظة',
    ]);
    expect(visualOrder(splitRuns('Teh 北京')).map((r) => r.text)).toEqual([
      'Teh ',
      '北京',
    ]);
  });
});

describe('PdfBuilder.table geometry (guard)', () => {
  interface Drawn {
    text: string;
    x: number;
    y: number;
    w: number;
    baseline?: unknown;
  }
  /** Every text fragment the table draws, with where it lands and how wide it is in its own face. */
  function record(b: PdfBuilder): Drawn[] {
    const doc = (b as unknown as { doc: PDFKit.PDFDocument }).doc;
    const out: Drawn[] = [];
    const orig: (...a: unknown[]) => PDFKit.PDFDocument = doc.text.bind(doc);
    (doc as unknown as { text: unknown }).text = (
      text: string,
      x: number,
      y: number,
      o: PDFKit.Mixins.TextOptions & { baseline?: unknown },
    ) => {
      out.push({
        text,
        x,
        y,
        w: doc.widthOfString(text),
        baseline: o?.baseline,
      });
      return orig(text, x, y, o);
    };
    return out;
  }

  const meta = {
    storeName: 'Warung',
    title: 'Laporan uji',
    period: '1 Nov 2026',
    generatedAt: '2 Nov 2026, 10.00',
    actorName: 'Rina',
  };
  const amounts = ['Rp123.456.789', '−Rp246.913.578', 'Rp5.000'];

  it('keeps every cell on its row’s one baseline, inside the table, never over its neighbour, and money whole', () => {
    const b = new PdfBuilder(meta);
    const drawn = record(b);
    const rows = Array.from({ length: 70 }, (_, i) => [
      i % 2 ? 'SEM-TEH-0001' : 'ELK-TV-65-4K-UHD-SMART-GARANSI-5TH-0001',
      i % 3 === 0
        ? 'قهوة عربية ممتازة من اليمن مع الهيل والزعفران الطبيعي'
        : 'Televisi LED Pintar 65 Inci Resolusi 4K Ultra HD dengan Garansi Resmi',
      String(i),
      amounts[i % 3],
      amounts[(i + 1) % 3],
    ]);
    b.table({
      columns: [
        { label: 'SKU', weight: 1.4, kind: 'code' },
        { label: 'Produk', weight: 3 },
        { label: 'Qty', weight: 0.8, align: 'right' },
        { label: 'Harga', weight: 1.5, align: 'right' },
        { label: 'Jumlah', weight: 1.6, align: 'right' },
      ],
      rows,
    });
    const left = 40;
    const right = 595.28 - 40;
    // Two pages: the header twice.
    const lines = new Map<string, Drawn[]>();
    let page = 0;
    let lastY = -1;
    for (const d of drawn) {
      if (d.y < lastY - 100) page++;
      lastY = d.y;
      const key = `${page}:${d.y.toFixed(3)}`;
      lines.set(key, [...(lines.get(key) ?? []), d]);
    }
    expect(lines.size).toBe(rows.length + 2);
    for (const [key, frags] of lines) {
      const sorted = [...frags].sort((a, z) => a.x - z.x);
      sorted.forEach((f, i) => {
        expect([
          key,
          f.text,
          f.x >= left - 0.01,
          f.x + f.w <= right + 0.01,
        ]).toEqual([key, f.text, true, true]);
        expect(f.baseline).toBe('alphabetic');
        if (i > 0) {
          const prev = sorted[i - 1];
          // Runs of one cell touch; cells never overlap.
          expect([
            key,
            prev.text,
            f.text,
            prev.x + prev.w <= f.x + 0.01,
          ]).toEqual([key, prev.text, f.text, true]);
        }
      });
    }
    const texts = drawn.map((d) => d.text);
    for (const a of amounts) expect(texts).toContain(a);
    expect(texts).toContain('SEM-TEH-0001');
    expect(texts.some((t) => t.endsWith('…'))).toBe(true);
  });
});
