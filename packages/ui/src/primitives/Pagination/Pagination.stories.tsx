import React from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { contract } from '../../contract';
import { Pagination } from './Pagination';

const meta: Meta<typeof Pagination> = {
  title: 'Components/Navigation/Pagination',
  component: Pagination,
  args: { page: 1, pageCount: 5, onPageChange: () => {} },
};
export default meta;

type Story = StoryObj<typeof Pagination>;

/** Stateful, so the arrows and numbers can be clicked through. */
const Live = (props: Partial<React.ComponentProps<typeof Pagination>>) => {
  const [page, setPage] = React.useState(props.page ?? 1);
  const [pageSize, setPageSize] = React.useState(10);
  return (
    <Pagination
      pageCount={12}
      {...props}
      page={page}
      onPageChange={setPage}
      pageSize={pageSize}
      onPageSizeChange={setPageSize}
    />
  );
};

export const Default: Story = { render: () => <Live /> };

/** Figma `Type`: the current page at the start, the middle and the end of the range. */
export const Positions: Story = {
  render: () => (
    <div className="space-y-4">
      <Pagination page={1} pageCount={5} onPageChange={() => {}} />
      <Pagination page={3} pageCount={5} onPageChange={() => {}} />
      <Pagination page={5} pageCount={5} onPageChange={() => {}} />
    </div>
  ),
};

/** Figma `Page: >9` — the ellipsis follows from the count. */
export const ManyPages: Story = { args: { page: 6, pageCount: 20 } };

/** Every `size` the contract declares. */
export const Sizes: Story = {
  render: () => (
    <div className="space-y-4">
      {contract.Pagination.axes.size.map((size) => (
        <Live key={size} size={size} />
      ))}
    </div>
  ),
};

/** Every `density` the contract declares — type size only, the squares keep their geometry. */
export const Densities: Story = {
  render: () => (
    <div className="space-y-4">
      {contract.Pagination.axes.density.map((density) => (
        <Live key={density} density={density} />
      ))}
    </div>
  ),
};

export const Empty: Story = { args: { page: 1, pageCount: 0 } };

/**
 * A CURSOR source (admin's gallery, an S3 listing): no `pageCount`, so the strip shows the current
 * page alone and `hasPrev` / `hasNext` decide the arrows. `disabled` holds every control while the
 * next page is fetched, and `summary` carries the row count on the left.
 */
const CursorHarness = () => {
  const [page, setPage] = React.useState(1);
  const [busy, setBusy] = React.useState(false);
  const go = (next: number) => {
    setBusy(true);
    setTimeout(() => {
      setPage(next);
      setBusy(false);
    }, 500);
  };
  return (
    <Pagination
      page={page}
      onPageChange={go}
      hasPrev={page > 1}
      hasNext={page < 4}
      disabled={busy}
      summary={<span>{page < 4 ? 50 : 12} baris</span>}
    />
  );
};

export const Cursor: Story = { render: () => <CursorHarness /> };
