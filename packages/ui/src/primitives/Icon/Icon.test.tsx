import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Play, ThumbsDown, ThumbsUp, Volume2 } from 'lucide-react';
import { Icon } from './Icon';
import { ICON_NAMES, ICON_REGISTRY } from './registry';

const svg = (testId = 'i') => screen.getByTestId(testId);

describe('Icon renders either glyph source identically', () => {
  it('renders an svg for every registered name', () => {
    for (const name of ICON_NAMES) {
      const { unmount } = render(<Icon name={name} data-testid="i" />);
      expect(svg().tagName.toLowerCase(), name).toBe('svg');
      unmount();
    }
  });

  it('gives a lucide-backed and a house name the same shape', () => {
    render(
      <>
        <Icon name="chevron-down" data-testid="lucide" className="h-4 w-4" />
        <Icon name="credit-coin" data-testid="house" className="h-4 w-4" />
      </>,
    );
    for (const id of ['lucide', 'house']) {
      expect(svg(id).tagName.toLowerCase()).toBe('svg');
      expect(svg(id).getAttribute('class')).toContain('h-4 w-4');
      expect(svg(id).getAttribute('aria-hidden')).toBe('true');
    }
  });

  it('has no duplicate names', () => {
    expect(new Set(ICON_NAMES).size).toBe(ICON_NAMES.length);
  });

  it('throws on an unknown name rather than rendering nothing', () => {
    // @ts-expect-error the union rejects this at compile time; the throw is for JS callers,
    // config tables and `as IconName` casts, where rendering nothing leaves a silent hole.
    expect(() => render(<Icon name="not-a-real-icon" />)).toThrow(/unknown name/);
  });
});

describe('Icon passes through what call sites actually use', () => {
  it('passes an interpolated className through unmodified', () => {
    const tone = 'text-blue-500';
    render(<Icon name="x" data-testid="i" className={`h-5 w-5 ${tone} shrink-0`} />);
    const cls = svg().getAttribute('class') ?? '';
    expect(cls).toContain('text-blue-500');
    expect(cls).toContain('shrink-0');
  });

  /** ChatInputArea's stop button: strokeWidth 0 + fill-white turns Square into a solid stop. */
  it('keeps strokeWidth={0} with a fill class', () => {
    render(<Icon name="square" data-testid="i" strokeWidth={0} className="h-4 w-4 fill-white" />);
    expect(svg().getAttribute('stroke-width')).toBe('0');
    expect(svg().getAttribute('class')).toContain('fill-white');
  });

  it('renders fill exactly as passed', () => {
    render(<Icon name="square" data-testid="i" fill="currentColor" />);
    expect(svg().getAttribute('fill')).toBe('currentColor');
  });
});

describe('Icon accessibility', () => {
  it('is decorative by default', () => {
    render(<Icon name="check" data-testid="i" />);
    expect(svg().getAttribute('aria-hidden')).toBe('true');
    expect(svg().getAttribute('role')).toBeNull();
  });

  it('opts into role=img when given an aria-label', () => {
    render(<Icon name="check" data-testid="i" aria-label="Selesai" />);
    expect(svg().getAttribute('role')).toBe('img');
    expect(svg().getAttribute('aria-label')).toBe('Selesai');
    expect(svg().getAttribute('aria-hidden')).toBeNull();
  });

  it('lets a house glyph take an aria-label too', () => {
    render(<Icon name="whatsapp" data-testid="i" aria-label="WhatsApp" />);
    expect(svg().getAttribute('role')).toBe('img');
    expect(svg().getAttribute('aria-hidden')).toBeNull();
  });
});

describe('Icon colour axis', () => {
  it('applies a token colour class', () => {
    render(<Icon name="check" data-testid="i" color="brand" />);
    expect(svg().getAttribute('class')).toContain('text-default-brand');
  });

  it('refuses to recolour a fixed-palette glyph', () => {
    render(<Icon name="credit-coin" data-testid="i" color="brand" />);
    expect(svg().getAttribute('class') ?? '').not.toContain('text-default-brand');
    expect(svg().innerHTML).toContain('--surface-gradient-yellow-start');
  });

  it('marks exactly one entry fixed-palette', () => {
    const fixed = ICON_NAMES.filter((n) => ICON_REGISTRY[n].fixedPalette);
    expect(fixed).toEqual(['credit-coin']);
  });
});

