/** Opt-in `titleClassName` (UMK-1579): replaces the visible title's class string; left off, the default is byte-identical. */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Dialog } from '../Dialog';

const DEFAULT_TITLE_CLASS = 'px-6 pt-4 text-ds-h5-desktop font-bold text-default-primary md:pt-6';

const titleClass = (props: Partial<React.ComponentProps<typeof Dialog>> = {}) => {
  const view = render(
    <Dialog open onOpenChange={() => {}} title="Judul" {...props}>
      <div>isi</div>
    </Dialog>,
  );
  const out = (view.baseElement.querySelector('[role="dialog"] h2') as HTMLElement).className;
  view.unmount();
  return out;
};

describe('Dialog titleClassName', () => {
  it('left off, the title keeps the exact default class string (golden)', () => {
    expect(titleClass()).toBe(DEFAULT_TITLE_CLASS);
  });

  it('set, it REPLACES the default string with no merge', () => {
    expect(titleClass({ titleClassName: 'pr-ds-2xl text-ds-h5-mobile font-bold' })).toBe('pr-ds-2xl text-ds-h5-mobile font-bold');
  });
});
