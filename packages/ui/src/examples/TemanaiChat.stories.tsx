import React from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { AppShell } from '../layouts/AppShell';
import { Button } from '../primitives/Button';
import {
  ChatAttachment,
  ChatAttachmentButton,
  ChatComposer,
  ChatDrawer,
  ChatSendButton,
  ChatToolsButton,
  ChatVoiceBar,
  ChatVoiceButton,
} from '../primitives/ChatComposer';
import {
  ChatMessage,
  ChatMessageBubble,
  ChatMessageList,
  ChatMessageMetadata,
  ChatMessageTTSButton,
  ChatThread,
} from '../primitives/ChatMessage';
import { Chip } from '../primitives/Chip';
import { Header } from '../primitives/Header';
import { Icon } from '../primitives/Icon';
import { Image } from '../primitives/Image';
import { Sidebar, SidebarMenuItem } from '../primitives/Sidebar';
import { Spinner } from '../primitives/Spinner';
import { Text } from '../primitives/Text';

/**
 * THE WHOLE TEMANAI CHAT ROOM, ASSEMBLED OUT OF THIS LIBRARY AND NOTHING ELSE.
 *
 * Every other story in the package shows one component, or one arrangement inside one message.
 * None of them answers the question adoption actually turns on: put the shell, the transcript,
 * the artifacts and the composer together and does the result look like the product? That is what
 * this page is, and it is the reason it lives in its own section rather than under `Components` —
 * it documents no component. It composes twenty of them.
 *
 * NOT A SCREENSHOT — A COMPOSITION. Every part below is the real published component with its
 * real props. There are no stand-in boxes, because a page of stand-ins would look right while the
 * composition it claims to demonstrate was broken. The consequence is that this page also FAILS
 * honestly: if a component stops fitting beside its neighbours, this is where it shows.
 *
 * WHAT THE LIBRARY DOES NOT COVER YET, read off the live surface while building this. None of it
 * is a defect in the pieces below; all of it is work the adopting app still owns, and naming it
 * here is more use than a page that implies the set is complete:
 *
 * - **The room's gradient background.** The app paints a full-bleed SVG behind the transcript.
 *   No component owns a page background and none should.
 * - **The error toast above the transcript**, and the credit and template overlays. Those are
 *   `Alert`, `Dialog` and app state; the transcript has no opinion about them.
 * - **A copy control.** The clipboard is the host's, and no component stands in for it yet, so
 *   the action row below carries read-aloud — which IS a component — and four named buttons.
 *   Press the microphone in the composer: the control row is replaced by `ChatVoiceBar`, at the
 *   same height, which is the one interaction on this page that swaps a whole row.
 * - **The once-per-session experience survey**, which is a feature rather than a piece of chrome.
 * - **The reading measure.** The app centres transcript and composer in one `max-w-4xl`; no
 *   component owns that, and `AppShell`'s content slot is right not to. See `COLUMN` below.
 * - **A 4/5 image ratio.** `Image` publishes square, 16/9 and unconstrained; the app's generated
 *   grid uses 4/5. The grid below takes the published square rather than inventing the fourth.
 *
 * The scroll pill, the load-older affordance, the streaming announcement and the density cascade
 * are all real here — scroll the transcript up and the pill appears, because `ChatThread` owns the
 * scroller and is watching this exact content grow.
 */
const meta: Meta = {
  title: 'Examples/TemanAI chat',
  parameters: { layout: 'fullscreen' },
};
export default meta;

type Story = StoryObj;

/* ---------------------------------------------------------------- the shell */

/**
 * The session list. `active` marks the open one and the rail state is what the narrow drawer
 * renders, which is why both instances take the same children.
 */
const Nav = ({ collapsed = false, label = 'Riwayat percakapan' }: { collapsed?: boolean; label?: string }) => (
  <Sidebar
    label={label}
    collapsed={collapsed}
    header={<span className="text-ds-paragraph-mobile font-semibold">{collapsed ? 'U' : 'UMKMall'}</span>}
  >
    <div className="flex flex-col gap-1">
      <SidebarMenuItem
        label="Chat baru"
        icon={<Icon name="message-square-plus" aria-hidden className="h-4 w-4" />}
        collapsed={collapsed}
        onClick={() => {}}
      />
      <SidebarMenuItem
        label="Caption keripik singkong"
        icon={<Icon name="message-square" aria-hidden className="h-4 w-4" />}
        collapsed={collapsed}
        active
        onClick={() => {}}
      />
      <SidebarMenuItem
        label="Foto produk untuk katalog"
        icon={<Icon name="message-square" aria-hidden className="h-4 w-4" />}
        collapsed={collapsed}
        onClick={() => {}}
      />
      <SidebarMenuItem
        label="Rencana promo Ramadan"
        icon={<Icon name="message-square" aria-hidden className="h-4 w-4" />}
        collapsed={collapsed}
        onClick={() => {}}
      />
    </div>
  </Sidebar>
);

