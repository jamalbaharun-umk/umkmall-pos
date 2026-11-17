import type { Meta, StoryObj } from '@storybook/react-vite';
import { contract } from '../../contract';
import { Stepper } from './Stepper';

/**
 * Consumers: the journey run page's stage trail and the account-deletion flow. `Selectable` is the
 * UMK-1809 shape: a finished step passes `onSelect`, and its mark and label are one button.
 *
 * WHAT TO CHECK IN A BROWSER: the completed leg behind a done step is coloured and the one
 * ahead is not, in BOTH orientations; and the first step has no leg at all rather than a
 * zero-length one.
 */
const meta = {
  title: 'Components/Navigation/Stepper',
  component: Stepper,
  args: { steps: [{ label: 'Data usaha' }], 'aria-label': 'Langkah pendaftaran' },
} satisfies Meta<typeof Stepper>;
export default meta;
type Story = StoryObj<typeof meta>;

const TRAIL = [
  { label: 'Data usaha', state: 'done' as const },
  { label: 'Lokasi', state: 'current' as const },
  { label: 'Komunitas', state: 'default' as const },
];

const Grid = ({
  orientations,
  states,
}: {
  orientations: typeof contract.Stepper.axes.orientation;
  states: typeof contract.Stepper.axes.state;
}) => (
  <div style={{ display: 'grid', gap: 40 }}>
    {orientations.map((orientation) => (
      <Stepper
        key={orientation}
        orientation={orientation}
        aria-label={`Contoh ${orientation}`}
        steps={states.map((state) => ({ label: `${orientation} ${state}`, state }))}
      />
    ))}
  </div>
);

export const AllVariants: Story = {
  parameters: {
    docs: {
      source: {
        code: `<Stepper
  aria-label="Langkah pendaftaran"
  steps={[
    { label: 'Data usaha', state: 'done' },
    { label: 'Lokasi', state: 'current' },
    { label: 'Komunitas', state: 'default' },
  ]}
/>`,
      },
    },
  },
  render: () => (
    <Grid orientations={contract.Stepper.axes.orientation} states={contract.Stepper.axes.state} />
  ),
};

export const Horizontal: Story = { args: { steps: TRAIL, orientation: 'horizontal' } };
export const Vertical: Story = { args: { steps: TRAIL, orientation: 'vertical' } };

/** One step: no connector at all, which is the case an index-derived position gets wrong. */
export const SingleStep: Story = {
  args: { steps: [{ label: 'Selesai', state: 'current' }] },
};

/**
 * A step rendered in ISOLATION, the way the design source publishes it — `position` passed
 * explicitly because there is no list for an index to be derived from.
 */
export const StandaloneMiddleStep: Story = {
  args: { steps: [{ label: 'Lokasi', state: 'current', position: 'middle' }] },
};

export const Selectable: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: 40 }}>
      {(['horizontal', 'vertical'] as const).map((orientation) => (
        <Stepper
          key={orientation}
          orientation={orientation}
          aria-label={`Contoh ${orientation}`}
          steps={TRAIL.map((step) => ({
            ...step,
            onSelect: step.state === 'done' ? () => {} : undefined,
            selectLabel: step.state === 'done' ? `Lihat ${step.label}` : undefined,
          }))}
        />
      ))}
    </div>
  ),
};
