import PDFDocument from 'pdfkit';
import SVGtoPDF from 'svg-to-pdfkit';
import type { Visual } from '../visuals/types';
import { visualIsEmpty } from '../visuals/types';
import { renderChart } from './chart-render';
import { int, rp } from './format';
import { PdfFonts } from './pdf-fonts';
import type { Weight } from './fonts';
import {
  layoutColumns,
  type ColumnKind,
  type LayoutColumn,
} from './table-layout';

// A4 report layout on pdfkit (UMK-1924 design features 37 and 38, owner ruling 2026-11-26: the PDF is made on the
// server). Pure Node, no browser. The charts are the screen's own components (`chart-render.ts`).

// Be Vietnam Pro latin is the face of the report; a name in another script is drawn with a Noto Sans face for it
// (`fonts.ts`, `pdf-fonts.ts`, UMK-2074).
const font = (weight: Weight): string =>
  require.resolve(
    `@fontsource/be-vietnam-pro/files/be-vietnam-pro-latin-${weight}-normal.woff`,
  );

const INK = '#042648';
const MUTED = '#4c6178';
const LINE = '#c3cbd3';
const WASH = '#f0f7ff';
const BRAND = '#0074e7';
/** A page that grows past this many pages is refused, not truncated: a report that long is a CSV. */
export const MAX_PAGES = 60;

export class PdfTooLargeError extends Error {}

export interface TableColumn {
  label: string;
  /** Relative share of the room left once every column has what it needs (`table-layout.ts`). */
  weight: number;
  align?: 'left' | 'right';
  /** `number` is never truncated, `code` (SKU, date) is sized to its values, `text` takes the rest. Default: a
   * right-aligned column is a number, any other is text. */
  kind?: ColumnKind;
}
export interface TableSpec {
  title?: string;
  columns: TableColumn[];
  rows: string[][];
  /** Rows after the body, drawn bold (totals). */
  totals?: string[][];
}
export interface SummaryItem {
  label: string;
  value: string;
  /** Draws the value larger and in the brand colour. */
  strong?: boolean;
}

export interface PdfMeta {
  storeName: string;
  storeAddress?: string;
  title: string;
  /** "20 sampai 26 Nov 2026" */
  period: string;
  generatedAt: string;
  actorName: string;
}

export class PdfBuilder {
  private readonly doc: PDFKit.PDFDocument;
  private readonly fonts: PdfFonts;
  private readonly chunks: Buffer[] = [];
  private readonly left: number;
  private readonly width: number;
  private readonly headerH = 44;
  private readonly footerH = 36;

  constructor(
    private readonly meta: PdfMeta,
    opts: { landscape?: boolean } = {},
  ) {
    this.doc = new PDFDocument({
      size: 'A4',
      layout: opts.landscape ? 'landscape' : 'portrait',
      bufferPages: true,
      margins: {
        top: this.headerH + 22,
        bottom: this.footerH + 16,
        left: 40,
        right: 40,
      },
      info: {
        Title: meta.title,
        Author: 'UMKMall POS',
        Creator: 'UMKMall POS',
      },
      compress: true,
    });
    this.left = 40;
    this.width = this.doc.page.width - 80;
    this.fonts = new PdfFonts(this.doc, font);
    this.doc.on('data', (c: Buffer) => this.chunks.push(c));
    this.doc.font('Body').fontSize(9).fillColor(INK);
    this.titleBlock();
  }

  private get y(): number {
    return this.doc.y;
  }
  private get bottom(): number {
    return this.doc.page.height - this.doc.page.margins.bottom;
  }

  private ensure(height: number): void {
    if (this.y + height > this.bottom) this.page();
  }

  private page(): void {
    if (this.doc.bufferedPageRange().count >= MAX_PAGES)
      throw new PdfTooLargeError();
    this.doc.addPage();
  }

  private titleBlock(): void {
    const d = this.doc;
    d.font('Bold').fontSize(16).fillColor(INK);
    this.fonts.text(
      this.meta.title,
      this.left,
      d.y,
      { width: this.width },
      700,
    );
    d.font('Body').fontSize(9.5).fillColor(MUTED);
    this.fonts.text(
      this.meta.period,
      undefined,
      undefined,
      { width: this.width },
      400,
    );
    d.moveDown(0.8).fillColor(INK);
  }

