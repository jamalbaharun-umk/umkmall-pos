import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TEXT_ROLES } from '../contract';
import * as FoundationStories from './Foundation.stories';
import { TypographyPage } from './TypographyPage';
import {
  ROLE_SEGMENTS,
  TYPOGRAPHY_PLATFORMS,
  TYPOGRAPHY_ROWS,
  TYPOGRAPHY_SPECIMENS,
  trackingPercent,
  typographyVar,
  type TypographyPlatform,
  type TypographyRole,
} from './typography-specimens';

/**
 * Every failure this file catches still renders something.
 *
 * A var name that does not exist, a specimen wired to the wrong style, a letter-spacing the
 * browser drops for want of a unit, and a px value printed under a header that says "Tracking"
 * all look like design nits rather than broken pipelines — the page keeps showing plausible
 * text in the browser default face and nothing errors. That is why these are assertions and
 * not a visual check.
 *
 * **What this file does NOT cover: the painted output.** Nothing in `packages/ui` loads
 * `tokens.css` under vitest (`vitest.setup.ts` imports jest-dom only), so a custom property
 * resolves to nothing here and an assertion on a computed `font` would pass vacuously. So the
 * guard asserts the WIRING — each specimen carries a `data-token` naming its variable, and
 * every composed name exists in `tokens.css` — which together prove each cell is bound to a
 * real, correct token. Whether the browser paints it is verified by opening Storybook, which
 * the plan's Verification Contract requires. Do not "strengthen" this into a computed-style
 * assertion; it will assert nothing.
 */

/** Finds a rendered specimen by the variable that paints it. */
const tokenSelector = (platform: TypographyPlatform, role: TypographyRole) =>
  `[data-token='${typographyVar(platform, role, 'semibold')}']`;

const tokensCss = readFileSync(join(__dirname, '../../tokens.css'), 'utf8');
const textSource = readFileSync(join(__dirname, '../primitives/Text/Text.tsx'), 'utf8');

describe('typography specimen model', () => {
  // The name is composed from a camelCase role key and consumed as a kebab var segment. An
  // undefined var() inside a `font` shorthand invalidates the whole declaration silently, so
  // reading tokens.css itself is the only independent check that the composition is right.
  it('composes exactly the --typography-* names tokens.css declares', () => {
    const declared = [...tokensCss.matchAll(/^\s*(--typography-[a-z0-9-]+):/gm)].map((m) => m[1]);
    const composed = TYPOGRAPHY_SPECIMENS.map((s) => s.cssVar);

    expect(composed).toHaveLength(80);
    expect([...composed].sort()).toEqual([...declared].sort());
  });

  // `SCALE` in Text.tsx hand-maintains the same camelCase -> kebab transformation for Tailwind
  // class names. Two copies of one transformation must not disagree without going red.
  it('agrees with the segments Text.tsx SCALE already uses', () => {
    const fromScale = Object.fromEntries(
      TEXT_ROLES.map((role) => {
        const line = textSource.match(new RegExp(`^\\s*${role}: '([^']+)'`, 'm'))?.[1];
        const segment = line?.match(/text-ds-(.+)-mobile/)?.[1];
        return [role, segment];
      }),
    );

    expect(fromScale).toEqual(ROLE_SEGMENTS);
  });

  // Iterating TEXT_WEIGHTS instead of TEXT_ROLE_WEIGHTS would invent 12 styles that do not
  // exist — display and h1 publish Bold and Semibold only.
  it('inventories the published styles, not the cartesian product', () => {
    for (const platform of ['desktop', 'mobile'] as const) {
      expect(TYPOGRAPHY_SPECIMENS.filter((s) => s.platform === platform)).toHaveLength(40);
    }

    const weightsOf = (role: string) =>
      TYPOGRAPHY_SPECIMENS.filter((s) => s.platform === 'desktop' && s.role === role).map(
        (s) => s.weight,
      );

    expect(weightsOf('display')).toEqual(['bold', 'semibold']);
    expect(weightsOf('h1')).toEqual(['bold', 'semibold']);
    expect(weightsOf('paragraph')).toEqual(['bold', 'semibold', 'medium', 'regular']);
  });

  it('keeps an unpublished letterSpacing undefined rather than claiming zero', () => {
    const h5 = TYPOGRAPHY_SPECIMENS.find(
      (s) => s.platform === 'desktop' && s.role === 'h5' && s.weight === 'semibold',
    );

    expect(h5?.letterSpacing).toBeUndefined();
    expect(h5?.letterSpacingCss).toBeUndefined();
  });

  it('emits a unit-bearing letter-spacing for a tracked role', () => {
    const display = TYPOGRAPHY_SPECIMENS.find(
      (s) => s.platform === 'desktop' && s.role === 'display' && s.weight === 'semibold',
    );

    expect(display?.letterSpacing).toBe(-0.56);
    expect(display?.letterSpacingCss).toBe('-0.01em');
  });

  it('lists the eleven roles per platform in published order', () => {
    for (const platform of ['desktop', 'mobile'] as const) {
      expect(TYPOGRAPHY_ROWS[platform].map((r) => r.role)).toEqual([...TEXT_ROLES]);
    }
  });

  it('carries the other platform size in each row', () => {
    const desktopDisplay = TYPOGRAPHY_ROWS.desktop[0];
    const mobileDisplay = TYPOGRAPHY_ROWS.mobile[0];

    expect(desktopDisplay.fontSize).toBe(56);
    expect(desktopDisplay.otherPlatformFontSize).toBe(36);
    expect(mobileDisplay.fontSize).toBe(36);
    expect(mobileDisplay.otherPlatformFontSize).toBe(56);
  });

  // The only assertion tying this page back to the Figma page's own printed numbers. The tokens
  // carry the resolved px; the design specifies a percentage of the font size, and the Tracking
  // column must show what the design means by tracking.
  it('recovers the design percentages the Figma page prints', () => {
    const percentOf = (platform: 'desktop' | 'mobile', role: string) =>
      TYPOGRAPHY_ROWS[platform].find((r) => r.role === role)?.trackingPercent;

    expect(percentOf('desktop', 'display')).toBe(-1);
    expect(percentOf('desktop', 'h1')).toBe(-0.3);
    expect(percentOf('desktop', 'h2')).toBe(-0.1);
    expect(percentOf('mobile', 'display')).toBe(-1);
    // A role that publishes no tracking shows 0, matching the Figma page.
    expect(percentOf('desktop', 'h5')).toBe(0);
    expect(trackingPercent(56, -0.56)).toBe(-1);
  });
});

