import React from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { ChatMessage, type ChatMessageProps } from './ChatMessage';
import { ChatMessageBubble } from './ChatMessageBubble';
import { ChatMessageList } from './ChatMessageList';
import { ChatMessageMetadata } from './ChatMessageMetadata';

/**
 * The transcript's log region.
 *
 * IT OWNS NO SCROLLER — the frame above it does. This announces, spaces and aligns what it holds,
 * and publishes its inner content element so the scroll owner can watch it grow.
 *
 * The busy state is ABSENT rather than false when nothing is streaming: a region permanently
 * announcing that it is not busy is noise on every settled turn.
 */
const Turn = ({
  children,
  sender = 'assistant',
  time = '09:41',
}: {
  children: React.ReactNode;
  sender?: ChatMessageProps['sender'];
  time?: string;
}) => (
  <ChatMessage sender={sender} name={sender === 'user' ? 'Andi' : 'Temanai'}>
    <ChatMessageBubble metadata={<ChatMessageMetadata timestamp={time} status="read" />}>
      {children}
    </ChatMessageBubble>
  </ChatMessage>
);

const meta: Meta<typeof ChatMessageList> = {
  title: 'Components/Chat/ChatMessageList',
  component: ChatMessageList,
  parameters: { layout: 'padded' },
  args: { label: 'Percakapan' },
  decorators: [
    (Story) => (
      <div className="h-[380px] w-[560px] overflow-y-auto rounded-ds-lg border border-default-primary">
        {Story()}
      </div>
    ),
  ],
};
export default meta;

type Story = StoryObj<typeof ChatMessageList>;

/* The alignment the arrangement stories use. One constant, so a reader comparing them is looking
   at the density or the gap rather than at two different seating rules. */
const TOP = 'top' as const;

/** A short conversation, seated above where a composer would be. */
export const Seated: Story = {
  args: {
    align: 'bottom',
    children: (
      <>
        <Turn sender="user" time="09:40">
          Tolong buatkan caption untuk produk baru saya.
        </Turn>
        <Turn>Tentu. Boleh ceritakan produknya dulu?</Turn>
      </>
    ),
  },
};

/** The same conversation hanging from the top, for a transcript embedded in a page. */
export const AlignedTop: Story = {
  args: {
    align: TOP,
    children: (
      <>
        <Turn sender="user" time="09:40">
          Tolong buatkan caption untuk produk baru saya.
        </Turn>
        <Turn>Tentu. Boleh ceritakan produknya dulu?</Turn>
      </>
    ),
  },
};

/** While a reply arrives. The busy state reaches assistive technology only in this story. */
export const Streaming: Story = {
  args: {
    streaming: true,
    children: (
      <>
        <Turn sender="user" time="09:40">
          Yang kedua saja.
        </Turn>
        <Turn>Baik, saya sedang menyusun versi pendeknya…</Turn>
      </>
    ),
  },
};

/** Nothing to show yet. */
export const Empty: Story = {
  args: {
    emptyState: (
      <>
        <span className="text-default-primary">Belum ada percakapan</span>
        <span>Mulai dengan menanyakan apa pun tentang usahamu.</span>
      </>
    ),
  },
};

/**
 * The three densities. Each picks a padding AND a row gap, and both flow to the rows inside
 * through context.
 */
export const Densities: Story = {
  render: (args) => (
    <div className="flex h-full flex-col">
      {(['compact', 'balanced', 'spacious'] as const).map((density) => (
        <ChatMessageList key={density} {...args} align={TOP} density={density}>
          <Turn>{density}</Turn>
          <Turn sender="user">{density}</Turn>
        </ChatMessageList>
      ))}
    </div>
  ),
};

/**
 * A gap override on top of a density. The PADDING stays where the density put it — the two are
 * separate tables precisely so a caller can move one without the other.
 */
export const GapOverride: Story = {
  args: {
    align: TOP,
    density: 'spacious',
    gap: 'none',
    children: (
      <>
        <Turn>Jarak baris dipepatkan…</Turn>
        <Turn>…tetapi padding tetap milik density.</Turn>
      </>
    ),
  },
};

/**
 * Loading older messages. The action fires when the reader reaches the top; the component holds
 * the in-flight state itself, because the pending row renders below the sentinel and would
 * otherwise let the observer fire again while the first call is still unresolved.
 */
export const LoadsOlder: Story = {
  render: (args) => {
    function Host() {
      const [older, setOlder] = React.useState<string[]>([]);
      return (
        <ChatMessageList
          {...args}
          align={TOP}
          scrollToTopAction={() =>
            new Promise<void>((resolve) =>
              setTimeout(() => {
                setOlder((was) => [`Pesan lama #${was.length + 1}`, ...was]);
                resolve();
              }, 600),
            )
          }
        >
          {older.map((text) => (
            <Turn key={text} time="08:00">
              {text}
            </Turn>
          ))}
          <Turn sender="user" time="09:40">
            Gulir ke atas untuk memuat pesan sebelumnya.
          </Turn>
        </ChatMessageList>
      );
    }
    return <Host />;
  },
};

/**
 * Every declared rung, so the axis has a demonstration rather than a props-table entry. The
 * padding is identical in all six — that is the split these two tables exist for.
 */
export const GapRungs: Story = {
  render: (args) => (
    <div className="flex h-full flex-col">
      {(['none', '2xs', 'xs', 'sm', 'md', 'lg'] as const).map((gap) => (
        <ChatMessageList key={gap} {...args} align={TOP} gap={gap}>
          <Turn>{gap}</Turn>
          <Turn sender="user">{gap}</Turn>
        </ChatMessageList>
      ))}
    </div>
  ),
};