  heading(text: string): void {
    this.ensure(40);
    this.doc.moveDown(0.6);
    this.doc.font('Bold').fontSize(11).fillColor(INK);
    this.fonts.text(text, this.left, this.y, { width: this.width }, 700);
    this.doc.moveDown(0.3);
    this.doc.font('Body').fontSize(9);
  }

  note(text: string): void {
    this.ensure(24);
    this.doc.font('Body').fontSize(8).fillColor(MUTED);
    this.fonts.text(text, this.left, this.y, { width: this.width }, 400);
    this.doc.fillColor(INK).moveDown(0.4);
  }

  /**
   * The total lines of a report as cards: up to four in a row on a landscape page, three on a portrait one, the rows
   * balanced and each row filling the full width, so an odd count leaves no hole. A value is never cut (it steps
   * down in size if it must); a label is truncated with an ellipsis.
   */
  summary(items: SummaryItem[]): void {
    const d = this.doc;
    if (items.length === 0) return;
    const gap = 10;
    const h = 32;
    const perRow = this.width > 600 ? 4 : 3;
    const rows = Math.ceil(items.length / perRow);
    let i = 0;
    for (let r = 0; r < rows; r++) {
      const k =
        Math.floor(items.length / rows) + (r < items.length % rows ? 1 : 0);
      this.ensure(h + 6);
      const top = this.y;
      const col = (this.width - gap * (k - 1)) / k;
      items.slice(i, i + k).forEach((it, j) => {
        const x = this.left + j * (col + gap);
        const inner = col - 16;
        d.roundedRect(x, top, col, h, 5).fill(WASH);
        // A long label steps down a little before it is truncated.
        let labelSize = 7.5;
        d.fillColor(MUTED).fontSize(labelSize);
        while (
          labelSize > 6.5 &&
          this.fonts.widthOfString(it.label, 400) > inner
        )
          d.fontSize((labelSize -= 0.5));
        this.fonts.line(it.label, x + 8, top + 11, 400, { width: inner });
        let size = it.strong ? 12 : 10.5;
        d.fontSize(size);
        while (size > 6 && this.fonts.widthOfString(it.value, 700) > inner)
          d.fontSize((size -= 0.5));
        d.fillColor(it.strong ? BRAND : INK);
        this.fonts.line(it.value, x + 8, top + 26, 700, { truncate: false });
      });
      i += k;
      d.y = top + h + 6;
    }
    d.x = this.left;
    d.fillColor(INK).font('Body').fontSize(9);
  }

  /** A visual, drawn from the screen's chart component; an empty one says so in one line. */
  chart(visual: Visual): void {
    const d = this.doc;
    if (visualIsEmpty(visual)) {
      this.heading(visual.title);
      this.note('Belum ada data untuk diagram ini.');
      return;
    }
    // CSS px, drawn at 0.75 pt each: the chart's 12 px axis text becomes 9 pt. The chart, the bar of a mix and its
    // legend all span the content width.
    const w = this.width;
    const px = Math.floor(w / 0.75);
    const height =
      visual.kind === 'segments'
        ? 28
        : visual.orientation === 'horizontal'
          ? Math.min(380, visual.categories.length * 32 + 8)
          : 190;
    const r = renderChart(visual, px, height);
    // The heading stays with its chart: room for both, or a new page for both.
    // A chart the component drew wider than asked (many columns) is scaled down to the width, and so is its height.
    const scale = r ? Math.min(w / r.width, 0.75) : 0.75;
    const need = r
      ? r.height * scale +
        12 +
        (r.legend.length > 3 && visual.kind === 'segments'
          ? r.legend.length * 12
          : 18)
      : 24;
    this.ensure(need + 40);
    this.heading(visual.title);
    if (!r) {
      // The component shows one value as a figure, not a bar: the PDF says the same in words.
      const one =
        visual.kind === 'bars'
          ? `${visual.categories[0]}: ${visual.series.map((s) => (visual.unit === 'rupiah' ? rp(s.values[0]) : int(s.values[0]))).join(' · ')}`
          : '';
      this.note(one);
      return;
    }
    this.ensure(need);
    const top = this.y;
    const { svg, labels } = this.fonts.chartLabels(r.svg);
    SVGtoPDF(d, svg, this.left, top, {
      width: w,
      height: r.height * scale,
      preserveAspectRatio: 'xMinYMin meet',
      fontCallback: this.fonts.fontCallback,
      assumePt: false,
      // A chart never reads a file or the network: an <image> in it resolves to nothing.
      imageCallback: () => '',
    });
    // Labels in another script, drawn by pdfkit where the SVG would have put them (same scale as the picture).
    for (const l of labels) {
      d.fontSize(l.size * scale).fillColor(l.fill);
      const lw = this.fonts.widthOfString(l.text, l.weight);
      const x =
        this.left +
        l.x * scale -
        (l.anchor === 'end' ? lw : l.anchor === 'middle' ? lw / 2 : 0);
      this.fonts.line(l.text, x, top + l.y * scale, l.weight);
    }
    d.y = top + r.height * scale + 6;
    this.legend(r.legend, visual.kind === 'segments');
    d.x = this.left;
    d.fillColor(INK).font('Body').fontSize(9);
  }

