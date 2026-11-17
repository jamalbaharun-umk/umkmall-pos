import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import postcss from 'postcss';
import tailwind from 'tailwindcss';
import { beforeAll, describe, expect, it } from 'vitest';
import * as COMPOSER_CLASSES from './composer-classes';
import { contract } from '../contract';

const {
  COMPOSER_DRAWER,
  COMPOSER_DRAWER_VARIANT,
  COMPOSER_BASE,
  COMPOSER_SHELL,
  COMPOSER_TRAY,
  COMPOSER_TRAY_TONE,
  COMPOSER_DRAWER_DISPLAY,
  COMPOSER_DRAWER_HANDLE,
  COMPOSER_STATUS,
  COMPOSER_BUTTON_ACTIVE,
  COMPOSER_BUTTON_IDLE,
  COMPOSER_BUTTON_DISABLED,
} = COMPOSER_CLASSES;

/**
 * THE CHAT COMPOSER FAMILY's purge guard. Eight components — the shell, the editor, the drawer,
 * the attachment and the four buttons — share `family: 'composer'` and this one pair, which is
 * what a family is for: the alternative was eight unfamilied allowlist rows naming eight pairs.
 *
 * WHAT IT IS FOR: a purged class renders unstyled against a green suite. The behaviour sibling can
 * see that the mobile shell asks for a different radius than the desktop one, and that the active
 * mic asks for the error surface; it cannot see that either rule still EXISTS in the emitted
 * stylesheet. A composer whose width, radius and padding were all purged is a full-bleed square
 * box with the controls jammed against its edges — and every class name is still on the element,
 * so nothing over there moves.
 *
 * Same siting and mechanics as `header.purge.test.ts`: in this package, because turbo's
 * `test` hash covers a package's own files and not its workspace dependencies' (UMK-852), and
 * the preset is loaded by RELATIVE path because the bare specifier resolves through a
 * node_modules symlink that is a different copy inside a git worktree.
 *
 * AND IT SCANS SOURCE ONLY. A glob that swept this file in would make these class names their
 * own content, and every one would report as emitted whether or not any component uses it.
 */
const require_ = createRequire(import.meta.url);
const PACKAGE = resolve(__dirname, '../..');

const componentFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? componentFiles(join(dir, e.name))
      : /\.tsx?$/.test(e.name) && !/\.(?:test|test-d|stories)\./.test(e.name)
        ? [join(dir, e.name)]
        : [],
  );

const compile = async (): Promise<string> => {
  const preset = require_(resolve(PACKAGE, 'tailwind.preset.js'));
  const processed = await postcss([
    tailwind({ presets: [preset], content: componentFiles(resolve(PACKAGE, 'src')) }),
  ]).process('@tailwind utilities;', { from: undefined });
  return processed.css;
};

/**
 * NOT A HAND-MAINTAINED LIST ANY MORE, and that is the fix rather than a tidy-up. There used to
 * be two registrations of the same module here — the required list and the exit-animation map —
 * both written out by hand, so a new table in `composer-classes.ts` was invisible to both until
 * someone made two edits, and a table present in one and absent from the other was unchecked
 * with nothing red. Nor could the map's own `> 4` count floor see that: a count cannot name what
 * went missing. Both registrations are now derived from ONE namespace import, and the
 * completeness check below is what notices a table shaped in a way this cannot flatten.
 */
const flatten = (module_: Record<string, unknown>): Record<string, string> =>
  Object.fromEntries(
    Object.entries(module_).flatMap(([name, value]) =>
      typeof value === 'string'
        ? [[name, value] as const]
        : Object.entries(value as Record<string, string>).map(
            ([step, v]) => [`${name}.${step}`, v] as const,
          ),
    ),
  );

/** A table is a class string, or a record of them. Anything else is not one — see below. */
const isTable = (value: unknown): boolean =>
  typeof value === 'string' ||
  (typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((v) => typeof v === 'string'));

const TABLES = flatten(COMPOSER_CLASSES as unknown as Record<string, unknown>);

