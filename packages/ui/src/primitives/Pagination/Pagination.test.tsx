import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Pagination } from './Pagination';
import { pageItems } from './page-items';

afterEach(cleanup);

const prev = () => screen.getByRole('button', { name: 'Halaman sebelumnya' }) as HTMLButtonElement;
const next = () => screen.getByRole('button', { name: 'Halaman berikutnya' }) as HTMLButtonElement;

describe('Pagination', () => {
  it('disables previous on the first page', () => {
    render(<Pagination page={1} pageCount={5} onPageChange={() => {}} />);
    expect(prev().disabled).toBe(true);
    expect(next().disabled).toBe(false);
  });

  it('disables next on the last page', () => {
    render(<Pagination page={5} pageCount={5} onPageChange={() => {}} />);
    expect(next().disabled).toBe(true);
    expect(prev().disabled).toBe(false);
  });

  it.each([0, 1])('renders one page and no negative or NaN page when pageCount is %i', (pageCount) => {
    render(<Pagination page={1} pageCount={pageCount} onPageChange={() => {}} />);
    const labels = screen
      .getAllByRole('button')
      .map((b) => b.textContent)
      .filter((t) => t);
    expect(labels).toEqual(['1']);
    expect(prev().disabled).toBe(true);
    expect(next().disabled).toBe(true);
  });

  it('hands onPageChange the page that was clicked, 1-based', () => {
    const onPageChange = vi.fn();
    render(<Pagination page={3} pageCount={10} onPageChange={onPageChange} />);
    fireEvent.click(screen.getByRole('button', { name: '4' }));
    fireEvent.click(prev());
    fireEvent.click(next());
    expect(onPageChange.mock.calls).toEqual([[4], [2], [4]]);
    expect(screen.getByRole('button', { name: '3' }).getAttribute('aria-current')).toBe('page');
  });

  it('fires onPageSizeChange with the chosen size as a number', () => {
    const onPageSizeChange = vi.fn();
    render(
      <Pagination
        page={1}
        pageCount={3}
        onPageChange={() => {}}
        pageSize={10}
        onPageSizeChange={onPageSizeChange}
      />,
    );
    fireEvent.click(screen.getByRole('combobox', { name: 'Item per halaman' }));
    fireEvent.click(screen.getByRole('option', { name: '20' }));
    expect(onPageSizeChange).toHaveBeenCalledWith(20);
  });

  it('offers a page size the options list does not carry, rather than a blank select', () => {
    render(
      <Pagination page={1} pageCount={3} onPageChange={() => {}} pageSize={25} onPageSizeChange={() => {}} />,
    );
    fireEvent.click(screen.getByRole('combobox', { name: 'Item per halaman' }));
    expect(screen.getByRole('option', { name: '25' })).toBeTruthy();
  });

  it('hides the page-size control when no callback is given', () => {
    render(<Pagination page={1} pageCount={3} onPageChange={() => {}} pageSize={10} />);
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('walks a cursor source by hasPrev / hasNext when there is no page count', () => {
    const onPageChange = vi.fn();
    const { rerender } = render(<Pagination page={3} onPageChange={onPageChange} hasNext />);
    expect(screen.getAllByRole('button').map((b) => b.textContent).filter(Boolean)).toEqual(['3']);
    expect(prev().disabled).toBe(false);
    fireEvent.click(next());
    expect(onPageChange).toHaveBeenCalledWith(4);
    rerender(<Pagination page={3} onPageChange={onPageChange} hasPrev={false} />);
    expect(prev().disabled).toBe(true);
    /* No count and no hasNext: only the source knows there is more, so next stays off. */
    expect(next().disabled).toBe(true);
  });

  it('disables every control while disabled', () => {
    render(
      <Pagination page={2} pageCount={5} onPageChange={() => {}} disabled summary="12 baris" />,
    );
    expect(screen.getAllByRole('button').every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
    expect(screen.getByText('12 baris')).toBeTruthy();
  });

  it('puts an ellipsis over every gap and keeps first, last and neighbours', () => {
    expect(pageItems(1, 1)).toEqual([1]);
    expect(pageItems(1, 3)).toEqual([1, 2, 3]);
    expect(pageItems(5, 10)).toEqual([1, 'ellipsis', 4, 5, 6, 'ellipsis', 10]);
    /* A one-page gap shows the page rather than an ellipsis in its slot. */
    expect(pageItems(4, 10)).toEqual([1, 2, 3, 4, 5, 'ellipsis', 10]);
  });

  /*
   * `density` (UMK-1306), pinned as LITERAL classes for the same reason datatable.test.tsx
   * gives: the default below is the library's original look, and it must red on drift.
   */
  it('omitted density renders exactly the compact classes — 12px numbers at large, a 10px label', () => {
    render(
      <Pagination page={1} pageCount={5} onPageChange={() => {}} pageSize={10} onPageSizeChange={() => {}} />,
    );
    const page1 = screen.getByRole('button', { name: '1' });
    expect(page1.className).toContain('text-ds-body-lg-mobile');
    expect(page1.className).not.toContain('text-ds-body-lg-desktop');

    const label = screen.getByText('Item per halaman');
    expect(label.className).toContain('text-ds-body-md-mobile');
    expect(label.className).not.toContain('text-ds-body-lg-desktop');
  });

  it('keeps the small squares on their own 10px compact step', () => {
    render(<Pagination page={1} pageCount={5} onPageChange={() => {}} size="small" />);
    const page1 = screen.getByRole('button', { name: '1' });
    expect(page1.className).toContain('text-ds-body-md-mobile');
    expect(page1.className).not.toContain('text-ds-body-lg-desktop');
  });

  it('comfortable puts the numbers and the label on the 14px desktop step', () => {
    render(
      <Pagination
        page={1}
        pageCount={5}
        onPageChange={() => {}}
        pageSize={10}
        onPageSizeChange={() => {}}
        density="comfortable"
      />,
    );
    const page1 = screen.getByRole('button', { name: '1' });
    expect(page1.className).toContain('text-ds-body-lg-desktop');
    expect(page1.className).not.toContain('text-ds-body-lg-mobile');

    const label = screen.getByText('Item per halaman');
    expect(label.className).toContain('text-ds-body-lg-desktop');
    expect(label.className).not.toContain('text-ds-body-md-mobile');
  });

  /* A stated choice, not a gap: no frame publishes a small comfortable pager, so it takes the same step. */
  it('comfortable keeps the 14px step on the small squares too, at their own 32px geometry', () => {
    render(<Pagination page={1} pageCount={5} onPageChange={() => {}} size="small" density="comfortable" />);
    const page1 = screen.getByRole('button', { name: '1' });
    expect(page1.className).toContain('size-8');
    expect(page1.className).toContain('text-ds-body-lg-desktop');
    expect(page1.className).not.toContain('text-ds-body-md-mobile');
  });
});