  private legend(
    entries: Array<{
      label: string;
      value?: string;
      percent?: string;
      color: string;
    }>,
    rows: boolean,
  ): void {
    const d = this.doc;
    d.font('Body').fontSize(8);
    const { capHeight } = this.fonts.metrics(400);
    const lineH = 12;
    if (rows) {
      // Label, amount, share: the amounts and shares are as wide as their widest value and end where the bar ends.
      const gap = 16;
      const widest = (k: 'value' | 'percent') =>
        Math.max(
          0,
          ...entries.map((e) =>
            e[k] ? this.fonts.widthOfString(e[k], 400) : 0,
          ),
        );
      const pctW = widest('percent');
      const valW = widest('value');
      const right = this.left + this.width;
      const pctX = right - pctW;
      const valX = (pctW > 0 ? pctX - gap : right) - valW;
      const labelX = this.left + 14;
      const labelW = (valW > 0 ? valX - gap : pctX - gap) - labelX;
      for (const e of entries) {
        this.ensure(lineH);
        const top = this.y;
        const base = top + lineH / 2 + capHeight / 2;
        d.roundedRect(this.left, top + 2, 8, 8, 2).fill(e.color);
        d.fillColor(INK);
        this.fonts.line(e.label, labelX, base, 400, { width: labelW });
        if (e.value)
          this.fonts.line(e.value, valX, base, 400, {
            width: valW,
            align: 'right',
            truncate: false,
          });
        if (e.percent) {
          d.fillColor(MUTED);
          this.fonts.line(e.percent, pctX, base, 400, {
            width: pctW,
            align: 'right',
            truncate: false,
          });
        }
        d.y = top + lineH;
      }
      return;
    }
    this.ensure(lineH + 2);
    let top = this.y;
    let x = this.left;
    for (const e of entries) {
      const w = Math.min(
        this.fonts.widthOfString(e.label, 400),
        this.width - 12,
      );
      if (x > this.left && x + 12 + w > this.left + this.width) {
        // The next entry would leave the page width: a new legend line.
        top += lineH;
        x = this.left;
      }
      d.roundedRect(x, top + 2, 8, 8, 2).fill(e.color);
      d.fillColor(INK);
      this.fonts.line(e.label, x + 12, top + lineH / 2 + capHeight / 2, 400, {
        width: this.width - 12,
      });
      x += 12 + w + 10;
    }
    d.y = top + lineH + 2;
  }

