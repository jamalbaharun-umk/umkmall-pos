import type { Meta, StoryObj } from '@storybook/react-vite';
import { ChatAttachment } from './ChatAttachment';
import { Icon } from '../Icon';

/**
 * ONE attachment — `01 Chat Bar`'s `State=Image` and `State=File` treatments, extracted.
 *
 * Its own component rather than something the drawer knows about: a sent-message card and a
 * file-picker list want this chip without wanting a drawer around it.
 *
 * THE PREVIEW IS A PLAIN ELEMENT, never the library `Image`, which refuses any source that is not
 * remote https — every preview a composer shows is a local blob. `Lightbox` hit that trap already.
 */
const PIXEL =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

const meta: Meta<typeof ChatAttachment> = {
  title: 'Components/Chat/ChatAttachment',
  component: ChatAttachment,
  parameters: { layout: 'centered' },
  args: { name: 'produk.jpg', previewUrl: PIXEL, sizeBytes: 482_000, onRemove: () => {} },
};
export default meta;

type Story = StoryObj<typeof ChatAttachment>;

export const Image: Story = {};

/** The treatment Figma publishes and the app never built — badge, filename, type label. */
export const File: Story = {
  args: { variant: 'file', name: 'CoffeeBrew_harian', typeLabel: 'XLSX', extension: 'X', sizeBytes: 4_915 },
};

/** `Show Size`, in the same B/KB/MB shape the SENT message card uses, so the two agree. */
export const WithSize: Story = {
  args: { variant: 'file', name: 'laporan.xlsx', typeLabel: 'XLSX', sizeBytes: 4_915, showSize: true },
};

export const Uploading: Story = { args: { status: 'uploading' } };
export const Failed: Story = { args: { status: 'error' } };
export const Done: Story = { args: { status: 'done' } };

/** Not removable: without `onRemove` the close control is simply absent. */
export const NotRemovable: Story = { args: { onRemove: undefined } };

/**
 * CHILDREN LAND INSIDE THE CHIP. This is the part a host genuinely cannot do from outside — the
 * content is positioned against this box, not against the drawer around it.
 */
export const WithOverlay: Story = {
  args: {
    status: 'error',
    children: (
      <button
        type="button"
        className="absolute inset-x-1 bottom-1 rounded bg-default-primary/90 py-0.5 text-ds-legacy-10 font-medium text-default-primary"
      >
        <Icon name="rotate-cw" className="mr-1 inline h-3 w-3" />
        Coba lagi
      </button>
    ),
  },
};

/** The file picker's states: the 96px box, a caption, the words under the spinner, a tappable preview. */
export const Compressing: Story = {
  args: { size: 'large', status: 'compressing', statusLabel: 'Menyiapkan…', caption: 'foto-produk.jpg' },
};

export const Previewable: Story = {
  args: { size: 'large', caption: 'foto-produk.jpg', onPreview: () => {} },
};

/** The picker's square non-image tile: a file icon over the extension, with a caption. */
export const Tile: Story = {
  args: { variant: 'tile', size: 'large', name: 'brief.pdf', previewUrl: undefined, caption: 'brief.pdf', icon: 'file-pdf' },
};