describe('Foundation/Typography page', () => {
  // Roles asserted BY NAME, never by counting rows: a count-based guard passes by measuring
  // itself (docs/solutions/conventions/a-guard-test-can-pass-by-measuring-itself.md).
  it.each([
    ['desktop', 'display', 'Display'],
    ['desktop', 'paragraph', 'Paragraph'],
    ['desktop', 'bodySm', 'Body Sm'],
    ['mobile', 'display', 'Display'],
    ['mobile', 'paragraph', 'Paragraph'],
    ['mobile', 'bodySm', 'Body Sm'],
  ] as const)('wires the %s %s specimen to its own Semibold variable', (platform, role, label) => {
    const { container } = render(<TypographyPage />);
    const cell = container.querySelector(tokenSelector(platform, role));

    expect(cell).not.toBeNull();
    expect(cell).toHaveTextContent(label);
  });

  // Bold would render and look entirely plausible; the design uses Semibold for every Style
  // cell, and only comparing against the rendered tree can tell the difference.
  it('wires no specimen to a weight other than Semibold', () => {
    const { container } = render(<TypographyPage />);
    const wired = [...container.querySelectorAll('[data-token]')].map((el) =>
      el.getAttribute('data-token'),
    );

    expect(wired.length).toBeGreaterThan(0);
    expect(wired.filter((name) => !name?.endsWith('-semibold'))).toEqual([]);
  });

  it('applies a unit-bearing letter-spacing only where the token publishes one', () => {
    const { container } = render(<TypographyPage />);
    const styleOf = (role: 'display' | 'h5') =>
      container
        .querySelector<HTMLElement>(tokenSelector('desktop', role))
        ?.style.letterSpacing;

    expect(styleOf('display')).toBe('-0.01em');
    expect(styleOf('h5')).toBe('');
  });

  // Asserted PER TABLE, not across the page: a page-wide "a Mobile header exists somewhere"
  // check passes just as happily when each section heads its delta column with its OWN
  // platform, which is the exact break that makes the column useless.
  it.each([
    ['Typography ~ Desktop', 'Mobile'],
    ['Typography ~ Mobile', 'Desktop'],
  ])('heads %s’s delta column with the other platform', (caption, delta) => {
    render(<TypographyPage />);
    const section = within(screen.getByRole('table', { name: caption }));

    expect(section.getByRole('columnheader', { name: 'Style' })).toBeInTheDocument();
    expect(section.getByRole('columnheader', { name: 'Size' })).toBeInTheDocument();
    expect(section.getByRole('columnheader', { name: 'Leading' })).toBeInTheDocument();
    expect(section.getByRole('columnheader', { name: 'Tracking' })).toBeInTheDocument();
    expect(section.getByRole('columnheader', { name: delta })).toBeInTheDocument();
  });

  // The Tracking column shows the design's percentage of the font size, printed bare as the
  // Figma page prints it. The px the token actually carries must never appear under that
  // header — it is a different quantity wearing the same name.
  it('prints the design percentage, never the token px value', () => {
    render(<TypographyPage />);

    expect(screen.getAllByText('-1').length).toBeGreaterThan(0);
    // Matched loosely, so the unit-bearing `-0.56px` form fails too — an exact-text query for
    // `-0.56` cannot fail for the drift it is named after.
    expect(screen.queryByText(/-0\.56/)).toBeNull();
  });

  // The columns are only useful if each number lands under its own header. Nothing above binds
  // a rendered cell to a column, so printing `fontSize` in the delta column — losing the one
  // thing this page adds over Figma — reads as a plausible table and passes every other
  // assertion. Expectations are hand-typed from the Figma page rather than read back out of
  // the model, so the model cannot certify itself.
  it.each([
    ['Typography ~ Desktop', 'Display', ['56', '64', '-1', '36']],
    ['Typography ~ Mobile', 'Display', ['36', '40', '-1', '56']],
    ['Typography ~ Desktop', 'Body Sm', ['10', '16', '0', '8']],
    ['Typography ~ Mobile', 'Body Sm', ['8', '14', '0', '10']],
  ])('prints %s’s %s row as Size/Leading/Tracking/delta', (caption, label, expected) => {
    render(<TypographyPage />);
    const row = within(screen.getByRole('table', { name: caption })).getByRole('row', {
      name: new RegExp(`^${label}\\b`),
    });

    expect(
      within(row)
        .getAllByRole('cell')
        .map((cell) => cell.textContent),
    ).toEqual(expected);
  });
});

