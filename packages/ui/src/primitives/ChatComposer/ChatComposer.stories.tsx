import React from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { ChatComposer } from './ChatComposer';
import { ChatDrawer } from './ChatDrawer';
import { ChatAttachment } from './ChatAttachment';
import { ChatToolsButton } from './ChatToolsButton';
import { ChatAttachmentButton } from './ChatAttachmentButton';
import { ChatVoiceButton } from './ChatVoiceButton';
import { ChatSendButton } from './ChatSendButton';
import { ChatVoiceBar } from './ChatVoiceBar';

/**
 * EVERY STORY IS STATEFUL, AND THAT IS NOT A CONVENIENCE. This is a CONTROLLED component: it
 * renders the `value` it is handed. An earlier version passed a fixed value and a no-op handler in
 * `meta.args`, which every story inherited — so nobody could type into any story.
 *
 * THE SHELL IS 17 PROPS, DOWN FROM 34. The buttons are slots rather than thirteen props, and the
 * drawer is a slot rather than seven; both were plumbing for state the host already held.
 */
type StatefulProps = Omit<React.ComponentProps<typeof ChatComposer>, 'value' | 'onValueChange'> & {
  initial?: string;
};

function Stateful({ initial = '', ...props }: StatefulProps) {
  const [value, setValue] = React.useState(initial);
  return <ChatComposer {...props} value={value} onValueChange={setValue} />;
}

/**
 * A DRAWER THAT REALLY GOES AWAY. `onDismiss` is a callback the HOST acts on — the drawer does not
 * unmount itself, because a surface may want to confirm first, or report, or refuse. A story that
 * passes a no-op therefore renders a dismiss button that does nothing, which is the same defect the
 * editor's `value`/`onValueChange` pair had: the control looks wired and is not.
 */
function DismissibleDrawer({
  children,
  ...props
}: React.ComponentProps<typeof ChatDrawer>): React.ReactElement | null {
  const [shown, setShown] = React.useState(true);
  if (!shown) return null;
  return (
    <ChatDrawer {...props} onDismiss={() => setShown(false)}>
      {children}
    </ChatDrawer>
  );
}

/** The composition every surface starts from: two tool buttons, voice and send. */
const TOOLS = (
  <>
    <ChatToolsButton label="Alat" />
    <ChatAttachmentButton label="Lampirkan file" />
  </>
);
const SEND = (
  <>
    <ChatVoiceButton label="Input suara" />
    <ChatSendButton label="Kirim pesan" />
  </>
);

const meta: Meta<typeof ChatComposer> = {
  title: 'Components/Chat/ChatComposer',
  component: ChatComposer,
  parameters: { layout: 'centered' },
  args: {
    placeholder: 'Tanyakan bisnismu...',
    editorLabel: 'Tulis pesan',
    toolActions: TOOLS,
    sendActions: SEND,
  },
  decorators: [(Story) => <div className="w-[640px]">{Story()}</div>],
  render: (args) => <Stateful {...args} />,
};
export default meta;

type Story = StoryObj<typeof ChatComposer>;

export const Default: Story = {};

/** The hero: `raised` swaps the resting and focus shadows for `shadow-xl`. */
export const Raised: Story = { args: { raised: true } };

/** The V2 hero: `raised` with `heroEdge` also draws the brand → success edge and, from `md`, the Desktop radius and padding (UMK-1755). */
export const HeroEdge: Story = { args: { raised: true, heroEdge: true } };

/** Type into it. */
export const Typing: Story = { render: (args) => <Stateful {...args} initial="Halo, " /> };

/** Nothing typed yet — the state the composer opens in, and where send is disabled. */
export const Empty: Story = {
  args: {
    sendActions: (
      <>
        <ChatVoiceButton label="Input suara" />
        <ChatSendButton label="Kirim pesan" disabled />
      </>
    ),
  },
};

/**
 * ATTACHMENTS LIVE IN THE HEADER, OUTSIDE THE BORDERED BOX. Focus the editor and watch the band:
 * it wraps the input and its controls, and NOT the files. That is the whole reason the drawer
 * moved out.
 */
export const WithAttachments: Story = {
  args: {
    header: (
      <ChatDrawer>
        <ChatAttachment variant="file" name="design-spec.pdf" typeLabel="PDF" onRemove={() => {}} />
        <ChatAttachment variant="file" name="api-schema.json" typeLabel="JSON" onRemove={() => {}} />
      </ChatDrawer>
    ),
  },
};

/**
 * A COLLAPSIBLE DRAWER, WITH THE FACE IT WEARS WHEN SHUT. The toggle draws a hairline while the
 * drawer is open and the host's summary once it closes — one control, two faces, so there is
 * always exactly one thing to press and one obvious way back.
 *
 * Collapse it: the files are HIDDEN, not unmounted, so an upload in flight survives the round trip.
 */
export const CollapsibleDrawer: Story = {
  render: (args) => {
    function Demo() {
      const [collapsed, setCollapsed] = React.useState(false);
      const files = ['design-spec.pdf', 'api-schema.json', 'screenshot.png', 'meeting-notes.md'];
      return (
        <Stateful
          {...args}
          header={
            <ChatDrawer
              collapsed={collapsed}
              onCollapsedChange={setCollapsed}
              collapseLabel={collapsed ? 'Tampilkan lampiran' : 'Sembunyikan lampiran'}
              collapsedSummary={
                <>
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-default-primary text-ds-paragraph-mobile">
                    {files.length}
                  </span>
                  <span>Lampiran</span>
                </>
              }
            >
              {files.map((name) => (
                <ChatAttachment key={name} variant="file" name={name} onRemove={() => {}} />
              ))}
            </ChatDrawer>
          }
        />
      );
    }
    return <Demo />;
  },
};

