import React from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { ChatDrawer } from './ChatDrawer';
import { ChatAttachment } from './ChatAttachment';
import { Chip } from '../Chip';

/**
 * The region above the composer's editor — A CONTAINER, and the name is the point.
 *
 * It used to BE the attachment list, which made "drawer" a lie: a drawer is the thing that holds,
 * not the things held. It takes children now, so a host can put attachments in it (the expected
 * content) or anything else a surface wants above the editor — suggestion chips, a reply-to
 * preview, a recording waveform.
 *
 * It renders NOTHING when empty rather than an empty box, because the composer's resting state is
 * a bar with no drawer at all.
 */
const PIXEL =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

/**
 * `onDismiss` is a callback the HOST acts on — the drawer never unmounts itself, because a surface
 * may want to confirm first, or report, or refuse. A story passing a no-op therefore shows a
 * dismiss button that does nothing, which is the defect the editor's controlled value already had
 * once in this file's sibling.
 */
function Dismissible({ children, ...props }: React.ComponentProps<typeof ChatDrawer>) {
  const [shown, setShown] = React.useState(true);
  if (!shown) return <span className="text-ds-paragraph-mobile text-default-secondary">Ditutup.</span>;
  return (
    <ChatDrawer {...props} onDismiss={() => setShown(false)}>
      {children}
    </ChatDrawer>
  );
}

const meta: Meta<typeof ChatDrawer> = {
  title: 'Components/Chat/ChatDrawer',
  component: ChatDrawer,
  parameters: { layout: 'centered' },
  /*
    STANDALONE, SO `neutral` RATHER THAN THE COMPONENT'S OWN DEFAULT. In a composer the tray behind
    the drawer supplies the surface and the default `inherit` paints nothing; on its own that would
    render invisible text on the Storybook canvas. `Inherit` below demonstrates the default.
  */
  args: { variant: 'neutral' },
  decorators: [(Story) => <div className="w-[560px]">{Story()}</div>],
};
export default meta;

type Story = StoryObj<typeof ChatDrawer>;

/** Holding files, which is what it usually holds. */
export const WithAttachments: Story = {
  args: {
    children: (
      <>
        <ChatAttachment variant="file" name="design-spec.pdf" typeLabel="PDF" onRemove={() => {}} />
        <ChatAttachment variant="file" name="api-schema.json" typeLabel="JSON" onRemove={() => {}} />
        <ChatAttachment variant="file" name="meeting-notes.md" typeLabel="MD" onRemove={() => {}} />
      </>
    ),
  },
};

/** Holding images instead — the same drawer, different children. */
export const WithImages: Story = {
  args: {
    children: (
      <>
        <ChatAttachment name="a.jpg" previewUrl={PIXEL} onRemove={() => {}} />
        <ChatAttachment name="b.jpg" previewUrl={PIXEL} onRemove={() => {}} />
      </>
    ),
  },
};

/**
 * COLLAPSIBLE — the handle IS the toggle, and it appears only because it works. An earlier draft
 * had a decorative `showHandle` boolean on a drawer that could not collapse: a control that looks
 * operable and does nothing.
 *
 * Controlled, like `Menu`: supply both `collapsed` and `onCollapsedChange` or get no toggle at all.
 */
export const Collapsible: Story = {
  render: () => {
    function Demo() {
      const [collapsed, setCollapsed] = React.useState(false);
      return (
        <ChatDrawer collapsed={collapsed} onCollapsedChange={setCollapsed}>
          <ChatAttachment variant="file" name="design-spec.pdf" typeLabel="PDF" onRemove={() => {}} />
          <ChatAttachment variant="file" name="api-schema.json" typeLabel="JSON" onRemove={() => {}} />
        </ChatDrawer>
      );
    }
    return <Demo />;
  },
};

/** Collapsed: the children are hidden but still mounted, so an upload in flight survives. */
export const Collapsed: Story = {
  args: {
    collapsed: true,
    onCollapsedChange: () => {},
    children: <ChatAttachment variant="file" name="design-spec.pdf" typeLabel="PDF" />,
  },
};

/**
 * COLLAPSED, WITH A SUMMARY — the same toggle, wearing a different face. A collapsed drawer showing
 * only a hairline says nothing about what it is holding, so someone who shut four files away has no
 * way to know they are still attached and still about to be sent.
 *
 * The words are the HOST's, for the reason the buttons' labels are: this container cannot know
 * whether it holds files, chips or a waveform, and must not pick copy in one language for four
 * surfaces.
 */
export const CollapsedWithSummary: Story = {
  render: () => {
    function Demo() {
      const [collapsed, setCollapsed] = React.useState(true);
      const files = ['design-spec.pdf', 'api-schema.json', 'screenshot.png', 'meeting-notes.md'];
      return (
        <ChatDrawer
          variant="neutral"
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
      );
    }
    return <Demo />;
  },
};

/**
 * THE SEMANTIC VARIANTS. `Alert`'s vocabulary and the published `callout` token group — which is
 * why the loud one is `danger` and not `error`. `neutral` is the drawer's own, because holding
 * files is not a message about anything.
 *
 * These are for a drawer used OUTSIDE a composer. Inside one, the tray carries the colour and the
 * drawer stays `inherit` — see `ChatComposer`'s `tone`.
 */
export const Variants: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      <ChatDrawer variant="neutral">Menyimpan lampiran</ChatDrawer>
      <Dismissible variant="info">Foto akan dikompres sebelum dikirim.</Dismissible>
      <Dismissible variant="warning">Kuota gambar kamu tinggal 2 hari lagi.</Dismissible>
      <Dismissible variant="danger">Ada foto yang gagal diunggah. Hapus lalu kirim ulang.</Dismissible>
    </div>
  ),
};

/**
 * Dismissable: supply the callback and the control appears — `Lightbox`'s rule. Press the X; it
 * really goes, because the story holds the state the component deliberately does not.
 */
export const Dismissable: Story = {
  render: () => <Dismissible variant="warning">Kuota gambar kamu tinggal 2 hari lagi.</Dismissible>,
};

/**
 * NOT ONLY ATTACHMENTS. The drawer holds whatever a surface needs above the editor; this is what
 * separating it from the chips buys.
 */
export const HoldingSomethingElse: Story = {
  args: {
    children: (
      <>
        <Chip>Ringkas ini</Chip>
        <Chip>Buat caption</Chip>
        <Chip>Hitung HPP</Chip>
      </>
    ),
  },
};

/**
 * `inherit`, THE DEFAULT: no fill, no border, nothing of its own. It is what a drawer looks like
 * inside a composer's tray, and on this bare canvas it is deliberately almost invisible — the
 * point being that the panel behind it is what paints, so a colour is chosen once.
 */
export const Inherit: Story = {
  args: { variant: 'inherit', children: 'Mewarisi warna dari tray di belakangnya.' },
  decorators: [(Story) => <div className="w-[560px] rounded-2xl bg-default-secondary">{Story()}</div>],
};

/** Nothing to hold: renders nothing at all, not an empty box. */
export const Empty: Story = { args: { children: null } };
