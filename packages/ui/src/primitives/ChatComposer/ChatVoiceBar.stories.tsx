import type { Meta, StoryObj } from '@storybook/react-vite';
import { ChatVoiceBar } from './ChatVoiceBar';

/**
 * The row the composer shows IN PLACE OF its icon row while the microphone is open.
 *
 * It replaces the attach / voice / send row below the editor rather than sitting above it, which
 * is why `size` exists: the two rows it can stand in for are 32px and 36px tall, and a bar of one
 * height makes the composer jump the moment recording starts.
 *
 * IT OWNS NO MICROPHONE — no permission prompt, no recorder, no metering. It is told it is
 * listening and draws that, which is what lets both composers adopt it unchanged.
 */
const meta: Meta<typeof ChatVoiceBar> = {
  title: 'Components/Chat/ChatVoiceBar',
  component: ChatVoiceBar,
  parameters: { layout: 'padded' },
  args: {
    size: 'compact',
    label: 'Mendengarkan...',
    stopLabel: 'Berhenti mendengarkan',
    onStop: () => {},
  },
};
export default meta;

type Story = StoryObj<typeof ChatVoiceBar>;

/** In-thread: the 32px row, standing in for the compact composer's controls. */
export const Compact: Story = {};

/** On the landing composer, whose icon row is 36px. */
export const Landing: Story = {
  args: { size: 'landing' },
};
