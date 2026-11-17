import type { Meta, StoryObj } from '@storybook/react-vite';
import { contract } from '../../contract';
import { Alert } from './Alert';

/**
 * All 24 Figma variants as a grid, plus the states worth seeing on their own.
 *
 * The grid takes its axes as PROPS rather than reading the contract itself: a grid that
 * defaults to the contract cannot fail the story guard, because it would iterate whatever
 * the contract happens to say including nothing.
 */
const meta = {
  title: 'Components/Feedback/Alert',
  component: Alert,
  args: { children: 'Kode berhasil ditukarkan' },
} satisfies Meta<typeof Alert>;
export default meta;
type Story = StoryObj<typeof meta>;

const Grid = ({
  types,
  variants,
  sizes,
}: {
  types: readonly ('alert' | 'toast')[];
  variants: readonly ('success' | 'info' | 'warning' | 'danger')[];
  sizes: readonly ('large' | 'medium' | 'small')[];
}) => (
  <div style={{ display: 'grid', gap: 24, maxWidth: 520 }}>
    {types.map((type) => (
      <div key={type} style={{ display: 'grid', gap: 12 }}>
        {variants.map((fn) =>
          sizes.map((size) => (
            <Alert key={`${type}-${fn}-${size}`} type={type} variant={fn} size={size}>
              {`${type} · ${fn} · ${size}`}
            </Alert>
          )),
        )}
      </div>
    ))}
  </div>
);

/**
 * THE SIX LOOKS SIDE BY SIDE — this is the grid to browser-check.
 *
 * `banner`'s green is the one to look at: the published stop is a darker teal-green than the
 * mid grass the live banners draw today, and the shift is accepted rather than unnoticed.
 * `coach` next to `accent`+success is the other pair worth comparing — two different greens
 * from the token group, not a duplicate.
 */
const TreatmentGrid = ({
  treatments,
  variants,
}: {
  treatments: readonly ('full' | 'accent' | 'coach' | 'banner')[];
  variants: readonly ('success' | 'info' | 'warning' | 'danger')[];
}) => (
  <div style={{ display: 'grid', gap: 24, maxWidth: 520 }}>
    {treatments.map((treatment) => (
      <div key={treatment} style={{ display: 'grid', gap: 12 }}>
        {variants.map((fn) => (
          <Alert key={`${treatment}-${fn}`} treatment={treatment} variant={fn}>
            {`${treatment} · ${fn}`}
          </Alert>
        ))}
      </div>
    ))}
  </div>
);

export const AllTreatments: Story = {
  parameters: {
    docs: {
      source: {
        code: `<Alert variant="success" treatment="banner">Kode berhasil ditukarkan</Alert>`,
      },
    },
  },
  render: () => (
    <TreatmentGrid
      treatments={contract.Alert.axes.treatment}
      variants={contract.Alert.axes.function}
    />
  ),
};

export const AllVariants: Story = {
  render: () => (
    <Grid
      types={contract.Alert.axes.type}
      variants={contract.Alert.axes.function}
      sizes={contract.Alert.axes.size}
    />
  ),
};

/** The call site that kept the `icon` prop: a custom glyph and no variant at all. */
export const CustomIcon: Story = {
  args: { children: 'Informasi ini akan digunakan untuk menyelesaikan pembelian', icon: 'i' },
};

/** `null` is a real choice, distinct from "not passed". */
export const NoIcon: Story = { args: { children: 'Tanpa ikon', icon: null } };

/**
 * The severity reaches assistive technology as a WORD, because colour is not a channel
 * every reader has and the glyph is `aria-hidden`. Nothing visible changes here — the
 * story exists so the behaviour is documented rather than only tested.
 */
export const AnnouncedSeverity: Story = {
  args: { children: 'Pembayaran gagal diproses', variant: 'danger' },
};
