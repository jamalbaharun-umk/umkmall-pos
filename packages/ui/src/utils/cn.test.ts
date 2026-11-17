import { describe, expect, it } from 'vitest';
import { cn } from './cn';

describe('cn', () => {
  it('merges two class strings into one', () => {
    expect(cn('px-4 py-2', 'bg-blue-500')).toBe('px-4 py-2 bg-blue-500');
  });

  it('resolves a Tailwind conflict, keeping the later utility', () => {
    expect(cn('px-4', 'px-8')).toBe('px-8');
  });

  // tailwind-merge reads an unknown `text-*` as a colour, so without the design system's
  // font-size group registered it drops the size and keeps only the colour.
  it('keeps a ds-* font size alongside a text colour', () => {
    expect(cn('text-ds-paragraph-mobile', 'text-default-primary')).toBe(
      'text-ds-paragraph-mobile text-default-primary',
    );
  });

  it('still treats two ds-* font sizes as a conflict', () => {
    expect(cn('text-ds-display-mobile', 'text-ds-body-sm-mobile')).toBe('text-ds-body-sm-mobile');
  });

  it('lets a plain height, width or radius override its ds-* default (UMK-957)', () => {
    expect(cn('h-ds-4xl w-ds-xl rounded-ds-md', 'h-16 w-10 rounded-full')).toBe('h-16 w-10 rounded-full');
    expect(cn('h-16', 'h-ds-md')).toBe('h-ds-md');
    expect(cn('size-ds-md', 'size-6')).toBe('size-6');
  });

  it('drops falsy entries without emitting them', () => {
    expect(cn('px-4', undefined, false, null, 'py-2')).toBe('px-4 py-2');
  });
});
