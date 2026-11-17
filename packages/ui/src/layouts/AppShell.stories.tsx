import type { Meta, StoryObj } from "@storybook/react-vite";
import React from "react";
import { AppShell } from "./AppShell";
import { Header } from "../primitives/Header";
import { Sidebar, SidebarMenuItem } from "../primitives/Sidebar";
import { Icon } from "../primitives/Icon";

/**
 * THE ARRANGEMENT IS CHECKED BY EYE HERE, not in the guard. happy-dom has no layout engine, so
 * nothing in the package suite can tell that the frame fills the viewport exactly once, that
 * the content scrolls while the frame does not, or that only one of the two navigations is on
 * screen at a given width. Resize the preview and scroll the content; that is what these are
 * for. The header's shadow appearing as the content moves is the scroll spy, seen.
 *
 * These compose the REAL `Sidebar` and `Header` rather than stand-ins, because the frame's only
 * job is holding those two next to a scrolling region — a story with placeholder boxes in the
 * slots would look correct while the real composition was broken.
 */
const meta: Meta<typeof AppShell> = {
  title: 'Components/Shell/AppShell',
  component: AppShell,
  parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj<typeof AppShell>;

/* `label` is DESTRUCTURED with a default rather than Omit-ed. Every landmark needs a name and
   most stories share one, but the drawer instance mounts beside the rail instance and each
   `Sidebar` renders a nav landmark — four landmarks under one name, two of them display:none,
   is exactly the ambiguity a screen-reader landmark list is for. Taking it here rather than
   through `rest` keeps the single-assignment intent of the old Omit: the name is written once
   in the JSX below, so a caller supplies it instead of overwriting it. */
const Nav = ({
  collapsed = false,
  label = "Navigasi",
  ...rest
}: Omit<React.ComponentProps<typeof Sidebar>, "label"> & { label?: string }) => (
  <Sidebar
    label={label}
    collapsed={collapsed}
    header={
      <span className="text-ds-paragraph-mobile font-semibold">
        {collapsed ? "U" : "UMKMall"}
      </span>
    }
    {...rest}
  >
    <div className="flex flex-col gap-1">
      <SidebarMenuItem
        label="Chat Baru"
        icon={<span>✎</span>}
        collapsed={collapsed}
        onClick={() => {}}
      />
      <SidebarMenuItem
        label="Riwayat"
        icon={<span>◷</span>}
        collapsed={collapsed}
        active
        onClick={() => {}}
      />
    </div>
  </Sidebar>
);

const LongContent = () => (
  <div className="min-h-0 flex-1 overflow-y-auto p-6">
    {Array.from({ length: 40 }, (_, i) => (
      <p key={i} className="mb-4 text-ds-paragraph-mobile text-default-secondary">
        Baris {i + 1} — gulir untuk melihat bayangan pada header muncul.
      </p>
    ))}
  </div>
);

export const Default: Story = {
  parameters: {
    docs: {
      source: {
        code: `<AppShell
  header={({ scrolled }) => (
    <Header type="temanAiChat" title="Teman AI" showTextLeft scrolled={scrolled} />
  )}
  sidebar={<Sidebar label="Navigasi" header="UMKMall">{/* menu items */}</Sidebar>}
>
  {children}
</AppShell>`,
      },
    },
  },
  render: () => (
    <AppShell
      header={({ scrolled }) => (
        <Header
          type="temanAiChat"
          title="Teman AI"
          showTextLeft
          scrolled={scrolled}
        />
      )}
      sidebar={<Nav />}
    >
      <LongContent />
    </AppShell>
  ),
};

/** The rail collapsed, which is the same frame with a narrower navigation column in it. */
export const CollapsedSidebar: Story = {
  render: () => (
    <AppShell
      header={({ scrolled }) => (
        <Header
          type="temanAiChat"
          title="Teman AI"
          showTextLeft
          scrolled={scrolled}
        />
      )}
      sidebar={<Nav collapsed />}
    >
      <LongContent />
    </AppShell>
  ),
};

/**
 * The narrow-viewport slot with its drawer open. Below the breakpoint the in-flow column is
 * gone and the drawer is the navigation; above it the reverse. Resize to see the swap.
 */
export const MobileDrawer: Story = {
  render: () => (
    <AppShell
      header={
        <Header
          type="temanAiChat"
          title="Teman AI"
          showTextLeft
          showBack
          backLabel="Kembali"
        />
      }
      sidebar={<Nav />}
      mobileSidebar={<Nav label="Navigasi seluler" open onOpenChange={() => {}} />}
    >
      <LongContent />
    </AppShell>
  ),
};

/** No navigation at all — the frame still fills the viewport and the content still scrolls. */
export const HeaderOnly: Story = {
  render: () => (
    <AppShell
      header={<Header type="dashboard" title="Dashboard" showTextLeft />}
    >
      <LongContent />
    </AppShell>
  ),
};

/**
 * THE ONE THAT ACTUALLY MOVES. Both toggles are wired to state here rather than pinned open,
 * which is the difference between seeing the drawer and seeing it *work*.
 *
 * - **Below the breakpoint**, the burger in the header opens the drawer and the scrim closes it.
 *   Narrow the preview until the in-flow column disappears.
 * - **A row does NOT close the drawer**, and that is not an oversight in the story. Closing on
 *   navigation is policy, and the library owns none: a row here has no destination to navigate
 *   to, and a real caller closes in its own click handler. Wiring it in the story would show a
 *   behaviour the component does not have.
 * - **From the breakpoint up**, the rail's own control collapses and expands the column. That
 *   control only renders when `onCollapsedChange` is supplied, so the two static stories above
 *   do not show it.
 *
 * NOTE WHICH SLOT THE BURGER USES. `Header` publishes one leading control and calls it `back`;
 * it takes any element and hands it the marker, the class set and the accessible name, so a
 * burger goes there and `backLabel` names it. That the slot is spelled `back` is a naming
 * question for whoever reconciles the header's axes with design — it is not a second slot, and
 * a shell should not grow one on a story's say-so.
 *
 * The drawer's open state lives HERE, in the caller, on purpose: the library owns the drawer's
 * chrome and none of its policy, so nothing in the shell decides when a navigation is showing.
 */
const TogglingShell = () => {
  const [open, setOpen] = React.useState(false);
  const [collapsed, setCollapsed] = React.useState(false);

  return (
    <AppShell
      header={({ scrolled }) => (
        <Header
          type="temanAiChat"
          title="Teman AI"
          showTextLeft
          showBack
          backLabel="Buka navigasi"
          back={(props) => (
            <button
              {...props}
              onClick={() => setOpen(true)}
              className={`${props.className} md:hidden`}
            >
              <Icon name="menu" className="h-5 w-5" />
            </button>
          )}
          scrolled={scrolled}
        />
      )}
      sidebar={<Nav collapsed={collapsed} onCollapsedChange={setCollapsed} />}
      mobileSidebar={<Nav label="Navigasi seluler" open={open} onOpenChange={setOpen} />}
    >
      <LongContent />
    </AppShell>
  );
};

/* A COMPONENT, not a closure in `render`. The layouts guard calls `render()` as a plain
   function to read the tree, so a hook called directly inside it is an invalid hook call and
   the story reddens the suite rather than the browser. `Menu.stories.tsx` sidesteps the same
   trap the same way. */
export const SidebarToggles: Story = { render: () => <TogglingShell /> };
