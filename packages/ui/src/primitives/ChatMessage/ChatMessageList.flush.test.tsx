/** Opt-in `flush` (UMK-1579): omits the density padding only; left off, the content class string is byte-identical. */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { ChatMessageList } from './ChatMessageList';

const contentClass = (props: Partial<React.ComponentProps<typeof ChatMessageList>> = {}) => {
  const view = render(
    <ChatMessageList {...props}>
      <div>satu</div>
    </ChatMessageList>,
  );
  const out = (view.container.querySelector('[role="log"]')!.firstElementChild as HTMLElement).className;
  view.unmount();
  return out;
};

describe('ChatMessageList flush', () => {
  it('left off, the content keeps the exact default class string per density (golden)', () => {
    expect(contentClass()).toBe('flex w-full flex-col p-ds-lg gap-ds-lg');
    expect(contentClass({ density: 'compact' })).toBe('flex w-full flex-col p-ds-sm gap-ds-sm');
    expect(contentClass({ density: 'spacious' })).toBe('flex w-full flex-col p-ds-xl gap-ds-2xl');
    expect(contentClass({ flush: false })).toBe('flex w-full flex-col p-ds-lg gap-ds-lg');
  });

  it('flush drops the padding and leaves the density gap alone', () => {
    expect(contentClass({ flush: true })).toBe('flex w-full flex-col gap-ds-lg');
    expect(contentClass({ flush: true, density: 'compact' })).toBe('flex w-full flex-col gap-ds-sm');
  });

  it('flush with an explicit gap keeps that gap and no padding', () => {
    expect(contentClass({ flush: true, gap: 'sm' })).toBe('flex w-full flex-col gap-ds-sm');
  });
});
