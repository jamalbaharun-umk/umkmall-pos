import type { Meta, StoryObj } from '@storybook/react-vite';
import { contract } from '../../contract';
import { DateTimeInput } from './DateTimeInput';

/**
 * KEYBOARD: Escape closes the calendar and returns focus to the field; arrows move across
 * days and Page Up / Page Down change month. Worth walking here as well as in the suite,
 * since the popover's focus handling is only real in a browser.
 */
const meta = {
  title: 'Components/Form/DateTimeInput',
  component: DateTimeInput,
  args: { label: 'Tanggal mulai' },
} satisfies Meta<typeof DateTimeInput>;
export default meta;
type Story = StoryObj<typeof meta>;

const Sizes = ({ sizes }: { sizes: readonly ('large' | 'small')[] }) => (
  <div style={{ display: 'grid', gap: 24, maxWidth: 420 }}>
    {sizes.map((size) => (
      <DateTimeInput key={size} label={size} size={size} defaultValue="2026-03-15" />
    ))}
  </div>
);

export const AllSizes: Story = {
  parameters: {
    docs: {
      source: {
        code: `<DateTimeInput label="Tanggal mulai" value={date} onValueChange={setDate} />`,
      },
    },
  },
  render: () => <Sizes sizes={contract.DateTimeInput.axes.size} />,
};

export const Empty: Story = { args: { label: 'Tanggal mulai' } };
export const Filled: Story = { args: { label: 'Tanggal mulai', defaultValue: '2026-03-15' } };
/**
 * OPEN THE CALENDAR AND MOVE THE POINTER ACROSS THE SELECTED DAY (UMK-1091). It used to go
 * pale under the pointer: the selection fill was on the day cell and the hover tint on the
 * button inside it, so the hover painted over the selection. This is the reported symptom and
 * the only check that proves it — happy-dom has no pointer and applies no stylesheet.
 *
 * Also worth a look while it is open: the selected day's corner is Figma's 6px rather than a
 * full pill, an out-of-range day is grey rather than pale blue, and today is brand-coloured
 * with no bold.
 */
export const SelectedSurvivesHover: Story = {
  args: { label: 'Tanggal mulai', defaultValue: '2026-03-15' },
};

export const Required: Story = { args: { label: 'Tanggal mulai', required: true } };
export const WithError: Story = { args: { label: 'Tanggal mulai', error: 'Tanggal tidak valid' } };
export const Disabled: Story = { args: { label: 'Tanggal mulai', disabled: true, defaultValue: '2026-03-15' } };

/**
 * THE OTHER ARM. No visible label — the accessible name only, for the surface whose wire
 * format cannot supply one.
 */
export const AccessibleNameOnly: Story = {
  args: { label: undefined, 'aria-label': 'Tanggal mulai', defaultValue: '2026-03-15' },
};

/**
 * `min` / `max` on a single date: typing a date outside them is refused, not only greyed out
 * in the calendar. Not the `range` selection — see `Range` below.
 */
export const MinMax: Story = {
  args: { label: 'Tanggal promo', min: '2026-03-01', max: '2026-03-31', defaultValue: '2026-03-10' },
};

/** `selection` (UMK-1185), one field per value, fed from the contract. */
const Selections = ({ selections }: { selections: readonly ('single' | 'range')[] }) => (
  <div style={{ display: 'grid', gap: 24, maxWidth: 420 }}>
    {selections.map((selection) =>
      selection === 'range' ? (
        <DateTimeInput key={selection} label={selection} selection="range" defaultRangeValue={{ from: '2026-03-02', to: '2026-03-09' }} />
      ) : (
        <DateTimeInput key={selection} label={selection} defaultValue="2026-03-15" />
      ),
    )}
  </div>
);

/** `selection: 'range'`: pick two days, then Terapkan. Hapus empties the draft; the x clears the field. */
export const Range: Story = {
  args: {
    label: 'Periode promo',
    selection: 'range',
    defaultRangeValue: { from: '2026-03-02', to: '2026-03-09' },
  },
};

export const AllSelections: Story = {
  render: () => <Selections selections={contract.DateTimeInput.axes.selection} />,
};

/** UMK-1383: a time of day, `HH:mm`, with the platform time input inside the field box. */
export const TimeOnly: Story = { args: { label: 'Jam mulai', timeOnly: true, defaultValue: '09:30' } };

/** `withTime` with presets: open the calendar for the hour and minute fields. */
export const WithTime: Story = {
  args: {
    label: 'Mulai berlaku',
    withTime: true,
    defaultValue: '2026-03-15T09:30',
    presets: [{ label: 'Sekarang', value: () => '2026-03-15T09:30' }],
  },
};

/** A plain date shows day-first (`15/03/2026`) and is typed that way; the value stays `YYYY-MM-DD`. */
export const DayFirstDate: Story = {
  args: { label: 'Tanggal lahir', defaultValue: '2026-03-15' },
};
