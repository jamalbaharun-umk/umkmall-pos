import type { Meta, StoryObj } from '@storybook/react-vite';
import { contract } from '../../contract';
import React from 'react';
import { Button } from '../Button';
import { Dialog, type DialogRounded, type DialogSide, type DialogSize } from './Dialog';

/**
 * THERE IS NO FIGMA SET FOR THIS COMPONENT. These stories are the artefact a designer works
 * against rather than a render of one — which is why they exist before the design does.
 *
 * The things the suite cannot see live here too. happy-dom has no layout engine, so nothing
 * in this package can assert where a dialog lands or how wide it actually is; the breakpoint
 * story below is SHOWN, not tested, the same way `Tooltip` documents `FlipsAtTheEdge`.
 *
 * Every open story forces `open` statically, so a static snapshot really contains a dialog.
 */
const meta = {
  /**
   * PORTALLED, so it CANNOT render inline on a docs page. A docs page renders every story into
   * the same document; this component renders into `document.body`, so it escapes its story
   * container and covers the whole page — the title, the props table and every other story
   * underneath it. The story view looks fine because Storybook already iframes that one.
   *
   * `inline: false` gives this component's stories their own iframe on the docs page too, which
   * is the same isolation the story view has. The height is the frame's, not the component's.
   */
  parameters: {
    docs: { story: { inline: false, height: '520px' } },
  },
  title: 'Components/Overlays/Dialog',
  component: Dialog,
  args: {
    open: true,
    onOpenChange: () => {},
    title: 'Hapus akun',
    size: 'medium' as DialogSize,
    children: (
      <div className="px-6 py-4 text-default-secondary">
        Semua data akan dihapus permanen dan tidak bisa dikembalikan.
      </div>
    ),
  },
} satisfies Meta<typeof Dialog>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Open: Story = {};

/** The default render. A closed dialog puts nothing in the document at all — that absence is
 *  the state, and the gate asks for open AND closed. */
export const Closed: Story = { args: { open: false } };

const Grid = ({ sizes }: { sizes: readonly DialogSize[] }) => (
  <div>
    {sizes.map((size) => (
      <Dialog
        key={size}
        open
        onOpenChange={() => {}}
        size={size}
        centered
        title={`Ukuran ${size}`}
      >
        <div className="px-6 py-4 text-default-secondary">{size}</div>
      </Dialog>
    ))}
  </div>
);

/**
 * Fed from the contract, not from a literal list. The guard invokes `render()` and compares
 * the returned element's props against `contract.Dialog.axes.size`, so a size added to the
 * contract and forgotten here goes red rather than quietly rendering three of four.
 */
export const AllSizes: Story = {
  render: () => <Grid sizes={contract.Dialog.axes.size} />,
};

/**
 * `fullHeight` (UMK-1497): below `md` the sheet takes the whole dynamic viewport, with no top radius;
 * the body scrolls inside it. From `md` up it is the same centred card as the default sheet. Resize
 * the canvas under 768px to see it; the handle and the swipe gesture are unchanged.
 */
export const FullHeightSheet: Story = {
  args: {
    fullHeight: true,
    title: 'Simulasi chat',
    showCloseButton: true,
    children: (
      <div className="flex-1 overflow-y-auto px-6 pb-6 pt-2 text-default-secondary">
        {Array.from({ length: 30 }, (_, i) => (
          <p key={i} className="py-1">
            Baris {i + 1}
          </p>
        ))}
      </div>
    ),
  },
};

/**
 * The confirmation shape, and the half a reader is most likely to drop.
 *
 * `centered` is not only "centred at every width": it also removes the drag handle and
 * disables the gesture. A destructive confirmation rendered as a swipe-away sheet invites a
 * dismissal the user did not mean, which is why the two ride one flag. Look for the absent
 * handle here, not just the position.
 */
export const CenteredConfirmation: Story = {
  args: {
    centered: true,
    size: 'small',
    title: 'Hapus akun?',
    showCloseButton: true,
    children: (
      <div className="px-6 pb-6 pt-2 text-default-secondary">
        Tidak ada handle dan tidak bisa digeser untuk menutup.
      </div>
    ),
  },
};

