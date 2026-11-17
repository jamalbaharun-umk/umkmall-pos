import type { Meta, StoryObj } from '@storybook/react-vite';
import { tokens } from './generated';
import {
  flattenGroup,
  groupsForPage,
  type FoundationPage,
  type TokenLeaf,
} from './foundation-pages';
import { TypographyPage } from './TypographyPage';

function Swatch({ path, value, group }: TokenLeaf & { group: string }) {
  const isColor = typeof value === 'string' && value.startsWith('#');

  return (
    <div style={{ width: 148, fontFamily: 'system-ui, sans-serif', fontSize: 12 }}>
      {isColor ? (
        <div style={{ height: 56, borderRadius: 8, border: '1px solid #e6e9ed', background: value }} />
      ) : (
        <Measure value={value} group={group} />
      )}
      <div style={{ marginTop: 6, color: '#03203d' }}>{path}</div>
      <div style={{ color: '#61768c' }}>{String(value)}</div>
    </div>
  );
}

/**
 * Numeric tokens are unitless in the token tree, and the point of showing them is the size
 * itself — rendering every value in an identically sized box makes 6 and 120 look the same,
 * which is no more use to a designer than reading the number. So each value is drawn at its
 * own magnitude: a radius as a corner, everything else as a bar that long.
 */
function Measure({ value, group }: { value: string | number; group: string }) {
  const px = typeof value === 'number' ? value : Number(value);

  if (!Number.isFinite(px)) {
    return <div style={{ height: 56, display: 'flex', alignItems: 'center', color: '#03203d' }}>{String(value)}</div>;
  }

  // Cards are 148px wide; the largest token today is 120. Clamp so a future larger value
  // stays inside its card rather than overlapping its neighbour.
  const drawn = Math.min(px, 132);

  if (group === 'Radius') {
    return (
      <div
        style={{
          height: 56,
          background: '#e6f1fd',
          border: '1px solid #0074e7',
          // A radius reads as a corner, not a length.
          borderRadius: drawn,
        }}
      />
    );
  }

  return (
    <div style={{ height: 56, display: 'flex', alignItems: 'center' }}>
      {px === 0 ? (
        // A zero-width bar draws nothing, which is indistinguishable from a broken render.
        <span style={{ color: '#61768c' }}>nol</span>
      ) : (
        <div style={{ width: drawn, height: 16, background: '#0074e7', borderRadius: 2 }} />
      )}
    </div>
  );
}

/**
 * The grid, drawn rather than tabulated (UMK-979 U6).
 *
 * Figma `28:1125` publishes FOUR grid styles; two of them are the desktop and mobile
 * containers below, and the third container here is the 500px step the app lays out at.
 * Saying "four published" out loud matters: this story shows three, and a reader who assumes
 * it shows everything will not go looking for the fourth.
 *
 * ONLY TWO MARGIN TOKENS REACH CODE — `margin.mobile` (16) and `margin.desktop` (84). The
 * gutter and the column counts are NOT tokens; they are read off the Figma styles and
 * written here as literals, which is why they carry the node id. Do not read this story as
 * evidence that the grid is tokenised.
 */
const GRIDS = [
  { label: 'Desktop', width: 1272, columns: 12, margin: tokens.margin.desktop },
  { label: 'Tablet', width: 500, columns: 6, margin: tokens.margin.mobile },
  { label: 'Mobile', width: 360, columns: 4, margin: tokens.margin.mobile },
] as const;

/** Figma `28:1125`. Not a token — see the note above. */
const GUTTER = 24;

function GridSpec() {
  return (
    <section style={{ marginBottom: 32 }}>
      <h2 style={{ fontFamily: 'system-ui, sans-serif', fontSize: 16, marginBottom: 4 }}>Grid</h2>
      <p style={{ fontFamily: 'system-ui, sans-serif', fontSize: 12, color: '#61768c', marginTop: 0 }}>
        Figma <code>28:1125</code>. Gutter {GUTTER}px. Margin is a token; the column count and
        the gutter are not.
      </p>
      <div style={{ display: 'grid', gap: 24 }}>
        {GRIDS.map(({ label, width, columns, margin }) => (
          <div key={label} style={{ fontFamily: 'system-ui, sans-serif', fontSize: 12 }}>
            <div style={{ color: '#03203d', marginBottom: 6 }}>
              {label} — {width}px container, {columns} columns, {margin}px margin
            </div>
            {/* Scaled to fit the docs page rather than drawn at true size: the RELATIVE
                proportions are the readable part, and a 1272px block would scroll. */}
            <div
              style={{
                width: '100%',
                maxWidth: width,
                boxSizing: 'border-box',
                padding: `0 ${margin}px`,
                border: '1px solid #e6e9ed',
                borderRadius: 8,
                background: '#f7f9fb',
              }}
            >
              <div style={{ display: 'grid', gridTemplateColumns: `repeat(${columns}, 1fr)`, gap: GUTTER }}>
                {Array.from({ length: columns }, (_, i) => (
                  <div key={i} style={{ height: 56, background: '#cfe4fb', borderRadius: 2 }} />
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function Page({ page }: { page: FoundationPage }) {
  const groups = groupsForPage(page);

  if (groups.length === 0) {
    return (
      <p style={{ fontFamily: 'system-ui, sans-serif', color: '#61768c' }}>
        Belum ada token untuk <strong>{page}</strong>. Halaman ini akan terisi sendiri begitu
        grupnya diterbitkan ke <code>generated.ts</code> — bukan tanda ada yang rusak.
      </p>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 32 }}>
      {groups.map((group) => (
        <section key={group}>
          <h2 style={{ fontFamily: 'system-ui, sans-serif', fontSize: 16, marginBottom: 12 }}>
            {group}
          </h2>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
            {flattenGroup(tokens[group as keyof typeof tokens]).map((leaf) => (
              <Swatch key={leaf.path} {...leaf} group={group} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

const meta = {
  title: 'Foundations',
  component: Page,
} satisfies Meta<typeof Page>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Color: Story = { args: { page: 'Color' } };
/**
 * `args` stays even though `render` ignores it: `Foundation.test.ts` maps `story.args.page` over
 * every exported story, and dropping it makes that dereference `undefined` and takes the whole
 * test file down at module scope. Excluding Typography from that map instead would retire the
 * guard that every Foundation page has a story.
 */
export const Typography: Story = {
  args: { page: 'Typography' },
  render: () => <TypographyPage />,
};
/**
 * `args.page` stays for `Foundation.test.ts`, which maps it over every export; the grid is
 * drawn ABOVE the token browser rather than as a story of its own so that mapping keeps
 * comparing one story per page.
 */
export const LayoutSpacingImage: Story = {
  name: 'Layout, Spacing, Image',
  args: { page: 'Layout, Spacing, Image' },
  render: () => (
    <>
      <GridSpec />
      <Page page="Layout, Spacing, Image" />
    </>
  ),
};
