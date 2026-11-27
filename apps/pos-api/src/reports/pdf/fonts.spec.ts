import { PRIMARY, faceById, isPlain, isRtl, splitRuns } from './fonts';
import * as fontsModule from './fonts';
import { PdfFonts } from './pdf-fonts';

// UMK-2074: which face draws which part of a name. Face ids are `<package>-<subset>`.
const faces = (text: string): Array<[string, string]> =>
  splitRuns(text).map((r) => [r.text, r.face]);
const NOTO = 'noto-sans';

describe('splitRuns', () => {
  it('keeps Latin text, digits and punctuation in one primary run', () => {
    expect(faces('Kopi Susu 250 ml, es (dingin)!')).toEqual([
      ['Kopi Susu 250 ml, es (dingin)!', PRIMARY],
    ]);
    expect(isPlain(splitRuns('Kopi'))).toBe(true);
    expect(isPlain(splitRuns(''))).toBe(true);
  });

  it('keeps accents the primary face has, and sends the rest of Latin-extended to Noto Sans', () => {
    expect(faces('Café Ñandú')).toEqual([['Café Ñandú', PRIMARY]]);
    expect(faces('Ayşe')).toEqual([
      ['Ay', PRIMARY],
      ['ş', `${NOTO}-latin-ext`],
      ['e', PRIMARY],
    ]);
    // Vietnamese letters outside Latin-1.
    expect(faces('Phở')[1]).toEqual(['ở', expect.stringContaining(NOTO)]);
  });

  it('composes a letter and its combining accent before choosing', () => {
    expect(faces('Café')).toEqual([['Café', PRIMARY]]);
  });

  it.each([
    ['Кофе с молоком', `${NOTO}-cyrillic`],
    ['Καφές', `${NOTO}-greek`],
    ['قهوة', 'noto-sans-arabic-arabic'],
    ['ชาไทย', 'noto-sans-thai-thai'],
    ['चाय', 'noto-sans-devanagari-devanagari'],
  ])('draws %s with %s', (text, face) => {
    const runs = splitRuns(text);
    expect(runs[0].face).toBe(face);
    expect(runs.every((r) => r.face === face || r.face === PRIMARY)).toBe(true);
    expect(runs.map((r) => r.text).join('')).toBe(text.normalize('NFC'));
  });

  it('draws Chinese, kana and Hangul from Noto Sans SC slices (Hangul glyphs are not in them, see the plan)', () => {
    for (const text of ['北京', 'こんにちは', 'コーヒー', '한국']) {
      const runs = splitRuns(text);
      expect(runs.length).toBeGreaterThan(0);
      for (const r of runs) expect(r.face).toMatch(/^noto-sans-sc-\d+$/);
    }
  });

  it('cuts a mixed name at the script boundary, spaces staying with the Latin side', () => {
    expect(faces('Toko 北京 Jaya')).toEqual([
      ['Toko ', PRIMARY],
      ['北京', expect.stringMatching(/^noto-sans-sc-/)],
      [' Jaya', PRIMARY],
    ]);
  });

  it('keeps digits and punctuation of Arabic and Cyrillic text in the run they stand in', () => {
    const r = splitRuns('قهوة ١٢');
    expect(r.map((x) => x.text).join('')).toBe('قهوة ١٢');
    expect(r[0].face).toBe('noto-sans-arabic-arabic');
    expect(faces('Кофе 24')).toEqual([
      ['Кофе', `${NOTO}-cyrillic`],
      [' 24', PRIMARY],
    ]);
  });

  it('keeps a combining mark with the character before it', () => {
    // Thai tone mark and Devanagari vowel sign stay with their own script's run.
    expect(faces('ก้')).toEqual([['ก้', 'noto-sans-thai-thai']]);
    expect(faces('कि')).toEqual([['कि', 'noto-sans-devanagari-devanagari']]);
  });

  it('marks a string whose first foreign run is Arabic as right to left', () => {
    expect(isRtl(splitRuns('قهوة عربية'))).toBe(true);
    expect(isRtl(splitRuns('Toko 北京'))).toBe(false);
    expect(isRtl(splitRuns('Kopi'))).toBe(false);
    expect(faceById('noto-sans-arabic-arabic').rtl).toBe(true);
  });

  it('gives a face for every fallback id it hands out, with the three report weights on disk', () => {
    for (const r of splitRuns('Ayşe Кофе Καφές قهوة ชา चाय 北京')) {
      const f = faceById(r.face);
      for (const w of [400, 600, 700] as const) expect(f.file(w)).toBeDefined();
    }
  });
});

describe('PdfFonts', () => {
  const doc = () => {
    const calls: string[] = [];
    return {
      calls,
      registerFont: (n: string) => calls.push(`reg ${n}`),
      font: (n: string) => {
        if (n.includes('broken')) throw new Error('unreadable');
        calls.push(`font ${n}`);
      },
    };
  };

  it('falls back to the primary face when a font file is missing, without failing', () => {
    const d = doc();
    const fonts = new PdfFonts(d as never, () => 'primary.woff');
    const face = faceById('noto-sans-cyrillic');
    const spy = jest.spyOn(face, 'file').mockReturnValue(undefined);
    expect(fonts.nameFor(face.id, 600)).toBe('Semi');
    expect(fonts.nameFor(face.id, 600)).toBe('Semi');
    spy.mockRestore();
    expect(fonts.nameFor(face.id, 400)).toBe(`${face.id}-400`);
  });

  it('falls back to the primary face when the file cannot be opened', () => {
    const fonts = new PdfFonts(doc() as never, () => 'primary.woff');
    // The stub's font() throws for a name holding "broken".
    const spy = jest.spyOn(fontsModule, 'faceById').mockReturnValue({
      ...faceById('noto-sans-greek'),
      id: 'broken-face',
      file: () => '/nope/x.woff',
    });
    expect(fonts.nameFor('broken-face', 700)).toBe('Bold');
    spy.mockRestore();
  });

  it('cuts chart labels into per-face tspans and leaves Latin labels untouched', () => {
    const fonts = new PdfFonts(doc() as never, () => 'primary.woff');
    const latin = '<text x="1" y="2">Es &amp; Teh</text>';
    expect(fonts.svg(latin)).toBe(latin);
    const out = fonts.svg('<text x="1">Toko 北京 &lt;b&gt;</text><rect/>');
    expect(out).toContain('<tspan font-family="uf-primary">Toko </tspan>');
    expect(out).toMatch(
      /<tspan font-family="uf-noto-sans-sc-\d+">北京<\/tspan>/,
    );
    expect(out).toContain('<tspan font-family="uf-primary"> &lt;b&gt;</tspan>');
    expect(out.endsWith('<rect/>')).toBe(true);
    expect(fonts.fontCallback('uf-primary', true)).toBe('Semi');
    expect(fonts.fontCallback('sans-serif', false)).toBe('Body');
    expect(fonts.fontCallback('uf-noto-sans-cyrillic', false)).toBe(
      'noto-sans-cyrillic-400',
    );
  });
});