/** A dialog whose own content is its heading. The accessible name comes from `label` and is
 *  carried by a visually-hidden title element, so the name is always a real node. */
export const LabelledWithoutAVisibleTitle: Story = {
  args: {
    title: undefined,
    label: 'Pilih Ratio Ukuran Gambar',
    children: <div className="px-6 py-6 text-default-primary">Tanpa judul yang terlihat.</div>,
  },
};

/**
 * PLACEMENT IS SHOWN, NOT ASSERTED. Resize the canvas across `md` (768px): below it this is a
 * bottom sheet with a drag handle, above it a centred card. No test in this package can see
 * that — happy-dom has no layout — so this story is the check, by eye.
 */
export const SheetBelowMdCentredAbove: Story = {
  args: { size: 'large', title: 'Ubah lebar kanvas' },
};

const SideGrid = ({ sides }: { sides: readonly DialogSide[] }) => (
  <div>
    {sides
      .filter((side): side is Exclude<DialogSide, 'none'> => side !== 'none')
      .map((side) => (
        <Dialog key={side} open onOpenChange={() => {}} side={side} title={`Sisi ${side}`}>
          <div className="px-6 py-4 text-default-secondary">{side}</div>
        </Dialog>
      ))}
  </div>
);

/**
 * The edge drawers (UMK-1186). Fed from the contract like `AllSizes`; `none` is the default
 * presentation every other story here already shows, so the grid draws the two edges. Both
 * are drawers at EVERY width — a caller wanting a bottom sheet on a phone and a right drawer
 * on a desktop passes `side` only when not on a phone.
 */
export const AllSides: Story = {
  render: () => <SideGrid sides={contract.Dialog.axes.side} />,
};

const RoundedGrid = ({ values }: { values: readonly DialogRounded[] }) => (
  <div>
    {values.map((rounded) => (
      <Dialog key={rounded} open onOpenChange={() => {}} rounded={rounded} title={`Sudut ${rounded}`}>
        <div className="px-6 py-4 text-default-secondary">{rounded}</div>
      </Dialog>
    ))}
  </div>
);

/** The opt-in corner radius (UMK-1548): `default` is `2xl`, `lg` the 24px `ds-2xl` token, on the sheet and the card. Fed from the contract. */
export const AllRounded: Story = {
  render: () => <RoundedGrid values={contract.Dialog.axes.rounded} />,
};

const ConfirmRecipe = () => {
  const [busy, setBusy] = React.useState(false);
  return (
    <Dialog open onOpenChange={() => {}} centered size="small" title="Hapus pengguna?">
      <div className="px-6 pb-2 pt-2 text-default-secondary">
        Pengguna dan riwayatnya akan dihapus permanen.
      </div>
      <div className="flex justify-end gap-3 px-6 pb-6 pt-4">
        <Button type="ghost" color="light" size="medium" disabled={busy}>
          Batal
        </Button>
        <Button color="danger" size="medium" isLoading={busy} onClick={() => setBusy(true)}>
          Hapus
        </Button>
      </div>
    </Dialog>
  );
};

/**
 * A RECIPE, not an API (UMK-1186). A confirm is `centered` (no swipe-away on a destructive
 * act) plus a `danger` button whose `isLoading` is the busy state. Admin builds its one
 * `ConfirmDialog` from this in UMK-1188; the library ships no preset.
 */
export const Confirm: Story = {
  render: () => <ConfirmRecipe />,
};

/** A lock (UMK-959): no X, no Escape, no scrim dismissal, no drag. The caller closes it by state. */
export const NotDismissible: Story = {
  args: { dismissible: false, showCloseButton: true, title: 'Lengkapi profil' },
};

/** A busy close (UMK-959): the X stays but is disabled until the work finishes. */
export const CloseDisabledWhileBusy: Story = {
  args: { closeDisabled: true, showCloseButton: true, title: 'Mengunggah…' },
};
