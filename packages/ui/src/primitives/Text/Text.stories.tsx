import type { Meta, StoryObj } from '@storybook/react-vite';
import { TEXT_COLORS, TEXT_ROLES, TEXT_ROLE_WEIGHTS } from '../../contract';
import { Text, type TextRole } from './Text';

/**
 * Every role, at every weight it actually publishes.
 *
 * The Mobile/Desktop pair is a `lg:` breakpoint at 976px, so it cannot be shown side by side
 * in one viewport — resize the preview past 976 and the whole grid steps up together. The
 * `Mobile` and `Desktop` stories pin the viewport so the two steps are inspectable without
 * dragging, which is the comparison a designer actually wants.
 */
const meta = {
  title: 'Foundations/Text',
  component: Text,
} satisfies Meta<typeof Text>;

export default meta;
type Story = StoryObj<typeof meta>;

const Row = ({ variant }: { variant: TextRole }) => (
  <div style={{ display: 'grid', gap: 8, paddingBottom: 20, borderBottom: '1px solid #e6e9ed' }}>
    <div style={{ fontFamily: 'system-ui, sans-serif', fontSize: 11, color: '#61768c' }}>
      {variant} · {TEXT_ROLE_WEIGHTS[variant].join(' · ')}
    </div>
    {TEXT_ROLE_WEIGHTS[variant].map((weight) => (
      // The cast is the price of iterating a union: `weight` is narrowed per role at the
      // value level, but TS cannot follow that through a generic component in a map.
      <Text key={weight} variant={variant} weight={weight as never}>
        Bisnis kecil, ambisi besar — {weight}
      </Text>
    ))}
  </div>
);

/** `roles` is a required prop, and each story passes TEXT_ROLES explicitly, so the coverage
 *  guard can assert what the grid was actually GIVEN. Reading a default off the component
 *  cannot fail — the guard would restate the default rather than check the story. */
const Scale = ({ roles }: { roles: readonly TextRole[] }) => (
  <div style={{ display: 'grid', gap: 20, maxWidth: 720 }}>
    {roles.map((variant) => (
      <Row key={variant} variant={variant} />
    ))}
  </div>
);

/** Resize past 976px to see the Desktop step. */
export const AllRoles: Story = {
  parameters: {
    docs: {
      source: {
        code: `<Text variant="h2" weight="semibold">Bisnis kecil, ambisi besar</Text>`,
      },
    },
  },
  render: () => <Scale roles={TEXT_ROLES} />,
};

/** Display and Heading 1 publish Bold and Semibold ONLY — the gap is the point. */
export const WeightsAreNotUniform: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: 20, maxWidth: 720 }}>
      <Row variant="display" />
      <Row variant="h1" />
      <Row variant="paragraph" />
    </div>
  ),
};

export const Colors: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: 8 }}>
      {TEXT_COLORS.map((color) => (
        <Text key={color} color={color}>
          {color}
        </Text>
      ))}
    </div>
  ),
};

/**
 * `bodyLg` is 14px — SMALLER than `paragraph` at 16px. "Body" is the small-text ramp below
 * paragraph, not above it, and reading the name the other way is the mistake this exists to
 * make visible.
 */
export const TheBodyNamingTrap: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: 8 }}>
      <Text variant="paragraph">paragraph — the largest of these</Text>
      <Text variant="bodyLg">bodyLg — smaller than paragraph</Text>
      <Text variant="bodyMd">bodyMd</Text>
      <Text variant="bodySm">bodySm</Text>
    </div>
  ),
};
