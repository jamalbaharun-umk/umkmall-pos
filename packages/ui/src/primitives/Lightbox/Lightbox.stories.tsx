import type { Meta, StoryObj } from '@storybook/react-vite';
import { Lightbox } from './Lightbox';

/**
 * PLACEMENT AND WIDTH ARE CHECKED BY EYE HERE, not in the guard. happy-dom has no layout
 * engine, so nothing in the package suite can tell that the panel covers the viewport or that
 * the image is contained inside it rather than overflowing it. Open the story; that is what
 * these are for.
 */
const meta: Meta<typeof Lightbox> = {
  title: 'Components/Overlays/Lightbox',
  component: Lightbox,
  /**
   * PORTALLED, so it CANNOT render inline on a docs page. A docs page renders every story into
   * the same document; this component renders into `document.body`, so it escapes its story
   * container and covers the whole page — the title, the props table and every other story
   * underneath it. The story view looks fine because Storybook already iframes that one.
   *
   * `inline: false` gives this component's stories their own iframe on the docs page too, which
   * is the same isolation the story view has. The height is the frame's, not the component's.
   */
  parameters: {
    layout: 'fullscreen',
    docs: { story: { inline: false, height: '640px' } },
  },
  args: {
    open: true,
    onOpenChange: () => {},
    src: 'https://placehold.co/1200x800/png',
    alt: 'Contoh gambar',
    label: 'Pratinjau gambar',
  },
};
export default meta;

type Story = StoryObj<typeof Lightbox>;

export const Open: Story = {};

/** The default render, and the easy one to lose: it puts nothing in the DOM at all. */
export const Closed: Story = { args: { open: false } };

/** Both optional affordances. Absent callback, absent control — there is no `showActions`. */
export const WithActions: Story = {
  args: { onDownload: () => {}, onShare: () => {} },
};

/**
 * The case KTD15 names: a base64 payload, which the `Image` primitive would refuse to render
 * at all. The chat surfaces hand this component exactly that.
 */
export const DataUriSource: Story = {
  args: {
    src: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
    alt: 'Piksel',
  },
};

/**
 * The gallery viewer (UMK-1690, Figma `15055:57360`): the `light` scrim with its round close, and the labelled
 * action bar. An action with an `href` renders through `linkAs` (the app passes `next/link`); here, a plain anchor.
 */
export const GalleryViewer: Story = {
  args: {
    scrim: 'light',
    actions: [
      { key: 'diskusi', icon: 'nav-chat', label: 'Diskusi', href: '#diskusi' },
      { key: 'ubah', icon: 'pen', label: 'Ubah', href: '#ubah' },
      { key: 'bagikan', icon: 'share', label: 'Bagikan', onSelect: () => {} },
      { key: 'unduh', icon: 'file-download', label: 'Unduh', onSelect: () => {} },
    ],
  },
};
