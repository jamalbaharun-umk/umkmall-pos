import type { Meta, StoryObj } from '@storybook/react-vite';
import { contract } from '../../contract';
import { Slider } from './Slider';

/**
 * Figma publishes `Slider` 1308:8026 — a `Size` axis and nothing else. The track heights and
 * thumb diameters come from it; everything else here is ours, so these stories are still the
 * deliverable for the states the set does not carry.
 *
 * KEYBOARD: arrows step, Home and End reach the bounds, Page Up / Page Down jump where the
 * browser implements them (Safari does not). Exercised here on a real browser — happy-dom
 * implements no native key defaults, so the suite cannot see it.
 */
const meta = {
  title: 'Components/Form/Slider',
  component: Slider,
  args: { label: 'Kualitas gambar' },
} satisfies Meta<typeof Slider>;
export default meta;
type Story = StoryObj<typeof meta>;

const Sizes = ({ sizes }: { sizes: readonly ('large' | 'small')[] }) => (
  <div style={{ display: 'grid', gap: 24, maxWidth: 420 }}>
    {sizes.map((size) => (
      <Slider key={size} label={size} size={size} defaultValue={50} />
    ))}
  </div>
);

export const AllSizes: Story = {
  parameters: {
    docs: {
      source: {
        code: `<Slider label="Kualitas gambar" value={quality} onChange={(e) => setQuality(Number(e.target.value))} />`,
      },
    },
  },
  render: () => <Sizes sizes={contract.Slider.axes.size} />,
};

export const Extremes: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: 24, maxWidth: 420 }}>
      <Slider label="Minimum" defaultValue={0} />
      <Slider label="Maksimum" defaultValue={100} />
    </div>
  ),
};

/** A stepped range: 0-10 in fives. */
export const Stepped: Story = { args: { label: 'Tingkat', min: 0, max: 10, step: 5, defaultValue: 5 } };

/** With a formatter the value is SPOKEN, not just shown — the one place ahead of the reference. */
export const AnnouncedValue: Story = {
  args: { label: 'Kualitas gambar', defaultValue: 60, formatValue: (v: number) => `${v} persen` },
};

/** UMK-1383: the video player's 4px seek bar. The thumb shows on hover or focus only. */
export const Scrubber: Story = {
  args: { label: undefined, 'aria-label': 'Posisi video', appearance: 'scrubber', defaultValue: 30 },
  decorators: [(Story) => <div style={{ maxWidth: 420, padding: 16, background: '#222' }}>{Story()}</div>],
};

export const Disabled: Story = { args: { label: 'Kualitas gambar', defaultValue: 40, disabled: true } };

/**
 * THE OTHER ARM. No visible label at all — the name reaches assistive technology only, which
 * is what a surface whose wire format carries no label has to fall back on. Omitting both is
 * a build error, not a story.
 */
export const AccessibleNameOnly: Story = {
  args: { label: undefined, 'aria-label': 'Kualitas gambar', defaultValue: 70 },
};
