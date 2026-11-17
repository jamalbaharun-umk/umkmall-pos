import React from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { ChatToolsButton } from './ChatToolsButton';

/**
 * THE ONE BUTTON WITH NO PUBLISHED SOURCE. `02 Tools` draws Mic, Tools and Send; the app has a
 * fourth control — the `+` that opens image, video and optimize — which the design set does not
 * model. `active` means that menu is OPEN, which is why the glyph becomes a minus: the same tap
 * closes it.
 */
const meta: Meta<typeof ChatToolsButton> = {
  title: 'Components/Chat/ChatToolsButton',
  component: ChatToolsButton,
  parameters: { layout: 'centered' },
  args: { label: 'Alat' },
};
export default meta;

type Story = StoryObj<typeof ChatToolsButton>;

export const Default: Story = {};

/** Open. Blue fill, and the glyph swaps to a minus. */
export const Active: Story = { args: { state: 'active', label: 'Tutup alat' } };

export const Disabled: Story = { args: { disabled: true } };

/** Both states side by side — the glyph swap is the part a colour-only read misses. */
export const States: Story = {
  render: (args) => (
    <div className="flex items-center gap-3">
      <ChatToolsButton {...args} />
      <ChatToolsButton {...args} state="active" label="Tutup alat" />
      <ChatToolsButton {...args} disabled />
    </div>
  ),
};

/** It toggles: click it. */
export const Interactive: Story = {
  render: (args) => {
    function Demo() {
      const [open, setOpen] = React.useState(false);
      return (
        <ChatToolsButton
          {...args}
          state={open ? 'active' : 'default'}
          onClick={() => setOpen((v) => !v)}
          label={open ? 'Tutup alat' : 'Alat'}
        />
      );
    }
    return <Demo />;
  },
};

/** The landing hero's 36px button, the same height as the voice bar it swaps with. */
export const Landing: Story = { args: { size: 'landing' } };

/** A dot for a state the closed menu must still show, such as an armed tool. */
export const Badged: Story = { args: { badge: true } };
