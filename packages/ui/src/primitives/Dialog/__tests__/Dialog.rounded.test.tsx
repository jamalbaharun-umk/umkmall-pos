/** Opt-in `rounded` (UMK-1548): `lg` is the 24px `ds-2xl` token on the sheet and the centred card; the default keeps `2xl`. */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Dialog } from '../Dialog';

const classes = (props: Partial<React.ComponentProps<typeof Dialog>> = {}) => {
  const view = render(
    <Dialog open onOpenChange={() => {}} title="Bulat" {...props}>
      <div>isi</div>
    </Dialog>,
  );
  const out = (view.baseElement.querySelector('[role="dialog"]') as HTMLElement).className.split(/\s+/);
  view.unmount();
  return out;
};

describe('Dialog rounded', () => {
  it('lg: the sheet takes rounded-t-ds-2xl and the md card rounded-ds-2xl, with no 2xl left', () => {
    const c = classes({ rounded: 'lg' });
    expect(c).toContain('rounded-t-ds-2xl');
    expect(c).toContain('md:rounded-ds-2xl');
    expect(c).not.toContain('rounded-t-2xl');
    expect(c).not.toContain('md:rounded-2xl');
  });

  it('lg on a centred card takes rounded-ds-2xl', () => {
    const c = classes({ rounded: 'lg', centered: true });
    expect(c).toContain('rounded-ds-2xl');
    expect(c).not.toContain('rounded-2xl');
  });

  it('lg on a full-height sheet keeps no top radius below md and the 24 card from md', () => {
    const c = classes({ rounded: 'lg', fullHeight: true });
    expect(c).toContain('rounded-none');
    expect(c).toContain('md:rounded-ds-2xl');
  });

  it('default (and the prop left off) keeps the 2xl classes and none of the 24 ones', () => {
    for (const props of [{}, { rounded: 'default' as const }]) {
      const c = classes(props);
      expect(c).toContain('rounded-t-2xl');
      expect(c).toContain('md:rounded-2xl');
      expect(c).not.toContain('rounded-t-ds-2xl');
      expect(c).not.toContain('md:rounded-ds-2xl');
    }
    const centered = classes({ centered: true });
    expect(centered).toContain('rounded-2xl');
    expect(centered).not.toContain('rounded-ds-2xl');
  });
});
