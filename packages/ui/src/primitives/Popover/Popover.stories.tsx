import type { Meta, StoryObj } from '@storybook/react-vite';
import { contract } from '../../contract';
import { Popover, PopoverContent, PopoverTrigger } from '.';

/**
 * In place by default; the `portal` prop renders into `document.body`.
 * CAN portal, its stories get their own docs iframe (`portal-stories.test.ts`): a portalled
 * story rendered inline would escape its container and cover the docs page.
 */
const meta = {
  parameters: {
    docs: { story: { inline: false, height: '320px' } },
  },
  title: 'Components/Overlays/Popover',
  component: PopoverContent,
} satisfies Meta<typeof PopoverContent>;
export default meta;
type Story = StoryObj<typeof meta>;

const Example = ({ align, open }: { align?: (typeof contract.Popover.axes.align)[number]; open?: boolean }) => (
  <Popover defaultOpen={open}>
    <PopoverTrigger asChild>
      <button type="button" className="rounded-ds-md border border-default-primary px-ds-sm py-ds-2xs">
        {align ?? 'Filter'}
      </button>
    </PopoverTrigger>
    {/* Focus stays put on open: the grid opens three at once, and a panel taking focus would
        dismiss the one before it as a focus-outside. */}
    <PopoverContent align={align} aria-label="Filter" onOpenAutoFocus={(e) => e.preventDefault()}>
      <p className="text-ds-body-lg-mobile text-default-primary">Isi apa saja di sini.</p>
    </PopoverContent>
  </Popover>
);

const Aligns = ({ aligns }: { aligns: readonly (typeof contract.Popover.axes.align)[number][] }) => (
  <div style={{ display: 'flex', gap: 160, padding: 24 }}>
    {aligns.map((align) => (
      <Example key={align} align={align} open />
    ))}
  </div>
);

export const Open: Story = { render: () => <Example open /> };
export const Closed: Story = { render: () => <Example /> };
export const AllAligns: Story = { render: () => <Aligns aligns={contract.Popover.axes.align} /> };
