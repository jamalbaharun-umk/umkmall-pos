import type { Meta, StoryObj } from '@storybook/react-vite';
import { ChatScrollButton } from './ChatScrollButton';

/**
 * The return-to-bottom pill.
 *
 * PRESENTATIONAL — it knows nothing about scrolling. The transcript frame decides when it appears,
 * what it says and what pressing it does, which is what lets a surface render its own in the same
 * slot.
 *
 * `label` is the accessible name and is required; `shape` decides whether it is also DRAWN.
 * Without it the pill is a circle holding a glyph, because a translated string inside a 36px
 * circle clips.
 */
const meta: Meta<typeof ChatScrollButton> = {
  title: 'Components/Chat/ChatScrollButton',
  component: ChatScrollButton,
  parameters: { layout: 'centered' },
  args: { label: 'Ke pesan terbaru' },
};
export default meta;

type Story = StoryObj<typeof ChatScrollButton>;

/** The default: a circle holding a glyph, announced by its label. */
export const IconOnly: Story = {};

/** Expanded, with the glyph leading the words. */
export const Labelled: Story = {
  args: { shape: 'labelled' },
};

/** A message arrived while the reader was away. The mark carries no text — see the component note. */
export const WithNewMessages: Story = {
  args: { hasNewMessages: true },
};

/** Both, which is the state a surface that names its affordances would show. */
export const LabelledWithNewMessages: Story = {
  args: { shape: 'labelled', hasNewMessages: true },
};
