import { Logger } from '@nestjs/common';
import {
  PRIMARY,
  faceById,
  isPlain,
  isRtl,
  splitRuns,
  type Run,
  type Weight,
} from './fonts';
import { truncate } from './table-layout';

// The pdfkit side of the font fallback (UMK-2074): registers a face on first use, draws a string that spans
// several faces on one baseline, truncates it to a width, and takes chart labels that need another face out of the
// SVG so that pdfkit draws them (UMK-2117). The choice of face is `fonts.ts`.
//
// Limitations: each run is shaped on its own by fontkit (Arabic joins and mirrors inside a run). A single-line
// string whose first non-Latin run is Arabic is drawn with its runs in reverse order, which is right for plain
// Arabic text with numbers or Latin words in it; nested directions and wrapped (multi-line) mixed text keep
// logical order, so a wrapped Arabic paragraph that also holds Latin words can read out of order.

const logger = new Logger('PdfFonts');
const warned = new Set<string>();

const PRIMARY_NAMES: Record<Weight, string> = {
  400: 'Body',
  600: 'Semi',
  700: 'Bold',
};

const unescapeText = (s: string) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, '&');

/**
 * The runs of a one-line string from left to right. A right-to-left string is drawn last run first; a left-to-right
 * run inside it keeps its letters in order but its edge spaces change sides, so `محفظة QRIS` reads `QRIS محفظة`.
 */
export function visualOrder(runs: Run[]): Run[] {
  if (!isRtl(runs)) return runs;
  return [...runs].reverse().map((r) => {
    if (r.rtl) return r;
    const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(r.text) as RegExpExecArray;
    return { ...r, text: `${m[3]}${m[2]}${m[1]}` };
  });
}

export class PdfFonts {
  private readonly names = new Map<string, string>();

  constructor(
    private readonly doc: PDFKit.PDFDocument,
    primaryFile: (weight: Weight) => string,
  ) {
    for (const w of [400, 600, 700] as const)
      doc.registerFont(PRIMARY_NAMES[w], primaryFile(w));
  }

  /** The pdfkit font name that draws `face` at `weight`; the primary face's when the file is missing or unreadable. */
  nameFor(faceId: string, weight: Weight): string {
    const primary = PRIMARY_NAMES[weight];
    if (faceId === PRIMARY) return primary;
    const key = `${faceId}-${weight}`;
    const known = this.names.get(key);
    if (known) return known;
    let name = primary;
    const file = faceById(faceId).file(weight);
    try {
      if (!file) throw new Error('no file');
      this.doc.registerFont(key, file);
      // Opens (and so validates) the file now, not in the middle of a table.
      this.doc.font(key);
      name = key;
    } catch {
      if (!warned.has(key)) {
        warned.add(key);
        logger.warn(`font ${key} unavailable, drawing with the primary face`);
      }
      this.doc.font(primary);
    }
    this.names.set(key, name);
    return name;
  }

  private use(faceId: string, weight: Weight): void {
    this.doc.font(this.nameFor(faceId, weight));
  }

  private measure(runs: Run[], weight: Weight): number {
    let w = 0;
    for (const r of runs) {
      this.use(r.face, weight);
      w += this.doc.widthOfString(r.text);
    }
    return w;
  }

  /** The width of a string at the current size, every run in its own face. */
  widthOfString(text: string, weight: Weight): number {
    return this.measure(splitRuns(text), weight);
  }

  /** Cap height and descent (positive, pt) of the primary face at the current size: one baseline for a row. */
  metrics(weight: Weight): {
    ascent: number;
    capHeight: number;
    descent: number;
  } {
    this.use(PRIMARY, weight);
    const f = (
      this.doc as unknown as {
        _font: { ascender: number; descender: number; capHeight: number };
        _fontSize: number;
      }
    )._font;
    const size = (this.doc as unknown as { _fontSize: number })._fontSize;
    return {
      ascent: (f.ascender / 1000) * size,
      capHeight: ((f.capHeight || f.ascender * 0.7) / 1000) * size,
      descent: (Math.abs(f.descender) / 1000) * size,
    };
  }

  /** `text`, cut to whole characters with an ellipsis when it is wider than `width` (measured with every face). */
  fit(text: string, width: number, weight: Weight): string {
    return truncate(text, width, (t) => this.widthOfString(t, weight));
  }

