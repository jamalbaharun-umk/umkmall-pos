import type { Meta, StoryObj } from '@storybook/react-vite';
import { ChatSoundWave } from './ChatSoundWave';

/**
 * The five bars that say a microphone is open.
 *
 * IT READS NO AMPLITUDE, and that is settled rather than pending: neither shipped surface meters
 * anything, and wiring real levels on one platform while the other fakes them would be a
 * difference rather than a fix.
 *
 * `bars` is a QUANTITY, not an axis — see the contract entry. Five is what both surfaces draw.
 */
const meta: Meta<typeof ChatSoundWave> = {
  title: 'Components/Chat/ChatSoundWave',
  component: ChatSoundWave,
  parameters: { layout: 'centered' },
};
export default meta;

type Story = StoryObj<typeof ChatSoundWave>;

/** Moving, which is the only state this is ever mounted in on a live surface. */
export const Listening: Story = {};

/**
 * Resting. The bars sit at the height the keyframe STARTS from, not at full — bars frozen tall
 * read as a level meter pinned at maximum. It is also what reduced motion resolves to.
 */
export const Idle: Story = {
  args: { state: 'idle' },
};

/** A different count, to show the stagger is derived rather than five hand-written delays. */
export const MoreBars: Story = {
  args: { bars: 9 },
};
