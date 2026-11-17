import type { Meta, StoryObj } from '@storybook/react-vite';
import { ChatMessage } from './ChatMessage';
import { ChatMessageBubble } from './ChatMessageBubble';
import { ChatMessageList } from './ChatMessageList';
import { ChatMessageMetadata } from './ChatMessageMetadata';
import { ChatScrollButton } from './ChatScrollButton';
import { ChatThread } from './ChatThread';

/**
 * The transcript frame — the element that owns the scroller.
 *
 * It composes inside the app shell's content slot and changes nothing about it: the shell
 * documents that slot as owning the scroller and pins both of its minimums so a child can scroll,
 * and its scroll spy tests containment rather than identity, so it still sees this scroller's
 * events.
 *
 * The pill is a SLOT with a working default. Scroll one of these up and it appears; scroll back to
 * the bottom and it goes.
 */
const LINES = [
  'Tolong buatkan caption untuk produk baru saya.',
  'Tentu. Boleh ceritakan produknya dulu?',
  'Keripik singkong pedas, kemasan 100 gram.',
  'Siap. Saya siapkan tiga pilihan nada bicara.',
  'Pertama: menekankan rasa pedasnya.',
  'Kedua: menekankan harga dan ukuran kemasan.',
  'Ketiga: menekankan bahan singkong lokal.',
  'Yang kedua saja, tolong dipendekkan.',
  'Baik, versi pendeknya sedang saya susun.',
  'Sudah. Silakan dicek dan beri tahu bagian yang perlu diubah.',
];

const Transcript = () => (
  <ChatMessageList label="Percakapan">
    {LINES.map((line, at) => (
      <ChatMessage
        key={line}
        sender={at % 2 === 0 ? 'user' : 'assistant'}
        name={at % 2 === 0 ? 'Andi' : 'Temanai'}
      >
        <ChatMessageBubble metadata={<ChatMessageMetadata timestamp="09:41" status="read" />}>
          {line}
        </ChatMessageBubble>
      </ChatMessage>
    ))}
  </ChatMessageList>
);

const meta: Meta<typeof ChatThread> = {
  title: 'Components/Chat/ChatThread',
  component: ChatThread,
  parameters: { layout: 'padded' },
  decorators: [
    (Story) => (
      <div className="flex h-[420px] w-[560px] flex-col rounded-ds-lg border border-default-primary">
        {Story()}
      </div>
    ),
  ],
};
export default meta;

type Story = StoryObj<typeof ChatThread>;

/** The frame with its default pill. Scroll up to see it appear. */
export const Default: Story = {
  render: (args) => (
    <ChatThread {...args}>
      <Transcript />
    </ChatThread>
  ),
};

/**
 * A surface supplying its own pill. The slot is a render function rather than a node, because
 * everything a surface would want to change about the pill is state this frame owns.
 */
export const CustomPill: Story = {
  render: (args) => (
    <ChatThread
      {...args}
      pill={(scroll) => (
        <ChatScrollButton
          label="Kembali ke bawah"
          shape="labelled"
          hasNewMessages={scroll.hasNewMessages}
          onClick={scroll.scrollToBottom}
        />
      )}
    >
      <Transcript />
    </ChatThread>
  ),
};

/**
 * The frame around an EMPTY transcript. The scroller is still the frame's, so the empty state
 * centres inside it rather than inside the page.
 */
export const Empty: Story = {
  render: (args) => (
    <ChatThread {...args}>
      <ChatMessageList
        label="Percakapan"
        emptyState={
          <>
            <span className="text-default-primary">Belum ada percakapan</span>
            <span>Mulai dengan menanyakan apa pun tentang usahamu.</span>
          </>
        }
      >
        {[]}
      </ChatMessageList>
    </ChatThread>
  ),
};