/* ---------------------------------------------------------------- the composer */

/**
 * STATEFUL, BECAUSE THE COMPOSER IS CONTROLLED. A fixed value and a no-op handler render an
 * editor nobody can type into — the defect this family's own stories shipped once and now
 * document.
 */
function Composer({ withAttachment = false }: { withAttachment?: boolean }) {
  const [value, setValue] = React.useState('');
  const [attached, setAttached] = React.useState(withAttachment);
  /* THE ONE REAL ROW SWAP ON THIS PAGE. The microphone does not toggle a button's own `active`
     state — it replaces the whole control row with the listening bar, which is what the live
     surface does and what `actionRow` exists for. Press it and watch the box height: it does not
     move, which is the reason the bar publishes a `size` at all. */
  const [listening, setListening] = React.useState(false);
  return (
    <ChatComposer
      value={value}
      onValueChange={setValue}
      editorLabel="Tulis pesan"
      placeholder="Ketik pertanyaan Anda..."
      header={
        attached ? (
          /* ONE DISMISS, NOT TWO. The drawer publishes its own `onDismiss` and the chip publishes
             `onRemove`; passing both draws two close buttons a centimetre apart for one file. The
             chip's is the right one here — what the reader wants to remove is the attachment, and
             the tray is only there because the attachment is. */
          <ChatDrawer>
            <ChatAttachment
              variant="file"
              name="daftar-produk.xlsx"
              typeLabel="XLSX"
              sizeBytes={41984}
              showSize
              onRemove={() => setAttached(false)}
            />
          </ChatDrawer>
        ) : undefined
      }
      actionRow={
        listening ? (
          <ChatVoiceBar
            size="compact"
            label="Mendengarkan..."
            stopLabel="Berhenti mendengarkan"
            onStop={() => setListening(false)}
          />
        ) : undefined
      }
      toolActions={
        <>
          <ChatToolsButton label="Alat" />
          <ChatAttachmentButton label="Lampirkan file" onClick={() => setAttached(true)} />
        </>
      }
      sendActions={
        <>
          <ChatVoiceButton label="Input suara" onClick={() => setListening(true)} />
          <ChatSendButton label="Kirim pesan" />
        </>
      }
    />
  );
}

/* ---------------------------------------------------------------- the turn parts */

/**
 * The assistant's action row, and it is a row of NAMED buttons rather than bare glyphs: an
 * icon-only control with no accessible name announces nothing at all, which the icon-only prop's
 * own type refuses to let you build.
 *
 * FIVE NOW, AND THE FIRST ONE IS NOT A `Button`. Read-aloud used to be absent here with the note
 * that the registry published no speaker — it does, and `ChatMessageTTSButton` is the control
 * built on it, so the row leads with that instead of approximating it with a glyph. It is the one
 * action with five drawings rather than one, which is exactly why it is a component and its four
 * neighbours are not. Copy is still absent: `copy` is in the registry, but the clipboard belongs
 * to the host and there is no component to stand in for it yet.
 */
const Actions = () => (
  <div className="flex items-center gap-ds-4xs">
    {/* Parked in `paused` so the row shows the state a reader would otherwise never catch —
        the example page is a still, and `idle` is what every other surface already draws. */}
    <ChatMessageTTSButton state="paused" label="Lanjutkan" onToggle={() => {}} />
    {(
      [
        ['thumbs-up', 'Jawaban ini membantu'],
        ['thumbs-down', 'Jawaban ini tidak membantu'],
        ['rotate-cw', 'Buat ulang jawaban'],
        ['file-download', 'Unduh jawaban'],
      ] as const
    ).map(([icon, label]) => (
      <Button key={icon} type="text" color="light" size="micro" iconOnly aria-label={label}>
        <Icon name={icon} aria-hidden className="h-4 w-4" />
      </Button>
    ))}
  </div>
);

/** The follow-up chips the app offers under a settled reply. `Chip` publishes the two states. */
const Suggestions = ({ items }: { items: readonly string[] }) => (
  <div className="flex flex-wrap gap-ds-4xs">
    {items.map((item) => (
      <Chip key={item} size="small">
        {item}
      </Chip>
    ))}
  </div>
);

/**
 * THE READING COLUMN, AND NO COMPONENT OWNS IT. The app centres its transcript and its composer in
 * the same `max-w-4xl` and pads both sides; `AppShell`'s content slot deliberately does not, because
 * a shell that imposed a measure would be wrong for every non-prose surface. So the width lives
 * here, written once and shared by the two regions that have to agree about it — at full viewport
 * width without it the transcript runs to about 1,300px and a four-photo grid draws 490px tiles.
 */
const COLUMN = 'mx-auto w-full max-w-4xl px-ds-md';