  /**
   * A table, one line per cell (UMK-2117): widths from the content (`table-layout.ts`), numbers never cut, codes
   * and names truncated with an ellipsis, every cell on one baseline per row. The header repeats on every page, a
   * row is never split, the title stays with the header and the first rows.
   */
  table(spec: TableSpec): void {
    const d = this.doc;
    const pad = 12;
    const cols: LayoutColumn[] = spec.columns.map((c) => ({
      label: c.label,
      weight: c.weight,
      kind: c.kind ?? (c.align === 'right' ? 'number' : 'text'),
    }));
    const totals = spec.totals ?? [];
    const { widths, size } = layoutColumns(
      cols,
      [...spec.rows, ...totals],
      this.width,
      (t, sz, bold) => {
        d.fontSize(sz);
        return this.fonts.widthOfString(t, bold ? 600 : 400);
      },
      { pad, size: 7.5, minSize: 6, codeCapEm: 11, textMinEm: 9 },
      spec.rows.length,
    );
    const rowH = Math.max(12, size * 2);
    d.fontSize(size);
    const { capHeight } = this.fonts.metrics(400);
    const baseOf = (top: number) => top + rowH / 2 + capHeight / 2;
    const cells = (row: string[], top: number, weight: Weight) => {
      d.fontSize(size);
      let x = this.left;
      row.forEach((t, i) => {
        this.fonts.line(t, x + pad / 2, baseOf(top), weight, {
          width: widths[i] - pad,
          align: spec.columns[i]?.align ?? 'left',
          truncate: cols[i]?.kind !== 'number',
        });
        x += widths[i];
      });
    };
    const head = () => {
      const top = this.y;
      d.rect(this.left, top, this.width, rowH).fill(WASH);
      d.fillColor(MUTED);
      cells(
        spec.columns.map((c) => c.label),
        top,
        600,
      );
      d.y = top + rowH;
    };
    if (spec.title) {
      this.ensure(40 + rowH * 3);
      this.heading(spec.title);
    }
    this.ensure(rowH * 3);
    head();
    const drawRow = (row: string[], bold: boolean) => {
      if (this.y + rowH > this.bottom) {
        this.page();
        head();
      }
      const top = this.y;
      d.fillColor(INK);
      cells(row, top, bold ? 600 : 400);
      d.moveTo(this.left, top + rowH)
        .lineTo(this.left + this.width, top + rowH)
        .lineWidth(0.4)
        .stroke(LINE);
      d.y = top + rowH;
    };
    for (const r of spec.rows) drawRow(r, false);
    for (const r of totals) drawRow(r, true);
    d.fillColor(INK).font('Body').fontSize(9);
    d.y += 4;
    d.x = this.left;
  }

  /** Header and footer of every page, then the bytes. */
  finish(): Promise<Buffer> {
    const d = this.doc;
    const range = d.bufferedPageRange();
    const w = d.page.width;
    for (let i = 0; i < range.count; i++) {
      d.switchToPage(range.start + i);
      // The header and footer sit in the margins: lift the bottom margin so writing there adds no page.
      d.page.margins.bottom = 0;
      d.font('Bold').fontSize(10).fillColor(INK);
      this.fonts.text(
        this.meta.storeName,
        this.left,
        28,
        { width: this.width * 0.6, lineBreak: false, ellipsis: true },
        700,
      );
      d.font('Body').fontSize(7.5).fillColor(MUTED);
      if (this.meta.storeAddress)
        this.fonts.text(
          this.meta.storeAddress,
          this.left,
          42,
          { width: this.width * 0.6, lineBreak: false, ellipsis: true },
          400,
        );
      this.fonts.text(
        this.meta.title,
        this.left + this.width * 0.55,
        31,
        {
          width: this.width * 0.45,
          align: 'right',
          lineBreak: false,
          ellipsis: true,
        },
        400,
      );
      d.moveTo(this.left, 58)
        .lineTo(w - this.left, 58)
        .lineWidth(0.6)
        .stroke(LINE);
      const fy = d.page.height - this.footerH + 6;
      d.moveTo(this.left, fy - 6)
        .lineTo(w - this.left, fy - 6)
        .lineWidth(0.6)
        .stroke(LINE);
      d.font('Body').fontSize(7.5).fillColor(MUTED);
      this.fonts.text(
        `Dicetak ${this.meta.generatedAt} oleh ${this.meta.actorName} · UMKMall POS`,
        this.left,
        fy,
        { width: this.width * 0.75, lineBreak: false, ellipsis: true },
        400,
      );
      this.fonts.text(
        `Halaman ${i + 1} dari ${range.count}`,
        this.left + this.width * 0.7,
        fy,
        { width: this.width * 0.3, align: 'right', lineBreak: false },
        400,
      );
    }
    return new Promise((resolve, reject) => {
      d.on('end', () => resolve(Buffer.concat(this.chunks)));
      d.on('error', reject);
      d.end();
    });
  }
}
