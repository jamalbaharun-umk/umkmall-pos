import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import preset from '../../../tailwind.preset.js';
import { TEXT_ROLES, TEXT_ROLE_WEIGHTS } from '../../contract';
import { Text } from './Text';

const classesOf = (label: string) => screen.getByText(label).className.split(/\s+/);

/**
 * The emitted scale, read from the preset rather than restated here. A hand-copied
 * expectation would keep passing after the pipeline stopped emitting a key, which is the
 * exact failure this file exists to catch: Tailwind emits NOTHING for a key it does not
 * know, so a variant whose token vanished renders at the browser default with no error.
 */
const fontSize = preset.theme.extend.fontSize as Record<string, [string, { lineHeight: string; letterSpacing?: string }]>;

describe('Text renders the published scale', () => {
  /**
   * ONE STEP AT EVERY VIEWPORT. The `lg:` Desktop half is deliberately absent — see the
   * scale comment in `Text.tsx`. Asserting the absence, not just the presence of the Mobile
   * class, is what keeps a later "restore the responsive pair" edit from silently re-growing
   * every heading above 976px: the classes still resolve, so nothing else in the suite reds.
   */
  it.each(TEXT_ROLES)('gives %s its Mobile class at every viewport', (role) => {
    render(<Text variant={role}>{role}</Text>);
    const classes = classesOf(role);
    expect(classes).toContain(`text-ds-${keyOf(role)}-mobile`);
    expect(classes).not.toContain(`lg:text-ds-${keyOf(role)}-desktop`);
  });

  it('names only keys the token pipeline actually emits', () => {
    for (const role of TEXT_ROLES) {
      for (const step of ['mobile', 'desktop']) {
        expect(fontSize, `${role}/${step} has no emitted token`).toHaveProperty(`ds-${keyOf(role)}-${step}`);
      }
    }
  });

  /**
   * R2 / UMK-910. The binding is structural — the utility is one Tailwind key whose value is
   * a `[size, { lineHeight }]` tuple — so this asserts the tuple, not the class string. A
   * caller has no syntax available that takes the size and leaves the leading behind.
   */
  const CALC_REM = /^calc\([\d.]+rem \* var\(--ds-text-scale, 1\)\)$/;
  it('cannot apply a size without its paired line-height', () => {
    // The two badge sizes (10px / 11px) are size-only by design: they inherit their leading.
    const SIZE_ONLY = ['ds-legacy-10', 'ds-legacy-11'];
    for (const key of SIZE_ONLY) expect(fontSize[key], key).toMatch(CALC_REM);
    for (const [key, value] of Object.entries(fontSize).filter(([k]) => k.startsWith('ds-') && !SIZE_ONLY.includes(k))) {
      expect(Array.isArray(value), `${key} is not a tuple`).toBe(true);
      expect(value[0]).toMatch(CALC_REM);
      expect(value[1].lineHeight, `${key} has no line-height`).toMatch(CALC_REM);
    }
  });

  it('carries tracking on display, h1 and h2 and nowhere else', () => {
    const tracked = Object.entries(fontSize)
      .filter(([k, v]) => k.startsWith('ds-') && v[1].letterSpacing)
      .map(([k]) => k)
      .sort();
    expect(tracked).toEqual([
      'ds-display-desktop',
      'ds-display-mobile',
      'ds-h1-desktop',
      'ds-h1-mobile',
      'ds-h2-desktop',
      'ds-h2-mobile',
    ]);
  });
});

describe('Text axes', () => {
  it('renders each weight a role publishes', () => {
    for (const weight of TEXT_ROLE_WEIGHTS.paragraph) {
      const { unmount } = render(<Text weight={weight}>{weight}</Text>);
      expect(classesOf(weight)).toContain(weight === 'regular' ? 'font-normal' : `font-${weight}`);
      unmount();
    }
  });

  it('maps each role to a sensible default element', () => {
    render(
      <>
        <Text variant="h2">h2 role</Text>
        <Text variant="paragraph">p role</Text>
      </>,
    );
    expect(screen.getByText('h2 role').tagName).toBe('H2');
    expect(screen.getByText('p role').tagName).toBe('P');
  });

  it('keeps the role styles when `as` overrides the element', () => {
    render(
      <Text variant="h3" as="h1">
        override
      </Text>,
    );
    const el = screen.getByText('override');
    expect(el.tagName).toBe('H1');
    expect(el.className).toContain('text-ds-h3-mobile');
  });

  it('lets a passed className win over the variant classes', () => {
    render(
      <Text variant="display" className="text-ds-body-sm-mobile">
        won
      </Text>,
    );
    /** `cn` puts className last and tailwind-merge drops the losing fontSize utility. */
    const classes = classesOf('won');
    expect(classes).toContain('text-ds-body-sm-mobile');
    expect(classes).not.toContain('text-ds-display-mobile');
  });

  it('renders a default role, weight and colour with no props', () => {
    render(<Text>bare</Text>);
    const classes = classesOf('bare');
    expect(classes).toContain('text-ds-paragraph-mobile');
    expect(classes).toContain('font-normal');
    expect(classes).toContain('text-default-primary');
  });

  // The reason the scale axis is `variant` and not `role`. While it was `role`, this was
  // unsayable: the prop was consumed as a style name and the ARIA attribute never reached
  // the DOM, so a live-region Text could not announce.
  it('passes an ARIA role through to the element', () => {
    render(
      <Text variant="paragraph" role="status">
        menyimpan
      </Text>,
    );
    expect(screen.getByRole('status')).toHaveTextContent('menyimpan');
  });

  it('names its variants for the elements they render, matching HTML', () => {
    render(<Text variant="h3">judul</Text>);
    expect(screen.getByText('judul').tagName).toBe('H3');
  });

  it('renders each semantic colour', () => {
    render(<Text color="secondary">muted</Text>);
    expect(classesOf('muted')).toContain('text-default-secondary');
  });
});

/**
 * contract -> pipeline. `bodyLg` becomes `ds-body-lg-*`; the heading names are shared, so
 * they pass through. Derived here rather than imported so the component's own map is checked
 * against an independently written one instead of against itself.
 */
function keyOf(role: string): string {
  // Splits camelCase only. Splitting before a DIGIT too would turn `h1` into `h-1`, which
  // is a key the pipeline does not emit — the names carry their digits now.
  return role.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
}
