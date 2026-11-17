import type { Meta, StoryObj } from '@storybook/react-vite';
import { ProfileHeader } from './ProfileHeader';

/** Profil's header (UMK-1840, Figma "Teman AI Page" 15044:52555), and its edge cases: a missing half, no name, a long name. */
const meta: Meta<typeof ProfileHeader> = {
  title: 'Components/Content/ProfileHeader',
  component: ProfileHeader,
  parameters: { layout: 'padded' },
  args: { name: 'Bambang Pamungkas', phone: '08123456789', meta: 'Donat Bateng' },
};
export default meta;

type Story = StoryObj<typeof ProfileHeader>;

export const Default: Story = {};

export const NoBusinessName: Story = { args: { meta: undefined } };

export const NameOnly: Story = { args: { phone: undefined, meta: undefined } };

export const NoName: Story = { args: { name: '', phone: '08123456789', meta: undefined } };

export const LongName: Story = {
  render: (args) => (
    <div className="max-w-xs">
      <ProfileHeader {...args} name="Bambang Pamungkas Setiawan Wijaya Kusuma" meta="Kripik Makyus Tangerang Selatan" />
    </div>
  ),
};
