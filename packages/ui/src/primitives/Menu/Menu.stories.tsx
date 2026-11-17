import type { Meta, StoryObj } from '@storybook/react-vite';
import React from 'react';
import { Icon } from '../Icon';
import { Menu } from './Menu';
import { contract } from '../../contract';

/**
 * THERE IS NO FIGMA SET FOR THIS COMPONENT, and unlike `Dialog` the code offers no evidence
 * for a size axis either — both menus this replaces render at one width and one treatment.
 * So the contract carries `pendingAxes: ['size']` and there is deliberately NO grid story
 * here: a grid fed from an empty axis iterates nothing and would satisfy the guard by having
 * nothing to check, which is the exact failure the pending declaration exists to avoid.
 *
 * These stories are what a designer responds to. When a set lands and `Menu` gains a real
 * axis, the guard starts asserting on it without anyone remembering to come back — and this
 * file gains its grid then.
 */
const trigger = (
  <button type="button" aria-label="Alat" className="rounded-full border border-default-primary px-4 py-2">
    Alat
  </button>
);

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
    docs: { story: { inline: false, height: '360px' } },
  },
  title: 'Components/Overlays/Menu',
  component: Menu,
  args: {
    trigger,
    label: 'Alat',
    open: true,
    onOpenChange: () => {},
    items: [
      { id: 'optimize', label: 'Tingkatkan Gambar', icon: <Icon name="image-increase" className="h-5 w-5" /> },
      { id: 'video', label: 'Buat Video Produk', icon: <Icon name="video-product" className="h-5 w-5" /> },
    ],
  },
} satisfies Meta<typeof Menu>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Open: Story = {
  parameters: {
    docs: {
      source: {
        code: `<Menu
  trigger={<button type="button">Alat</button>}
  label="Alat"
  items={[
    { id: 'optimize', label: 'Tingkatkan Gambar', icon: <Icon name="image-increase" className="h-5 w-5" /> },
  ]}
/>`,
      },
    },
  },
};

/** The default render: a trigger and nothing else in the document. The gate asks for open
 *  AND closed, and closed is what a menu spends almost all of its life being. */
export const Closed: Story = { args: { open: false } };

/**
 * A checkable row, which is `role="menuitemcheckbox"` with `aria-checked` rather than a plain
 * item that happens to draw a tick. `ComposerToolsMenu`'s "Buat Gambar" row is this shape,
 * and it is what announces whether the next turn is armed.
 */
export const WithACheckableRow: Story = {
  args: {
    items: [
      { id: 'optimize', label: 'Tingkatkan Gambar', icon: <Icon name="image-increase" className="h-5 w-5" /> },
      {
        id: 'createImage',
        label: 'Buat Gambar',
        icon: <Icon name="composer-image" className="h-5 w-5" />,
        checked: true,
        trailing: <Icon name="composer-check-circle" className="h-5 w-5" />,
      },
      { id: 'video', label: 'Buat Video Produk', icon: <Icon name="video-product" className="h-5 w-5" />, disabled: true },
    ],
  },
};

/**
 * A NESTED MENU AND REAL LINK ROWS — the shape `AccountMenu` needs.
 *
 * A row that declares `items` becomes a submenu trigger; Radix supplies open-on-hover,
 * Right/Left traversal and collision handling. A row that declares `href` renders as an
 * anchor rather than a button, so it can be copied, middle-clicked and opened in a new tab.
 *
 * `external` adds the new-context target and the opener rule together. In an app, pass
 * `linkComponent={Link}` so same-app rows navigate client-side; this package cannot import a
 * router, and an external row stays a plain anchor either way.
 */
export const WithASubmenuAndLinks: Story = {
  args: {
    items: [
      { id: 'profile', label: 'Profil Saya', href: '/profil' },
      {
        id: 'language',
        label: 'Bahasa',
        items: [
          { id: 'id', label: 'Indonesia', checked: true },
          { id: 'en', label: 'English', checked: false },
        ],
      },
      { id: 'terms', label: 'Syarat & Ketentuan', href: 'https://umkmall.id/syarat', external: true },
    ],
  },
};

/**
 * DRILL-IN, for a surface too narrow for a flyout. Opening Bantuan replaces the list in place
 * with a back row and its children; Back or Escape returns. `onOpenChange` on the row fires
 * once per open.
 */
export const DrillIn: Story = {
  args: {
    items: [
      { id: 'profile', label: 'Profil Saya', href: '/profil' },
      {
        id: 'help',
        label: 'Bantuan',
        drillIn: true,
        backLabel: 'Kembali',
        items: [
          { id: 'faq', label: 'FAQ', href: '/faq' },
          { id: 'wa', label: 'Pusat Bantuan', href: 'https://wa.me/6285287431359', external: true },
        ],
      },
    ],
  },
};