/**
 * A MESSAGE ABOVE THE BAR, WHICH IS WHAT THE TRAY IS FOR. The tint runs behind the editor box and
 * shows as a margin around it — one panel, not a notification sitting on top of a separate bar.
 * The tone is the COMPOSER's, because there is one tinted surface and so one place to tint it.
 */
export const HeaderDanger: Story = {
  args: {
    tone: 'danger',
    header: <DismissibleDrawer>Gagal mengirim pesan. Coba lagi.</DismissibleDrawer>,
  },
};

/** The same message below instead — the other slot, same tray. */
export const FooterWarning: Story = {
  args: {
    tone: 'warning',
    footer: <DismissibleDrawer>Kuota gambar kamu tinggal 2 hari lagi.</DismissibleDrawer>,
  },
};

/**
 * ALL FOUR TONES. `danger`, not `error` — `Alert`'s vocabulary, and Figma's word.
 */
export const Tones: Story = {
  render: (args) => (
    <div className="flex flex-col gap-6">
      {(['neutral', 'info', 'warning', 'danger'] as const).map((tone) => (
        <Stateful
          {...args}
          key={tone}
          tone={tone}
          header={<ChatDrawer>{`tone="${tone}"`}</ChatDrawer>}
        />
      ))}
    </div>
  ),
};

/**
 * Both slots at once — and the limitation that comes with one tray: they SHARE the tone. A
 * composer gets one voice, which is the honest reading of a surface telling the user one thing.
 */
export const HeaderAndFooter: Story = {
  args: {
    header: (
      <ChatDrawer>
        <ChatAttachment name="produk.jpg" previewUrl="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" onRemove={() => {}} />
      </ChatDrawer>
    ),
    footer: <ChatDrawer>Foto akan dikompres sebelum dikirim.</ChatDrawer>,
  },
};

/**
 * A DRAWER OUTSIDE A COMPOSER paints itself, because nothing else supplies a surface. This is the
 * one place `variant` is not `inherit`.
 */
export const StandaloneDrawer: Story = {
  render: () => (
    <div className="flex w-[640px] flex-col gap-3">
      <ChatDrawer variant="neutral">Tanpa tray — drawer ini mewarnai dirinya sendiri.</ChatDrawer>
      <ChatDrawer variant="danger">Dan yang keras.</ChatDrawer>
    </div>
  ),
};

/**
 * MID-STREAM. The send seat is a STOP button while a reply comes back — different glyph, different
 * colour, different handler, different accessible name. This is the state a streaming surface
 * spends every turn in, and the slot API is what makes it a call-site swap rather than a prop on
 * the shell.
 */
export const Streaming: Story = {
  render: (args) => (
    <Stateful
      {...args}
      initial="Buatkan caption untuk produk ini"
      sendActions={
        <>
          <ChatVoiceButton label="Input suara" disabled />
          <ChatSendButton state="stop" label="Hentikan AI" />
        </>
      }
    />
  ),
};

/** Uploads still going, so the turn cannot start. Blue, because nothing is wrong. */
export const AwaitingUploads: Story = {
  render: (args) => (
    <Stateful
      {...args}
      sendActions={
        <>
          <ChatVoiceButton label="Input suara" disabled />
          <ChatSendButton state="waiting" label="Menunggu foto diunggah" disabled />
        </>
      }
    />
  ),
};

/**
 * THE ACTION SLOTS TAKE ANY COMPOSITION. This is the point of replacing thirteen props: a surface
 * that wants only send, or a fifth control, changes its own call site rather than this component.
 */
export const SendOnly: Story = {
  args: { toolActions: null, sendActions: <ChatSendButton label="Kirim pesan" /> },
};

export const Disabled: Story = {
  args: {
    disabled: true,
    toolActions: (
      <>
        <ChatToolsButton label="Alat" disabled />
        <ChatAttachmentButton label="Lampirkan file" disabled />
      </>
    ),
    sendActions: (
      <>
        <ChatVoiceButton label="Input suara" disabled />
        <ChatSendButton label="Kirim pesan" disabled />
      </>
    ),
  },
};

/** A placeholder that is a NODE, for the landing composer's rotating one. */
export const PlaceholderSlot: Story = {
  args: { placeholderSlot: <span className="text-ds-paragraph-mobile leading-5 text-default-secondary">Buat gambar produk…</span> },
};

/**
 * THE MICROPHONE IS OPEN, and this is the story the bar exists to be seen in.
 *
 * `ChatVoiceBar` goes in `actionRow`, which REPLACES the two groups rather than stacking under
 * them — the bar stands in for the attach / voice / send row, and one rendered in addition to it
 * would grow the composer by the bar's own height. Flip between this and `Default`: the box is
 * the same height in both, which is the whole reason the bar publishes a `size`.
 *
 * Passing it as `toolActions` instead is the plausible wrong answer and renders without error —
 * the bar lands in a content-sized flex item and sits at its intrinsic width with the right half
 * of the row empty. See the prop's note.
 */
export const Listening: Story = {
  args: {
    actionRow: (
      <ChatVoiceBar
        size="compact"
        label="Mendengarkan..."
        stopLabel="Berhenti mendengarkan"
        onStop={() => {}}
      />
    ),
  },
};

/**
 * The landing composer's taller row, for the same reason — its icon row is 36 rather than 32, so
 * its listening bar is too. Two stories rather than one because the point IS the pair.
 */
export const ListeningOnLanding: Story = {
  args: {
    actionRow: (
      <ChatVoiceBar
        size="landing"
        label="Mendengarkan..."
        stopLabel="Berhenti mendengarkan"
        onStop={() => {}}
      />
    ),
  },
};
