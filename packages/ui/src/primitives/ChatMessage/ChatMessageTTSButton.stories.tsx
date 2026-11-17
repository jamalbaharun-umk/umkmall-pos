import type { Meta, StoryObj } from '@storybook/react-vite';
import { ChatMessageTTSButton } from './ChatMessageTTSButton';

/**
 * The per-message LISTEN control.
 *
 * PRESENTATIONAL — it owns no audio. Fetching the speech, caching it, playing the chunks in order
 * and making sure only one message speaks at a time is the host's; this is `state` in and a press
 * out, which is what lets the classic surface, the agent surface and the native screen adopt one
 * control instead of three.
 *
 * `label` is the accessible name and is required PER STATE: the same button means "Dengarkan",
 * "Jeda", "Lanjutkan" and "Memproses…" depending on where playback has got to.
 */
const meta: Meta<typeof ChatMessageTTSButton> = {
  title: 'Components/Chat/ChatMessageTTSButton',
  component: ChatMessageTTSButton,
  parameters: { layout: 'centered' },
  args: { state: 'idle', label: 'Dengarkan', onToggle: () => {} },
};
export default meta;

type Story = StoryObj<typeof ChatMessageTTSButton>;

/** Nothing has been pressed. Transparent, secondary ink — one grey glyph among the row's five. */
export const Idle: Story = {};

/** The speech is being fetched. A spinner, not a faded glyph, and the press is refused. */
export const Loading: Story = {
  args: { state: 'loading', label: 'Memproses…' },
};

/** Speaking. The glyph becomes a pause, because that is what the next press does. */
export const Playing: Story = {
  args: { state: 'playing', label: 'Jeda' },
};

/** Halted mid-message. The one state on the warning tint — it is paused, not finished. */
export const Paused: Story = {
  args: { state: 'paused', label: 'Lanjutkan' },
};

/**
 * The attempt failed. Neither live surface draws this — both fall back to idle, so a failure is
 * indistinguishable from a control nobody pressed. See the contract entry's second divergence.
 */
export const Failed: Story = {
  args: { state: 'error', label: 'Dengarkan' },
};