/** The four generated photos. Real sources through the real component — see `Image`'s own story. */
const SHOTS = [
  ['https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=480', 'Etalase toko dari depan'],
  ['https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?w=480', 'Produk di atas meja kayu'],
  ['https://images.unsplash.com/photo-1558961363-fa8fdf82db35?w=480', 'Kemasan dengan latar polos'],
  ['https://images.unsplash.com/photo-1528735602780-2552fd46c7af?w=480', 'Produk dipegang tangan'],
] as const;

/**
 * HOW WIDE A SINGLE PIECE OF MEDIA IS, and it is narrower than the message column on purpose. The
 * app narrows a lone image and a video the same way — a video that spans the whole reading column
 * dominates the conversation it is part of, and the reader loses the thread around it. The ghost
 * bubble still asks for the full width: this percentage is measured against that, which is exactly
 * the arrangement the app uses.
 */
const MEDIA = 'w-[70%] md:w-[45%] min-w-[180px]';

const Face = () => (
  <span
    aria-hidden
    className="flex h-7 w-7 items-center justify-center rounded-full bg-default-secondary text-ds-legacy-10 text-default-secondary"
  >
    AI
  </span>
);

/* ---------------------------------------------------------------- the transcript */

/**
 * ONE TRANSCRIPT CARRYING EVERY SHAPE THE PRODUCT ACTUALLY SENDS: plain prose, an attachment
 * going out, a generated image grid, a video that is still rendering, a video that finished, a
 * turn that failed, and the action row and follow-up chips that close a settled reply.
 *
 * The user turns pass NO avatar and no name. That is the product, not an omission: neither shipped
 * surface gives the reader a face, and the author header renders only when something fills it.
 *
 * EVERY ASSISTANT BUBBLE IS A GHOST, AND THAT IS THE APP RATHER THAN A PREFERENCE. The live
 * transcript fills and rounds the USER side only — `bg-[#F0F7FF] rounded-xl` on that branch and an
 * empty string on the other — so a reply draws as prose in the message column with no container
 * around it. `ghost` is exactly that: the fill goes, the inline padding stays, so the text still
 * lines up with the media beneath it instead of sitting an inset to the side of it.
 *
 * The contract keeps a filled assistant row (KTD10) and `ChatMessageBubble`'s own stories still
 * demonstrate it, because the sender fill is a declared axis and a component's stories are where
 * an axis gets shown. This page is not about the axes — it is about what the product looks like,
 * and on this surface the assistant side does not take the fill.
 *
 * `group` is dropped from these: it tucks a CORNER toward the sender's edge, and a bubble with no
 * fill has no corner to tuck. Leaving it would be a prop doing nothing, which is worse than absent
 * because the next reader has to check.
 */
