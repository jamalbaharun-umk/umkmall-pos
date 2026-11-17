import type { Meta, StoryObj } from '@storybook/react-vite';
import { ChatMessage } from './ChatMessage';
import { ChatMessageBubble } from './ChatMessageBubble';
import { ChatMessageMetadata } from './ChatMessageMetadata';

/**
 * The line under a message — a time, whatever the host wants beside it, and a delivery status.
 *
 * IT RENDERS NOTHING WHEN GIVEN NOTHING, because a caller mounts it under every row and most rows
 * have nothing to say. The separators are computed from what is actually present, so a row with
 * only a time shows no dangling dot.
 */
const meta: Meta<typeof ChatMessageMetadata> = {
  title: 'Components/Chat/ChatMessageMetadata',
  component: ChatMessageMetadata,
  parameters: { layout: 'padded' },
  decorators: [(Story) => <div className="w-[560px]">{Story()}</div>],
};
export default meta;

type Story = StoryObj<typeof ChatMessageMetadata>;

/** The usual row: a time and a settled status. */
export const TimeAndStatus: Story = {
  args: { timestamp: '09:41', status: 'sent' },
};

/** A time alone. No separator appears, because there is no second piece to separate it from. */
export const TimeOnly: Story = {
  args: { timestamp: '09:41' },
};

/** All three slots filled, which is the only arrangement that draws two separators. */
export const WithFooter: Story = {
  args: { timestamp: '09:41', footer: 'Gemini 2.5 Flash', status: 'read' },
};

/**
 * Every status. `delivered` and `read` share a glyph and differ only by label; `error` is the only
 * one that takes a colour, and `sending` is the only one that moves.
 */
export const EveryStatus: Story = {
  render: () => (
    <div className="flex flex-col gap-2">
      {(['sending', 'sent', 'delivered', 'read', 'error'] as const).map((status) => (
        <ChatMessageMetadata key={status} timestamp="09:41" status={status} />
      ))}
    </div>
  ),
};

/**
 * Given nothing, it renders nothing at all — the bordered box below stays empty rather than
 * gaining a blank row.
 */
export const RendersNothingWhenEmpty: Story = {
  render: () => (
    <div className="rounded-ds-lg border border-default-primary p-ds-sm text-ds-legacy-xs text-default-secondary">
      <ChatMessageMetadata />
      Kotak ini kosong: baris metadata tanpa isi tidak merender apa pun.
    </div>
  ),
};

/**
 * In place, under both sides of a transcript. The user row reverses the DIRECTION only — the
 * authored order stays timestamp, footer, status, so both sides are announced as the same
 * sentence.
 */
export const InsideATranscript: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      <ChatMessage sender="assistant" name="Temanai">
        <ChatMessageBubble
          metadata={<ChatMessageMetadata timestamp="09:41" footer="Gemini 2.5 Flash" status="read" />}
        >
          Tiga pilihan caption sudah saya siapkan.
        </ChatMessageBubble>
      </ChatMessage>
      <ChatMessage sender="user" name="Andi">
        <ChatMessageBubble metadata={<ChatMessageMetadata timestamp="09:42" status="sending" />}>
          Yang kedua saja, tolong dipendekkan.
        </ChatMessageBubble>
      </ChatMessage>
    </div>
  ),
};
