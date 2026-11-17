/**
 * The native-ui-v2 list chrome and sheet (docs/guidelines/mobile-design-identity.md §4.5, §5.3,
 * §7): `ListGroup`, `ListRow`, `Menu`'s identity sheet, and the press motion retrofitted onto
 * `Button`, `Chip` and `SelectionCard`.
 *
 * SOURCE-SCANNED, not rendered: `react-native` does not load under vitest (its entry is Flow). The
 * rendered behaviour — a press reaching `onPress`, the tint, the spring and timing configs — is in
 * `apps/mobile/src/design/__tests__/list-chrome.test.tsx`. This half exists because a guard only
 * guards its own package: turbo replays that suite's cached pass over a change made here.
 *
 * PROVED RED, one injection each, reverted:
 * | Injection | Reds |
 * | -- | -- |
 * | `ListRow`'s tint read `surface.hoverNeutral` | the pressed and active tint |
 * | `TRAILING_ICON.external` → `'chevron-right'` | the trailing glyphs |
 * | `identity` dropped from `Menu`'s Dialog tag | Menu draws the identity sheet |
 * | `identity = true` as the prop's default in `Menu` | the identity sheet is opt-in |
 * | `Animated.spring(progress, …MOTION.spring.sheet` → `Animated.timing(progress, { duration: 380 …` | the identity motion |
 * | `Chip` back on a bare `<Pressable` | the press retrofit (Chip) |
 * | `PLAIN_ROW` back to 16 / 8 padding | the plain row is 52 tall |
 * | `PLAIN_GLYPH = 20`, or its ink `secondary` | the plain row's glyphs |
 * | the plain label `paragraph` `semibold` (or `bodyLg` `bold`) | the plain row's label and value |
 * | `PLAIN_GROUP` gap `2xs`, or `PLAIN_LABEL` ink `muted` | the plain group's label |
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contract } from '../../contract';
import { tokens } from '../../tokens';
import { BUTTON_TREATMENT } from '../button-styles';

const read = (file: string) => readFileSync(resolve(__dirname, '..', file), 'utf8');

/** Line comments first, then block comments — so prose naming a pattern cannot satisfy it. */
const code = (file: string) =>
  read(file)
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .replace(/\/\*[\s\S]*?\*\//g, '');

/** The slice of `source` from `start` to the first top-level close of the object/call it opens. */
const sliceFrom = (source: string, start: string): string => {
  const at = source.indexOf(start);
  expect(at, `${start} not found`).toBeGreaterThan(-1);
  const end = source.slice(at).search(/\n\}( as const[^\n]*)?;/);
  expect(end, `${start} never closes`).toBeGreaterThan(-1);
  return source.slice(at, at + end + 3);
};

describe('the identity sizes the list chrome reads exist as tokens', () => {
  /* If a rung moves, the component moves with it; these pin that the rung still MEANS the
     identity's number, so a token edit cannot silently resize every row. */
  it('pins the measures and radii', () => {
    expect(tokens.measurement['3-5']).toBe(56);
    expect(tokens.measurement['2-25']).toBe(36);
    expect(tokens.measurement['2-5']).toBe(40);
    expect(tokens.radius['3xl']).toBe(32);
    expect(tokens.spacing['4xs']).toBe(4);
  });
});

