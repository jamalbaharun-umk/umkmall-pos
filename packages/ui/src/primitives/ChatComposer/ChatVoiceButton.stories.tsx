import type { Meta, StoryObj } from '@storybook/react-vite';
import { ChatVoiceButton } from './ChatVoiceButton';

/**
 * `02 Tools`, `Type=Mic` — THE ONLY BUTTON THAT GOES RED, and the reason is not decoration: red
 * means the microphone is LIVE, where blue on the other three means armed or open. Put `Active`
 * beside `ChatToolsButton`'s and the difference is the whole point; a refactor that gives all four
 * one active colour turns a recording indicator into an arming one.
 *
 * The label is the caller's because only the caller knows whether the next tap starts or stops.
 */
const meta: Meta<typeof ChatVoiceButton> = {
  title: 'Components/Chat/ChatVoiceButton',
  component: ChatVoiceButton,
  parameters: { layout: 'centered' },
  args: { label: 'Input suara' },
};
export default meta;

type Story = StoryObj<typeof ChatVoiceButton>;

export const Default: Story = {};

/** Recording. Red, and the glyph becomes a pause — a variant swap, not a recolour. */
export const Active: Story = { args: { state: 'active', label: 'Berhenti merekam' } };

export const Disabled: Story = { args: { disabled: true } };

export const States: Story = {
  render: (args) => (
    <div className="flex items-center gap-3">
      <ChatVoiceButton {...args} />
      <ChatVoiceButton {...args} state="active" label="Berhenti merekam" />
      <ChatVoiceButton {...args} disabled />
    </div>
  ),
};

/** The landing hero's 36px button, the same height as the voice bar it swaps with. */
export const Landing: Story = { args: { size: 'landing' } };
