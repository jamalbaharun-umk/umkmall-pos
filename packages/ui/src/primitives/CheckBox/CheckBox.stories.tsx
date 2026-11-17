import React from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { contract } from '../../contract';
import { Radio } from '../Radio';
import { CheckBox } from './CheckBox';

/* `args` on the meta, not just on each story: `label` is required, so `StoryObj<typeof
 * meta>` demands `args` on EVERY story until the meta supplies a default — which a
 * render-only grid story has no reason to carry. `apps/design` typechecks these files even
 * though `packages/ui` excludes them, so this is a real gate. */
const meta = {
  title: 'Components/Form/CheckBox',
  component: CheckBox,
  args: { label: 'Setuju' },
} satisfies Meta<typeof CheckBox>;
export default meta;
type Story = StoryObj<typeof meta>;

/* DERIVED, not retyped. This union was hand-written until slice 5's `extraLarge` → `xlarge`
 * rename exposed it: a literal here agrees with the contract only until someone edits one of
 * them, and nothing compares the two. */
const Sizes = ({ sizes }: { sizes: typeof contract.CheckBox.axes.size }) => (
  <div style={{ display: 'grid', gap: 12 }}>
    {sizes.map((size) => (
      <CheckBox key={size} label={size} size={size} defaultChecked />
    ))}
  </div>
);

export const AllSizes: Story = {
  parameters: {
    docs: {
      source: {
        code: `<CheckBox label="Setuju" checked={checked} onChange={(e) => setChecked(e.target.checked)} />`,
      },
    },
  },
  render: () => <Sizes sizes={contract.CheckBox.axes.size} />,
};

/**
 * CHECKBOX BESIDE RADIO at every shared size — 18 / 16 / 14, Figma's ladder. The two live in
 * separate tables with no compile-time link, so this row is where a person can see them
 * disagree. `xlarge` is ours and appears on the checkbox alone; see the recorded divergence.
 *
 * Measure it in devtools rather than trusting the eye: the guard proves the three tables
 * agree with each other, never that the box lays out at 18 real pixels.
 */
export const SizeParityWithRadio: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'max-content max-content' }}>
      {(['large', 'medium', 'small'] as const).map((size) => (
        <React.Fragment key={size}>
          <CheckBox label={`CheckBox ${size}`} size={size} defaultChecked />
          <Radio label={`Radio ${size}`} size={size} defaultChecked />
        </React.Fragment>
      ))}
      <CheckBox label="CheckBox xlarge (ours)" size="xlarge" defaultChecked />
      <span />
    </div>
  ),
};

export const Unchecked: Story = { args: { label: 'Belum dipilih' } };
export const Checked: Story = { args: { label: 'Sudah dipilih', defaultChecked: true } };
export const Indeterminate: Story = { args: { label: 'Sebagian dipilih', indeterminate: true } };
export const Disabled: Story = { args: { label: 'Tidak tersedia', disabled: true } };

/**
 * THE FOUR FILLED-BOX CASES, and the only place UMK-1091's fix is visible. An indeterminate
 * box used to paint white under a white dash — invisible — and a locked checked box lost its
 * fill to an unconditional disabled arm. Two solid brand boxes on the top row, two pale blue
 * ones below; no test in this repo can tell you whether the blues are right (KTD6).
 */
export const FilledAndDisabled: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'max-content max-content' }}>
      <CheckBox label="Dicentang" defaultChecked />
      <CheckBox label="Sebagian" indeterminate />
      <CheckBox label="Dicentang, terkunci" defaultChecked disabled />
      <CheckBox label="Sebagian, terkunci" indeterminate disabled />
    </div>
  ),
};

/**
 * ACCESSIBILITY GUIDANCE, not a design state — retitled in UMK-1091 so it does not read as
 * one. Figma's checkbox set publishes neither a required nor an error axis, and the two
 * stories demonstrating them are gone with this change. This one survives the cull because
 * its prose is the only record of WHY `disabled` is the wrong reach on this control: a
 * disabled control leaves the tab order and disappears from screen-reader perception
 * entirely, so "why can I not continue?" has no answer anywhere on the page.
 *
 * It also keeps `error` honest in the story-state table — it renders an errored box.
 */
export const PreferErrorOverDisabled: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: 24, maxWidth: 420 }}>
      <CheckBox label="Saya setuju (disabled — tidak bisa difokus, tanpa alasan)" disabled />
      <CheckBox label="Saya setuju (lebih baik: tetap bisa difokus, dengan pesan)" error="Harus dicentang untuk lanjut" />
    </div>
  ),
};

/** UMK-955: a checkbox with no visible caption (a row selector). `label` XOR `aria-label`. */
export const AriaLabelOnly: Story = {
  render: () => <CheckBox aria-label="Pilih baris 1" />,
};