describe('ListRow', () => {
  const src = code('ListRow.tsx');

  it('presses with the identity press scale: default for a tile row, card for a plain one', () => {
    expect(src).toMatch(/<PressableScaleHost[\s\S]*?scale=\{plain \? 'card' : 'default'\}/);
    expect(src).not.toMatch(/<Pressable[\s>]/);
  });

  it('is at least 56 tall, with a 36 icon tile on the pale brand surface', () => {
    expect(sliceFrom(src, 'const TILE_ROW = {')).toMatch(/minHeight:\s*measure\['3-5'\]/);
    /* The 56 floor and the inner padding are the tile row's alone: the shared box carries neither. */
    expect(sliceFrom(src, 'const ROW = {')).not.toMatch(/minHeight|padding/);
    expect(src).toMatch(/\[ROW, plain \? PLAIN_ROW : TILE_ROW,/);
    const tile = sliceFrom(src, 'const ICON_TILE = {');
    expect(tile).toMatch(/width:\s*measure\['2-25'\]/);
    expect(tile).toMatch(/height:\s*measure\['2-25'\]/);
    expect(tile).toMatch(/backgroundColor:\s*tokens\.surface\.weak\.brand/);
    expect(src).toMatch(/tint=\{tokens\.brand\.b500\}/);
  });

  it('tints pressed and active rows surface.weak.brand', () => {
    expect(src).toMatch(/const ROW_TINTED = \{ backgroundColor: tokens\.surface\.weak\.brand \}/);
    expect(src).toMatch(/const isLit = \(pressed: boolean\) => active \|\| \(pressed && !disabled\);/);
    expect(src).toMatch(/!plain && isLit\(pressed\) && ROW_TINTED/);
  });

  it('draws › for in-app and ↗ for leaving the app, never mixed', () => {
    const map = sliceFrom(src, 'const TRAILING_ICON = {');
    expect(map).toMatch(/chevron:\s*'chevron-right'/);
    expect(map).toMatch(/external:\s*'external-link'/);
    expect(map).toMatch(/none:\s*undefined/);
    expect(src).toMatch(/Of<'trailing'>/);
    expect(contract.ListRow.axes.trailing).toEqual(['chevron', 'external', 'none']);
  });

  it('says in its docblock that a destructive action is not a row', () => {
    expect(read('ListRow.tsx')).toMatch(/DESTRUCTIVE ACTIONS ARE NOT ROWS/);
    expect(read('ListRow.tsx')).toMatch(/type="ghost" color="danger" width="full"/);
  });
});

/**
 * The plain row (UMK-1601 / UMK-1614, Figma `Mobile/Profile` 14980:77345): 52 tall with no inset of
 * its own, no tile, 18 pt glyphs in the default ink, a Medium 14 label, a SemiBold 14 trailing value,
 * and a press that FADES its tint in rather than snapping it.
 */
describe('ListRow — plain variant and trailing value', () => {
  const src = code('ListRow.tsx');

  it('reads both new axes out of the contract', () => {
    expect(src).toMatch(/Of<'variant'>/);
    expect(src).toMatch(/Of<'valueTone'>/);
    expect(contract.ListRow.axes.variant).toEqual(['tile', 'plain']);
    expect(contract.ListRow.axes.valueTone).toEqual(['muted', 'brand']);
    /* Default `tile`, so every caller that says nothing keeps today's row. */
    expect(src).toMatch(/variant = 'tile',/);
  });

  it('is 52 tall: 16 above and below the 20 line, and no horizontal padding of its own', () => {
    const box = sliceFrom(src, 'const PLAIN_ROW = {');
    expect(box).toMatch(/paddingVertical:\s*tokens\.spacing\.md/);
    expect(box).not.toMatch(/paddingHorizontal|minHeight/);
    expect(tokens.spacing.md * 2 + tokens.typography.mobile.paragraph.medium.lineHeight).toBe(52);
  });

  it('draws a plain row\'s glyphs bare: 18 pt through the registry, default ink (disabled ink when disabled), and never inside the tile', () => {
    expect(src).toMatch(/const PLAIN_GLYPH = 18;/);
    const glyph = src.slice(src.indexOf('const PlainGlyph'), src.indexOf('const PlainRowBody'));
    expect(glyph).toMatch(/size=\{PLAIN_GLYPH\}/);
    expect(glyph).toMatch(/color=\{disabled \? ICON_COLOR_VALUES\.disable : ICON_COLOR_VALUES\.primary\}/);
    /* An unported name still throws Icon's message rather than drawing nothing. */
    expect(glyph).toMatch(/if \(!Glyph\) return <Icon name=\{name\} \/>;/);
    const body = src.slice(src.indexOf('const PlainRowBody'), src.indexOf('export const ListRow'));
    expect(body).toMatch(/<PlainGlyph name=\{icon\} disabled=\{disabled\} \/>/);
    expect(body).toMatch(/<PlainGlyph name=\{glyph\} disabled=\{disabled\} \/>/);
    expect(body).not.toMatch(/<Icon /);
    expect(body).not.toMatch(/ICON_TILE/);
  });

  it('labels a plain row Medium 14, values it SemiBold 14, and tones the value brand or muted from the contract axis', () => {
    const body = src.slice(src.indexOf('const PlainRowBody'), src.indexOf('export const ListRow'));
    expect(body).toMatch(/<Text variant="paragraph" weight="medium" color=\{disabled \? 'disable' : 'primary'\}/);
    expect(body).toMatch(/<Text variant="paragraph" weight="semibold" color=\{VALUE_TONE\[valueTone\]\}/);
    expect(tokens.typography.mobile.paragraph.medium).toMatchObject({ fontSize: 14, lineHeight: 20, fontWeight: 500 });
    expect(tokens.typography.mobile.paragraph.semibold).toMatchObject({ fontSize: 14, lineHeight: 20, fontWeight: 600 });
    const tone = sliceFrom(src, 'const VALUE_TONE = {');
    expect(tone).toMatch(/muted:\s*'muted'/);
    expect(tone).toMatch(/brand:\s*'brand'/);
    /* Both variants draw the value from the same table. */
    expect(src.match(/color=\{VALUE_TONE\[valueTone\]\}/g)).toHaveLength(2);
  });

  it('fades the plain row\'s surface.weak.brand highlight in over duration.press', () => {
    expect(sliceFrom(src, 'const HIGHLIGHT = {')).toMatch(/backgroundColor:\s*tokens\.surface\.weak\.brand/);
    expect(src).toMatch(
      /Animated\.timing\(progress, \{\s*toValue: lit \? 1 : 0,\s*duration: MOTION\.duration\.press,\s*easing: EASING\.standard,\s*useNativeDriver: true,?\s*\}\)/,
    );
    expect(src).toMatch(/opacity: progress/);
  });

  it('nudges an external plain row\'s ↗ up and right by distance.nudge, and not at all under Reduce Motion', () => {
    expect(src).toMatch(/const nudge = reduce \? 0 : MOTION\.distance\.nudge;/);
    expect(src).toMatch(/translateX: progress\.interpolate\(\{ inputRange: \[0, 1\], outputRange: \[0, nudge\] \}\)/);
    expect(src).toMatch(/translateY: progress\.interpolate\(\{ inputRange: \[0, 1\], outputRange: \[0, -nudge\] \}\)/);
    expect(tokens.motion.distance.nudge).toBe(2);
  });
});

describe('the outlined danger button a destructive action uses instead', () => {
  /* No new variant: `ghost` × `danger` already IS the full-width outlined danger button. */
  it('is ghost × danger: a 1px error stroke on a clear fill', () => {
    const cell = BUTTON_TREATMENT.ghost.danger;
    expect(cell.strokeWidth).toBe(1);
    expect(cell.rest.backgroundColor).toBe('transparent');
    expect(cell.rest.borderColor).toBe(tokens.border.default.error);
    expect(cell.rest.ink).toBe(tokens.text.default.error);
  });
});

describe('ListGroup', () => {
  const src = code('ListGroup.tsx');

  it('is the solid card: a white container with padding 4 and the one card edge, no glass layer (UMK-1603)', () => {
    const container = sliceFrom(src, 'const CONTAINER = {');
    /* The fill is the container's own: the glass layer under the rows was deleted. */
    expect(container).toMatch(/backgroundColor:\s*tokens\.surface\.default\.primary/);
    expect(src).not.toMatch(/GlassBackdrop|from '\.\/glass'/);
    expect(src).toMatch(/<View style=\{CONTAINER\}>\s*<List>/);
    /* The stale note goes with the gap it described; `code()` strips comments, so read it raw. */
    expect(read('ListGroup.tsx')).not.toMatch(/NO BLUR YET/);
    /* The one card edge (`CARD_EDGE`, pinned by value in `ui-v2-surfaces.test.ts`). */
    expect(container).toMatch(/\.\.\.CARD_EDGE,/);
    expect(src).toMatch(/import \{ CARD_EDGE \} from '\.\/content-styles'/);
    expect(container).toMatch(/borderRadius:\s*tokens\.radius\['2xl'\]/);
    expect(container).toMatch(/padding:\s*tokens\.spacing\['4xs'\]/);
  });

  it('labels the section Bold, uppercase and muted', () => {
    const label = sliceFrom(src, 'const LABEL = {');
    expect(label).toMatch(/color:\s*tokens\.text\.default\.muted/);
    expect(label).toMatch(/textTransform:\s*'uppercase'/);
    expect(src).toMatch(/<Text variant="bodyLg" weight="bold" accessibilityRole="header" style=\{LABEL\}>/);
  });

  it('stacks its rows through List rather than forking a second stack', () => {
    expect(src).toMatch(/import \{ List \} from '\.\/List'/);
    expect(src).toMatch(/<List>\{children\}<\/List>/);
  });

  it('reads its variant out of the contract, outlined by default', () => {
    expect(src).toMatch(/Of<'variant'>/);
    expect(contract.ListGroup.axes.variant).toEqual(['outlined', 'plain']);
    expect(src).toMatch(/variant = 'outlined',/);
  });

  it('a plain group drops the container and labels the section in sentence case, SemiBold 14 in the secondary ink, with no inset', () => {
    expect(src).toMatch(/const PLAIN_LABEL = \{ color: tokens\.text\.default\.secondary \} as const;/);
    expect(src).toMatch(/<Text variant="paragraph" weight="semibold" accessibilityRole="header" style=\{PLAIN_LABEL\}>/);
    /* Figma stacks the plain group 4 apart; the outlined group keeps its 8. */
    expect(src).toMatch(/const PLAIN_GROUP = \{ gap: tokens\.spacing\['4xs'\] \} as const;/);
    expect(src).toMatch(/const OUTLINED_GROUP = \{ gap: tokens\.spacing\['2xs'\] \} as const;/);
    expect(src).toMatch(/style=\{\[plain \? PLAIN_GROUP : OUTLINED_GROUP, style\]\}/);
    expect(src).toMatch(/plain \? \(\s*<List>\{children\}<\/List>\s*\) : \(\s*<View style=\{CONTAINER\}>/);
  });
});

describe("Menu's identity sheet", () => {
  const menu = code('Menu.tsx');
  const dialog = code('Dialog.tsx');
  const styles = code('overlay-styles.ts');

  it('draws the identity sheet when asked', () => {
    const tag = menu.slice(menu.indexOf('<Dialog'), menu.indexOf('bottomInset={bottomInset}'));
    expect(tag).toMatch(/\n\s*identity=\{identity\}\n/);
    expect(tag.startsWith('<Dialog open={isOpen}')).toBe(true);
  });

  /**
   * OFF unless a call site asks (review of #1327, when the since-deleted v1 UI shared `Menu`). It stays
   * opt-in: `ImageActionsMenu` still says nothing, and flipping the default would change its sheet.
   */
  it('keeps the identity sheet opt-in, so a caller that says nothing is unchanged', () => {
    expect(menu).toMatch(/\n\s*identity = false,\n\}: MenuProps\)/);
    expect(menu).toMatch(/const Rows = identity \? IdentityRows : React\.Fragment;/);
    expect(menu).not.toMatch(/<EnterList[^>]*>\s*\{drilled/);
  });

  it('staggers its rows in after the sheet lands', () => {
    expect(menu).toMatch(/<EnterList delay=\{MOTION\.duration\.base\}>\{children\}<\/EnterList>/);
  });

  it('carries a header slot: an 18 Bold title and a trailing node', () => {
    expect(menu).toMatch(/title\?: string;/);
    expect(menu).toMatch(/headerTrailing\?: React\.ReactNode;/);
    expect(menu).toMatch(/<Text variant="h5" weight="bold" accessibilityRole="header"/);
    expect(tokens.typography.mobile.h5.bold.fontSize).toBe(18);
  });

  it('rounds the sheet at radius.3xl under shadow.float', () => {
    const sheet = sliceFrom(styles, 'export const DIALOG_IDENTITY_SHEET = {');
    expect(sheet).toMatch(/borderTopLeftRadius:\s*tokens\.radius\['3xl'\]/);
    expect(sheet).toMatch(/borderTopRightRadius:\s*tokens\.radius\['3xl'\]/);
    expect(sheet).toMatch(/shadowStyle\(tokens\.shadow\.float\)/);
    expect(dialog).toMatch(/identity && DIALOG_IDENTITY_SHEET/);
  });

  /* `flushRows` (UMK-1890): the composer's Final Design rows, OFF unless asked — pinned here as well
     as in apps/mobile, because turbo replays the app's cached pass over a change in this package. */
  it('keeps flushRows opt-in and draws its rows square, edge to edge, at 16 padding and a 12 gap', () => {
    expect(menu).toMatch(/\n\s*flushRows = false,\n/);
    const item = sliceFrom(styles, 'export const MENU_FLUSH_ITEM = {');
    expect(item).toMatch(/borderRadius:\s*0,/);
    expect(item).toMatch(/gap:\s*tokens\.spacing\.sm,/);
    expect(item).toMatch(/paddingHorizontal:\s*tokens\.spacing\.md,/);
    expect(item).toMatch(/paddingVertical:\s*tokens\.spacing\.md,/);
    expect(sliceFrom(styles, 'export const MENU_FLUSH_SCROLL = {')).toMatch(/marginHorizontal:\s*-tokens\.margin\.mobile,/);
    expect(sliceFrom(styles, 'export const MENU_FLUSH_CONTENT = {')).toMatch(/paddingHorizontal:\s*0,/);
    expect(menu).toMatch(/<ScrollView style=\{\[\{ flexShrink: 1 \}, flushRows && \{ marginHorizontal: MENU_FLUSH_SCROLL\.marginHorizontal \}\]\}/);
    expect(menu).toMatch(/flushRows && MENU_FLUSH_ITEM,/);
  });

  it('keeps the 40-wide handle', () => {
    expect(sliceFrom(styles, 'export const DIALOG_HANDLE_BAR = {')).toMatch(/width:\s*measure\['2-5'\]/);
  });

  it('moves on the motion tokens: spring.sheet in, a shorter easing.exit out, a duration.base scrim', () => {
    const motion = sliceFrom(dialog, 'const identityMotion = (');
    expect(motion).toMatch(/Animated\.spring\(progress, \{ toValue: 1, \.\.\.MOTION\.spring\.sheet/);
    expect(motion).toMatch(/duration: reduceMotion \? MOTION\.duration\.fast : MOTION\.duration\.base,\s*easing: EASING\.standard/);
    expect(motion.match(/easing: EASING\.exit/g)).toHaveLength(2);
    /* Every number in it is a token: no duration, delay or spring constant written out. */
    expect(motion).not.toMatch(/(duration|delay|damping|stiffness):\s*\d/);
    /* The scrim runs on its own clock only for the identity sheet. */
    expect(dialog).toMatch(/opacity: identity \? scrim : progress/);
  });

  it('keeps the KeyboardAvoidingView as the modal root', () => {
    /* packages/ui/CLAUDE.md: the sheet avoids the keyboard only through this root. */
    expect(dialog).toMatch(/<Modal[\s\S]*?<KeyboardAvoidingView/);
  });
});

describe('the press retrofit', () => {
  it.each(['Button.tsx', 'Chip.tsx', 'SelectionCard.tsx'])('%s presses with the identity press scale', (file) => {
    const src = code(file);
    expect(src).toMatch(/<PressableScaleHost[\s\S]*?scale="default"/);
    expect(src).not.toMatch(/<Pressable[\s>]/);
  });

  it('shares one press hook between the two press helpers', () => {
    const motion = code('motion.tsx');
    expect(motion.match(/usePressScale\(scale, disabled\)/g)).toHaveLength(2);
    expect(motion).toMatch(/Boolean\(testOnly_pressed\) \|\| down/);
  });
});