  /**
   * One line of text at an alphabetic `baseline`: every run, whatever its face, sits on the same baseline (each
   * Noto face has its own ascent, so drawing runs by their top puts Arabic low and Devanagari high). Never wraps:
   * with a `width` it is truncated with an ellipsis (unless `truncate` is false) and aligned in it. Leaves the
   * cursor where it was.
   */
  line(
    text: string,
    x: number,
    baseline: number,
    weight: Weight,
    opts: {
      width?: number;
      align?: 'left' | 'right' | 'center';
      truncate?: boolean;
    } = {},
  ): number {
    const d = this.doc;
    const { x: x0, y: y0 } = d;
    const shown =
      opts.width !== undefined && opts.truncate !== false
        ? this.fit(text, opts.width, weight)
        : text;
    const runs = splitRuns(shown);
    const total = this.measure(runs, weight);
    const room = (opts.width ?? total) - total;
    let cx =
      x +
      (opts.align === 'right' ? room : opts.align === 'center' ? room / 2 : 0);
    for (const r of visualOrder(runs)) {
      this.use(r.face, weight);
      d.text(r.text, cx, baseline, {
        lineBreak: false,
        baseline: 'alphabetic',
      });
      cx += d.widthOfString(r.text);
    }
    d.x = x0;
    d.y = y0;
    return total;
  }

  /**
   * `doc.text(text, x, y, opts)` for text that may need other faces. A one-line string (`lineBreak: false`) is
   * drawn by `line` on the primary face's baseline, truncated with an ellipsis when `ellipsis` is set; a wrapping
   * one is drawn as continued chunks, one font each. The cursor moves to the next line, as pdfkit's does.
   */
  text(
    text: string,
    x: number | undefined,
    y: number | undefined,
    opts: PDFKit.Mixins.TextOptions,
    weight: Weight,
  ): void {
    const d = this.doc;
    if (opts.lineBreak === false) {
      const x0 = x ?? d.x;
      const y0 = y ?? d.y;
      const { ascent } = this.metrics(weight);
      this.line(text, x0, y0 + ascent, weight, {
        width: opts.width,
        align: opts.align === 'justify' ? 'left' : opts.align,
        truncate: opts.ellipsis !== undefined && opts.ellipsis !== false,
      });
      this.use(PRIMARY, weight);
      d.x = x0;
      d.y = y0 + d.currentLineHeight(true);
      return;
    }
    const runs = splitRuns(text);
    if (runs.length <= 1) {
      this.use(runs[0]?.face ?? PRIMARY, weight);
      d.text(runs[0]?.text ?? text, x, y, opts);
      return;
    }
    runs.forEach((r, i) => {
      this.use(r.face, weight);
      d.text(r.text, i === 0 ? x : undefined, i === 0 ? y : undefined, {
        ...opts,
        continued: i < runs.length - 1,
      });
    });
  }

  /**
   * A chart's SVG split in two: the SVG with every `<text>` that needs a face other than the primary taken out,
   * and those labels, to be drawn by `line` over the picture. svg-to-pdfkit lays text out glyph by glyph, which
   * breaks Arabic joining and drops Thai marks (UMK-2117); pdfkit's own text path shapes them as the table does.
   * Latin labels stay in the SVG byte for byte.
   */
  chartLabels(svg: string): { svg: string; labels: ChartLabel[] } {
    const labels: ChartLabel[] = [];
    const out = svg.replace(
      /<text\b([^>]*)>((?:[^<]|<!-- -->)*)<\/text>/g,
      (all, attrs: string, body: string) => {
        const text = unescapeText(body.replace(/<!-- -->/g, ''));
        if (isPlain(splitRuns(text))) return all;
        const attr = (name: string) =>
          new RegExp(`\\s${name}="([^"]*)"`).exec(attrs)?.[1];
        const anchor = attr('text-anchor');
        labels.push({
          text,
          x: Number(attr('x') ?? 0),
          y: Number(attr('y') ?? 0),
          anchor: anchor === 'end' || anchor === 'middle' ? anchor : 'start',
          size: Number(attr('font-size') ?? 12),
          weight: Number(attr('font-weight') ?? 400) >= 600 ? 600 : 400,
          fill: attr('fill') ?? '#000000',
        });
        return '';
      },
    );
    return { svg: out, labels };
  }

  /** svg-to-pdfkit's `fontCallback`: the labels left in the SVG are primary text, drawn with the body face. */
  readonly fontCallback = (_family: string, bold: boolean): string =>
    PRIMARY_NAMES[bold ? 600 : 400];
}

export interface ChartLabel {
  text: string;
  /** SVG user units (CSS px) of the chart. */
  x: number;
  /** The alphabetic baseline, in SVG user units. */
  y: number;
  anchor: 'start' | 'middle' | 'end';
  size: number;
  weight: Weight;
  fill: string;
}
