import type { Meta, StoryObj } from '@storybook/react-vite';
import { contract } from '../../contract';
import { Disclosure } from './Disclosure';

/**
 * ONE GRID, over `appearance` only (UMK-1307): no Disclosure set exists in Ensyra, so the only
 * axis is ours — the agent surface's pre-library look — and `pendingAxes` still holds the size
 * a published set would add.
 *
 * NATIVE `<details>` / `<summary>`. Try it with the keyboard — Enter and Space both work, and
 * the open state is announced, none of which had to be written. That is the argument for the
 * element over a hand-rolled toggle, where the announcement is the part always left out.
 */
const meta = {
  title: 'Components/Content/Disclosure',
  component: Disclosure,
  args: {
    title: 'Bagaimana cara menghitung margin?',
    children: 'Margin = (harga jual − modal) ÷ harga jual × 100%.',
  },
} satisfies Meta<typeof Disclosure>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Folded: Story = {};
export const Expanded: Story = { args: { defaultOpen: true } };

/** Stacked, which is how a FAQ actually uses it. Each fold is independent — no accordion here. */
export const Stacked: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: 8, maxWidth: 420 }}>
      <Disclosure title="Bagaimana cara menghitung margin?">
        Margin = (harga jual − modal) ÷ harga jual × 100%.
      </Disclosure>
      <Disclosure title="Kapan harus menaikkan harga?">
        Saat modal naik lebih dari 10% dan margin turun di bawah target.
      </Disclosure>
    </div>
  ),
};

const AppearanceGrid = ({ appearances }: { appearances: typeof contract.Disclosure.axes.appearance }) => (
  <div style={{ display: 'grid', gap: 8, maxWidth: 420 }}>
    {appearances.map((appearance) => (
      <Disclosure key={appearance} appearance={appearance} defaultOpen title={appearance}>
        Margin = (harga jual − modal) ÷ harga jual × 100%.
      </Disclosure>
    ))}
  </div>
);

/** The default look beside the agent surface's pre-library one, both open so the panel shows. */
export const AllVariants: Story = {
  render: () => <AppearanceGrid appearances={contract.Disclosure.axes.appearance} />,
};
