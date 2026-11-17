import type { Meta, StoryObj } from '@storybook/react-vite';
import React from 'react';
import { contract } from '../../contract';
import { Badge } from '../Badge';
import { SelectionCard } from './SelectionCard';

/**
 * THE INVERSION IS WHAT TO LOOK AT. `InsightCards` below is a real payload lifted from the
 * agent surface's content-feed flow: each option's description carries a leading line, so that
 * line becomes the heading and the authored label sits above it as an eyebrow. A card that
 * rendered the label as the heading would get all fifty live instances wrong.
 */
const meta = {
  title: 'Components/Form/SelectionCard',
  component: SelectionCard,
  args: {
    label: 'Pilih tujuan',
    options: [
      { label: '🛒 Bikin orang langsung pesan', value: 'jualan' },
      { label: '📣 Biar lebih dikenal', value: 'dikenal' },
    ],
  },
} satisfies Meta<typeof SelectionCard>;
export default meta;
type Story = StoryObj<typeof meta>;

const OPTIONS = [
  { label: '🛒 Bikin orang langsung pesan', value: 'jualan' },
  { label: '📣 Biar lebih dikenal', value: 'dikenal' },
  { label: '💚 Pelanggan balik lagi', value: 'setia' },
];

const Grid = ({
  sizes,
  states,
}: {
  sizes: typeof contract.SelectionCard.axes.size;
  states: typeof contract.SelectionCard.axes.state;
}) => (
  <div style={{ display: 'grid', gap: 32, maxWidth: 480 }}>
    {sizes.map((size) =>
      states.map((state) => (
        <SelectionCard
          key={`${size}-${state}`}
          label={`${size} · ${state}`}
          size={size}
          disabled={state === 'disabled'}
          value={state === 'selected' ? ['jualan'] : []}
          options={OPTIONS}
        />
      )),
    )}
  </div>
);

export const AllSizes: Story = {
  parameters: {
    docs: {
      source: {
        code: `<SelectionCard
  label="Pilih tujuan"
  multiple
  value={value}
  onValueChange={setValue}
  options={[
    { label: '🛒 Bikin orang langsung pesan', value: 'jualan' },
    { label: '📣 Biar lebih dikenal', value: 'dikenal' },
  ]}
/>`,
      },
    },
  },
  render: () => (
    <Grid sizes={contract.SelectionCard.axes.size} states={contract.SelectionCard.axes.state} />
  ),
};

export const Default: Story = { args: { options: OPTIONS, value: ['dikenal'] } };

/**
 * A REAL PAYLOAD, lifted verbatim from the content-feed flow. Every field the wire format pins
 * is present: icon, label, value and a description whose first line is the generated title.
 */
export const InsightCards: Story = {
  args: {
    label: 'Pilih insight',
    value: ['etalase'],
    options: [
      {
        label: '🔲 Feed dilihat sekaligus',
        value: 'sekaligus',
        icon: '🔲',
        description: 'Orang lihat 9 kotak barengan, bukan satu-satu.',
      },
      {
        label: '📣 Strategi 1 — tarik perhatian',
        value: 'etalase',
        description: 'Etalase pertama\n3 kotak teratas nentuin orang lanjut atau kabur.',
      },
    ],
  },
};

/**
 * A COMPONENT, not a hook-bearing render function. The family guard invokes each story's
 * `render` as a plain call to pull it into the typecheck program, and a hook called that way
 * throws — so anything stateful lives in a component the render function returns.
 */
const MultiSelectDemo = () => {
  const [value, setValue] = React.useState<string[]>(['jualan']);
  return (
    <SelectionCard
      label="Boleh lebih dari satu"
      multiple
      value={value}
      onValueChange={setValue}
      options={OPTIONS}
    />
  );
};

/** Multi-select adds to and removes from the array; single-select emits a one-element one. */
export const MultiSelect: Story = { render: () => <MultiSelectDemo /> };

/** The badge slot is `Chip`'s and `Badge`'s job, not this component's — it just holds them. */
export const WithBadge: Story = {
  args: {
    options: [{ ...OPTIONS[0], badge: <Badge color="bestseller">Populer</Badge> }, OPTIONS[1]],
  },
};

/** No visible group label at all — the other arm of the labelling union. */
export const AccessibleNameOnly: Story = {
  args: { label: undefined, 'aria-label': 'Pilih tujuan', options: OPTIONS },
};

export const Disabled: Story = { args: { options: OPTIONS, disabled: true } };

/**
 * `layout="tile"` (UMK-1218): a pack picker's card — the content centred and the control DRAWN in
 * the top-right corner (Teman AI Page mobile coin cards 14275:102539). The input is the same hidden
 * real radio, so arrow keys and the focus ring behave as in every other story; the corner ring is its
 * picture. One unselected, one selected, one with a badge straddling the top edge.
 */
export const Tile: Story = {
  args: {
    label: undefined,
    'aria-label': 'Pilih paket koin',
    layout: 'tile',
    size: 'small',
    value: ['50'],
    className: 'grid grid-cols-2 gap-ds-md',
    options: [
      { label: '10', value: '10', description: 'Rp 30.000' },
      { label: '50', value: '50', description: 'Rp 120.000', badge: <Badge color="primary">Paling Populer</Badge> },
    ],
  },
};

const CappedDemo = () => {
  const [value, setValue] = React.useState<string[]>([]);
  return (
    <SelectionCard label="Pilih maksimal 2" multiple maxSelect={2} value={value} onValueChange={setValue} options={OPTIONS} />
  );
};

/** UMK-1295: at the cap every unselected card is disabled; untick one and they come back. */
export const MaxSelect: Story = { render: () => <CappedDemo /> };

/** A tiny inline renderer so the story imports nothing from an app: `**x**` becomes bold. */
const bold = (text: string) =>
  text.split(/(\*\*[^*]+\*\*)/).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong> : part,
  );

/** UMK-1295: `renderText` reaches the title and the body, never the label. */
export const Markdown: Story = {
  args: {
    renderText: bold,
    options: [
      { label: 'Strategi 1', value: 's1', description: 'Etalase **pertama**\nTiga kotak **teratas** menentukan.' },
    ],
  },
};

/** UMK-1295: one column on a narrow screen, two from `sm`; the eyebrow above each title is uppercase. */
export const TwoColumns: Story = {
  args: {
    columns: 2,
    options: ['Satu', 'Dua', 'Tiga', 'Empat'].map((l, i) => ({
      label: `Strategi ${i + 1}`,
      value: l,
      description: `Judul ${l}\nIsi singkat untuk kartu ${l}.`,
    })),
  },
};

const CHOICE_OPTIONS = [
  { label: 'Strategi 1 — tarik perhatian', value: '1', icon: '📈', badge: <Badge>Populer</Badge>, description: 'Foto Utama Paling Memukau\nPilih foto terbaikmu sebagai foto utama.' },
  { label: 'Bikin Konten yang Menjual', value: '2', icon: '✍️', description: 'Feed 9 kotak + caption siap posting' },
  { label: 'Polos', value: '3' },
];

/** UMK-1296: the agent surface's pre-library option cards, value for value (two colours have no token). */
export const Choice: Story = {
  args: { appearance: 'choice', columns: 2, options: CHOICE_OPTIONS, value: ['2'] },
};

/** UMK-1296: one-tap steps are plain buttons; an arrow key can never submit an answer. */
export const Activation: Story = {
  args: { appearance: 'choice', activation: true, columns: 2, options: CHOICE_OPTIONS },
};
