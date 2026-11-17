import type { Meta, StoryObj } from '@storybook/react-vite';
import { contract } from '../../contract';
import { Icon } from '../Icon';
import { Button } from './Button';

/**
 * The canary (UMK-879 KTD6). Foundation stories render token *values* and would look
 * entirely correct with every Tailwind class purged; this is the only thing in the ticket
 * that makes "component classes render styled" observable.
 */
const meta = {
  title: 'Foundations/Button',
  component: Button,
  args: { children: 'Kirim', width: 'auto' },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

// Figma's `Type` (shape) and `Colors` (hue) are separate axes, so these are two rows of a
// cross-product rather than one flat variant list.
export const Filled: Story = {};
export const Outlined: Story = { args: { type: 'ghost' } };
export const Outline: Story = { args: { type: 'outline' } };
export const Bare: Story = { args: { type: 'text' } };
export const Danger: Story = { args: { color: 'danger', children: 'Hapus' } };
export const OutlinedDanger: Story = { args: { type: 'ghost', color: 'danger', children: 'Hapus' } };
export const Light: Story = { args: { color: 'light' } };
export const Dark: Story = { args: { color: 'dark' } };
export const Loading: Story = { args: { isLoading: true } };
export const Disabled: Story = { args: { disabled: true } };

/**
 * THE FULL GRID, ENABLED OVER DISABLED — and the only place UMK-1091's Button work is
 * visible. The disabled row used to be four faded copies of one another because the base
 * carried a single `disabled:opacity-50`; it should now read as four distinguishable colours,
 * each Figma's published disable step.
 *
 * WHAT TO CHECK BY EYE, since no test here can: the ghost stroke measures 1px in devtools on
 * brand, light and danger and 2px on dark (Figma draws it that way); and the three non-brand
 * colours are Figma's values rather than the legacy palette's — the table in `Button.tsx`
 * records every hex that moved.
 */
export const EveryColourEnabledAndDisabled: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: 16 }}>
      {contract.Button.axes.type.map((type) => (
        <div key={type} style={{ display: 'grid', gap: 8 }}>
          {[false, true].map((disabled) => (
            <div key={String(disabled)} style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {contract.Button.axes.color.map((color) => (
                <Button key={color} type={type} color={color} width="auto" disabled={disabled}>
                  {`${type} ${color}`}
                </Button>
              ))}
            </div>
          ))}
        </div>
      ))}
    </div>
  ),
};

/**
 * ICON-ONLY AT EVERY SIZE. What to look at: each one is a SQUARE that lines up with the text
 * button of the same size, and none of them stretches — no `className` and no `width` needed
 * at the call site, which is what all 74-plus live icon buttons pass today.
 */
export const IconOnly: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
      {contract.Button.axes.size.map((size) => (
        <Button key={size} iconOnly aria-label={`Tutup ${size}`} size={size}>
          <Icon name="x" size="sm" />
        </Button>
      ))}
    </div>
  ),
};

/**
 * UNSTYLED AND ASCHILD. What to look at: the unstyled button carries only the classes passed
 * to it (no fill, pill or width), and `asChild` renders a real link with the same props.
 */
export const Unstyled: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
      <Button unstyled className="rounded border border-default-primary px-3 py-1">
        Unstyled
      </Button>
      <Button unstyled disabled className="rounded border border-default-primary px-3 py-1">
        Unstyled disabled
      </Button>
    </div>
  ),
};

export const AsChild: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
      <Button unstyled asChild className="underline">
        <a href="#as-child">Link as unstyled button</a>
      </Button>
      <Button asChild width="auto">
        <a href="#as-child">Link as styled button</a>
      </Button>
    </div>
  ),
};
