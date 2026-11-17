import type { Meta, StoryObj } from '@storybook/react-vite';
import { ChatMessage } from './ChatMessage';
import { ChatMessageBubble } from './ChatMessageBubble';
import { ChatAttachment } from '../ChatComposer';
import { ChatMessageMetadata } from './ChatMessageMetadata';
import { Icon } from '../Icon';

/**
 * One row of a chat transcript — a speaker, a position, and whatever they said.
 *
 * IT TAKES NO MESSAGE OBJECT. Three surfaces in this product carry three incompatible message
 * shapes, so a component accepting any one of them would be adoptable on exactly one surface.
 * This owns the chrome and the slots; the content is children.
 *
 * The speaker is a small header ABOVE the turn — the face and the name on one line — which is what
 * both shipped surfaces draw. The user side flips by alignment alone, so what a screen reader
 * receives is the same on both sides of the transcript.
 */
/* The slot draws the 28px circle (L23); the host supplies only the mark inside it. */
const Face = ({ label }: { label: string }) => (
  <span aria-hidden className="text-ds-legacy-xs text-default-secondary">
    {label}
  </span>
);

const meta: Meta<typeof ChatMessage> = {
  title: 'Components/Chat/ChatMessage',
  component: ChatMessage,
  parameters: { layout: 'padded' },
  decorators: [(Story) => <div className="w-[560px]">{Story()}</div>],
};
export default meta;

type Story = StoryObj<typeof ChatMessage>;

/** The assistant's turn: the author header above, the turn hugging the leading edge. */
export const Assistant: Story = {
  args: {
    sender: 'assistant',
    avatar: <Face label="AI" />,
    name: 'Temanai',
    children: <ChatMessageBubble>Halo! Ada yang bisa saya bantu untuk usahamu hari ini?</ChatMessageBubble>,
  },
};

/**
 * The user's turn, drawn against the other edge. The author header is still the FIRST child in the
 * source — only the alignment flips, which is what keeps the accessibility order identical on both
 * sides. Neither shipped surface actually gives the user a face; this passes one to show that the
 * header is not assistant-only.
 */
export const User: Story = {
  args: {
    sender: 'user',
    avatar: <Face label="AN" />,
    name: 'Andi',
    children: <ChatMessageBubble>Tolong buatkan caption untuk produk baru saya.</ChatMessageBubble>,
  },
};

/**
 * `system` suppresses the avatar, the name and the metadata even when all three are passed, and
 * centres the content. A notice wearing the assistant's face reads as something the assistant said.
 */
export const System: Story = {
  args: {
    sender: 'system',
    avatar: <Face label="!" />,
    name: 'Sistem',
    metadata: <span>09:41</span>,
    children: <ChatMessageBubble>Percakapan dilanjutkan dari sesi sebelumnya.</ChatMessageBubble>,
  },
};

/** The three densities, side by side. Each flows to the bubble inside through context. */
export const Densities: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      {(['compact', 'balanced', 'spacious'] as const).map((density) => (
        <ChatMessage key={density} sender="assistant" density={density} avatar={<Face label="AI" />} name={density}>
          <ChatMessageBubble>Ukuran ruang yang diambil baris ini.</ChatMessageBubble>
        </ChatMessage>
      ))}
    </div>
  ),
};

/**
 * A run of consecutive bubbles from one sender. The corners tuck toward that sender's edge, which
 * is what makes three bubbles read as one turn.
 */
export const GroupedRun: Story = {
  render: () => (
    <ChatMessage sender="assistant" avatar={<Face label="AI" />} name="Temanai">
      <ChatMessageBubble group="first">Saya sudah menyiapkan tiga pilihan.</ChatMessageBubble>
      <ChatMessageBubble group="middle">Yang pertama menekankan harga.</ChatMessageBubble>
      <ChatMessageBubble group="last" metadata={<span>09:42</span>}>
        Yang kedua menekankan bahan.
      </ChatMessageBubble>
    </ChatMessage>
  ),
};

/** No author header at all — the ordinary user row, and the one neither app draws a face on. */
export const WithoutAvatar: Story = {
  args: {
    sender: 'assistant',
    children: <ChatMessageBubble>Baris tanpa avatar tidak membayar gap yang tidak dipakainya.</ChatMessageBubble>,
  },
};

/**
 * A raw child sits FLUSH with the row edge — no bubble, no inset.
 *
 * That is the right answer for something meant to bleed and the wrong one for anything that has
 * to read as part of the conversation. The ghost bubble on `ChatMessageBubble` is the fix for the
 * second case; see that component's `GhostAlignment` story.
 */
export const RawChild: Story = {
  render: () => (
    <ChatMessage sender="assistant" avatar={<Face label="AI" />} name="Temanai">
      <ChatMessageBubble>Ini gambar yang kamu minta:</ChatMessageBubble>
      <div className="flex h-24 w-full items-center justify-center rounded-ds-lg bg-default-secondary">
        <Icon name="tile-image" aria-hidden className="h-6 w-6" />
      </div>
    </ChatMessage>
  ),
};

/**
 * ARRANGEMENT ONE — A SENT MESSAGE CARRYING AN ATTACHMENT.
 *
 * The chip is `ChatAttachment`, which this library already publishes for the composer. Both apps
 * hand-rolled their own copy of it for the sent-message card, which is the duplication this
 * arrangement exists to retire: an attachment looks the same whether it is about to be sent or has
 * been.
 *
 * IT IS WRAPPED IN A GHOST BUBBLE FOR ALIGNMENT, NOT DECORATION. Dropped in raw, the chip sits
 * flush with the message edge and a whole inset to the side of the text above it. The ghost gives
 * it the bubble's side padding and nothing else, so the chip's leading edge meets the text column.
 */
export const ArtifactAttachment: Story = {
  render: () => (
    <ChatMessage sender="user" avatar={<Face label="AN" />} name="Andi">
      <ChatMessageBubble group="first">Ini file spesifikasinya.</ChatMessageBubble>
      <ChatMessageBubble
        ghost
        group="last"
        metadata={<ChatMessageMetadata timestamp="09:41" status="delivered" />}
      >
        <ChatAttachment variant="file" name="spesifikasi-produk.pdf" typeLabel="PDF" sizeBytes={184320} showSize />
      </ChatMessageBubble>
    </ChatMessage>
  ),
};