describe('Icon owns its accessibility decision', () => {
  // `IconProps` extends SVGProps, so this compiles. Before the a11y attributes were spread
  // last it also WORKED — the icon lost aria-hidden, gained no role and no label, and became
  // an unlabelled node in the accessibility tree.
  it('ignores an aria-hidden={false} passed without a label', () => {
    render(<Icon name="check" data-testid="i" aria-hidden={false} />);
    expect(svg().getAttribute('aria-hidden')).toBe('true');
    expect(svg().getAttribute('role')).toBeNull();
  });

  it('ignores a role passed instead of an aria-label', () => {
    render(<Icon name="check" data-testid="i" role="presentation" />);
    expect(svg().getAttribute('aria-hidden')).toBe('true');
  });

  it('still lets an aria-label win, since that is the documented lever', () => {
    render(<Icon name="check" data-testid="i" aria-hidden={false} aria-label="Selesai" />);
    expect(svg().getAttribute('role')).toBe('img');
    expect(svg().getAttribute('aria-label')).toBe('Selesai');
    expect(svg().getAttribute('aria-hidden')).toBeNull();
  });
});

/**
 * UMK-956 added these four so the TemanAI surface could stop hand-drawing them. The generic
 * sweeps above cover rendering; what they cannot see is one of the four being dropped or
 * renamed, which is a runtime throw at every call site on that surface, not a typecheck error.
 */
