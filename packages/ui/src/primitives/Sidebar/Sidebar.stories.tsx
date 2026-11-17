import type { Meta, StoryObj } from '@storybook/react-vite';
import React from 'react';
import { Sidebar } from './Sidebar';
import { SidebarMenuItem } from './SidebarMenuItem';

/**
 * PLACEMENT AND WIDTH ARE CHECKED BY EYE HERE, not in the guard. happy-dom has no layout
 * engine, so nothing in the package suite can tell that the rail is narrower than the expanded
 * aside or that the drawer is off-screen while closed. These stories are where that is seen.
 */
const meta: Meta<typeof Sidebar> = {
  title: 'Components/Shell/Sidebar',
  component: Sidebar,
  parameters: { layout: 'fullscreen' },
};
export default meta;

type Story = StoryObj<typeof Sidebar>;

const List = ({ collapsed = false }: { collapsed?: boolean }) => (
  <div className="flex flex-col gap-1">
    <SidebarMenuItem label="Chat Baru" icon={<span>✎</span>} collapsed={collapsed} onClick={() => {}} />
    <SidebarMenuItem label="Riwayat" icon={<span>◷</span>} collapsed={collapsed} active onClick={() => {}} />
    <SidebarMenuItem label="Pengaturan" icon={<span>⚙</span>} collapsed={collapsed} state="submenu" />
    {!collapsed && <SidebarMenuItem label="Akun" nested onClick={() => {}} />}
  </div>
);

/* The list slot is a chat-history list here because that is where the row shape came from —
   Ensyra publishes no session row, so `SessionItem` is the only source there was. */
const Frame = (props: React.ComponentProps<typeof Sidebar>) => (
  <div className="flex h-[560px] bg-default-secondary">
    <Sidebar {...props} />
  </div>
);

export const Expanded: Story = {
  parameters: {
    docs: {
      source: {
        code: `<Sidebar
  label="Navigasi"
  header={<strong>TemanAI</strong>}
  footer={<SidebarMenuItem label="Bantuan" onClick={() => {}} />}
>
  <SidebarMenuItem label="Chat Baru" icon={<span>✎</span>} onClick={() => {}} />
</Sidebar>`,
      },
    },
  },
  render: () => (
    <Frame
      label="Navigasi"
      header={<strong>TemanAI</strong>}
      footer={<SidebarMenuItem label="Bantuan" onClick={() => {}} />}
      onCollapsedChange={() => {}}
    >
      <List />
    </Frame>
  ),
};

export const Collapsed: Story = {
  render: () => (
    <Frame label="Navigasi" collapsed onCollapsedChange={() => {}} header={<strong>T</strong>}>
      <List collapsed />
    </Frame>
  ),
};

export const Drawer: Story = {
  render: () => (
    <Frame label="Navigasi" open onOpenChange={() => {}} header={<strong>TemanAI</strong>}>
      <List />
    </Frame>
  ),
};
