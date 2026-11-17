import type { Meta, StoryObj } from '@storybook/react-vite';
import { ChatAttachmentButton } from './ChatAttachmentButton';

/**
 * `02 Tools`, `Type=Tools` — the PAPERCLIP. Figma's word for this type is "Tools", but the app
 * also has a `+` menu it calls tools, so carrying the published name would make the two
 * indistinguishable at every call site. The treatment and both glyphs are as drawn.
 */
const meta: Meta<typeof ChatAttachmentButton> = {
  title: 'Components/Chat/ChatAttachmentButton',
  component: ChatAttachmentButton,
  parameters: { layout: 'centered' },
  args: { label: 'Lampirkan file' },
};
export default meta;

type Story = StoryObj<typeof ChatAttachmentButton>;

export const Default: Story = {};

/** The attach menu is open; the published minus is drawn at 24 where the clip is 20. */
export const Active: Story = { args: { state: 'active', label: 'Tutup lampiran' } };

export const Disabled: Story = { args: { disabled: true } };

export const States: Story = {
  render: (args) => (
    <div className="flex items-center gap-3">
      <ChatAttachmentButton {...args} />
      <ChatAttachmentButton {...args} state="active" label="Tutup lampiran" />
      <ChatAttachmentButton {...args} disabled />
    </div>
  ),
};

/** The landing hero's 36px button, the same height as the voice bar it swaps with. */
export const Landing: Story = { args: { size: 'landing' } };
