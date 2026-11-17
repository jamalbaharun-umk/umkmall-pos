import type { Meta, StoryObj } from '@storybook/react-vite';
import { ListRow } from '../ListRow';
import { ListGroup } from './ListGroup';

/** Both `variant` values: `plain` is Profil's (UMK-1840), `outlined` the native identity's card. */
const meta: Meta<typeof ListGroup> = {
  title: 'Components/Content/ListGroup',
  component: ListGroup,
  parameters: { layout: 'padded' },
  args: { label: 'Teman AI', variant: 'plain', children: null },
};
export default meta;

type Story = StoryObj<typeof ListGroup>;

export const Plain: Story = {
  render: (args) => (
    <div className="max-w-sm">
      <ListGroup {...args} variant="plain" label="Lainnya">
        <ListRow variant="plain" icon="help-centre" trailing="chevron" label="Pusat Bantuan" href="#help" external />
        <ListRow variant="plain" icon="guide" trailing="chevron" label="Panduan Teman AI" href="#guide" external />
        <ListRow variant="plain" icon="terms" trailing="chevron" label="Syarat Ketentuan" href="#terms" />
        <ListRow variant="plain" icon="privacy" trailing="chevron" label="Kebijakan Privasi" href="#privacy" />
      </ListGroup>
    </div>
  ),
};

export const Outlined: Story = {
  render: (args) => (
    <div className="max-w-sm">
      <ListGroup {...args} variant="outlined" label="Akun">
        <ListRow icon="user" trailing="chevron" label="Pengaturan Profile" />
        <ListRow icon="headphones" trailing="external" label="Pusat Bantuan" href="#help" external />
      </ListGroup>
    </div>
  ),
};
