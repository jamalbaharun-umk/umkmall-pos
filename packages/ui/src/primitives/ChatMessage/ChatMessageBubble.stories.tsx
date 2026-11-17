import type { Meta, StoryObj } from '@storybook/react-vite';
import { ChatMessage } from './ChatMessage';
import { ChatMessageBubble } from './ChatMessageBubble';
import { ChatMessageMetadata } from './ChatMessageMetadata';
import { Button } from '../Button';
import { Icon } from '../Icon';
import { Image } from '../Image';
import { Spinner } from '../Spinner';
import { Text } from '../Text';

/**
 * The visible bubble.
 *
 * IT RETURNS A FRAGMENT. Its `name` and `metadata` slots are SIBLINGS of the bubble inside the
 * row's content column, not children of a box around all three — wrap them and every grouped run
 * gains a gap it did not ask for at each end.
 *
 * It reads its sender from the row it sits in. Outside one it draws as the assistant side, which
 * is why the stories here mount it inside a row wherever the sender matters.
 */
const meta: Meta<typeof ChatMessageBubble> = {
  title: 'Components/Chat/ChatMessageBubble',
  component: ChatMessageBubble,
  parameters: { layout: 'padded' },
  decorators: [(Story) => <div className="w-[560px]">{Story()}</div>],
};
export default meta;

type Story = StoryObj<typeof ChatMessageBubble>;

/** On its own, with no row around it: the assistant side at the standalone density. */
export const Standalone: Story = {
  args: { children: 'Sebuah gelembung tanpa baris di sekitarnya.' },
};

/** Inside a user row, where it takes that side's direction and grouping edge. */
export const InsideUserMessage: Story = {
  render: () => (
    <ChatMessage sender="user" name="Andi">
      <ChatMessageBubble>Gelembung yang membaca pengirimnya dari barisnya.</ChatMessageBubble>
    </ChatMessage>
  ),
};

/**
 * The four grouping values, on both sides. Each tightens a different corner pair, and tightens on
 * the OPPOSITE side for the user — logical corners, so a right-to-left reader gets the tuck on the
 * side the message is actually on.
 */
export const Grouping: Story = {
  render: () => (
    <div className="flex flex-col gap-6">
      {(['assistant', 'user'] as const).map((sender) => (
        <ChatMessage key={sender} sender={sender} name={sender}>
          <ChatMessageBubble group="first">Pertama</ChatMessageBubble>
          <ChatMessageBubble group="middle">Tengah</ChatMessageBubble>
          <ChatMessageBubble group="last">Terakhir</ChatMessageBubble>
        </ChatMessage>
      ))}
    </div>
  ),
};

/**
 * THE GHOST IS AN ALIGNMENT MECHANISM, NOT A DECORATION — and this story is the reason it exists.
 *
 * The first row drops a media box straight into the message, so its leading edge sits flush with
 * the row and a whole inset to the left of the text above it. The second wraps the same box in a
 * ghost bubble: the fill and the vertical padding go, the SIDE padding stays, and the box now
 * starts exactly where the bubble text starts.
 */
export const GhostAlignment: Story = {
  render: () => {
    const Box = () => (
      <div className="flex h-20 w-full items-center justify-center rounded-ds-lg bg-default-secondary">
        <Icon name="tile-image" aria-hidden className="h-6 w-6" />
      </div>
    );
    return (
      <div className="flex flex-col gap-6">
        <ChatMessage sender="assistant" name="Tanpa ghost — tidak sejajar">
          <ChatMessageBubble>Ini hasilnya:</ChatMessageBubble>
          <Box />
        </ChatMessage>
        <ChatMessage sender="assistant" name="Dengan ghost — sejajar">
          <ChatMessageBubble>Ini hasilnya:</ChatMessageBubble>
          <ChatMessageBubble ghost width="full">
            <Box />
          </ChatMessageBubble>
        </ChatMessage>
      </div>
    );
  },
};

/**
 * `width="full"` clears the default cap as well as setting the width. Setting a width alone would
 * leave the cap winning, which looks like the prop doing nothing on a wide viewport and working on
 * a narrow one.
 */
export const WidthOverride: Story = {
  render: () => (
    <div className="flex flex-col gap-6">
      <ChatMessage sender="user" name="Dibatasi (auto)">
        <ChatMessageBubble>
          Teks panjang yang berhenti di batas lebar bawaan, supaya balasan satu baris tidak
          membentang selebar kolom desktop.
        </ChatMessageBubble>
      </ChatMessage>
      <ChatMessage sender="user" name="Penuh (full)">
        <ChatMessageBubble width="full">
          Teks yang sama, tetapi batas lebarnya dilepas sehingga gelembung mengisi kolom pesan.
        </ChatMessageBubble>
      </ChatMessage>
    </div>
  ),
};