// Every printed number, checked against the stylesheet rather than against the model that
// printed it. The spot-checks above cover four rows by hand; this covers all twenty-two, so a
// size or leading that goes wrong on a role nobody thought to enumerate still reddens.
describe('the printed numbers agree with tokens.css', () => {
  it.each(TYPOGRAPHY_PLATFORMS)('matches the %s shorthand for every role', (platform) => {
    for (const row of TYPOGRAPHY_ROWS[platform]) {
      const declared = tokensCss.match(new RegExp(`${row.styleVar}:\\s*([^;]+);`))?.[1];

      // A var the stylesheet does not declare paints nothing; the name cross-check above owns
      // that failure, but reading `undefined` here must not pass quietly either.
      expect(declared, `${row.styleVar} is not declared in tokens.css`).toBeDefined();
      const calc = (n: number) => `calc(${n / 16}rem * var(--ds-text-scale, 1))`;
      expect(declared).toContain(`${calc(row.fontSize)}/${calc(row.lineHeight)}`);
    }
  });
});

// Typography routes to its own component; Color and Layout keep the shared Page path. Folding
// TypographyPage back into Page would drop this render override and silently re-scalarise the
// page into 336 bars.
describe('the other Foundation pages keep the untouched path', () => {
  it('renders Color through the shared Page component', () => {
    const Page = FoundationStories.default.component;
    render(<Page {...FoundationStories.Color.args} />);

    expect(screen.getByRole('heading', { name: 'brand' })).toBeInTheDocument();
    expect(screen.getByText('b600')).toBeInTheDocument();
  });

  // Rendered, not merely asserted to BE a function: pointing the override back at the shared
  // `Page` leaves it a function, so a typeof check stays green while the 336 scalar bars come
  // straight back. What makes the story right is what it paints.
  it('paints the Typography story from the typography table', () => {
    const story = FoundationStories.Typography.render;
    if (!story) throw new Error('the Typography story lost its render override');

    const { container } = render(
      <>{story(FoundationStories.Typography.args as never, {} as never)}</>,
    );

    expect(container.querySelector(tokenSelector('desktop', 'display'))).not.toBeNull();
    expect(within(container).getAllByRole('table')).toHaveLength(2);
  });

  it('leaves the Color story on the shared path', () => {
    expect(FoundationStories.Color.render).toBeUndefined();
  });

  /* The Layout story gained a render override in UMK-979 so it can draw the grid ABOVE the
     token browser. Rendered rather than typeof-checked, for the same reason the Typography
     assertion above is: an override pointing back at the shared `Page` is still a function.
     Asserted on the Figma node id, which is the one string on the page that would be wrong
     if the grid were repointed at a different published style. */
  it('draws the grid above the shared token browser on the Layout story', () => {
    const story = FoundationStories.LayoutSpacingImage.render;
    if (!story) throw new Error('the Layout story lost its render override');

    const { container } = render(
      <>{story(FoundationStories.LayoutSpacingImage.args as never, {} as never)}</>,
    );

    expect(container.textContent).toContain('28:1125');
    for (const width of ['1272px', '500px', '360px']) {
      expect(container.textContent).toContain(width.replace('px', 'px container'));
    }
    // The token browser is still underneath it; the grid did not replace the page.
    expect(container.textContent).toContain('margin');
  });
});
