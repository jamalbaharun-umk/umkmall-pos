import PDFDocument from 'pdfkit';
import SVGtoPDF from 'svg-to-pdfkit';
import type { Visual } from '../visuals/types';
import { visualIsEmpty } from '../visuals/types';
import { renderChart } from './chart-render';
import { int, rp } from './format';

// A4 report layout on pdfkit (UMK-1924 design features 37 and 38, owner ruling 2026-11-26: the PDF is made on the
// server). Pure Node, no browser. The charts are the screen's own components (`chart-render.ts`).

const font = (weight: 400 | 600 | 700): string =>
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
  /** Relative width. */
  weight: number;
  align?: 'left' | 'right';
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
    this.doc.registerFont('Body', font(400));
    this.doc.registerFont('Semi', font(600));
    this.doc.registerFont('Bold', font(700));
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
    d.font('Bold')
      .fontSize(16)
      .fillColor(INK)
      .text(this.meta.title, this.left, d.y, { width: this.width });
    d.font('Body')
      .fontSize(9.5)
      .fillColor(MUTED)
      .text(this.meta.period, { width: this.width });
    d.moveDown(0.8).fillColor(INK);
  }

  heading(text: string): void {
    this.ensure(40);
    this.doc.moveDown(0.6);
    this.doc
      .font('Bold')
      .fontSize(11)
      .fillColor(INK)
      .text(text, this.left, this.y, { width: this.width });
    this.doc.moveDown(0.3);
    this.doc.font('Body').fontSize(9);
  }

  note(text: string): void {
    this.ensure(24);
    this.doc
      .font('Body')
      .fontSize(8)
      .fillColor(MUTED)
      .text(text, this.left, this.y, { width: this.width });
    this.doc.fillColor(INK).moveDown(0.4);
  }

  /** Label and value pairs in rows of two columns, the total lines of a report. */
  summary(items: SummaryItem[]): void {
    const d = this.doc;
    const col = (this.width - 16) / 2;
    for (let i = 0; i < items.length; i += 2) {
      this.ensure(34);
      const top = this.y;
      items.slice(i, i + 2).forEach((it, k) => {
        const x = this.left + k * (col + 16);
        d.roundedRect(x, top, col, 30, 5).fill(WASH);
        d.fillColor(MUTED)
          .font('Body')
          .fontSize(7.5)
          .text(it.label, x + 8, top + 5, {
            width: col - 16,
            lineBreak: false,
            ellipsis: true,
          });
        d.fillColor(it.strong ? BRAND : INK)
          .font('Bold')
          .fontSize(it.strong ? 12 : 10.5)
          .text(it.value, x + 8, top + 15, {
            width: col - 16,
            lineBreak: false,
            ellipsis: true,
          });
      });
      d.y = top + 36;
    }
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
    // CSS px, drawn at 0.75 pt each: the chart's 12 px axis text becomes 9 pt.
    const w = Math.min(this.width, 560);
    const px = Math.floor(w / 0.75);
    const height =
      visual.kind === 'segments'
        ? 28
        : visual.orientation === 'horizontal'
          ? Math.min(380, visual.categories.length * 32 + 8)
          : 190;
    const r = renderChart(visual, px, height);
    // The heading stays with its chart: room for both, or a new page for both.
    const need = r
      ? r.height * 0.75 +
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
    SVGtoPDF(d, r.svg, this.left, top, {
      width: w,
      height: r.height * 0.75,
      preserveAspectRatio: 'xMinYMin meet',
      fontCallback: (_family: string, bold: boolean) =>
        bold ? 'Semi' : 'Body',
      assumePt: false,
      // A chart never reads a file or the network: an <image> in it resolves to nothing.
      imageCallback: () => '',
    });
    d.y = top + r.height * 0.75 + 6;
    this.legend(r.legend, visual.kind === 'segments');
    d.x = this.left;
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
    if (rows) {
      for (const e of entries) {
        this.ensure(12);
        const top = this.y;
        const lw = Math.min(this.width, 560);
        d.roundedRect(this.left, top + 1.5, 8, 8, 2).fill(e.color);
        d.fillColor(INK).text(e.label, this.left + 14, top, {
          width: lw * 0.5,
          lineBreak: false,
          ellipsis: true,
        });
        if (e.value)
          d.text(e.value, this.left + lw * 0.5, top, {
            width: lw * 0.34,
            align: 'right',
            lineBreak: false,
          });
        if (e.percent)
          d.fillColor(MUTED).text(e.percent, this.left + lw * 0.86, top, {
            width: lw * 0.14,
            align: 'right',
            lineBreak: false,
          });
        d.y = top + 12;
      }
      return;
    }
    this.ensure(14);
    const top = this.y;
    let x = this.left;
    for (const e of entries) {
      const w = d.widthOfString(e.label) + 22;
      d.roundedRect(x, top + 1.5, 8, 8, 2).fill(e.color);
      d.fillColor(INK).text(e.label, x + 12, top, { lineBreak: false });
      x += w;
    }
    d.y = top + 14;
  }

  table(spec: TableSpec): void {
    const d = this.doc;
    if (spec.title) this.heading(spec.title);
    const total = spec.columns.reduce((a, c) => a + c.weight, 0);
    const widths = spec.columns.map((c) => (c.weight / total) * this.width);
    const rowH = 15;
    const cell = (
      text: string,
      i: number,
      x: number,
      y: number,
      bold: boolean,
    ) => {
      d.font(bold ? 'Semi' : 'Body')
        .fontSize(7.5)
        .fillColor(INK);
      d.text(text, x + 4, y + 4, {
        width: widths[i] - 8,
        align: spec.columns[i].align ?? 'left',
        lineBreak: false,
        ellipsis: true,
      });
    };
    const head = () => {
      const top = this.y;
      d.rect(this.left, top, this.width, rowH).fill(WASH);
      let x = this.left;
      spec.columns.forEach((c, i) => {
        d.font('Semi')
          .fontSize(7.5)
          .fillColor(MUTED)
          .text(c.label, x + 4, top + 4, {
            width: widths[i] - 8,
            align: c.align ?? 'left',
            lineBreak: false,
            ellipsis: true,
          });
        x += widths[i];
      });
      d.y = top + rowH;
    };
    this.ensure(rowH * 3);
    head();
    const drawRow = (row: string[], bold: boolean) => {
      if (this.y + rowH > this.bottom) {
        this.page();
        head();
      }
      const top = this.y;
      let x = this.left;
      row.forEach((t, i) => {
        cell(t, i, x, top, bold);
        x += widths[i];
      });
      d.moveTo(this.left, top + rowH)
        .lineTo(this.left + this.width, top + rowH)
        .lineWidth(0.4)
        .stroke(LINE);
      d.y = top + rowH;
    };
    for (const r of spec.rows) drawRow(r, false);
    for (const r of spec.totals ?? []) drawRow(r, true);
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
      d.font('Bold')
        .fontSize(10)
        .fillColor(INK)
        .text(this.meta.storeName, this.left, 28, {
          width: this.width * 0.6,
          lineBreak: false,
          ellipsis: true,
        });
      d.font('Body').fontSize(7.5).fillColor(MUTED);
      if (this.meta.storeAddress)
        d.text(this.meta.storeAddress, this.left, 42, {
          width: this.width * 0.6,
          lineBreak: false,
          ellipsis: true,
        });
      d.text(this.meta.title, this.left + this.width * 0.55, 31, {
        width: this.width * 0.45,
        align: 'right',
        lineBreak: false,
        ellipsis: true,
      });
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
      d.text(
        `Dicetak ${this.meta.generatedAt} oleh ${this.meta.actorName} · UMKMall POS`,
        this.left,
        fy,
        { width: this.width * 0.75, lineBreak: false, ellipsis: true },
      );
      d.text(
        `Halaman ${i + 1} dari ${range.count}`,
        this.left + this.width * 0.7,
        fy,
        { width: this.width * 0.3, align: 'right', lineBreak: false },
      );
    }
    return new Promise((resolve, reject) => {
      d.on('end', () => resolve(Buffer.concat(this.chunks)));
      d.on('error', reject);
      d.end();
    });
  }
}
