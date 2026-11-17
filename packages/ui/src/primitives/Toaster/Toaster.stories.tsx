import type { Meta, StoryObj } from '@storybook/react-vite';
import { contract } from '../../contract';
import { Alert } from '../Alert';
import { Toaster, toast } from './Toaster';

/**
 * The host is a singleton that renders nothing until something is queued, so every story
 * mounts it beside the buttons that raise a toast.
 *
 * The queue, the timer and the announcement need real time to be seen, which no static
 * story can show — so the grid below ALSO renders the toast visual inline, and that is
 * what the story guard reads. A guard waiting on sonner's timers would be measuring
 * sonner rather than this package.
 */
const meta = {
  title: 'Components/Feedback/Toaster',
  component: Toaster,
  args: {},
} satisfies Meta<typeof Toaster>;
export default meta;
type Story = StoryObj<typeof meta>;

const Raise = ({
  variants,
  sizes,
}: {
  variants: readonly ('success' | 'info' | 'warning' | 'danger')[];
  sizes: readonly ('large' | 'medium' | 'small')[];
}) => (
  <div style={{ display: 'grid', gap: 24, maxWidth: 520 }}>
    <Toaster />
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      {variants.map((fn) => (
        <button key={fn} type="button" onClick={() => toast(`Toast ${fn}`, { variant: fn })}>
          {`Raise ${fn}`}
        </button>
      ))}
      <button type="button" onClick={() => toast.dismiss()}>
        Dismiss all
      </button>
    </div>
    {/* The same visual the host renders, standing still so it can be looked at. NO fake
        close button here: a story that mocks the affordance turns the guard reading it into
        a guard measuring the mock. The real one arrives with the real host, above. */}
    <div style={{ display: 'grid', gap: 12 }}>
      {variants.map((fn) =>
        sizes.map((size) => (
          <Alert
            key={`${fn}-${size}`}
            type="toast"
            variant={fn}
            size={size}
          >
            {`toast · ${fn} · ${size}`}
          </Alert>
        )),
      )}
    </div>
  </div>
);

export const AllVariants: Story = {
  parameters: {
    docs: {
      source: {
        code: `<Toaster />
// elsewhere:
toast('Berhasil disimpan', { variant: 'success' });`,
      },
    },
  },
  render: () => (
    <Raise variants={contract.Alert.axes.function} sizes={contract.Alert.axes.size} />
  ),
};

/** Raising several shows the stack, the cap and the auto-dismiss in one press. */
export const StacksAndCaps: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: 16 }}>
      <Toaster visibleToasts={2} />
      <button
        type="button"
        onClick={() => {
          for (const n of ['Satu', 'Dua', 'Tiga', 'Empat']) toast(n);
        }}
      >
        Raise four with a cap of two
      </button>
    </div>
  ),
};
