import type { ComponentProps, ReactNode } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { contract } from '../../contract';
import { Icon } from '../Icon';
import { Select } from '../Select';
import { TextField } from './TextField';

/**
 * Every state in the slice's state table, plus the size x error x disabled x filled
 * cross-product as a grid — the cross-product is too large for one named story each.
 */
const meta = {
  title: 'Components/Form/TextField',
  component: TextField,
  args: { label: 'Nama usaha' },
} satisfies Meta<typeof TextField>;
export default meta;
type Story = StoryObj<typeof meta>;

const Row = ({ children }: { children: ReactNode }) => (
  <div style={{ display: 'grid', gap: 16, maxWidth: 420 }}>{children}</div>
);

/** `sizes` is passed in, never defaulted: a grid reading its own default cannot fail the guard. */
const Grid = ({ sizes }: { sizes: readonly NonNullable<ComponentProps<typeof TextField>['size']>[] }) => (
  <div style={{ display: 'grid', gap: 24, maxWidth: 420 }}>
    {sizes.map((size) => (
      <Row key={size}>
        <TextField label={`${size} · default`} size={size} placeholder="Tulis di sini" />
        <TextField label={`${size} · filled`} size={size} defaultValue="Warung Bu Andi" />
        <TextField label={`${size} · error`} size={size} error="Nama wajib diisi" />
        <TextField label={`${size} · disabled`} size={size} disabled defaultValue="Terkunci" />
      </Row>
    ))}
  </div>
);

export const AllStates: Story = {
  parameters: {
    docs: {
      source: {
        code: `<TextField label="Nama usaha" value={name} onChange={(e) => setName(e.target.value)} />`,
      },
    },
  },
  render: () => <Grid sizes={contract.TextField.axes.size} />,
};

export const Required: Story = { args: { label: 'Nama usaha', required: true } };
export const ReadOnly: Story = { args: { label: 'Kode referral', readOnly: true, defaultValue: 'UMKM-2026' } };
export const Multiline: Story = { args: { label: 'Deskripsi usaha', multiline: true, rows: 4 } };
export const Password: Story = { args: { label: 'Kata sandi', type: 'password' } };

/**
 * THE ADORNMENT PAIR AND THE COUNTER. What to look at: the text never runs under either slot,
 * and on the password row the trailing adornment and the reveal sit side by side rather than
 * one on top of the other — they co-exist, deliberately.
 */
export const Adornments: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: 24, maxWidth: 420 }}>
      <TextField label="Harga" leadingAdornment={<span>Rp</span>} defaultValue="150000" />
      <TextField label="Berat" trailingAdornment={<span>kg</span>} defaultValue="2" />
      <TextField
        label="Kata sandi"
        type="password"
        trailingAdornment={<Icon name="tile-key" size="md" />}
        defaultValue="rahasia"
      />
    </div>
  ),
};

/** The counter is driven by `maxLength`, so the field and the number can never disagree. */
export const Counter: Story = {
  args: { label: 'Deskripsi singkat', showCounter: true, maxLength: 60, defaultValue: 'Kopi susu' },
};

/** At the limit the counter takes the error ink — the field stops accepting either way. */
export const CounterAtLimit: Story = {
  args: { label: 'Kode', showCounter: true, maxLength: 5, defaultValue: 'ABCDE' },
};

/** The counter survives multiline, because it sits under the box and not inside it. */
export const MultilineCounter: Story = {
  args: {
    label: 'Deskripsi',
    multiline: true,
    showCounter: true,
    maxLength: 200,
    defaultValue: 'Kopi susu gula aren',
  },
};

/**
 * The phone shape (UMK-1186): a country `Select` in the INTERACTIVE `prefix` slot, inside the
 * same box as the number. Not `leadingAdornment` — that slot is hidden from assistive
 * technology, which would leave the picker unreachable by a screen reader.
 */
export const PhonePrefix: Story = {
  args: {
    label: 'Nomor HP',
    inputMode: 'tel',
    placeholder: '812 3456 7890',
    prefix: (
      <Select
        aria-label="Kode negara"
        size="small"
        /* Borderless inside the field: the FIELD'S box is the one box. */
        className="border-transparent px-0 hover:border-transparent [&:not([data-quiet-focus])]:focus-within:border-transparent [&:not([data-quiet-focus])]:focus-within:ring-0"
        showSearch
        value="ID"
        options={[
          { value: 'ID', label: '+62', hint: 'Indonesia' },
          { value: 'MY', label: '+60', hint: 'Malaysia' },
          { value: 'SG', label: '+65', hint: 'Singapura' },
        ]}
      />
    ),
  },
};

/** UMK-955: a name with no visible caption (a search box). `label` XOR `aria-label`. */
export const AriaLabelOnly: Story = {
  args: { 'aria-label': 'Cari kursus', placeholder: 'Cari kursus', label: undefined },
};

/** UMK-955: a multiline field that grows with its content, then scrolls past `maxRows`. */
export const AutoResize: Story = {
  args: { label: 'Catatan', multiline: true, rows: 1, autoResize: true, maxRows: 6, placeholder: 'Ketik beberapa baris…' },
};

/** UMK-955: `appearance="bare"` - no chrome at all. The type is the caller's `className` on the box. */
export const Bare: Story = {
  args: {
    label: undefined,
    'aria-label': 'Pesan',
    appearance: 'bare',
    multiline: true,
    autoResize: true,
    maxRows: 4,
    rows: 1,
    placeholder: 'Tulis pesan…',
    className: 'text-ds-paragraph-desktop text-default-primary',
  },
};

/** UMK-955: `valid` - a success border and a trailing tick (it yields to a trailing adornment). `error` wins. */
export const Valid: Story = {
  args: { label: 'Email', defaultValue: 'andi@umkmall.id', valid: true },
};

/** UMK-955: `disabled` is Figma's Disable Filled (grey fill, value at full ink); `readOnly` keeps the plain filled look. */
export const DisabledFilled: Story = {
  args: { label: 'Nomor WhatsApp', defaultValue: '6281234567890', disabled: true },
};

/** UMK-955: `size="xsmall"` - a compact 12px field (padding 4/8, about 26px tall). Ours; no Figma rung. */
export const XSmall: Story = {
  args: { label: 'Alasan', size: 'xsmall', placeholder: 'Tulis alasan', 'aria-label': undefined },
};

/** UMK-955: `resize={false}` removes the drag handle on a multiline field. */
export const NoResize: Story = {
  args: { label: 'Ulasan', multiline: true, rows: 3, resize: false },
};

/** UMK-955: `counterPlacement="inside"` - the count sits in a row under the control, inside the box. */
export const CounterInside: Story = {
  args: { label: 'Masukan', multiline: true, rows: 3, maxLength: 200, showCounter: true, counterPlacement: 'inside', defaultValue: 'Bagus sekali' },
};

/** UMK-955: `prefixPlacement="outside"` - the prefix gets its OWN box beside the field and mirrors its state. */
export const PrefixOutside: Story = {
  args: { label: 'Nomor WhatsApp', inputMode: 'tel', prefix: '+62', prefixPlacement: 'outside', placeholder: '812 3456 7890' },
};

/** `labelSize` sets the caption's tier apart from the field's: a small field under a large caption. */
export const LabelSize: Story = {
  args: { label: 'Ulasan', size: 'small', labelSize: 'large' },
};
