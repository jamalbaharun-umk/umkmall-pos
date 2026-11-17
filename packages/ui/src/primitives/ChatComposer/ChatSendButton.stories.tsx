import type { Meta, StoryObj } from '@storybook/react-vite';
import { ChatSendButton } from './ChatSendButton';

/**
 * `02 Tools`, `Type=Send` — and everything about it that DIVERGES from the published set is
 * visible here.
 *
 * It RESTS FILLED. Figma draws every type as an outlined white circle at rest; send is the
 * composer's primary action, and drawing it like its neighbours makes it indistinguishable from
 * them.
 *
 * `Disabled` is a flat neutral, NOT a fade — a faded blue circle still reads as blue, so a send
 * that cannot be pressed would still look like the primary action. The composer starts empty, so
 * this is the state the button spends most of its time in: it is the story to look at first.
 *
 * IT IS NOT A TOGGLE, so it emits no `aria-pressed` in any state. Figma's `Default | Active` pair
 * is replaced by `state: send | stop | waiting`, because a boolean could not say the thing that
 * matters — see `Stop`.
 */
const meta: Meta<typeof ChatSendButton> = {
  title: 'Components/Chat/ChatSendButton',
  component: ChatSendButton,
  parameters: { layout: 'centered' },
  args: { label: 'Kirim pesan' },
};
export default meta;

type Story = StoryObj<typeof ChatSendButton>;

/** Enabled: blue, because there is something to send. */
export const Default: Story = {};

/** Nothing typed yet — the composer's opening state. */
export const Disabled: Story = { args: { disabled: true } };

/**
 * STREAMING. While a reply is coming back, this seat is not a send button — it is a stop button,
 * and it must not look like send. It takes the error fill for the same reason the recording
 * microphone does: both interrupt something already running.
 *
 * THE LABEL AND THE HANDLER ARE THE CALLER'S, and that is load-bearing rather than stylistic. A
 * button drawing a stop square while still announcing "Kirim pesan" and still calling send is
 * worse than one that never changed at all, so the component owns neither — setting `state` makes
 * the caller confront both.
 */
export const Stop: Story = {
  args: { state: 'stop', label: 'Hentikan AI' },
};

/**
 * Uploads still in flight, so the turn cannot start yet. STAYS BLUE: nothing has gone wrong and
 * nothing is interruptible — a spinner in error red would say the upload failed. Only the glyph
 * says "not yet".
 */
export const Waiting: Story = {
  args: { state: 'waiting', label: 'Menunggu foto diunggah', disabled: true },
};

export const States: Story = {
  render: (args) => (
    <div className="flex items-center gap-3">
      <ChatSendButton {...args} />
      <ChatSendButton {...args} disabled />
      <ChatSendButton {...args} state="waiting" label="Menunggu foto diunggah" />
      <ChatSendButton {...args} state="stop" label="Hentikan AI" />
    </div>
  ),
};

/** The landing hero's 36px button, the same height as the voice bar it swaps with. */
export const Landing: Story = { args: { size: 'landing' } };
