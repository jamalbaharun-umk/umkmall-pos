import React from 'react';
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { Alert } from './Alert';
import { Card } from '../compositions/Card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../compositions/Tabs';
import { CheckBox } from './CheckBox';
import { DateTimeInput } from './DateTimeInput';
import { TextField } from './TextField';
import { Upload } from './Upload';
import {
  A2UI_ALERT_LOOK,
  A2UI_BOX_BASE,
  A2UI_CARD_HERO,
  A2UI_TAB_LIST,
  A2UI_TAB_PANEL,
  A2UI_TAB_STATE,
  A2UI_TAB_TRIGGER,
  A2UI_UPLOAD_ZONE,
} from './a2ui-classes';

/**
 * UMK-1307: the form and feedback halves of the `a2ui` appearance (the content half is asserted in
 * `content.stories.test.tsx`). Each look must carry its own classes and NONE of the default look's `ds-`
 * rungs — a `ds-` rung beside a plain one is never resolved by `cn` (both ship), which is exactly how a
 * "restored" size would silently stay the library's.
 */
const has = (el: Element, classes: string) => classes.split(' ').every((c) => el.classList.contains(c));
const dsRungs = (el: Element) => [...el.classList].filter((c) => /(?<!text)-ds-/.test(c)); // type tokens (text-ds-*) scale with the text-size setting (UMK-1325) and are not a look

describe('the a2ui appearance (UMK-1307)', () => {
  it('TextField draws the old input box and label, with no ds rung on the box', () => {
    const { container } = render(<TextField appearance="a2ui" label="Nama" />);
    const box = container.querySelector('input')!.parentElement!;
    expect(has(box, A2UI_BOX_BASE)).toBe(true);
    expect(dsRungs(box)).toEqual([]);
    expect(container.querySelector('label span')?.className).toContain('text-ds-legacy-xs');
  });

  it('TextField keeps its default look when appearance is absent', () => {
    const { container } = render(<TextField label="Nama" />);
    expect(dsRungs(container.querySelector('input')!.parentElement!).length).toBeGreaterThan(0);
  });

  it('DateTimeInput draws the same box', () => {
    const { container } = render(<DateTimeInput appearance="a2ui" aria-label="Tanggal" />);
    const box = container.querySelector('input')!.parentElement!;
    expect(has(box, A2UI_BOX_BASE)).toBe(true);
    expect(dsRungs(box)).toEqual([]);
  });

  it('CheckBox native keeps the browser box: no drawn box, no glyph', () => {
    const { container } = render(<CheckBox appearance="native" size="large" label="Setuju" />);
    const input = container.querySelector('input')!;
    expect(input.className).toContain('accent-brand-primary');
    expect(input.className).not.toContain('appearance-none');
    expect(container.querySelector('svg')).toBeNull();
  });

  it('Upload draws the dashed zone, a real pill button, and keeps its error live region mounted', () => {
    const { container, rerender } = render(<Upload appearance="a2ui" label="Logo" />);
    expect(has(container.querySelector('label + label, div > label:last-of-type')!, A2UI_UPLOAD_ZONE)).toBe(true);
    expect(container.querySelector('button')?.className).toContain('rounded-full');
    const live = container.querySelector('[role="alert"]')!;
    expect(live.textContent).toBe('');
    rerender(<Upload appearance="a2ui" label="Logo" error="Gagal" />);
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('Gagal');
    rerender(<Upload appearance="a2ui" label="Logo" disabled />);
    expect(container.querySelector('button')).toBeNull(); // read-only: the pill is not drawn
  });

  it.each([
    ['coach', 'info', 'coach-info'],
    ['coach', 'success', 'coach-success'],
    ['accent', 'success', 'accent-success'],
    ['accent', 'warning', 'accent-warning'],
    ['accent', 'danger', 'accent-danger'],
    ['banner', 'success', 'banner-success'],
  ] as const)('Alert %s/%s draws its own look', (treatment, variant, key) => {
    const { container } = render(
      <Alert appearance="a2ui" treatment={treatment} variant={variant} role="note" icon={null}>
        x
      </Alert>,
    );
    const root = container.firstElementChild!;
    expect(has(root, A2UI_ALERT_LOOK[key])).toBe(true);
    expect(dsRungs(root)).toEqual([]);
  });
});

