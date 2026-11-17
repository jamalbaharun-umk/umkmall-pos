import type { Meta, StoryObj } from '@storybook/react-vite';
import { contract } from '../../contract';
import { Label } from './Label';

/**
 * The STANDALONE label, and the reason it looks redundant is worth reading before reaching
 * for it. Every slice-2 control owns its own label (see `TextField`'s divergence), so this is
 * not the label you put above a `TextField` — it is the one for a group heading, a fieldset,
 * or a non-control that still needs an accessible name. Reaching for it on a control that
 * already has a `label` prop gives that field two names.
 *
 * The `required` asterisk is decorative and carries no accessible text: a screen reader is
 * told by the control's own `required`, not by this glyph.
 */
const meta = {
  title: 'Components/Form/Label',
  component: Label,
  args: { children: 'Nama usaha' },
} satisfies Meta<typeof Label>;
export default meta;
type Story = StoryObj<typeof meta>;

const Grid = ({
  variants,
  sizes,
}: {
  variants: typeof contract.Label.axes.variant;
  sizes: typeof contract.Label.axes.size;
}) => (
  <div style={{ display: 'grid', gap: 16, justifyItems: 'start' }}>
    {variants.map((variant) => (
      <div key={variant} style={{ display: 'flex', gap: 24, alignItems: 'baseline' }}>
        {sizes.map((size) => (
          <Label key={size} variant={variant} size={size}>
            {`${variant} / ${size}`}
          </Label>
        ))}
      </div>
    ))}
  </div>
);

/** The cross-product, drawn from the contract so a new axis value cannot go undrawn. */
export const AllVariants: Story = {
  parameters: {
    docs: { source: { code: `<Label htmlFor="business-name">Nama usaha</Label>` } },
  },
  render: () => <Grid variants={contract.Label.axes.variant} sizes={contract.Label.axes.size} />,
};

export const Required: Story = { args: { required: true } };

export const Error: Story = { args: { variant: 'error', children: 'Nama usaha wajib diisi' } };

export const Success: Story = { args: { variant: 'success', children: 'Nama usaha tersedia' } };

/** UMK-955: the caption a web form control draws over its own box, Figma Field Input's Large (14/20). */
export const FieldLarge: Story = { args: { look: 'field-large', children: 'Nama Lengkap', required: true } };

/** UMK-955: Figma Field Input's Small caption (12/18). */
export const FieldSmall: Story = { args: { look: 'field-small', children: 'Nama Lengkap', required: true } };
