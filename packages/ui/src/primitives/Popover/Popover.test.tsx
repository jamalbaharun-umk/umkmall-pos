import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Popover, PopoverContent, PopoverTrigger } from '.';

const mount = (portal?: boolean) =>
  render(
    <Popover defaultOpen>
      <PopoverTrigger>Buka</PopoverTrigger>
      <PopoverContent portal={portal}>Isi</PopoverContent>
    </Popover>,
  );

/**
 * WHERE THE PANEL LANDS is the one decision this component makes (UMK-1185): in place by
 * default, `document.body` only when asked.
 */
describe('Popover placement', () => {
  it('renders in place, inside the caller subtree, by default', () => {
    const { container } = mount();
    expect(container.contains(screen.getByText('Isi'))).toBe(true);
  });

  it('renders into document.body when portal is set', () => {
    const { container } = mount(true);
    const panel = screen.getByText('Isi');
    expect(container.contains(panel)).toBe(false);
    expect(document.body.contains(panel)).toBe(true);
  });
});