/** The per-bubble slots: a name on the first bubble of a run, a timestamp on the last. */
export const PerBubbleSlots: Story = {
  render: () => (
    <ChatMessage sender="assistant">
      <ChatMessageBubble group="first" name="Temanai">
        Saya sudah menyiapkan tiga pilihan.
      </ChatMessageBubble>
      <ChatMessageBubble group="last" metadata={<span>09:42</span>}>
        Pilih salah satu untuk saya perbaiki.
      </ChatMessageBubble>
    </ChatMessage>
  ),
};

/**
 * A generated image, drawn with a PLAIN ELEMENT rather than the library `Image`.
 *
 * That component refuses any source which is not remote https — an SSRF control that is correct
 * there and would blank every one of these: a generated image arrives as a data URL, an
 * object-store key or a presigned link. Same carve-out the chat prose already records for composer
 * previews. `Image` plus `Lightbox` are still the right pair once a picture has a settled https
 * home.
 */
/**
 * REAL PHOTOS THROUGH THE REAL COMPONENT, and both halves of that matter.
 *
 * These were four grey boxes drawing `tile-image-sparkle` — enough to show the wrapper's
 * geometry and nothing about the thing inside it. `Image` REFUSES any source that is not
 * `https://`: it renders its placeholder and emits no `<img>` at all, which is an SSRF control
 * rather than a tidy empty state. A family of arrangement stories that never mounts it is a
 * transcript nobody has seen carry a photo, and the protocol branch is invisible in the one place
 * a reader would look for it.
 *
 * The host is the same one `Image.stories.tsx` already uses, so the two pages agree about where a
 * sample photo comes from. `type="thumbnail"` is the square ratio and `fit="cover"` fills the
 * cell — without the fit the default `contain` letterboxes every tile inside its own square.
 *
 * THE APP'S GRID IS 4/5, WHICH THIS LIBRARY DOES NOT PUBLISH. `Image` offers square, 16/9 and
 * unconstrained; the square is taken here rather than the fourth ratio being invented in a story,
 * which is how a published set grows a value nobody decided on. Noted, not worked around.
 */
const SHOTS = [
  ['https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=480', 'Etalase toko dari depan'],
  ['https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?w=480', 'Produk di atas meja kayu'],
  ['https://images.unsplash.com/photo-1558961363-fa8fdf82db35?w=480', 'Kemasan dengan latar polos'],
  ['https://images.unsplash.com/photo-1528735602780-2552fd46c7af?w=480', 'Produk dipegang tangan'],
] as const;

/** How wide a lone piece of media is — see `ArtifactVideo`'s note. Mirrors the app's own cap. */
const MEDIA = 'w-[70%] md:w-[45%] min-w-[180px]';

/**
 * ARRANGEMENT TWO — A GENERATED-IMAGE GRID THAT SPANS THE MESSAGE COLUMN.
 *
 * The grid is ordinary children: a grid of elements, which is what a media arrangement is. No
 * media-grid component is needed and none is offered.
 *
 * THE GHOST WRAPPER IS THE ALIGNMENT, AND `width="full"` IS WHAT LETS IT SPAN. Without the ghost
 * the grid starts at the message edge while the sentence above it starts an inset further in —
 * two left edges in one message, which reads as a layout accident. Without the width override the
 * default cap would hold the grid at the bubble's own maximum, which is narrower than the column a
 * grid of four wants.
 */
export const ArtifactImageGrid: Story = {
  render: () => (
    <ChatMessage sender="assistant" name="Temanai">
      <ChatMessageBubble group="first">Ini empat variasi fotonya:</ChatMessageBubble>
      <ChatMessageBubble ghost width="full" group="last">
        {/* THREE COLUMNS FOR FOUR PHOTOS — the app's own rule: two images take two columns, three
            or more take three. A 2x2 of four is a block of very large tiles at any real width. */}
        <div className="grid w-full grid-cols-3 gap-2">
          {SHOTS.map(([src, alt]) => (
            <Image key={src} src={src} alt={alt} type="thumbnail" fit="cover" />
          ))}
        </div>
      </ChatMessageBubble>
    </ChatMessage>
  ),
};

