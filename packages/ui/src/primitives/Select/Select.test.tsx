import React from 'react';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Select } from './Select';

const OPTIONS = [
  { label: 'Makanan', value: 'makanan' },
  { label: 'Minuman', value: 'minuman' },
  { label: 'Fesyen', value: 'fesyen' },
];

const openList = () => fireEvent.click(screen.getByRole('combobox'));
const options = () => screen.getAllByRole('option').map((o) => o.textContent);

/** Characterisation of single mode (UMK-1185 U1), pinned before `multiple` lands beside it. */
describe('Select (single)', () => {
  it('picks one option, reports it and closes', () => {
    const seen: string[] = [];
    render(<Select label="Kategori" options={OPTIONS} onValueChange={(v) => seen.push(v)} />);
    openList();
    fireEvent.click(screen.getByRole('option', { name: 'Minuman' }));
    expect(seen).toEqual(['minuman']);
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('filters its own options while searching', () => {
    render(<Select label="Kategori" options={OPTIONS} showSearch />);
    openList();
    fireEvent.change(screen.getByPlaceholderText('Cari'), { target: { value: 'min' } });
    expect(options()).toEqual(['Minuman']);
  });

  it('hands the query to onSearch, renders options verbatim and shows loading', () => {
    const queries: string[] = [];
    render(
      <Select label="Kategori" options={OPTIONS} showSearch loading onSearch={(q) => queries.push(q)} />,
    );
    openList();
    fireEvent.change(screen.getByPlaceholderText('Cari'), { target: { value: 'zzz' } });
    expect(queries).toEqual(['zzz']);
    expect(options()).toEqual(['Makanan', 'Minuman', 'Fesyen']);
    expect(screen.getByText('Memuat…')).toBeTruthy();
  });
});

describe('Select trigger label under remote search (UMK-955)', () => {
  it('keeps the chosen label after a search replaces the options', () => {
    const Remote = () => {
      const [value, setValue] = React.useState('');
      const [opts, setOpts] = React.useState(OPTIONS);
      return (
        <Select
          label="Kota"
          showSearch
          value={value}
          options={opts}
          onValueChange={setValue}
          onSearch={(q) => setOpts(q ? [{ label: 'Lainnya', value: 'x' }] : OPTIONS)}
        />
      );
    };
    render(<Remote />);
    openList();
    fireEvent.click(screen.getByRole('option', { name: 'Minuman' }));
    expect(screen.getByRole('combobox').textContent).toBe('Minuman');
    openList();
    fireEvent.change(screen.getByPlaceholderText('Cari'), { target: { value: 'zzz' } });
    expect(options()).toEqual(['Lainnya']);
    fireEvent.keyDown(screen.getByPlaceholderText('Cari'), { key: 'Escape' });
    expect(screen.getByRole('combobox').textContent).toBe('Minuman');
  });
});

describe('Select (multiple)', () => {
  const Multi = ({ onChange, ...rest }: { onChange: (v: string[]) => void; showSearch?: boolean; loading?: boolean; onSearch?: (q: string) => void }) => {
    const [value, setValue] = React.useState<string[]>([]);
    return (
      <Select
        label="Kategori"
        multiple
        options={OPTIONS}
        value={value}
        onValueChange={(v) => {
          setValue(v);
          onChange(v);
        }}
        {...rest}
      />
    );
  };

  it('keeps both of two picks, stays open, and summarises them on the trigger', () => {
    const seen: string[][] = [];
    render(<Multi onChange={(v) => seen.push(v)} />);
    openList();
    fireEvent.click(screen.getByRole('option', { name: 'Makanan' }));
    fireEvent.click(screen.getByRole('option', { name: 'Fesyen' }));
    expect(seen.at(-1)).toEqual(['makanan', 'fesyen']);
    expect(screen.getByRole('listbox').getAttribute('aria-multiselectable')).toBe('true');
    expect(screen.getByRole('combobox').textContent).toContain('2 dipilih');
  });

  it('removes an option that is picked again', () => {
    const seen: string[][] = [];
    render(<Multi onChange={(v) => seen.push(v)} />);
    openList();
    fireEvent.click(screen.getByRole('option', { name: 'Makanan' }));
    fireEvent.click(screen.getByRole('option', { name: 'Makanan' }));
    expect(seen.at(-1)).toEqual([]);
  });

  it('still filters while several are selected', () => {
    render(<Multi onChange={() => {}} showSearch />);
    openList();
    fireEvent.click(screen.getByRole('option', { name: 'Makanan' }));
    fireEvent.click(screen.getByRole('option', { name: 'Fesyen' }));
    fireEvent.change(screen.getByPlaceholderText('Cari'), { target: { value: 'min' } });
    expect(options()).toEqual(['Minuman']);
  });

  it('hands the query to onSearch and shows the loading row', () => {
    const queries: string[] = [];
    render(<Multi onChange={() => {}} showSearch loading onSearch={(q) => queries.push(q)} />);
    openList();
    fireEvent.change(screen.getByPlaceholderText('Cari'), { target: { value: 'x' } });
    expect(queries).toEqual(['x']);
    expect(screen.getByText('Memuat…')).toBeTruthy();
  });
});

describe('Select (portal)', () => {
  it('renders the list in place by default and into document.body with portal', () => {
    const { container, unmount } = render(<Select label="A" options={OPTIONS} />);
    openList();
    expect(container.contains(screen.getByRole('listbox'))).toBe(true);
    unmount();

    const seen: string[] = [];
    const portalled = render(<Select label="B" options={OPTIONS} portal onValueChange={(v) => seen.push(v)} />);
    openList();
    const list = screen.getByRole('listbox');
    expect(portalled.container.contains(list)).toBe(false);
    expect(document.body.contains(list)).toBe(true);
    /* A press inside the portalled list is not an outside click: it must select, not dismiss. */
    const option = screen.getByRole('option', { name: 'Fesyen' });
    fireEvent.mouseDown(option);
    fireEvent.click(option);
    expect(seen).toEqual(['fesyen']);
  });
});

describe('Select (portal) focus', () => {
  it('closes when focus leaves the portalled search box for the page', () => {
    render(
      <>
        <Select label="C" options={OPTIONS} portal showSearch />
        <button type="button">Lain</button>
      </>,
    );
    openList();
    const search = screen.getByPlaceholderText('Cari');
    const outside = screen.getByRole('button', { name: 'Lain' });
    fireEvent.focusOut(search, { relatedTarget: outside });
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});
