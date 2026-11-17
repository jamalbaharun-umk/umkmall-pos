import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { DateTimeInput } from './DateTimeInput';

/**
 * CHARACTERISATION FIRST (UMK-1185 U1). The popover this component opens is being extracted
 * into `Popover`, and `form-controls.test.tsx` pins the value rules but not where the calendar
 * renders — so these cases pin what the extraction must keep before it happens.
 */
const openCalendar = () => fireEvent.click(screen.getByRole('button', { name: 'Buka kalender' }));

describe('DateTimeInput (characterisation)', () => {
  it('renders the calendar INSIDE its own subtree, never portalled to the body', () => {
    const { container } = render(<DateTimeInput label="Tanggal" defaultValue="2026-03-10" />);
    openCalendar();
    const grid = screen.getByRole('grid');
    expect(container.contains(grid)).toBe(true);
  });

  it('aligns the calendar to the start edge of the field', () => {
    render(<DateTimeInput label="Tanggal" defaultValue="2026-03-10" />);
    openCalendar();
    expect(screen.getByRole('grid').closest('[data-align]')?.getAttribute('data-align')).toBe('start');
  });

  it('commits a picked day as YYYY-MM-DD and closes', () => {
    const seen: string[] = [];
    render(<DateTimeInput label="Tanggal" defaultValue="2026-03-10" onValueChange={(v) => seen.push(v)} />);
    openCalendar();
    fireEvent.click(within(screen.getByRole('grid')).getByText('14'));
    expect(seen).toEqual(['2026-03-14']);
    expect(screen.queryByRole('grid')).toBeNull();
  });

  it('refuses an out-of-range typed value', () => {
    const seen: string[] = [];
    render(<DateTimeInput label="Tanggal" max="2026-01-31" onValueChange={(v) => seen.push(v)} />);
    const input = screen.getByLabelText('Tanggal');
    fireEvent.change(input, { target: { value: '2026-02-01' } });
    fireEvent.blur(input);
    expect(seen).toEqual([]);
  });
});

const day = (n: string, grid = 0) => within(screen.getAllByRole('grid')[grid]).getByText(n);