/**
 * ARRANGEMENT THREE — BUBBLE TEXT AND AN ARTIFACT CARD IN ONE MESSAGE.
 *
 * The timestamp rides the LAST BUBBLE's metadata slot rather than the message's, which is the
 * difference the two slots exist for: a message-level timestamp sits under everything, including
 * the card, and reads as belonging to the card rather than to the turn. On the last bubble it
 * closes the turn where the turn actually ends.
 *
 * The card is a raw child on purpose — it is meant to bleed to the message edge, which is the one
 * case where NOT wrapping it in a ghost is the right answer. Compare `GhostAlignment` above for
 * the opposite case.
 */
export const ArtifactMixedCard: Story = {
  render: () => (
    <ChatMessage sender="assistant" name="Temanai">
      <ChatMessageBubble group="first">Rangkuman kampanyenya sudah siap.</ChatMessageBubble>
      <div className="w-full rounded-ds-lg border border-default-primary p-ds-sm">
        <div className="text-ds-paragraph-mobile text-default-primary">Kampanye Ramadan</div>
        <div className="text-ds-legacy-xs text-default-secondary">3 caption · 4 gambar · 1 video</div>
      </div>
      <ChatMessageBubble group="last" metadata={<ChatMessageMetadata timestamp="09:43" status="read" />}>
        Beri tahu saya bagian mana yang perlu diubah.
      </ChatMessageBubble>
    </ChatMessage>
  ),
};

/**
 * ARRANGEMENT FOUR — A GENERATED VIDEO, WAITING AND THEN FINISHED.
 *
 * BOTH STATES ARE IN ONE STORY BECAUSE THE POINT IS THAT THEY ARE THE SAME SIZE. The app draws a
 * tinted box while the video renders and swaps a player into it when the file arrives; size the
 * two even slightly differently and the transcript jumps under the reader at the moment the swap
 * happens. That jump is the whole reason the aspect ratio travels in the pending marker rather
 * than being decided by whatever arrives, and a story showing one state alone cannot show it.
 *
 * `type="banner"` is the 16/9 ratio — the same constraint the pending box takes from
 * `aspect-video`, so the two are one ratio expressed by the component in one and by the wrapper
 * in the other. That asymmetry is real: the pending box has no photo, so there is no `Image` to
 * carry it.
 *
 * THE POSTER IS A PHOTO, NOT A PLAYER. Mounting a real `<video>` here would make this page fetch
 * a media file to demonstrate a layout, and the arrangement is identical either way: a 16/9 frame
 * inside a full-width ghost, with the play affordance over it. What the app puts in that frame is
 * its own player.
 *
 * AND IT IS NARROWER THAN THE MESSAGE COLUMN, which is the app's arrangement rather than a
 * decoration: a video spanning the whole column dominates the conversation it belongs to. The
 * ghost still asks for the full width — the percentage below is measured against that.
 */
export const ArtifactVideo: Story = {
  render: () => (
    <ChatMessage sender="assistant" name="Temanai">
      <ChatMessageBubble group="first">Videonya sedang saya buat, sekitar satu menit.</ChatMessageBubble>
      <ChatMessageBubble ghost width="full">
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
      <ChatMessageBubble group="first">Sudah selesai. Silakan dicek.</ChatMessageBubble>
      <ChatMessageBubble
        ghost
        width="full"
        group="last"
        metadata={<ChatMessageMetadata timestamp="09:47" status="read" />}
      >
        <div className={`relative ${MEDIA}`}>
          <Image
            src="https://images.unsplash.com/photo-1542838132-92c53300491e?w=960"
            alt="Cuplikan pembuka video produk"
            type="banner"
            fit="cover"
          />
          {/* The affordance is a real button with a real name: a glyph alone announces nothing,
              and this is the control a reader reaches the video through. */}
          <div className="absolute inset-0 flex items-center justify-center">
            <Button type="primary" color="light" size="medium" iconOnly aria-label="Putar video">
              <Icon name="tile-video-play" aria-hidden className="h-6 w-6" />
            </Button>
          </div>
        </div>
      </ChatMessageBubble>
    </ChatMessage>
  ),
};

/**
 * ARRANGEMENT FIVE — A VIDEO THE APP COULD NOT MAKE.
 *
 * The failure is prose in an ordinary bubble, not a red frame where the video would have been: a
 * box styled as an error occupies the space of a thing that does not exist, and the reader is left
 * looking at the shape of their loss. The `error` status on the metadata is what carries it.
 */
export const ArtifactVideoFailed: Story = {
  render: () => (
    <ChatMessage sender="assistant" name="Temanai">
      <ChatMessageBubble metadata={<ChatMessageMetadata timestamp="09:47" status="error" />}>
        <Text variant="paragraph">
          Videonya gagal dibuat dan kuotamu tidak terpakai. Mau saya coba lagi?
        </Text>
      </ChatMessageBubble>
    </ChatMessage>
  ),
};
