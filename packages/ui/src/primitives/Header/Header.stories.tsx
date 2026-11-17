import type { Meta, StoryObj } from '@storybook/react-vite';
import { Header } from './Header';
import { HEADER_TYPES } from '../header-classes';

/**
 * THE REFLOW IS CHECKED BY EYE HERE, not in the guard. happy-dom has no layout engine, so
 * nothing in the package suite can tell that the bar is shorter on a phone than on a desktop
 * or that the shadow is visible. Resize the preview; that is what these are for.
 */
const meta: Meta<typeof Header> = {
  title: 'Components/Shell/Header',
  component: Header,
  parameters: { layout: 'fullscreen' },
};
export default meta;

type Story = StoryObj<typeof Header>;

/**
 * All seven published treatments, side by side. The only place a designer can see that two of
 * them have collapsed onto one look — which every behaviour assertion still passes.
 */
export const AllTypes: Story = {
  parameters: {
    docs: {
      source: {
        code: `<Header type="dashboard" title="Judul Halaman" showTextLeft showBack backLabel="Kembali" />`,
      },
    },
  },
  render: () => (
    <div className="flex flex-col gap-4 bg-default-secondary p-4">
      {HEADER_TYPES.map((type) => (
        <div key={type}>
          <p className="mb-1 text-ds-legacy-xs text-default-secondary">{type}</p>
          <Header
            type={type}
            title="Judul Halaman"
            showTextLeft
            showBack
            backLabel="Kembali"
            actions={<span className="text-ds-paragraph-mobile">Aksi</span>}
          />
        </div>
      ))}
    </div>
  ),
};

export const WithTabs: Story = {
  render: () => (
    <Header
      type="dashboard"
      title="Dashboard"
      showTextLeft
      showTab
      tabs={
        <>
          <span className="text-ds-paragraph-mobile font-medium">Ringkasan</span>
          <span className="text-ds-paragraph-mobile text-default-secondary">Aktivitas</span>
        </>
      }
    />
  ),
};

export const Scrolled: Story = {
  render: () => (
    <Header type="temanAiChat" title="TemanAI" showTextLeft scrolled showBack backLabel="Kembali" />
  ),
};

/* The back control a real consumer passes: an app's own link component, receiving the
   header's props. The library cannot import one, which is the whole reason for the prop. */
export const CallerSuppliedBack: Story = {
  render: () => (
    <Header
      type="temanAiChat"
      title="TemanAI"
      showTextLeft
      showBack
      backLabel="Kembali ke Beranda"
      back={(props) => (
        <a {...props} href="/">
          ← Beranda
        </a>
      )}
    />
  ),
};
