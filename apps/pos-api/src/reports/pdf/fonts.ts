import { existsSync, readFileSync } from 'node:fs';

// Which font draws which character in a report PDF (UMK-2074). Be Vietnam Pro (latin) is the primary face; any
// character it lacks goes to a Noto Sans face for its script. Pure: it reads the packages' own `unicode.json`
// (the unicode-range of each subset file) and never touches pdfkit.

export const PRIMARY = 'primary';
export type Weight = 400 | 600 | 700;

type Range = readonly [number, number];

export interface Face {
  /** `primary`, or `<package>-<subset>` such as `noto-sans-cyrillic` or `noto-sans-sc-117`. */
  id: string;
  ranges: Range[];
  rtl: boolean;
  /** The woff of this subset at a weight, or undefined when the package does not ship it. */
  file(weight: Weight): string | undefined;
}

export interface Run {
  text: string;
  face: string;
  rtl: boolean;
}

const fontsource = (pkg: string, file: string): string =>
  require.resolve(`@fontsource/${pkg}/${file}`);

function readRanges(pkg: string): Record<string, Range[]> {
  try {
    const raw = JSON.parse(
      readFileSync(fontsource(pkg, 'unicode.json'), 'utf8'),
    ) as Record<string, string>;
    const out: Record<string, Range[]> = {};
    for (const [subset, list] of Object.entries(raw))
      out[subset] = list.split(',').map((r) => {
        const [lo, hi] = r.replace(/^U\+/i, '').split('-');
        return [parseInt(lo, 16), parseInt(hi ?? lo, 16)] as const;
      });
    return out;
  } catch {
    // A missing package leaves its characters to the primary face.
    return {};
  }
}

function faceFile(pkg: string, subset: string, weight: Weight) {
  try {
    const p = fontsource(pkg, `files/${pkg}-${subset}-${weight}-normal.woff`);
    return existsSync(p) ? p : undefined;
  } catch {
    return undefined;
  }
}

const make = (
  pkg: string,
  subset: string,
  ranges: Range[] | undefined,
  rtl = false,
): Face[] =>
  ranges
    ? [
        {
          id: `${pkg}-${subset.replace(/[[\]]/g, '')}`,
          ranges,
          rtl,
          file: (w) => faceFile(pkg, subset.replace(/[[\]]/g, ''), w),
        },
      ]
    : [];

interface Faces {
  primary: Face;
  fallbacks: Face[];
  byId: Map<string, Face>;
}

let loaded: Faces | undefined;

function faces(): Faces {
  if (loaded) return loaded;
  const bvp = readRanges('be-vietnam-pro');
  const primary: Face = {
    id: PRIMARY,
    // The subset the report has always used. If the package cannot be read, Latin-1 is still the primary's.
    ranges: bvp.latin ?? [[0, 0xff]],
    rtl: false,
    file: (w) => faceFile('be-vietnam-pro', 'latin', w),
  };
  const noto = readRanges('noto-sans');
  const arabic = readRanges('noto-sans-arabic');
  const thai = readRanges('noto-sans-thai');
  const deva = readRanges('noto-sans-devanagari');
  const sc = readRanges('noto-sans-sc');
  const fallbacks: Face[] = [
    ...[
      'cyrillic',
      'cyrillic-ext',
      'greek',
      'greek-ext',
      'latin-ext',
      'vietnamese',
    ].flatMap((s) => make('noto-sans', s, noto[s])),
    ...make('noto-sans-arabic', 'arabic', arabic.arabic, true),
    ...make('noto-sans-thai', 'thai', thai.thai),
    ...make('noto-sans-devanagari', 'devanagari', deva.devanagari),
    // Last, so the alphabets above win the characters they share: Noto Sans SC's numbered slices (Han, kana,
    // Hangul); its named subsets (latin, cyrillic ...) hold characters the faces above already own.
    ...Object.keys(sc)
      .filter((k) => k.startsWith('['))
      .flatMap((k) => make('noto-sans-sc', k, sc[k])),
  ];
  const byId = new Map([primary, ...fallbacks].map((f) => [f.id, f]));
  return (loaded = { primary, fallbacks, byId });
}

const inRanges = (ranges: Range[], cp: number): boolean =>
  ranges.some(([lo, hi]) => cp >= lo && cp <= hi);

const cache = new Map<number, Face>();

/** The face that draws a code point: the primary when it has it, else the first fallback whose range holds it. */
export function faceOf(cp: number): Face {
  const { primary, fallbacks } = faces();
  if (cp < 0x80) return primary;
  let face = cache.get(cp);
  if (!face) {
    face = inRanges(primary.ranges, cp)
      ? primary
      : (fallbacks.find((f) => inRanges(f.ranges, cp)) ?? primary);
    cache.set(cp, face);
  }
  return face;
}

export const faceById = (id: string): Face => {
  const f = faces();
  return f.byId.get(id) ?? f.primary;
};

const MARK = /^[\p{M}‌‍]$/u;

/**
 * Cuts a string into runs of one face each, in logical order. Digits, spaces and punctuation belong to the
 * primary face (so Latin text, with or without numbers, is a single run); a combining mark stays with the
 * character before it when that face covers it.
 */
export function splitRuns(input: string): Run[] {
  const runs: Run[] = [];
  let last: Face | undefined;
  for (const ch of input.normalize('NFC')) {
    const cp = ch.codePointAt(0) as number;
    let face = faceOf(cp);
    if (last && face !== last && MARK.test(ch) && inRanges(last.ranges, cp))
      face = last;
    const tail = runs[runs.length - 1];
    if (tail && last === face) tail.text += ch;
    else runs.push({ text: ch, face: face.id, rtl: face.rtl });
    last = face;
  }
  return runs;
}

/** True when the first run that is not primary text is right to left: such a string is drawn right to left. */
export const isRtl = (runs: Run[]): boolean =>
  (runs.find((r) => r.face !== PRIMARY) ?? runs[0])?.rtl ?? false;

/** Only the primary face is needed: nothing to rewrite, today's drawing code applies as it is. */
export const isPlain = (runs: Run[]): boolean =>
  runs.length === 0 || (runs.length === 1 && runs[0].face === PRIMARY);