/**
 * The uncontrolled form: no `open` prop at all, so the menu owns its own state and the
 * trigger opens it. `ComposerToolsMenu` migrates to exactly this.
 *
 * Click the trigger in the canvas — this one is not forced open, which is the point.
 */
export const Uncontrolled: Story = {
  args: { open: undefined, onOpenChange: undefined },
};

/**
 * The controlled form: the parent owns `open` and the menu changes nothing by itself. The
 * composer's attach menu needs this, and a `Menu` that supported only the uncontrolled shape
 * would have looked finished and failed on that second site.
 */
const ParentOwnedMenu = (args: React.ComponentProps<typeof Menu>) => {
  const [open, setOpen] = React.useState(false);
  return (
    <div className="flex flex-col items-start gap-4">
      <button type="button" className="underline" onClick={() => setOpen((v) => !v)}>
        {open ? 'Tutup dari luar' : 'Buka dari luar'}
      </button>
      <Menu {...args} open={open} onOpenChange={setOpen} />
    </div>
  );
};

/* A COMPONENT, not a hook call inside `render`. The overlay guard mounts every story by
   INVOKING `render()` as a plain function, so state written there runs outside a component
   and throws "Invalid hook call" — for the guard, not for Storybook, which is exactly the
   kind of divergence that leaves a story unmountable and unnoticed. */
export const Controlled: Story = {
  render: (args) => <ParentOwnedMenu {...args} />,
};

/**
 * KEYBOARD TRAVERSAL, SHOWN. Focus the trigger and press Down: focus moves onto the first
 * row, Up from there wraps to the last, typing jumps by first letter, and Escape closes and
 * puts focus back on the trigger. None of that existed on either menu this replaces.
 *
 * The guard asserts the parts happy-dom can model; this story is where the rest is checked by
 * hand.
 */
export const KeyboardTraversal: Story = {
  args: { open: undefined, onOpenChange: undefined },
};

/**
 * PLACEMENT IS SHOWN, NOT ASSERTED — happy-dom has no layout engine, so nothing in this
 * package can see where the panel lands. Scroll this box so the trigger nears the bottom
 * edge: Radix flips the menu above it. That collision detection is what replaced the
 * composer's hand-rolled walk up the overflow ancestors.
 */
export const FlipsAtTheEdge: Story = {
  render: (args) => (
    <div style={{ height: 200, overflow: 'auto', border: '1px solid #ccc', padding: 16 }}>
      <div style={{ height: 400, paddingTop: 150 }}>
        <Menu {...args} open={undefined} onOpenChange={undefined} side="bottom" />
      </div>
    </div>
  ),
};

/**
 * BOTH SHIPPED TREATMENTS, SIDE BY SIDE — the grid this file said it would gain when `Menu`
 * got a real axis (UMK-963). It got one from the CODE rather than from a set: `pill` is what
 * the chat composer renders today and `boxed` is the user-settings popover's card. Neither
 * has a design source, so this render is the only place the two can be compared at all.
 *
 * Fed from the contract, never a literal list — a value added there has to show up here.
 */
const Grid = ({ variants }: { variants: readonly ('pill' | 'boxed')[] }) => (
  <div className="flex flex-wrap items-start gap-10">
    {variants.map((variant) => (
      <div key={variant} className="flex flex-col gap-3">
        <span className="text-ds-legacy-xs uppercase tracking-wide text-default-secondary">{variant}</span>
        <Menu
          {...meta.args}
          variant={variant}
          label={`Alat (${variant})`}
          trigger={
            <button type="button" aria-label={`Alat (${variant})`} className="rounded-full border border-default-primary px-4 py-2">
              {variant}
            </button>
          }
          items={[
            { id: 'optimize', label: 'Tingkatkan Gambar', icon: <Icon name="image-increase" className="h-5 w-5" /> },
            { id: 'video', label: 'Buat Video Produk', icon: <Icon name="video-product" className="h-5 w-5" /> },
            {
              id: 'help',
              label: 'Bantuan',
              icon: <Icon name="menu-help" className="h-5 w-5" />,
              items: [{ id: 'wa', label: 'Pusat Bantuan', href: 'https://wa.me/6285287431359', external: true }],
            },
          ]}
        />
      </div>
    ))}
  </div>
);

export const AllVariants: Story = {
  render: () => <Grid variants={contract.Menu.axes.variant} />,
};
