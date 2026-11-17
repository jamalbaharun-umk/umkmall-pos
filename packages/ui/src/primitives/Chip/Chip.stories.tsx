import type { Meta, StoryObj } from '@storybook/react-vite';
import { contract } from '../../contract';
import { Icon } from '../Icon';
import { Chip } from './Chip';

/**
 * The interactive half of the Badge/Chip split. Tab to one and press it — it is a real
 * button, where the pills it replaces were spans with an onClick: clickable by mouse and
 * invisible to everything else.
 *
 * `default` and `active` must stay VISIBLY apart at every size. A selection control whose two
 * states render the same thing works perfectly and communicates nothing, and the grid is
 * where that would be obvious.
 */
const meta = {
  title: 'Components/Content/Chip',
  component: Chip,
  args: { children: 'Pemasaran' },
} satisfies Meta<typeof Chip>;
export default meta;
type Story = StoryObj<typeof meta>;

const Grid = ({
  states,
  sizes,
}: {
  states: typeof contract.Chip.axes.state;
  sizes: typeof contract.Chip.axes.size;
}) => (
  <div style={{ display: 'grid', gap: 16, justifyItems: 'start' }}>
    {states.map((state) => (
      <div key={state} style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        {sizes.map((size) => (
          <Chip key={size} state={state} size={size}>
            {`${state} ${size}`}
          </Chip>
        ))}
      </div>
    ))}
  </div>
);

export const AllVariants: Story = {
  parameters: {
    docs: {
      source: {
        code: `<Chip state="active" onClick={() => {}}>Pemasaran</Chip>`,
      },
    },
  },
  render: () => <Grid states={contract.Chip.axes.state} sizes={contract.Chip.axes.size} />,
};

export const Default: Story = {};
export const Active: Story = { args: { state: 'active', children: 'Terpilih' } };
export const Disabled: Story = { args: { disabled: true, children: 'Tidak tersedia' } };
export const WithIcon: Story = {
  args: { children: 'Filter', iconLeft: <Icon name="search" className="h-4 w-4" /> },
};
