import type { Meta, StoryObj } from '@storybook/react-vite';
import { contract } from '../../contract';
import { Card } from './Card';

/**
 * A container, and only a container. The published Figma set called Card is a COURSE card —
 * a rating row, a struck-through price, tags — which is a content component built on top of
 * this rather than this. The contract records that as a divergence.
 *
 * `padding` is the only axis. The legacy component also carried `variant`, dropped
 * deliberately because nothing passed it and neither treatment had a design behind it.
 */
const meta = {
  title: 'Components/Content/Card',
  component: Card,
  args: { children: 'Isi kartu' },
} satisfies Meta<typeof Card>;
export default meta;
type Story = StoryObj<typeof meta>;

const Grid = ({
  variants,
  paddings,
}: {
  variants: typeof contract.Card.axes.variant;
  paddings: typeof contract.Card.axes.padding;
}) => (
  <div style={{ display: 'grid', gap: 24, maxWidth: 460 }}>
    {variants.map((variant) => (
      <div key={variant} style={{ display: 'grid', gap: 8 }}>
        <span style={{ fontSize: 12, opacity: 0.6 }}>{variant}</span>
        {paddings.map((padding) => (
          <Card key={padding} variant={variant} padding={padding}>
            <span style={{ fontSize: 12, opacity: 0.6 }}>{`${variant} / ${padding}`}</span>
          </Card>
        ))}
      </div>
    ))}
  </div>
);

export const AllVariants: Story = {
  parameters: {
    docs: {
      source: {
        code: `<Card variant="outlined" padding="medium">Isi kartu</Card>`,
      },
    },
  },
  render: () => (
    <Grid variants={contract.Card.axes.variant} paddings={contract.Card.axes.padding} />
  ),
};

/** The dominant TemanAI treatment: a border, no shadow. */
export const Outlined: Story = { args: { variant: 'outlined' } };

/** No chrome at all, for a card whose surface supplies its own. */
export const Plain: Story = { args: { variant: 'plain', padding: 'none' } };

export const Default: Story = {};
export const Flush: Story = {
  args: { padding: 'none', children: 'Tanpa padding — untuk kartu dengan gambar penuh' },
};

/** Every corner rung. `lg` is the default; `full` is a pill (a circle on a square card). */
export const Rounded: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: 12, maxWidth: 460 }}>
      {(['none', 'sm', 'md', 'lg', 'full'] as const).map((rounded) => (
        <Card key={rounded} variant="outlined" padding="small" rounded={rounded}>
          <span style={{ fontSize: 12, opacity: 0.6 }}>{`rounded="${rounded}"`}</span>
        </Card>
      ))}
    </div>
  ),
};
