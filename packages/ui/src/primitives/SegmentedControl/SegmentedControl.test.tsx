import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { SegmentedControl } from './SegmentedControl';

const OPTIONS = [
  { value: 'a', label: 'A-' },
  { value: 'b', label: 'A' },
  { value: 'c', label: 'A+' },
];

const setup = (value = 'b') => {
  const onChange = vi.fn();
  render(<SegmentedControl aria-label="Ukuran" options={OPTIONS} value={value} onChange={onChange} />);
  return onChange;
};

describe('SegmentedControl', () => {
  it('is a named radiogroup of radios, one checked', () => {
    setup();
    expect(screen.getByRole('radiogroup', { name: 'Ukuran' })).toBeTruthy();
    const radios = screen.getAllByRole('radio');
    expect(radios.map((r) => r.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false']);
    expect(radios.map((r) => r.tabIndex)).toEqual([-1, 0, -1]);
  });

  it('reports a click', () => {
    const onChange = setup();
    fireEvent.click(screen.getByRole('radio', { name: 'A+' }));
    expect(onChange).toHaveBeenCalledWith('c');
  });

  it('arrows choose and wrap', () => {
    const onChange = setup('c');
    fireEvent.keyDown(screen.getByRole('radio', { name: 'A+' }), { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith('a');
    fireEvent.keyDown(screen.getByRole('radio', { name: 'A+' }), { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenLastCalledWith('b');
  });

  it('disabled blocks every segment', () => {
    const onChange = vi.fn();
    render(<SegmentedControl aria-label="x" options={OPTIONS} value="a" onChange={onChange} disabled />);
    for (const r of screen.getAllByRole('radio')) {
      expect((r as HTMLButtonElement).disabled).toBe(true);
      fireEvent.click(r);
      fireEvent.keyDown(r, { key: 'ArrowRight' });
    }
    expect(onChange).not.toHaveBeenCalled();
  });

  it('keeps the group reachable by Tab when value matches no option', () => {
    render(<SegmentedControl aria-label="x" options={OPTIONS} value="zzz" onChange={vi.fn()} />);
    expect(screen.getAllByRole('radio').map((r) => r.tabIndex)).toEqual([0, -1, -1]);
  });
});
