import React from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { contract } from '../../contract';
import { Divider } from './Divider';

/**
 * NO FIGMA SET EXISTS for a divider, so this render is what a designer responds to rather
 * than documentation of something already drawn. The axis was read off the legacy component's
 * line treatment, which is the only evidence there is.
 *
 * The label's background is what punches the rule, so it takes the page's surface token. Drop
 * a labelled divider onto a tinted surface and the label needs the caller's own background —
 * otherwise the rule runs straight through the middle of the word.
 */
const meta = {
  title: 'Components/Content/Divider',
  component: Divider,
  args: {},
} satisfies Meta<typeof Divider>;
export default meta;
type Story = StoryObj<typeof meta>;

const Grid = ({
  variants,
  orientations,
}: {
  variants: typeof contract.Divider.axes.variant;
  orientations: typeof contract.Divider.axes.orientation;
}) => (
  <div style={{ display: 'grid', gap: 24, maxWidth: 420 }}>
    {orientations.map((orientation) =>
      orientation === 'horizontal' ? (
        <div key={orientation} style={{ display: 'grid' }}>
          {variants.map((variant) => (
            <Divider key={variant} variant={variant} orientation={orientation}>
              {`${orientation} / ${variant}`}
            </Divider>
          ))}
        </div>
      ) : (
        /* A vertical rule takes its height from the row it sits in, so it needs a flex
           parent to stretch against — which is the whole reason it is a separate value. */
        <div key={orientation} style={{ display: 'flex', alignItems: 'stretch', gap: 12, height: 48 }}>
          {variants.map((variant) => (
            <React.Fragment key={variant}>
              <span style={{ fontSize: 12, opacity: 0.6, alignSelf: 'center' }}>{variant}</span>
              <Divider variant={variant} orientation={orientation} />
            </React.Fragment>
          ))}
        </div>
      ),
    )}
  </div>
);

export const AllVariants: Story = {
  parameters: {
    docs: {
      source: {
        code: `<Divider variant="dashed">atau</Divider>`,
      },
    },
  },
  render: () => (
    <Grid
      variants={contract.Divider.axes.variant}
      orientations={contract.Divider.axes.orientation}
    />
  ),
};

/** Separating items inside a row — the a2ui case the library could not serve before. */
export const Vertical: Story = {
  render: () => (
    <div style={{ display: 'flex', alignItems: 'stretch', gap: 12, height: 40 }}>
      <span style={{ alignSelf: 'center' }}>Satu</span>
      <Divider orientation="vertical" />
      <span style={{ alignSelf: 'center' }}>Dua</span>
    </div>
  ),
};

export const Plain: Story = {};
export const WithLabel: Story = { args: { children: 'atau' } };
export const Dashed: Story = { args: { variant: 'dashed' } };
