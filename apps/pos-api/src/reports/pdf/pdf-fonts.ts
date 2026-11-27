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

// The pdfkit side of the font fallback (UMK-2074): registers a face on first use, draws a string that spans
// several faces, and prepares chart labels for svg-to-pdfkit. The choice of face is `fonts.ts`.
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

/** The font-family a chart `<tspan>` carries so that the `fontCallback` can find its face again. */
const FAMILY_PREFIX = 'uf-';

const unescapeText = (s: string) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, '&');
const escapeText = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

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

  /**
   * `doc.text(text, x, y, opts)` for text that may need other faces. Latin text takes the very same pdfkit call
   * as before. A one-line string (`lineBreak: false`) is laid out here, with `align` and `ellipsis`; a wrapping one
   * is drawn as continued chunks, one font each.
   */
  text(
    text: string,
    x: number | undefined,
    y: number | undefined,
    opts: PDFKit.Mixins.TextOptions,
    weight: Weight,
  ): void {
    const d = this.doc;
    const runs = splitRuns(text);
    if (runs.length <= 1) {
      this.use(runs[0]?.face ?? PRIMARY, weight);
      d.text(runs[0]?.text ?? text, x, y, opts);
      return;
    }
    if (opts.lineBreak !== false) {
      runs.forEach((r, i) => {
        this.use(r.face, weight);
        d.text(r.text, i === 0 ? x : undefined, i === 0 ? y : undefined, {
          ...opts,
          continued: i < runs.length - 1,
        });
      });
      return;
    }
    const x0 = x ?? d.x;
    const y0 = y ?? d.y;
    let shown = runs;
    let total = this.measure(shown, weight);
    if (opts.width !== undefined && total > opts.width && opts.ellipsis) {
      const cps = [...text.normalize('NFC')];
      const fit = (n: number) => splitRuns(cps.slice(0, n).join('') + '…');
      let lo = 0;
      let hi = cps.length;
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        if (this.measure(fit(mid), weight) <= opts.width) lo = mid;
        else hi = mid - 1;
      }
      shown = fit(lo);
      total = this.measure(shown, weight);
    }
    const room = (opts.width ?? total) - total;
    let cx =
      x0 +
      (opts.align === 'right' ? room : opts.align === 'center' ? room / 2 : 0);
    for (const r of isRtl(shown) ? [...shown].reverse() : shown) {
      this.use(r.face, weight);
      d.text(r.text, cx, y0, { lineBreak: false });
      cx += d.widthOfString(r.text);
    }
    d.x = x0;
    d.y = y0 + d.currentLineHeight(true);
  }

  /**
   * The chart's SVG with each `<text>` that needs another face cut into `<tspan font-family="uf-<face>">`, one per
   * run. Text a single primary run can draw is left byte for byte as it was.
   */
  svg(svg: string): string {
    return svg.replace(
      /<text\b([^>]*)>((?:[^<]|<!-- -->)*)<\/text>/g,
      (all, attrs: string, body: string) => {
        const runs = splitRuns(unescapeText(body.replace(/<!-- -->/g, '')));
        if (isPlain(runs)) return all;
        const spans = runs
          .map(
            (r) =>
              `<tspan font-family="${FAMILY_PREFIX}${r.face}">${escapeText(r.text)}</tspan>`,
          )
          .join('');
        return `<text${attrs}>${spans}</text>`;
      },
    );
  }

  /** svg-to-pdfkit's `fontCallback`: the face a `<tspan>` named, else the body font. */
  readonly fontCallback = (family: string, bold: boolean): string => {
    const weight: Weight = bold ? 600 : 400;
    const m = new RegExp(`${FAMILY_PREFIX}([a-z0-9-]+)`).exec(family ?? '');
    return this.nameFor(m ? m[1] : PRIMARY, weight);
  };
}
