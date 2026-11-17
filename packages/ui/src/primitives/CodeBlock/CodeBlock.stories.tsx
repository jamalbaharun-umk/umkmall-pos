import type { Meta, StoryObj } from '@storybook/react-vite';
import { contract } from '../../contract';
import { CodeBlock } from './CodeBlock';

/**
 * THIS STORY IS A DELIVERABLE. Ensyra publishes no fenced-block set, so the grid is what the
 * component is designed against — and what makes the two duplicated app implementations
 * reproducible side by side.
 *
 * WHAT TO CHECK IN A BROWSER: click copy twice in quick succession, and watch the copied state
 * revert once rather than flickering. In a page served over plain http the clipboard API is
 * absent entirely, and the control must say so rather than doing nothing.
 */
const meta = {
  title: 'Components/Content/CodeBlock',
  component: CodeBlock,
  args: { children: 'npm install @umkmall/ui', label: 'bash' },
} satisfies Meta<typeof CodeBlock>;
export default meta;
type Story = StoryObj<typeof meta>;

const Grid = ({ sizes }: { sizes: typeof contract.CodeBlock.axes.size }) => (
  <div style={{ display: 'grid', gap: 24, maxWidth: 520 }}>
    {sizes.map((size) => (
      <CodeBlock key={size} size={size} label={size}>
        {`# ${size}\nnpm install @umkmall/ui`}
      </CodeBlock>
    ))}
  </div>
);

export const AllSizes: Story = {
  parameters: {
    docs: {
      source: {
        code: `<CodeBlock label="bash">npm install @umkmall/ui</CodeBlock>`,
      },
    },
  },
  render: () => <Grid sizes={contract.CodeBlock.axes.size} />,
};

export const Default: Story = {};

/** No label: the bar collapses to the copy control alone rather than leaving an empty strip. */
export const NoLabel: Story = { args: { label: undefined } };

/** Indentation and newlines survive, and a long line wraps rather than leaving the bubble. */
export const Multiline: Story = {
  args: {
    label: 'json',
    children: '{\n  "name": "@umkmall/ui",\n  "private": true\n}',
  },
};

/** A payload that is not the rendered text — the copy control writes what it was given. */
export const ExplicitCopyText: Story = {
  args: { label: 'perintah', children: '$ npm run dev', copyText: 'npm run dev' },
};