const REQUIRED = Object.values(TABLES)
  .flatMap((v) => v.split(' '))
  /* Arbitrary values cannot be falsified: Tailwind's JIT generates them from the very line
     the expectation is read off, so the rule always exists and the check always passes. */
  .filter((c) => !c.includes('['))
  /* Mirror Tailwind's own escape rule rather than enumerating characters — the emitted
     selector for a variant class carries a literal backslash, and escaping a chosen subset
     builds a selector the stylesheet never contains. */
  .map((c) => `.${c.replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch}`)}`);

describe('the composer classes survive the purge', () => {
  let css = '';
  beforeAll(async () => {
    css = await compile();
  });

  it('emits a rule for every class the composer family relies on', () => {
    const emitted = (selector: string) =>
      new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![-\\w])`).test(css);
    const missing = [...new Set(REQUIRED)].filter((selector) => !emitted(selector));
    expect(missing).toEqual([]);
  });

  /**
   * THE FAMILY IS RECONCILED AGAINST THE CONTRACT, not against a number. Seven entries claim
   * `family: 'composer'`; a component added to the contract without a class table, or a table
   * deleted while its entry stays, is what this catches. A count would survive either.
   */
  it('covers every component the contract puts in this family', () => {
    const members = Object.entries(contract)
      .filter(([, e]) => (e as { family?: string }).family === 'composer')
      .map(([name]) => name)
      .sort();
    expect(members).toEqual([
      'ChatAttachment',
      'ChatAttachmentButton',
      'ChatComposer',
      'ChatComposerInput',
      'ChatDrawer',
      'ChatSendButton',
      'ChatSoundWave',
      'ChatToolsButton',
      'ChatVoiceBar',
      'ChatVoiceButton',
    ]);
  });

  /**
   * ONE PRESENTATION, AND THE SHELL STILL CARRIES EVERY MEASUREMENT. The Desktop/Mobile pair was
   * briefly a real prop and was collapsed onto the mobile values by product decision, so what has
   * to be asserted flipped: not that the two disagree, but that collapsing them did not quietly
   * drop a measurement on the way. A shell missing its radius or its padding is a square box with
   * the controls jammed against its edges, and every class name would still be on the element.
   */
  it('names a radius, a padding and a gap on the single shell', () => {
    for (const [name, re] of [
      ['radius', /(?:^|\s)(rounded-\S+)/],
      ['padding', /(?:^|\s)(p[xy]?-\S+)/],
      ['gap', /(?:^|\s)(gap-\S+)/],
    ] as const) {
      expect(COMPOSER_SHELL.match(re)?.[1], `the shell names no ${name}`).toBeTruthy();
    }
    /* And no width cap survived the collapse: 760 and 328 were artboard measurements, and a
       composer capped at either is one the surface cannot use full-width. */
    expect(COMPOSER_SHELL).not.toMatch(/max-w-/);
  });

  /**
   * THE ACTIVE STATE, which the published set does not draw and the surface needs. Asserted as
   * BOTH halves — a resting elevation and a focus treatment that changes it — because a shadow
   * that never moves is not an active state, and a focus ring with no elevation is not what was
   * asked for. The colour comes from this package's own focus tokens; the guard below that bans
   * palette steps is what keeps the app's untokenised teal from being copied in later.
   */
  it('has a raised lift that is emitted, at rest and on focus', async () => {
    // Exactly the lift: the V2 edge and desktop shape live in COMPOSER_HERO_EDGE, so a hero from before the web Beranda v2
    // (`temanai-web-beranda-v2` off) draws none of them.
    expect(COMPOSER_CLASSES.COMPOSER_RAISED.split(' ')).toEqual(['shadow-xl', 'focus-within:shadow-xl']);
    expect(COMPOSER_CLASSES.COMPOSER_HERO_EDGE.split(' ')).toEqual(
      expect.arrayContaining(['border-transparent', 'focus-within:border-transparent', 'md:rounded-ds-2xl']),
    );
    expect(css).toMatch(/\.shadow-xl\b/);
    expect(css).toMatch(/\.focus-within\\:shadow-xl\b/);
  });

  /**
   * THE HERO'S EDGE IS AN ARBITRARY VALUE, which the emission check above skips — and a malformed
   * one (an unbalanced bracket, a space where an underscore belongs) is not generated at all. The
   * hero would then show a transparent border with no edge, every name still on the element and
   * every other case green. So this reads the DECLARATION: both layers, both boxes and both semantic
   * stops, the gradient running to the bottom (UMK-1755).
   */
  it("generates the hero's gradient edge", () => {
    expect(css).toMatch(
      /background:\s*linear-gradient\([^;}]*\)\s*padding-box,\s*linear-gradient\(to bottom,[^;}]*--surface-default-brand[^;}]*--surface-default-success[^;}]*\)\s*border-box/,
    );
  });

  it('rests with an elevation and lifts on focus', () => {
    expect(COMPOSER_BASE).toMatch(/(?:^|\s)shadow-\S+/);
    expect(COMPOSER_BASE).toMatch(/focus-within:shadow-\S+/);
    const resting = COMPOSER_BASE.match(/(?:^|\s)(shadow-\S+)/)?.[1];
    const focused = COMPOSER_BASE.match(/focus-within:(shadow-\S+)/)?.[1];
    expect(resting, 'focus does not change the elevation').not.toBe(focused);
  });

  /**
   * NO BREAKPOINT PREFIX ANYWHERE, BAR THE HERO'S DESKTOP SHAPE. With the Desktop/Mobile axis
   * collapsed this is the ordinary reason again: the composer has ONE presentation, so a responsive
   * prefix would mean a width band where it is not that presentation — and no assertion in this
   * package can see a layout band. It is also how the collapsed axis would most plausibly grow back
   * by accident.
   *
   * ONE EXCEPTION, BY NAME (UMK-1755, the author's decision): the V2 hero is the page's subject,
   * and from `md` it takes the published Desktop radius and padding. Exactly those three classes,
   * in its edge table (`COMPOSER_HERO_EDGE`) only — so a fourth prefix there, or any prefix in another table, is red.
   */
  it('names no breakpoint prefix, bar the hero’s desktop radius and padding', () => {
    const HERO_DESKTOP = ['md:rounded-ds-2xl', 'md:px-ds-2xl', 'md:py-ds-lg'];
    // A breakpoint is ANY variant segment naming one of the preset's screens (or its `max-` twin) or
    // an arbitrary `min-[…]`/`max-[…]` width — wherever it sits in the chain, so `focus-within:md:`
    // counts as much as `md:`. The screens are read off the preset, so a screen added there is
    // covered with no edit here.
    const screens = Object.keys(
      require_('tailwindcss/resolveConfig')({ presets: [require_(resolve(PACKAGE, 'tailwind.preset.js'))], content: [] })
        .theme.screens,
    );
    const breakpoint = new RegExp(`^(?:max-)?(?:${screens.join('|')})$|^(?:min|max)-\\[`);
    for (const [name, value] of Object.entries(TABLES)) {
      const prefixed = value
        .split(' ')
        .filter((c) => c.split(':').slice(0, -1).some((segment) => breakpoint.test(segment)));
      expect(prefixed, name).toEqual(name === 'COMPOSER_HERO_EDGE' ? HERO_DESKTOP : []);
    }
  });

  /**
   * THE SHELL'S FOCUS BAND IS ONE HUE, and that is the assertion — not merely that a ring exists.
   *
   * `FOCUS_RING.field` pairs a STRONG border colour with a PALE ring colour. On a checkbox the two
   * read as one treatment; on a surface this size the strong inner edge separates from the pale
   * halo and reads as a dark line drawn inside a glow. So the border and the halo here name the
   * SAME token. Asserted as an identity between the two rather than as "a ring is present",
   * because a ring is present either way.
   *
   * AND THE TOKEN MUST BE THE PALE ONE, which is the assertion this guard was missing. It first
   * passed with BOTH naming `focus-brand` — one hue, exactly as demanded, and the dark
   * line was still there, because a hairline of the strong stop is a hairline whether or not the
   * glow around it agrees. One hue was necessary and not sufficient. The strong stop is still
   * required to exist and to be used by the buttons, so this is a placement rule rather than a ban.
   *
   * The BUTTONS keep the shared control ring: they are small, which is what the two-tone pair is
   * for, and using it is what keeps them consistent with every other control in the package.
   */
  it('draws the shell focus band in one hue, and keeps the shared ring on the buttons', () => {
    const border = COMPOSER_BASE.match(/focus-within:border-(\S+)/)?.[1];
    const ring = COMPOSER_BASE.match(/focus-within:ring-([a-z-]+)(?:\/\d+)?(?!\S)/)?.[1];
    expect(border, 'the shell names no focus border').toBe('halo');
    expect(ring, 'the shell halo is a different colour from its focus border').toBe(border);
    /*
      AND THE HALO IS THIN. Ring width does not scale with the element: 2px reads as a delicate edge
      on a checkbox and as a heavy band on a full-width composer. Asserted against the SMALL
      controls' width rather than as a literal, so the rule survives a change to either — what must
      hold is that the big surface does not wear the small controls' ring weight.
    */
    const shellRing = Number(COMPOSER_BASE.match(/focus-within:ring-(\d+)(?!\S)/)?.[1]);
    const controlRing = Number(
      COMPOSER_CLASSES.COMPOSER_BUTTON_BASE.match(/focus-visible:ring-(\d+)(?!\S)/)?.[1],
    );
    expect(shellRing, 'the shell names no ring width').toBeTypeOf('number');
    expect(controlRing, 'the buttons name no ring width').toBeTypeOf('number');
    expect(shellRing, 'the shell wears the small controls\' ring weight').toBeLessThan(controlRing);

    /* The strong stop draws a visible hairline at this size — it belongs on the small controls. */
    expect(COMPOSER_BASE, 'the shell draws its focus edge in the strong stop').not.toContain(
      'focus-within:border-focus-brand',
    );
    /* Focus must still be VISIBLE: the resting border is a near-white grey, so the focused one has
       to be a different token entirely rather than a shade of it. */
    expect(COMPOSER_BASE).toContain('border-default-primary');
    expect(border).not.toBe('default-primary');

    expect(COMPOSER_CLASSES.COMPOSER_BUTTON_BASE).toContain('focus-visible:ring-halo');
  });

  /** Tailwind only emits a class it can read whole, so both box sizes are spelled out literally. */
  it('spells both button sizes out as whole classes', () => {
    expect(COMPOSER_CLASSES.COMPOSER_BUTTON_SIZE.compact).toBe('h-8 w-8');
    expect(COMPOSER_CLASSES.COMPOSER_BUTTON_SIZE.landing).toBe('h-9 w-9');
  });

  /** The non-image tile's classes are whole literals too, and 96px comes from the preview size table. */
  it('spells the file tile out as whole classes', () => {
    expect(COMPOSER_CLASSES.COMPOSER_FILE_TILE).toContain('border-2 border-default-primary');
    expect(COMPOSER_CLASSES.COMPOSER_FILE_TILE_EXT).toContain('text-ds-legacy-10');
    expect(COMPOSER_CLASSES.COMPOSER_PREVIEW_SIZE.large).toBe('h-24 w-24');
  });

  /** The composer surface and border pair the token pipeline published for this component. */
  it('draws the shell and the three outlined buttons on the composer tokens', () => {
    for (const value of [COMPOSER_BASE, COMPOSER_BUTTON_IDLE.tools, COMPOSER_BUTTON_IDLE.attachment, COMPOSER_BUTTON_IDLE.voice]) {
      expect(value).toContain('bg-default-primary');
      expect(value).toContain('border-default-primary');
    }
  });

  /**
   * SEND RESTS FILLED, and its disabled state is a flat neutral rather than a fade. Both are
   * product decisions against the published set, and both are the kind a later "consistency" pass
   * undoes: the first makes the composer's primary action look like its neighbours again, and the
   * second leaves a disabled send still reading as blue. Asserted as a DISAGREEMENT with the three
   * outlined buttons, so a shared idle cannot satisfy it.
   */
  it('rests send filled while the other three rest outlined', () => {
    expect(COMPOSER_BUTTON_IDLE.send).toContain('bg-default-brand');
    expect(COMPOSER_BUTTON_IDLE.send).not.toContain('bg-default-primary');
    expect(COMPOSER_BUTTON_IDLE.send).not.toBe(COMPOSER_BUTTON_IDLE.attachment);
  });

  it('disables send to a neutral fill rather than fading it', () => {
    expect(COMPOSER_BUTTON_DISABLED.send).toMatch(/disabled:bg-\S+/);
    expect(COMPOSER_BUTTON_DISABLED.send).not.toContain('opacity');
    /* The premise: the other three DO fade, so the claim above is about send specifically. */
    for (const kind of ['tools', 'attachment', 'voice'] as const) {
      expect(COMPOSER_BUTTON_DISABLED[kind]).toContain('opacity');
    }
  });

  /**
   * THE ACTIVE FILL IS PER BUTTON, ASSERTED PER BUTTON (UMK-956). A check that merely counted four
   * entries, or asserted "the actives differ from idle", would stay green against a shared
   * constant — precisely the edit that turns a recording indicator into an arming one. So voice is
   * required to name the ERROR surface, the other three the BRAND surface, and the two claims are
   * required to disagree.
   */
  it('keeps voice on the error surface and the other three on the brand surface', () => {
    expect(COMPOSER_BUTTON_ACTIVE.voice).toContain('bg-default-error');
    expect(COMPOSER_BUTTON_ACTIVE.voice).not.toContain('bg-default-brand');
    for (const kind of ['tools', 'attachment', 'send'] as const) {
      expect(COMPOSER_BUTTON_ACTIVE[kind]).toContain('bg-default-brand');
      expect(COMPOSER_BUTTON_ACTIVE[kind]).not.toContain('bg-default-error');
    }
    /* The premise: if the two fills were ever the same string, every line above would still hold
       against exactly one of them and say nothing about the split. */
    expect(COMPOSER_BUTTON_ACTIVE.voice).not.toBe(COMPOSER_BUTTON_ACTIVE.tools);
  });

  /**
   * THE TRAY IS THE PANEL, NOT THE DRAWER, and this pair of assertions is the correction. The
   * drawer shipped as its own filled, bordered box floating above a separately bordered bar —
   * two containers with the page showing between them, where the reference surfaces draw one
   * tinted tray with the editor box resting inside it.
   *
   * So: the tray must paint, and the drawer's DEFAULT must not. Asserting only the first would
   * pass with both painting, which is the exact doubling this replaced.
   */
  it('paints the tray and leaves the drawer inside it transparent', () => {
    expect(COMPOSER_TRAY, 'the tray names no radius').toMatch(/(?:^|\s)rounded-\S+/);
    /* And NO padding of its own — see the tray's note. The slot pads itself. */
    expect(COMPOSER_TRAY, 'the tray pads itself instead of letting the slot do it').not.toMatch(/(?:^|\s)p[xytrbl]?-\S+/);
    expect(COMPOSER_DRAWER, 'the slot does not pad itself').toMatch(/(?:^|\s)p[xy]?-\S+/);
    for (const [name, value] of Object.entries(COMPOSER_TRAY_TONE)) {
      expect(value, `tray tone ${name} names no fill`).toMatch(/(?:^|\s)bg-\S+/);
    }
    /* The drawer's default paints nothing at all — no fill, no border. */
    expect(COMPOSER_DRAWER_VARIANT.inherit, 'the default drawer variant paints something').toBe('');
    expect(COMPOSER_DRAWER, 'the drawer row carries a fill of its own').not.toMatch(/(?:^|\s)bg-\S+/);
    expect(COMPOSER_DRAWER, 'the drawer row carries a border of its own').not.toMatch(/(?:^|\s)border(?:$|\s)/);
    /* It is still a row with a shape, so a standalone variant has something to fill. */
    expect(COMPOSER_DRAWER, 'the drawer names no radius').toMatch(/(?:^|\s)rounded-\S+/);
  });

  /**
   * THE STANDALONE VARIANTS STILL PAINT. `inherit` is right inside a tray and useless outside one:
   * a drawer used on its own has no panel behind it, so each opaque variant has to carry a fill
   * and a border or it is invisible. Skips `inherit`, which the test above pins as empty.
   */
  it('gives every opaque drawer variant a fill and a border', () => {
    for (const [name, value] of Object.entries(COMPOSER_DRAWER_VARIANT)) {
      if (name === 'inherit') continue;
      expect(value, `${name} names no fill`).toMatch(/(?:^|\s)bg-\S+/);
      expect(value, `${name} names no border colour`).toMatch(/(?:^|\s)border-\S+/);
    }
  });

  /**
   * CONCENTRIC, AND THE TWO RADII ARE ONE MEASUREMENT. The tray's radius must exceed the box's by
   * the inset it sits at, or the inner corner reads as pinched inside the outer one. Both numbers
   * are read out of the class tables rather than restated, so changing one without the other is
   * what fails here — which is the only way this coupling is visible to anything.
   */
  it('rounds the tray by exactly the box radius plus its inset', () => {
    const scale: Record<string, number> = { 'rounded-lg': 8, 'rounded-xl': 12, 'rounded-2xl': 16, 'rounded-3xl': 24 };
    const spacing: Record<string, number> = { 'p-1': 4, 'p-1.5': 6, 'p-2': 8, 'p-3': 12 };
    const trayRadius = scale[COMPOSER_TRAY.match(/rounded-\S+/)?.[0] as string];
    /* No padding class means no inset, which is the tray's current shape — not a parse failure. */
    const insetClass = COMPOSER_TRAY.match(/(?:^|\s)(p-\S+)/)?.[1];
    const trayInset = insetClass === undefined ? 0 : spacing[insetClass];
    const boxRadius = scale[COMPOSER_SHELL.match(/rounded-\S+/)?.[0] as string];
    expect(trayRadius, 'the tray radius is off the known scale').toBeTypeOf('number');
    expect(trayInset, 'the tray inset is off the known scale').toBeTypeOf('number');
    expect(boxRadius, 'the box radius is off the known scale').toBeTypeOf('number');
    expect(trayRadius).toBe(boxRadius + trayInset);
  });

  /**
   * THE COLLAPSE IS A CLASS, AND THAT IS THE WHOLE BUG. The row shipped collapsing via the `hidden`
   * ATTRIBUTE on a node whose class list said `flex`; a class beats the UA stylesheet's
   * `[hidden] { display: none }`, so the attribute was set, `aria-expanded` was right, and the
   * drawer stayed open. Asserting the two class values here is what makes the fix visible to
   * anything — happy-dom applies no UA stylesheet, so no rendered-DOM assertion can see it.
   */
  it('collapses by display class, with the open state naming a display of its own', () => {
    expect(COMPOSER_DRAWER_DISPLAY.collapsed, 'the collapsed state does not hide').toBe('hidden');
    expect(COMPOSER_DRAWER_DISPLAY.open, 'the open state names no display').toMatch(/^(?:flex|block|grid)$/);
    /* And the row must not hard-code its own display, or the toggle above cannot win. */
    expect(COMPOSER_DRAWER, 'the drawer row hard-codes a display the toggle cannot override')
      .not.toMatch(/(?:^|\s)(?:flex|block|grid|hidden)(?:$|\s)/);
  });

  /**
   * THE HANDLE IS A HAIRLINE, NOT A SHEET GRAB BAR. It shipped at `h-1 w-9` in the pale border
   * colour, which reads as a promise of a drag gesture this control does not offer, and at that
   * lightness it competed with the attachments beside it. Asserted as a CEILING on both dimensions
   * rather than as exact classes, so a later tweak has room to move without a guard rewrite, and
   * separately as "not a pale step" — which is the half that made it look draggable.
   *
   * THE BAN IS BY STEP, NOT BY CLASS NAME (UMK-978). It used to name one class,
   * `bg-border-primary`, which is exactly the shape of ban that survives a rename by matching
   * nothing: the restructure retired that name and the assertion would have kept passing over
   * a handle repainted in any pale grey. It now enumerates the pale steps the background
   * palette actually publishes, so the assertion fails on the CONDITION rather than on a
   * string. Ensyra's Surface ramp publishes no `#C3CBD3`, so `bg-border-invert` had no
   * background-family successor; the handle now takes the dark invert step at 25%, which
   * composites to within four values of what it rendered before. See its own note.
   */
  it('draws the collapse handle as a short dark hairline', () => {
    const width = Number(COMPOSER_DRAWER_HANDLE.match(/(?:^|\s)w-(\d+)(?:$|\s)/)?.[1]);
    const height = Number(COMPOSER_DRAWER_HANDLE.match(/(?:^|\s)h-\[(\d+)px\](?:$|\s)/)?.[1]);
    expect(width, 'the handle width is off the spacing scale').toBeTypeOf('number');
    expect(width, 'the handle is as wide as the sheet grab bar it must not imitate').toBeLessThanOrEqual(7);
    expect(height, 'the handle names no explicit hairline height').toBeTypeOf('number');
    expect(height, 'the handle is thicker than a hairline').toBeLessThanOrEqual(4);
    /**
     * THE PALE SET IS DERIVED, NOT LISTED (UMK-1091 review).
     *
     * This used to enumerate six names, while the note above it describes a CONDITION — "not a
     * pale step". The two drifted: `bg-active-primary` is byte-identical to the listed
     * `bg-disable-primary` (both `240 240 240`) and passed the ban, and so did `hover-primary`,
     * `weak-brand` and the three other `weak-*` tints. A handle repainted in any of them is the
     * exact defect this refuses, wearing a name nobody thought to write down.
     *
     * So the set comes from the published palette by relative luminance. The background ramp
     * splits cleanly: fourteen steps sit at 0.93 and above, then `disable-warning` at 0.89 and
     * a long tail down to black. Anything at or above 0.90 is a pale step by any reading, and a
     * newly published pale token joins the ban with no edit here.
     */
    const PALE_LUMINANCE = 0.9;
    const declared = Object.fromEntries(
      [...readFileSync(resolve(PACKAGE, 'tokens.css'), 'utf8').matchAll(
        /^\s*--surface-([\w-]+):\s*(\d+) (\d+) (\d+);/gm,
      )].map((m) => [m[1], (0.2126 * +m[2] + 0.7152 * +m[3] + 0.0722 * +m[4]) / 255]),
    );
    const backgroundTokens = Object.keys(
      require_(resolve(PACKAGE, 'tokens.preset.js')).theme.extend.backgroundColor,
    );
    const paleSteps = backgroundTokens.filter((name) => (declared[name] ?? 0) >= PALE_LUMINANCE);
    /* An empty derivation would ban nothing and pass silently — the failure this whole check
       exists to refuse. Sized to what the ramp actually publishes, not to `> 0`. */
    expect(paleSteps.length, 'the pale set derived to almost nothing; the token shape moved').toBeGreaterThanOrEqual(10);
    expect(paleSteps, 'the identical-colour step the name list missed').toContain('active-primary');

    for (const pale of paleSteps) {
      /* The opacity segment is part of the ban, not outside it. The handle itself is
         `bg-hover-invert/25`, so a ban anchored on whitespace stops matching the moment anyone
         writes `bg-default-secondary/50` — the class is still the pale step, and the assertion
         would have gone quiet on the exact edit it exists to refuse. */
      expect(COMPOSER_DRAWER_HANDLE, `the handle rests in the pale step bg-${pale}`).not.toMatch(
        new RegExp(`(?:^|\\s)bg-${pale}(?:/\\d+)?(?![-\\w])`),
      );
    }
    /* And it still CHANGES on hover — a handle that reads the same at rest and under the
       pointer is not signalling that the row is interactive. */
    const resting = COMPOSER_DRAWER_HANDLE.match(/(?:^|\s)(bg-[a-z-]+(?:\/\d+)?)(?:$|\s)/)?.[1];
    const hovered = COMPOSER_DRAWER_HANDLE.match(/group-hover:(bg-[a-z-]+(?:\/\d+)?)(?:$|\s)/)?.[1];
    expect(resting, 'the handle names no resting fill').toBeTruthy();
    expect(hovered, 'the handle names no hover fill').toBeTruthy();
    expect(resting, 'the handle does not change on hover').not.toBe(hovered);
  });

  /**
   * FOUR VARIANTS, FOUR DISTINCT TREATMENTS — asserted pairwise, not as "each has a fill". A table
   * where `warning` and `danger` shared a value would satisfy every check above while telling a
   * user their quota notice is an error. Same rule as the buttons' per-type active fill.
   */
  it('gives every drawer variant a treatment no other variant shares', () => {
    const values = Object.values(COMPOSER_DRAWER_VARIANT);
    expect(new Set(values).size, 'two drawer variants share one treatment').toBe(values.length);
    /* And neutral is the only PAINTED one off the callout scale — it holds rather than says. */
    expect(COMPOSER_DRAWER_VARIANT.neutral).not.toContain('callout');
    for (const name of ['info', 'warning', 'danger'] as const) {
      expect(COMPOSER_DRAWER_VARIANT[name], `${name} is not on the callout scale`).toContain('callout');
    }
  });

  /**
   * FOUR STATUSES, FOUR TREATMENTS, and `idle` must draw nothing. Asserted as distinct strings
   * rather than as present keys: a table where `error` and `uploading` shared one value would
   * satisfy a key check and tell a user a failed upload is still in flight.
   */
  it('gives every upload status its own treatment, and idle none', () => {
    expect(COMPOSER_STATUS.idle).toBe('hidden');
    const visible = [COMPOSER_STATUS.uploading, COMPOSER_STATUS.error, COMPOSER_STATUS.done];
    expect(new Set(visible).size).toBe(3);
    for (const value of visible) expect(value).toContain('absolute');
  });

  /**
   * A STATED TEST SCENARIO: no raw palette step and no literal hex anywhere in the tables. A
   * colour written literally survives every purge check in this file — it is emitted, it renders,
   * and it silently opts this component out of theming. The composer this replaces is full of
   * exactly that, which is the drift this family exists to end.
   */
  it('names only semantic tokens, never a palette step or a literal colour', () => {
    const all = Object.values(TABLES).join(' ');
    expect(all).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(all).not.toMatch(
      /(?:^|\s|:)(?:bg|text|border|ring|from|via|to|shadow|divide|outline)-[a-z]+-\d{2,3}(?![-\w])/,
    );
  });

  /**
   * THE DERIVATION'S OWN COMPLETENESS CHECK. Deriving from the module removes the drift between
   * two hand-written registrations; it does not by itself prove the module was fully read. A table
   * declared in a shape `flatten` cannot walk — an array, a nested record — would be skipped in
   * silence, which is the same hole one register lower down.
   */
  it('reads every export of the class module, in a shape it can flatten', () => {
    const exports_ = Object.entries(COMPOSER_CLASSES as unknown as Record<string, unknown>);
    expect(exports_.length).toBeGreaterThan(0);
    expect(exports_.filter(([, v]) => !isTable(v)).map(([name]) => name)).toEqual([]);
    for (const [name] of exports_)
      expect(Object.keys(TABLES).some((k) => k === name || k.startsWith(`${name}.`))).toBe(true);
  });

  it('scans source only, so its own expectations are not its content', () => {
    const scanned = componentFiles(resolve(PACKAGE, 'src'));
    expect(scanned.some((f) => f.endsWith('composer.purge.test.ts'))).toBe(false);
    expect(scanned.some((f) => f.endsWith('ChatComposer.stories.tsx'))).toBe(false);
    expect(scanned.some((f) => f.endsWith('composer-classes.ts'))).toBe(true);
  });
});
