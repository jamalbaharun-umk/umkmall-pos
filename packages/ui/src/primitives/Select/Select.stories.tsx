import type { Meta, StoryObj } from '@storybook/react-vite';
import React from 'react';
import { contract } from '../../contract';
import { Select } from './Select';

/**
 * WHAT TO CHECK IN A BROWSER: open with ArrowDown, move with the arrows, select with Enter, and
 * close with Escape — focus must land back on the trigger, not at the top of the document.
 * happy-dom implements no native key defaults, so the suite drives these handlers directly and
 * only a real browser proves nothing is fighting the platform.
 */
const meta = {
  title: 'Components/Form/Select',
  component: Select,
  args: { label: 'Kategori', options: [] },
} satisfies Meta<typeof Select>;
export default meta;
type Story = StoryObj<typeof meta>;

const OPTIONS = [
  { label: 'Makanan', value: 'makanan' },
  { label: 'Minuman', value: 'minuman' },
  { label: 'Fesyen', value: 'fesyen' },
  { label: 'Kerajinan', value: 'kerajinan' },
];

const Grid = ({
  sizes,
  statuses,
}: {
  sizes: typeof contract.Select.axes.size;
  statuses: typeof contract.Select.axes.status;
}) => (
  <div style={{ display: 'grid', gap: 24, maxWidth: 420 }}>
    {sizes.map((size) =>
      statuses.map((status) => (
        <Select
          key={`${size}-${status}`}
          size={size}
          label={`${size} · ${status}`}
          options={OPTIONS}
          value={status === 'filled' ? 'makanan' : undefined}
          disabled={status === 'disabled'}
          error={status === 'error' ? 'Wajib dipilih' : undefined}
        />
      )),
    )}
  </div>
);

export const AllSizes: Story = {
  parameters: {
    docs: {
      source: {
        code: `<Select label="Kategori" options={options} value={value} onValueChange={setValue} />`,
      },
    },
  },
  render: () => <Grid sizes={contract.Select.axes.size} statuses={contract.Select.axes.status} />,
};

export const Default: Story = { args: { options: OPTIONS } };

/* A COMPONENT, not a hook-bearing render function — see `SelectionCard.stories.tsx`. */
const ControlledDemo = () => {
  const [value, setValue] = React.useState('minuman');
  return <Select label="Kategori" options={OPTIONS} value={value} onValueChange={setValue} />;
};

export const Controlled: Story = { render: () => <ControlledDemo /> };

/** The searchable case and the plain case are ONE component with the affordance on or off. */
export const Searchable: Story = { args: { options: OPTIONS, showSearch: true } };

/** An empty result is a message, not a blank box. Type something that matches nothing. */
export const EmptyResult: Story = {
  args: { options: OPTIONS, showSearch: true, emptyMessage: 'Kategori tidak ditemukan' },
};

export const WithDisabledOption: Story = {
  args: { options: [...OPTIONS, { label: 'Segera hadir', value: 'soon', disabled: true }] },
};

export const WithError: Story = { args: { options: OPTIONS, error: 'Wajib dipilih' } };
export const Disabled: Story = { args: { options: OPTIONS, disabled: true } };

/** No visible label — the other arm of the labelling union. */
export const AccessibleNameOnly: Story = {
  args: { label: undefined, 'aria-label': 'Kategori', options: OPTIONS },
};

/**
 * THE ONBOARDING SHAPE, which is what these four props exist for: a province/city pair where
 * the city is disabled until a province is picked, both fetch, and two same-named cities are
 * told apart only by their hint.
 */
export const WithHints: Story = {
  args: {
    label: 'Kota',
    showSearch: true,
    options: [
      { label: 'Bogor', value: 'bogor-kota', hint: 'Kota' },
      { label: 'Bogor', value: 'bogor-kab', hint: 'Kabupaten' },
      { label: 'Bekasi', value: 'bekasi', hint: 'Jawa Barat' },
    ],
  },
};

export const Loading: Story = { args: { label: 'Kota', options: [], loading: true } };

export const DisabledWithHint: Story = {
  args: { label: 'Kota', options: [], disabled: true, disabledHint: 'Pilih provinsi dulu' },
};

/** The caller owns the query: the component reports keystrokes and renders what it is given. */
const CallerFilteredDemo = () => {
  const [query, setQuery] = React.useState('');
  const all = OPTIONS;
  const shown = all.filter((o) => o.label.toLowerCase().startsWith(query.toLowerCase()));
  return (
    <Select label="Kategori" options={shown} showSearch onSearch={setQuery} />
  );
};

export const CallerOwnedSearch: Story = { render: () => <CallerFilteredDemo /> };

/**
 * UMK-1119: type a category that is not listed ("Kerajinan Tangan") and choose the Tambah row.
 * The caller owns `options` — this demo appends the created row and the trigger selects it.
 */
const CreateOptionDemo = () => {
  const [options, setOptions] = React.useState(OPTIONS);
  const [value, setValue] = React.useState<string>();
  return (
    <Select
      label="Kategori"
      options={options}
      value={value}
      onValueChange={setValue}
      showSearch
      onCreate={(query) => {
        const option = { label: query, value: query.toLowerCase() };
        setOptions((prev) => [...prev, option]);
        return option;
      }}
    />
  );
};

export const CreateOption: Story = { render: () => <CreateOptionDemo /> };

/** `multiple` (UMK-1185): the list stays open between picks and the trigger summarises. */
const MultipleExample = () => {
  const [value, setValue] = React.useState<string[]>(['makanan', 'fesyen']);
  return (
    <div style={{ maxWidth: 360 }}>
      <Select
        label="Kategori"
        multiple
        showSearch
        value={value}
        onValueChange={setValue}
        options={[
          { label: 'Makanan', value: 'makanan' },
          { label: 'Minuman', value: 'minuman' },
          { label: 'Fesyen', value: 'fesyen' },
        ]}
      />
    </div>
  );
};

export const Multiple: Story = { render: () => <MultipleExample /> };

/** UMK-955: `detail` is a second column at full weight; the trigger shows only the label. */
export const DetailColumn: Story = {
  render: () => (
    <div style={{ maxWidth: 360 }}>
      <Select
        label="Ukuran Gambar"
        value="1:1"
        options={[
          { label: '1:1', value: '1:1', detail: 'Feed Instagram' },
          { label: '16:9', value: '16:9', detail: 'YouTube, Banner' },
          { label: '9:16', value: '9:16', detail: 'Story, Reels, TikTok' },
        ]}
      />
    </div>
  ),
};
