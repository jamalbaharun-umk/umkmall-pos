import type { Meta, StoryObj } from '@storybook/react-vite';
import { contract } from '../../contract';
import { Icon } from '../Icon';
import { Badge } from './Badge';

/**
 * `bestseller` IS THE ONE TO LOOK AT. Five of the six colours are 10% tints of their
 * function; it is the solid success surface with inverted text, which is why the live pill on
 * a course card is saturated green rather than pale mint. The grid puts them side by side so
 * that difference reads as deliberate rather than as a mistake.
 *
 * `args` on the meta, not just on each story: `children` is required, so a render-only grid
 * story would otherwise have to carry args it has no use for.
 */
const meta = {
  title: 'Components/Content/Badge',
  component: Badge,
  args: { children: 'Kelas' },
} satisfies Meta<typeof Badge>;
export default meta;
type Story = StoryObj<typeof meta>;

const Grid = ({
  colors,
  sizes,
}: {
  colors: typeof contract.Badge.axes.color;
  sizes: typeof contract.Badge.axes.size;
}) => (
  <div style={{ display: 'grid', gap: 16, justifyItems: 'start' }}>
    {colors.map((color) => (
      <div key={color} style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        {sizes.map((size) => (
          <Badge key={size} color={color} size={size}>
            {`${color} ${size}`}
          </Badge>
        ))}
      </div>
    ))}
  </div>
);

export const AllVariants: Story = {
  parameters: {
    docs: {
      source: {
        code: `<Badge color="success">Kelas</Badge>`,
      },
    },
  },
  render: () => (
    <Grid colors={contract.Badge.axes.color} sizes={contract.Badge.axes.size} />
  ),
};

export const Default: Story = {};
export const BestSeller: Story = { args: { color: 'bestseller', children: 'Best Seller' } };
export const WithIcon: Story = {
  args: {
    color: 'success',
    children: 'Selesai',
    iconLeft: <Icon name="check" className="h-3.5 w-3.5" />,
  },
};

/**
 * THE GRADIENT VALUE. Both stops are published tokens and both are classes — nothing here is
 * an inline colour.
 *
 * WHAT THIS DOES NOT COVER, so nobody reads more into it: the two live topic badges take an
 * authored `from`/`to` pair off data carrying eleven distinct combinations. A closed axis
 * cannot express an arbitrary pair, and a passthrough would re-admit the arbitrary colour this
 * component's rewrite removed. Those stay hand-rolled until someone decides what the eleven
 * collapse to.
 */
export const Gradient: Story = { args: { color: 'gradient', children: 'Baru' } };