describe('DateTimeInput selection: range (UMK-1185)', () => {
  const Range = ({ onChange, ...rest }: { onChange: (v: unknown) => void; min?: string; max?: string }) => {
    const [value, setValue] = React.useState<{ from: string; to: string } | undefined>({ from: '2026-03-02', to: '2026-03-03' });
    return (
      <DateTimeInput
        label="Periode"
        selection="range"
        rangeValue={value}
        onRangeChange={(v) => {
          setValue(v);
          onChange(v);
        }}
        {...rest}
      />
    );
  };

  it('emits { from, to } only on Apply, after a click pair', () => {
    const seen: unknown[] = [];
    render(<Range onChange={(v) => seen.push(v)} />);
    openCalendar();
    fireEvent.click(screen.getByRole('button', { name: 'Hapus' }));
    fireEvent.click(day('10'));
    fireEvent.click(day('14'));
    expect(seen).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Terapkan' }));
    expect(seen).toEqual([{ from: '2026-03-10', to: '2026-03-14' }]);
  });

  it('Clear empties the draft and emits nothing', () => {
    const seen: unknown[] = [];
    const { container } = render(<Range onChange={(v) => seen.push(v)} />);
    openCalendar();
    expect(container.querySelectorAll('.day-selected').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Hapus' }));
    expect(seen).toEqual([]);
    expect(container.querySelectorAll('.day-selected')).toHaveLength(0);
  });

  it('leaves the committed range unchanged when closed without Apply', () => {
    const seen: unknown[] = [];
    render(<Range onChange={(v) => seen.push(v)} />);
    openCalendar();
    fireEvent.click(screen.getByRole('button', { name: 'Hapus' }));
    fireEvent.click(day('10'));
    fireEvent.click(day('14'));
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    expect(screen.queryByRole('grid')).toBeNull();
    expect(seen).toEqual([]);
    expect((screen.getByLabelText('Periode') as HTMLInputElement).value).toBe('2026-03-02 – 2026-03-03');
  });

  it('still refuses days outside min/max', () => {
    render(<Range onChange={() => {}} min="2026-03-05" />);
    openCalendar();
    expect(day('4').closest('button')?.disabled).toBe(true);
    expect(day('6').closest('button')?.disabled).toBe(false);
  });
});

describe('DateTimeInput withTime and presets (UMK-1185)', () => {
  it('emits YYYY-MM-DDTHH:mm, keeping the time when a day is picked', () => {
    const seen: string[] = [];
    render(<DateTimeInput label="Waktu" withTime defaultValue="2026-03-10T08:15" onValueChange={(v) => seen.push(v)} />);
    openCalendar();
    fireEvent.change(screen.getByLabelText('Jam'), { target: { value: '21' } });
    fireEvent.click(day('12'));
    expect(seen).toEqual(['2026-03-10T21:15', '2026-03-12T21:15']);
  });

  it('commits a preset and closes; renders no preset buttons without the prop', () => {
    const seen: string[] = [];
    const { unmount } = render(
      <DateTimeInput
        label="Waktu"
        withTime
        presets={[{ label: 'Besok pagi', value: () => '2026-04-01T09:00' }]}
        onValueChange={(v) => seen.push(v)}
      />,
    );
    openCalendar();
    fireEvent.click(screen.getByRole('button', { name: 'Besok pagi' }));
    expect(seen).toEqual(['2026-04-01T09:00']);
    expect(screen.queryByRole('grid')).toBeNull();
    unmount();

    render(<DateTimeInput label="Waktu" withTime />);
    openCalendar();
    expect(screen.queryByRole('button', { name: 'Besok pagi' })).toBeNull();
  });
});

describe('DateTimeInput opens from the field (UMK-1185)', () => {
  it('opens the calendar on a click in the field and keeps focus there for typing', () => {
    render(<DateTimeInput label="Tanggal" defaultValue="2026-03-10" />);
    const input = screen.getByLabelText('Tanggal');
    input.focus();
    fireEvent.click(input);
    expect(screen.getByRole('grid')).toBeTruthy();
    expect(document.activeElement).toBe(input);
  });

  it('does not open on focus alone', () => {
    render(<DateTimeInput label="Tanggal" />);
    fireEvent.focus(screen.getByLabelText('Tanggal'));
    expect(screen.queryByRole('grid')).toBeNull();
  });

  it('opens a range field on a click in the field', () => {
    render(<DateTimeInput label="Periode" selection="range" />);
    fireEvent.click(screen.getByLabelText('Periode'));
    expect(screen.getByRole('button', { name: 'Terapkan' })).toBeTruthy();
  });

  it('stays out of the way of a disabled field', () => {
    render(<DateTimeInput label="Tanggal" disabled />);
    fireEvent.click(screen.getByLabelText('Tanggal'));
    expect(screen.queryByRole('grid')).toBeNull();
  });
});

describe('DateTimeInput range without an owner (UMK-1185)', () => {
  it('clears from the x and applies a new range when nothing controls it', () => {
    render(<DateTimeInput label="Periode" selection="range" defaultRangeValue={{ from: '2026-03-02', to: '2026-03-03' }} />);
    const input = screen.getByLabelText('Periode') as HTMLInputElement;
    fireEvent.click(screen.getByRole('button', { name: 'Kosongkan tanggal' }));
    expect(input.value).toBe('');

    openCalendar();
    fireEvent.click(day('10'));
    fireEvent.click(day('14'));
    fireEvent.click(screen.getByRole('button', { name: 'Terapkan' }));
    /* Cleared, so the calendar opens on the current month. */
    expect(input.value).toMatch(/^\d{4}-\d{2}-10 – \d{4}-\d{2}-14$/);
  });
});

/* happy-dom has no layout, so this pins the rule rather than the pixels: an empty leading cell
   holds no button, and only a width on the CELL keeps the 1st under its weekday. */
it('gives every day cell the weekday header width, empty leading cells included', () => {
  render(<DateTimeInput label="Tanggal" defaultValue="2026-09-15" />);
  openCalendar();
  const grid = screen.getByRole('grid');
  const width = grid.querySelector('th')!.className.split(' ').find((c) => c.startsWith('w-'));
  const cells = [...grid.querySelectorAll('td')];
  expect(cells.some((td) => td.textContent === '')).toBe(true);
  for (const td of cells) expect(td.className.split(' ')).toContain(width);
});

describe('DateTimeInput timeOnly (UMK-1383)', () => {
  it('renders a time input with no calendar and reports HH:mm', () => {
    const onValueChange = vi.fn();
    render(<DateTimeInput label="Jam" timeOnly defaultValue="09:30" onValueChange={onValueChange} />);
    const input = screen.getByLabelText('Jam') as HTMLInputElement;
    expect(input.type).toBe('time');
    expect(input.value).toBe('09:30');
    fireEvent.change(input, { target: { value: '10:45' } });
    expect(onValueChange).toHaveBeenCalledWith('10:45');
    expect(input.value).toBe('10:45');
    fireEvent.click(input);
    expect(screen.queryByRole('grid')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Buka kalender' })).toBeNull();
  });
});
