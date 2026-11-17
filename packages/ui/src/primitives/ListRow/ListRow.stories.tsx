import type { Meta, StoryObj } from '@storybook/react-vite';
import { ListRow } from './ListRow';

/**
 * Every axis value is drawn at least once: `variant` tile and plain, `trailing` chevron, external and
 * none, `valueTone` muted and brand, plus the `active` and `disabled` booleans. Profil (UMK-1840) uses
 * the plain rows; view them at phone width, where they are drawn.
 */
const meta: Meta<typeof ListRow> = {
  title: 'Components/Content/ListRow',
  component: ListRow,
  parameters: { layout: 'padded' },
  args: { label: 'Pengaturan Profile', icon: 'user', variant: 'plain', trailing: 'chevron' },
};
export default meta;

type Story = StoryObj<typeof ListRow>;

export const Plain: Story = {};

export const PlainProfil: Story = {
  render: () => (
    <div className="flex max-w-sm flex-col">
      <ListRow variant="plain" icon="user" trailing="chevron" label="Pengaturan Profile" />
      <ListRow variant="plain" icon="diamond" trailing="chevron" label="Paket Teman AI" value="Basic" valueTone="brand" />
      <ListRow variant="plain" icon="book-open" trailing="chevron" label="Perkenalan Teman AI" />
      <ListRow variant="plain" icon="whatsapp" trailing="chevron" label="Chat Teman AI WhatsApp" href="#wa" external />
    </div>
  ),
};

export const Tile: Story = {
  render: () => (
    <div className="flex max-w-sm flex-col">
      <ListRow icon="message-circle" trailing="chevron" label="Analisis Data Penjualan" meta="Kemarin" />
      <ListRow icon="headphones" trailing="external" label="Pusat Bantuan" meta="WhatsApp" href="#help" external />
      <ListRow icon="book-open" trailing="none" label="Panduan Teman AI" />
    </div>
  ),
};

export const Trailing: Story = {
  render: () => (
    <div className="flex max-w-sm flex-col">
      <ListRow variant="plain" icon="user" trailing="chevron" label="Chevron: stays in the product" />
      <ListRow variant="plain" icon="guide" trailing="external" label="External: leaves it" href="#out" external />
      <ListRow variant="plain" icon="info" trailing="none" label="None: draws nothing" />
    </div>
  ),
};

export const ValueTone: Story = {
  render: () => (
    <div className="flex max-w-sm flex-col">
      <ListRow variant="plain" icon="diamond" trailing="chevron" label="Muted value" value="Basic" valueTone="muted" />
      <ListRow variant="plain" icon="diamond" trailing="chevron" label="Brand value" value="Basic" valueTone="brand" />
    </div>
  ),
};

export const ActiveAndDisabled: Story = {
  render: () => (
    <div className="flex max-w-sm flex-col">
      <ListRow icon="message-circle" trailing="chevron" label="The current row" active />
      <ListRow variant="plain" icon="menu-install" trailing="chevron" label="A disabled row" disabled />
    </div>
  ),
};