const Transcript = () => (
  <ChatMessageList label="Percakapan dengan Teman AI" align="bottom" className={COLUMN}>
    <ChatMessage sender="user">
      <ChatMessageBubble group="first">Ini daftar produk saya.</ChatMessageBubble>
      <ChatMessageBubble ghost group="last" metadata={<ChatMessageMetadata timestamp="09:38" status="read" />}>
        <ChatAttachment variant="file" name="daftar-produk.xlsx" typeLabel="XLSX" sizeBytes={41984} showSize />
      </ChatMessageBubble>
    </ChatMessage>

    <ChatMessage sender="assistant" avatar={<Face />} name="Teman AI">
      {/* NO TIMESTAMP ON AN ASSISTANT REPLY, because the app does not draw one — and the metadata
          row emits its separators from the GAP between the pieces it was given, so a timestamp
          beside an action row renders a dot in front of the buttons. The user turns below do carry
          one, which is the app's asymmetry rather than this page's. */}
      <ChatMessageBubble ghost metadata={<ChatMessageMetadata footer={<Actions />} />}>
        <Text variant="paragraph">
          Sudah saya baca. Ada 24 produk, dan yang paling sering dibeli keripik singkong pedas 100
          gram. Mau kita mulai dari caption untuk produk itu?
        </Text>
      </ChatMessageBubble>
    </ChatMessage>

    <ChatMessage sender="user">
      <ChatMessageBubble metadata={<ChatMessageMetadata timestamp="09:40" status="read" />}>
        Tolong buatkan empat variasi fotonya dulu.
      </ChatMessageBubble>
    </ChatMessage>

    <ChatMessage sender="assistant" avatar={<Face />} name="Teman AI">
      <ChatMessageBubble ghost>Ini empat variasinya:</ChatMessageBubble>
      <ChatMessageBubble ghost width="full" metadata={<ChatMessageMetadata footer={<Actions />} />}>
        {/* THREE COLUMNS FOR FOUR PHOTOS, which is the app's own rule: two images get two
            columns and three or more get three, so a four-photo reply draws three across and one
            below rather than a 2x2 block of very large tiles.

            `thumbnail` is the published square. The app's grid uses 4/5, a ratio this library does
            not publish — recorded in the page docblock rather than hand-written here, because a
            story quietly inventing a ratio is how a set grows one nobody decided on. */}
        <div className="grid w-full grid-cols-3 gap-2">
          {SHOTS.map(([src, alt]) => (
            <Image key={src} src={src} alt={alt} type="thumbnail" fit="cover" />
          ))}
        </div>
      </ChatMessageBubble>
    </ChatMessage>

    <ChatMessage sender="user">
      <ChatMessageBubble metadata={<ChatMessageMetadata timestamp="09:44" status="read" />}>
        Bagus. Sekarang buatkan video produknya.
      </ChatMessageBubble>
    </ChatMessage>

    <ChatMessage sender="assistant" avatar={<Face />} name="Teman AI">
      <ChatMessageBubble ghost>Videonya sedang saya buat, sekitar satu menit.</ChatMessageBubble>
      <ChatMessageBubble ghost width="full">
        {/* The tinted box is the SAME 16/9 the finished player takes, so the transcript does not
            jump under the reader when one replaces the other. */}
        <div className={MEDIA}>
          <div
            className="flex aspect-video w-full items-center justify-center rounded-ds-lg bg-callout-default-surface"
            role="status"
            aria-label="Video sedang dibuat"
          >
            <Spinner size="md" variant="primary" label="" />
          </div>
        </div>
      </ChatMessageBubble>
    </ChatMessage>

    <ChatMessage sender="assistant" avatar={<Face />} name="Teman AI">
      <ChatMessageBubble ghost>Sudah selesai. Silakan dicek.</ChatMessageBubble>
      <ChatMessageBubble
        ghost
        width="full"
        metadata={
          <ChatMessageMetadata
            footer={
              <div className="flex flex-col gap-ds-4xs">
                <Actions />
                <Suggestions items={['Buat versi 15 detik', 'Ganti musiknya', 'Tulis caption untuk video ini']} />
              </div>
            }
          />
        }
      >
        <div className={`relative ${MEDIA}`}>
          <Image
            src="https://images.unsplash.com/photo-1542838132-92c53300491e?w=960"
            alt="Cuplikan pembuka video produk"
            type="banner"
            fit="cover"
          />
          <div className="absolute inset-0 flex items-center justify-center">
            <Button type="primary" color="light" size="medium" iconOnly aria-label="Putar video">
              <Icon name="tile-video-play" aria-hidden className="h-6 w-6" />
            </Button>
          </div>
        </div>
      </ChatMessageBubble>
    </ChatMessage>

    <ChatMessage sender="system">
      <ChatMessageBubble>Percakapan dilanjutkan dari sesi sebelumnya.</ChatMessageBubble>
    </ChatMessage>
  </ChatMessageList>
);

/* ---------------------------------------------------------------- the stories */

/**
 * THE ROOM, FULL. Resize the preview to see the rail become a drawer; scroll the transcript to see
 * the header's shadow and the scroll pill arrive.
 */
export const Room: Story = {
  render: () => (
    <AppShell
      header={({ scrolled }) => (
        <Header type="temanAiChat" title="Teman AI" showTextLeft scrolled={scrolled} />
      )}
      sidebar={<Nav />}
      mobileSidebar={<Nav label="Riwayat percakapan (drawer)" />}
    >
      <ChatThread scrollToBottomLabel="Ke pesan terbaru">
        <Transcript />
      </ChatThread>
      <div className="shrink-0 py-ds-md">
        <div className={COLUMN}>
          <Composer />
        </div>
      </div>
    </AppShell>
  ),
};

/**
 * THE ROOM, EMPTY — and the composer is in the MIDDLE rather than at the bottom, which is the one
 * structural thing the live surface changes between the two states. The heading, the composer and
 * the starting chips are one centred column; the transcript is not rendered at all.
 */
export const EmptyRoom: Story = {
  render: () => (
    <AppShell
      header={<Header type="temanAiChat" title="Teman AI" showTextLeft />}
      sidebar={<Nav />}
      mobileSidebar={<Nav label="Riwayat percakapan (drawer)" />}
    >
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-ds-md px-ds-md py-ds-2xl">
          <div className="text-center">
            <Text variant="paragraph" color="secondary">
              Chat AI Coach sekarang
            </Text>
            <Text variant="h2" weight="bold" as="h1">
              Langkah besar dimulai dari obrolan
            </Text>
          </div>
          <Composer withAttachment />
          <Suggestions
            items={[
              'Buatkan caption produk',
              'Tingkatkan foto produk',
              'Buat video produk',
              'Bantu tulis balasan pelanggan',
            ]}
          />
        </div>
      </div>
    </AppShell>
  ),
};
