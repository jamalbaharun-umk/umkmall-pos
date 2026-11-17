import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * A component that portals to `document.body` cannot render INLINE on a docs page (UMK-979).
 *
 * The story view is already iframed, so a portalled overlay looks correct there and the failure
 * is invisible until someone opens the Docs tab: a docs page renders every story into one
 * document, the portal escapes its story container, and an open Dialog or Lightbox covers the
 * page title, the props table and every story beneath it. Nothing errors, the build is green,
 * and the component itself is behaving exactly as designed.
 *
 * `parameters.docs.story.inline: false` gives those stories their own iframe on the docs page —
 * the same isolation the story view has. This guard derives WHO NEEDS IT from the components
 * themselves rather than from a list someone maintains: any source file reaching for a portal
 * must have a story file that opts out of inline rendering.
 *
 * Read as TEXT rather than imported, like `story-taxonomy.test.ts` next door: importing a story
 * module would drag Radix and the DOM into a node environment for no gain, and the question here
 * is what the file says, not what it evaluates to.
 */
const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');

/** `createPortal`, or a Radix `*.Portal` element — the two forms this library actually uses. */
const PORTALS = /createPortal|<[A-Z]\w*\.Portal\b/;

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? sourceFiles(join(dir, e.name))
      : /\.tsx$/.test(e.name) && !/\.(stories|test)\.tsx$/.test(e.name)
        ? [join(dir, e.name)]
        : [],
  );

/**
 * `native/` is excluded on purpose: React Native has no `document.body` and no Storybook docs
 * page, so the failure this guard describes cannot occur there.
 */
const files = sourceFiles(SRC).filter((f) => !f.includes(`${'/'}native${'/'}`));

/** Kept as full paths: the story is the SIBLING of the file that portals, not the first file
 *  of that name anywhere in the tree. */
const portalling = files
  .filter((f) => PORTALS.test(readFileSync(f, 'utf8')))
  .map((f) => [f.split('/').pop()!.replace('.tsx', ''), f.replace(/\.tsx$/, '.stories.tsx')] as const);

/**
 * COMMENTS ARE STRIPPED BEFORE MATCHING, and this guard was written wrong once for want of it.
 * The docblock in each story file EXPLAINS `inline: false`, so a raw-text match is satisfied by
 * the prose describing the rule rather than by the code obeying it — deleting the real parameter
 * left the guard green. That is the repo's own recorded trap
 * (`docs/solutions/conventions/a-comment-can-blind-a-regex-guard-test.md`), reached here by a
 * guard whose subject is a setting its own comment has to name.
 */
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

const read = (path: string) =>
  existsSync(path) ? stripComments(readFileSync(path, 'utf8')) : undefined;

describe('a portalled component does not render inline in docs', () => {
  /* Anti-vacuity sized to a PARTIAL walk, not to zero: this library portals in four places
     today, and a walk that stopped early would still return one or two and pass every
     per-component assertion below over the ones it never saw. */
  it('found the components that portal', () => {
    expect(portalling.length).toBeGreaterThanOrEqual(4);
  });

  it.each(portalling)('%s opts its stories out of inline rendering', (component, storyPath) => {
    const story = read(storyPath);
    expect(story, `${component} portals but has no story file`).toBeDefined();
    expect(story, `${component} portals and would cover its own docs page`).toContain(
      'inline: false',
    );
  });
});
