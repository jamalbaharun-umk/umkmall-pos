import type { Meta, StoryObj } from '@storybook/react-vite';
import { contract } from '../../contract';
import { Radio } from './Radio';

const meta = {
  title: 'Components/Form/Radio',
  component: Radio,
  args: { label: 'Ya' },
} satisfies Meta<typeof Radio>;
export default meta;
type Story = StoryObj<typeof meta>;

const Sizes = ({ sizes }: { sizes: readonly ('large' | 'medium' | 'small')[] }) => (
  <div style={{ display: 'grid', gap: 12 }}>
    {sizes.map((size) => (
      <Radio key={size} label={size} size={size} name={`ukuran-${size}`} defaultChecked />
    ))}
  </div>
);

/** The checkbox scale minus its largest step — the radio set does not publish one. */
export const AllSizes: Story = {
  parameters: {
    docs: {
      source: {
        code: `<Radio label="Makanan" name="kategori" value="makanan" checked={value === 'makanan'} onChange={() => setValue('makanan')} />`,
      },
    },
  },
  render: () => <Sizes sizes={contract.Radio.axes.size} />,
};

export const Unchecked: Story = { args: { label: 'Belum dipilih', name: 'demo' } };
export const Checked: Story = { args: { label: 'Sudah dipilih', name: 'demo', defaultChecked: true } };
export const Required: Story = { args: { label: 'Pilih salah satu', name: 'demo', required: true } };
export const WithError: Story = { args: { label: 'Pilih salah satu', name: 'demo', error: 'Wajib dipilih' } };
export const Disabled: Story = { args: { label: 'Tidak tersedia', name: 'demo', disabled: true } };

export const Group: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: 12 }}>
      <Radio label="Makanan" name="kategori" value="makanan" defaultChecked />
      <Radio label="Minuman" name="kategori" value="minuman" />
      <Radio label="Kerajinan" name="kategori" value="kerajinan" />
    </div>
  ),
};
