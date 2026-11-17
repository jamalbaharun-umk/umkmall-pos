import type { Meta, StoryObj } from '@storybook/react-vite';
import { contract } from '../../contract';
import { Icon } from '../../primitives/Icon';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './Tabs';

/**
 * KEYBOARD TRAVERSAL IS THE THING TO CHECK HERE, and it is the thing no happy-dom assertion
 * fully covers. Focus a tab and press the arrow keys: it should move and wrap, with Home and
 * End jumping to the ends, and the panel should follow the focus. The component this replaces
 * had none of that — it announced itself as a tablist and responded only to clicks.
 *
 * Every panel is in the DOM at all times, with `hidden` on the inactive ones. Inspect one and
 * the point becomes visible: an `aria-controls` on an unselected tab has something to point
 * at, which is what the previous render (return `null` for inactive) made impossible.
 *
 * The stories render UNCONTROLLED. That is possible at all only because this rewrite added
 * `defaultValue` — the previous component required both `value` and `onValueChange`, so a
 * story had to wrap it in state of its own before it could show anything.
 */
const meta = {
  title: 'Components/Navigation/Tabs',
  component: Tabs,
  args: {
    defaultValue: 'masuk',
    children: (
      <>
        <TabsList label="Autentikasi">
          <TabsTrigger value="masuk">Masuk</TabsTrigger>
          <TabsTrigger value="daftar">Daftar</TabsTrigger>
        </TabsList>
        <TabsContent value="masuk">Formulir masuk</TabsContent>
        <TabsContent value="daftar">Formulir daftar</TabsContent>
      </>
    ),
  },
} satisfies Meta<typeof Tabs>;
export default meta;
type Story = StoryObj<typeof meta>;

const Sizes = ({ sizes, states }: { sizes: typeof contract.Tabs.axes.size; states: typeof contract.Tabs.axes.state }) => (
  <div style={{ display: 'grid', gap: 24, maxWidth: 420 }}>
    {sizes.map((size) => (
      <div key={size} style={{ display: 'grid', gap: 8 }}>
        <span style={{ fontSize: 12, opacity: 0.6 }}>{`${size} · ${states.join(' / ')}`}</span>
        {/* `defaultValue` picks the first tab, so both states are on screen at once. */}
        <Tabs size={size} defaultValue="satu">
          <TabsList label={size}>
            <TabsTrigger value="satu">Satu</TabsTrigger>
            <TabsTrigger value="dua">Dua</TabsTrigger>
            <TabsTrigger value="tiga">Tiga</TabsTrigger>
          </TabsList>
          <TabsContent value="satu">Panel satu</TabsContent>
          <TabsContent value="dua">Panel dua</TabsContent>
          <TabsContent value="tiga">Panel tiga</TabsContent>
        </Tabs>
      </div>
    ))}
  </div>
);

export const AllSizes: Story = {
  parameters: {
    docs: {
      source: {
        code: `<Tabs defaultValue="masuk">
  <TabsList label="Autentikasi">
    <TabsTrigger value="masuk">Masuk</TabsTrigger>
    <TabsTrigger value="daftar">Daftar</TabsTrigger>
  </TabsList>
  <TabsContent value="masuk">Formulir masuk</TabsContent>
  <TabsContent value="daftar">Formulir daftar</TabsContent>
</Tabs>`,
      },
    },
  },
  render: () => <Sizes sizes={contract.Tabs.axes.size} states={contract.Tabs.axes.state} />,
};

export const Default: Story = {};

/** The published slots. A hidden title makes an icon-only tab, so `aria-label` is required;
 *  `notif` is the count badge Figma draws, not a dot. */
export const WithIconAndNotif: Story = {
  args: {
    defaultValue: 'pesan',
    children: (
      <>
        <TabsList label="Kotak masuk">
          <TabsTrigger value="pesan" iconLeft={<Icon name="send" className="h-5 w-5" />} notif={32} notifLabel={(n) => `${n} pesan belum dibaca`}>
            Pesan
          </TabsTrigger>
          <TabsTrigger
            value="setelan"
            iconLeft={<Icon name="settings" className="h-5 w-5" />}
            showTitle={false}
            aria-label="Setelan"
          >
            Setelan
          </TabsTrigger>
        </TabsList>
        <TabsContent value="pesan">Daftar pesan</TabsContent>
        <TabsContent value="setelan">Setelan akun</TabsContent>
      </>
    ),
  },
};

/** Four tabs in a 320px box at `xsmall`: the labels share the width and wrap instead of scrolling the box sideways. */
export const DenseNarrow: Story = {
  render: () => (
    <div style={{ width: 320 }}>
      <Tabs size="xsmall" defaultValue="a">
        <TabsList label="Pengaturan">
          {['Tampilan', 'Profil', 'Perangkat', 'Komunitas'].map((label, i) => (
            <TabsTrigger key={label} value={String.fromCharCode(97 + i)}>
              {label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
    </div>
  ),
};
