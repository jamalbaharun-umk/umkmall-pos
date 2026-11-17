import type { Meta, StoryObj } from '@storybook/react-vite';
import { TabBar, TabBarItem } from './TabBar';

/**
 * THE BAR IS HIDDEN FROM `md` UP. View these stories in a phone-width viewport; on a desktop
 * canvas they render nothing visible, which is the component working.
 */
const meta: Meta<typeof TabBar> = {
  title: 'Components/Navigation/TabBar',
  component: TabBar,
  parameters: { layout: 'fullscreen' },
  args: { label: 'Menu utama Teman AI' },
};
export default meta;

type Story = StoryObj<typeof TabBar>;

const Tabs = ({ active }: { active: 'chat' | 'jalur' | 'aktivitas' | 'profil' }) => (
  <>
    <TabBarItem label="AI Chat" icon="nav-chat" activeIcon="nav-chat-active" href="#chat" active={active === 'chat'} />
    <TabBarItem label="Jalur" icon="nav-jalur" activeIcon="nav-jalur-active" href="#jalur" active={active === 'jalur'} />
    <TabBarItem
      label="Aktivitas"
      icon="nav-aktivitas"
      activeIcon="nav-aktivitas-active"
      href="#aktivitas"
      active={active === 'aktivitas'}
    />
    <TabBarItem label="Profil" icon="nav-profil" activeIcon="nav-profil-active" active={active === 'profil'} />
  </>
);

export const ChatActive: Story = {
  render: (args) => (
    <TabBar {...args}>
      <Tabs active="chat" />
    </TabBar>
  ),
};

export const JalurActive: Story = {
  render: (args) => (
    <TabBar {...args}>
      <Tabs active="jalur" />
    </TabBar>
  ),
};

/** A flag-off tab is simply not rendered; the remaining items share the width. */
export const ThreeTabs: Story = {
  render: (args) => (
    <TabBar {...args}>
      <TabBarItem label="AI Chat" icon="nav-chat" activeIcon="nav-chat-active" href="#chat" active />
      <TabBarItem label="Aktivitas" icon="nav-aktivitas" activeIcon="nav-aktivitas-active" href="#aktivitas" />
      <TabBarItem label="Profil" icon="nav-profil" activeIcon="nav-profil-active" />
    </TabBar>
  ),
};
