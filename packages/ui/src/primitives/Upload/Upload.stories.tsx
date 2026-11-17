import type { Meta, StoryObj } from '@storybook/react-vite';
import { contract } from '../../contract';
import { Icon } from '../Icon';
import { Upload } from './Upload';

/**
 * WHAT TO CHECK IN A BROWSER: drag a file over the zone and drop it — without the drag-over
 * handler the browser navigates away to the file instead, which no unit test can see.
 *
 * DRAG-OVER HAS NO STORY, and cannot: it is not a status a prop can set — it is a pointer
 * condition, so a story can only reach it by an actual drag. Check it in the browser alongside
 * the drop. (It is off the status axis for that reason: native has no drag, and web and native
 * consume one contract.)
 */
const meta = {
  title: 'Components/Form/Upload',
  component: Upload,
  args: { label: 'Foto produk', children: 'Tarik file ke sini atau klik untuk memilih' },
} satisfies Meta<typeof Upload>;
export default meta;
type Story = StoryObj<typeof meta>;

const Grid = ({
  sizes,
  statuses,
}: {
  sizes: typeof contract.Upload.axes.size;
  statuses: typeof contract.Upload.axes.status;
}) => (
  <div style={{ display: 'grid', gap: 24, maxWidth: 480 }}>
    {sizes.map((size) =>
      statuses.map((status) => (
        <Upload
          key={`${size}-${status}`}
          size={size}
          label={`${size} · ${status}`}
          filled={status === 'filled'}
          disabled={status === 'disabled'}
          busy={status === 'busy'}
          error={status === 'error' ? 'Ukuran file terlalu besar' : undefined}
        >
          {`${size} · ${status}`}
        </Upload>
      )),
    )}
  </div>
);

export const AllSizes: Story = {
  parameters: {
    docs: {
      source: {
        code: `<Upload label="Foto produk" onFilesChange={setFiles}>
  Tarik file ke sini atau klik untuk memilih
</Upload>`,
      },
    },
  },
  render: () => <Grid sizes={contract.Upload.axes.size} statuses={contract.Upload.axes.status} />,
};

export const Default: Story = {};
export const Required: Story = { args: { required: true } };
export const Filled: Story = { args: { filled: true, children: 'foto-produk.jpg' } };
export const WithError: Story = { args: { error: 'Ukuran file terlalu besar' } };
export const Disabled: Story = { args: { disabled: true } };
export const WithIcon: Story = { args: { icon: <Icon name="composer-image" size="md" /> } };

/** Figma's third row: standing guidance under the zone. An `error` replaces it. */
export const WithHelperText: Story = { args: { helperText: 'Maksimal 5 MB, format JPG atau PNG' } };

/** Figma's first row: the `info-circle` trigger beside the label. */
export const WithTooltip: Story = { args: { tooltip: 'Foto yang jelas menjual lebih baik' } };

/** OURS, not Figma's — the "drop a file here" convention the app's own dropzone ships. */
export const DashedBorder: Story = { args: { border: 'dashed' } };

/** Mid-upload. Refuses the picker and the drop, exactly as `disabled` does. */
export const Busy: Story = { args: { busy: true, children: 'Mengunggah…' } };

/** The chosen file, in place of the placeholder — the browse button stays, to replace it. */
export const WithPreview: Story = {
  args: { filled: true, preview: <span>foto-produk.jpg</span> },
};

/** No visible label — the other arm of the labelling union. */
export const AccessibleNameOnly: Story = {
  args: { label: undefined, 'aria-label': 'Foto produk' },
};