describe('the UMK-956 feedback and playback glyphs', () => {
  const added = ['thumbs-up', 'thumbs-down', 'play', 'speaker'] as const;

  it('registers all four names', () => {
    for (const name of added) expect(ICON_NAMES, name).toContain(name);
  });

  /**
   * Pins the DRAWING, not just the name. Every other assertion here passes if `speaker` is
   * wired to `Headphones` or `thumbs-down` to `ThumbsUp` — an svg renders, it takes the colour
   * axis, the name exists. Only comparing the component catches the "close enough" swap the
   * registry docblock warns about, and `speaker`/`headphones` are exactly that pair.
   */
  it('backs each name with the intended lucide drawing', () => {
    expect(ICON_REGISTRY['thumbs-up'].component).toBe(ThumbsUp);
    expect(ICON_REGISTRY['thumbs-down'].component).toBe(ThumbsDown);
    expect(ICON_REGISTRY.play.component).toBe(Play);
    expect(ICON_REGISTRY.speaker.component).toBe(Volume2);
    expect(ICON_REGISTRY.speaker.component).not.toBe(ICON_REGISTRY.headphones.component);
  });

  /* THE TWO CHECKS ARE DIFFERENT DRAWINGS, and a consolidation that points one at the other
     is the failure this pins: `check-circle` is lucide's outline, `check-circle-filled` is
     Figma's disc with a knocked-out tick, which is the only one that reads inside a filled
     mark. `composer-check-circle` is a third — an outline too, so it cannot stand in either. */
  it('keeps the filled check separate from both outline circles', () => {
    expect(ICON_REGISTRY['check-circle-filled'].component).not.toBe(
      ICON_REGISTRY['check-circle'].component,
    );
    expect(ICON_REGISTRY['check-circle-filled'].component).not.toBe(
      ICON_REGISTRY['composer-check-circle'].component,
    );
  });

  /* The disc is what makes it usable on a filled mark, so the fill is asserted rather than
     assumed: an outline substituted here renders `fill="none"` on its path. */
  it('draws the filled check as a solid disc painted from currentColor', () => {
    render(<Icon name="check-circle-filled" data-testid="i" className="h-5 w-5" />);
    const path = svg().querySelector('path')!;
    expect(path.getAttribute('fill')).toBe('currentColor');
    expect(svg().getAttribute('viewBox')).toBe('0 0 17 17');
  });

  /* UMK-1210: the plan diamond is Figma's navy OUTLINE, painted from the colour axis. The gold
     filled diamond it replaces was an <img> with its hex baked in; a `currentColor` path is what
     lets a caller set `text-default-primary` instead. */
  it('draws the plan diamond as an outline painted from currentColor', () => {
    render(<Icon name="diamond" data-testid="i" className="h-4 w-4" />);
    const path = svg().querySelector('path')!;
    expect(path.getAttribute('fill')).toBe('currentColor');
    expect(svg().getAttribute('viewBox')).toBe('0 0 16 16');
    expect(svg().outerHTML).not.toMatch(/#[0-9a-f]{6}/i);
  });

  /* UMK-1218: Figma's `bag cart`, and the FILLED diamond "Paket Saat Ini" paints gray or gold. Both
     are one `currentColor` path so the caller's token decides the colour — no hex in the drawing. */
  it.each([
    ['bag', '0 0 24 24'],
    ['diamond-filled', '0 0 32 32'],
    ['check-circle-bullet', '0 0 18 18'],
  ] as const)('draws %s as one currentColor path with no hex', (name, viewBox) => {
    render(<Icon name={name} data-testid="i" color="warning" />);
    const paths = svg().querySelectorAll('path');
    expect(paths).toHaveLength(1);
    expect(paths[0].getAttribute('fill')).toBe('currentColor');
    expect(svg().getAttribute('viewBox')).toBe(viewBox);
    expect(svg().getAttribute('class')).toContain('text-default-warning');
    expect(svg().outerHTML).not.toMatch(/#[0-9a-f]{6}/i);
  });

  it('lets fill override lucide default so a cast vote reads as filled', () => {
    render(
      <>
        <Icon name="thumbs-up" data-testid="cast" fill="currentColor" className="h-4 w-4" />
        <Icon name="thumbs-up" data-testid="uncast" className="h-4 w-4" />
      </>,
    );
    expect(svg('cast').getAttribute('fill')).toBe('currentColor');
    expect(svg('uncast').getAttribute('fill')).toBe('none');
  });

  it('leaves all four on the colour axis', () => {
    for (const name of added) {
      const { unmount } = render(<Icon name={name} data-testid="i" color="brand" />);
      expect(svg().getAttribute('class'), name).toContain('text-default-brand');
      unmount();
    }
  });
});

/**
 * The Teman AI coin (UMK-1218): Figma's gradient disc and white mark, every colour a token.
 *
 * PROVED RED, one injection each, reverted:
 * | Injection | Reds |
 * | -- | -- |
 * | `gradientId` a constant `'credit-coin'` | a distinct gradient per coin |
 * | the first stop's style reads `--surface-gradient-brand-start` | paints the yellow sweep |
 *
 * The plain-id assertion below is NOT a proof of the `useId` strip: React 19.2 already returns
 * `_r_N_`, so it passes with or without it. It pins the property (the id is usable in `url(#…)`),
 * which the strip only defends if React's format changes again.
 */
describe('the credit coin', () => {
  const stops = (el: Element) =>
    [...el.querySelectorAll('stop')].map((s) => (s as SVGStopElement).style.stopColor);

  it('paints the disc with the yellow gradient tokens and the mark with the invert icon token', () => {
    render(<Icon name="credit-coin" data-testid="i" />);
    expect(svg().getAttribute('viewBox')).toBe('0 0 32 32');
    expect(stops(svg())).toEqual([
      'rgb(var(--surface-gradient-yellow-start, 245 158 11))',
      'rgb(var(--surface-gradient-yellow-end, 172 111 8))',
    ]);
    const mark = svg().querySelector('path') as SVGPathElement;
    expect(mark.style.fill).toBe('rgb(var(--icon-default-invert, 255 255 255))');
    expect(svg().outerHTML).not.toMatch(/#[0-9a-f]{6}/i);
  });

  it('gives each coin on a page its own gradient, referenced by its own disc', () => {
    render(
      <>
        <Icon name="credit-coin" data-testid="a" />
        <Icon name="credit-coin" data-testid="b" />
        <Icon name="credit-coin" data-testid="c" />
      </>,
    );
    const ids = ['a', 'b', 'c'].map((t) => {
      const gradient = svg(t).querySelector('linearGradient')!;
      const disc = svg(t).querySelector('circle')!;
      expect(disc.getAttribute('fill')).toBe(`url(#${gradient.id})`);
      // A plain id, usable inside `url(#…)` (React 19.2's `_r_N_` already is; see the header).
      expect(gradient.id).toMatch(/^[A-Za-z0-9_-]+$/);
      return gradient.id;
    });
    expect(new Set(ids).size).toBe(3);
    expect(document.querySelectorAll('linearGradient')).toHaveLength(3);
  });
});

/**
 * The Sosial Media page's brand cards (UMK-1601, Figma `14992:22237`): Iconsax `instagram` and
 * `facebook`, outline. House artwork — the lucide brand set is not the drawing Figma places, and
 * Facebook there is the "f" in a rounded square, not the bare letter — so it must be STROKED from
 * `currentColor`, like the tab set, or the page cannot paint it from a token.
 */
describe('the Sosial Media brand glyphs', () => {
  it.each(['instagram', 'facebook'] as const)('draws %s as a currentColor outline on the 24 grid', (name) => {
    render(<Icon name={name} data-testid="i" color="primary" />);
    expect(svg().getAttribute('viewBox')).toBe('0 0 24 24');
    expect(svg().getAttribute('fill')).toBe('none');
    expect(svg().getAttribute('stroke')).toBe('currentColor');
    expect(svg().querySelectorAll('path').length).toBeGreaterThanOrEqual(2);
    expect(svg().getAttribute('class')).toContain('text-default-primary');
    expect(svg().outerHTML).not.toMatch(/#[0-9a-f]{6}/i);
  });

  it('keeps the two drawings apart', () => {
    expect(ICON_REGISTRY.instagram.component).not.toBe(ICON_REGISTRY.facebook.component);
  });
});