describe('the a2ui appearance fails safe (UMK-1307 review)', () => {
  it('Alert falls back to the default look for a pair the a2ui table does not carry', () => {
    const { container } = render(
      <Alert appearance="a2ui" treatment="full" variant="info">
        x
      </Alert>,
    );
    const root = container.firstElementChild!;
    expect(root.className).not.toContain('px-3');
    expect(dsRungs(root).length).toBeGreaterThan(0);
  });

  it('Upload keeps its in-zone error out of the input name', () => {
    const { container } = render(<Upload appearance="a2ui" label="Logo" error="Terlalu besar" />);
    const input = container.querySelector('input')!;
    const labelId = input.getAttribute('aria-labelledby')!;
    expect(container.querySelector(`#${CSS.escape(labelId)}`)?.textContent).toBe('Logo');
  });
});

describe('the a2ui Tabs and Card appearance (UMK-1290)', () => {
  const tabs = (appearance?: 'a2ui') => (
    <Tabs appearance={appearance} defaultValue="a">
      <TabsList>
        <TabsTrigger value="a">A</TabsTrigger>
        <TabsTrigger value="b">B</TabsTrigger>
      </TabsList>
      <TabsContent value="a">pa</TabsContent>
      <TabsContent value="b">pb</TabsContent>
    </Tabs>
  );

  it('Tabs draws the old bar: list rule, natural-width triggers, state colours, no ds rung', () => {
    const { container } = render(tabs('a2ui'));
    const [a, b] = [...container.querySelectorAll('[role="tab"]')];
    expect(has(container.querySelector('[role="tablist"]')!, A2UI_TAB_LIST)).toBe(true);
    expect(has(a, `${A2UI_TAB_TRIGGER} ${A2UI_TAB_STATE.active}`)).toBe(true);
    expect(has(b, `${A2UI_TAB_TRIGGER} ${A2UI_TAB_STATE.default}`)).toBe(true);
    expect(a.classList.contains('flex-1')).toBe(false);
    expect([a, b, container.querySelector('[role="tablist"]')!].flatMap((el) => dsRungs(el))).toEqual([]);
    expect(has(container.querySelector('[role="tabpanel"]')!, A2UI_TAB_PANEL)).toBe(true);
  });

  it('Tabs a2ui keeps the old tab order: every trigger tabbable, no tab stop on the panel', () => {
    const { container } = render(tabs('a2ui'));
    expect([...container.querySelectorAll('[role="tab"]')].map((t) => t.hasAttribute('tabindex'))).toEqual([false, false]);
    expect(container.querySelector('[role="tabpanel"]')!.hasAttribute('tabindex')).toBe(false);
  });

  it('Tabs keeps its default look and roving tabindex when appearance is absent', () => {
    const { container } = render(tabs());
    const [a, b] = [...container.querySelectorAll('[role="tab"]')];
    expect(dsRungs(a).length).toBeGreaterThan(0);
    expect([a.getAttribute('tabindex'), b.getAttribute('tabindex')]).toEqual(['0', '-1']);
    expect(container.querySelector('[role="tabpanel"]')!.getAttribute('tabindex')).toBe('0');
  });

  it('Card a2ui is a bare div; a2ui-hero is the banner; default is untouched', () => {
    const { container } = render(
      <>
        <Card appearance="a2ui">x</Card>
        <Card appearance="a2ui-hero">y</Card>
        <Card>z</Card>
      </>,
    );
    const [plain, hero, dflt] = [...container.children];
    expect(plain.className).toBe('');
    expect(has(hero, A2UI_CARD_HERO)).toBe(true);
    expect(dsRungs(hero)).toEqual([]);
    expect(dsRungs(dflt).length).toBeGreaterThan(0);
  });
});
