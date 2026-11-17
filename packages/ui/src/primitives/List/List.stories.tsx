import type { Meta, StoryObj } from '@storybook/react-vite';
import { List } from './List';

/**
 * NO GRID STORY, and that is the honest answer rather than an omission. `List`'s contract
 * entry carries `axes: {}` plus `pendingAxes` because Ensyra publishes no List set at all —
 * there is nothing to iterate, and a grid fed from an empty array would satisfy the guard by
 * rendering nothing. The guard keys that exemption off the contract, so the day a set lands
 * and the entry gains a real axis, it starts demanding a grid here on its own.
 *
 * `direction` is not that axis. It is a layout choice rather than a design variant, which is
 * why it stays a prop and never became contract vocabulary.
 *
 * IT RENDERS A `<div>`, NOT A `<ul>`. Items author their own bold-prefixed prose, so each is
 * a paragraph rather than a list item — a semantic list around them would announce a list of
 * paragraphs. `bullet` draws its own dot for the same reason: a native marker sits at the
 * wrong baseline against that prose.
 */
const meta = {
  title: 'Components/Content/List',
  component: List,
  args: {
    children: [
      <span key="a">
        <strong>Modal</strong> — hitung ulang tiap bulan
      </span>,
      <span key="b">
        <strong>Margin</strong> — target minimal 30%
      </span>,
      <span key="c">
        <strong>Stok</strong> — catat keluar-masuk harian
      </span>,
    ],
  },
} satisfies Meta<typeof List>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Vertical: Story = {};
export const Bullet: Story = { args: { direction: 'bullet' } };
export const Horizontal: Story = {
  args: { direction: 'horizontal', children: ['Satu', 'Dua', 'Tiga'] },
};

/** Real list semantics (UMK-960). Items here are list-shaped, unlike the a2ui prose above. */
export const AsUnorderedList: Story = {
  args: { as: 'ul', direction: 'bullet', children: ['Satu', 'Dua', 'Tiga'] },
};
export const AsOrderedList: Story = {
  args: { as: 'ol', children: ['Daftar akun', 'Isi data usaha', 'Mulai belajar'] },
};

/** Native markers on a block list, with a chosen row gap (UMK-960). */
export const Marked: Story = {
  args: { as: 'ul', marker: 'disc', gap: 'xs', children: ['Satu', 'Dua', 'Tiga'] },
};

/** A flex list whose gap changes at a breakpoint (a marquee track); resize the canvas past `lg`. */
export const ResponsiveGap: Story = {
  args: { direction: 'horizontal', gap: { base: '2xl', lg: '3xl-mobile' }, children: ['Satu', 'Dua', 'Tiga'] },
};
