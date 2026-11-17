import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { contract, storyTitle, type ComponentCategory, type ComponentName } from './variants';

/**
 * The sidebar taxonomy, asserted from the contract (UMK-979 R3/R4/R5).
 *
 * Storybook's CSF indexer extracts `title` by STATIC ANALYSIS, without executing the module,
 * so a computed title is not read — the story silently falls back to path-derived
 * autotitling and lands in a section nobody chose. That is why every title below is a
 * hand-written literal and this guard computes what it should have been. The literal is the
 * thing that can be wrong; the expectation is derived, which is what makes the guard capable
 * of failing (KTD3).
 *
 * It reads the story files as TEXT rather than importing them. Importing would read the
 * evaluated `title`, which is the same string either way — it cannot tell a literal from an
 * expression, and the expression is the failure this exists to catch.
 *
 * TWO QUOTE STYLES. `AppShell.stories.tsx` writes its title in DOUBLE quotes and is the only
 * file that does; a sweep keyed on `title: '` skips it in silence, which cost real time
 * during this ticket's research. The pattern below accepts either and rejects anything that
 * is not a plain string.
 *
 * SCOPE: this guard lives in `packages/ui` and reads only `packages/ui` sources, so turbo's
 * per-package `test` hash actually covers what it asserts (UMK-852).
 */
const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * `Foundations` is a TOP-LEVEL section beside `Components`, not one of the seven categories
 * under it — so its members are titled `Foundations/<Name>` rather than
 * `Components/Foundations/<Name>` (KTD2).
 */
/**
 * The story files with no contract entry, excluded BY NAME rather than by a rule that would also
 * swallow the next omission.
 *
 * `Foundation` is a token page, not a component: it has no props and no axes, so there is nothing
 * for a contract entry to say about it. `TemanaiChat` is the opposite kind of exception — it
 * documents no single component because it composes twenty of them into the product's own chat
 * room, which is the one thing no per-component story can show. Neither is a component, so
 * neither can have a contract entry, and both would otherwise redden the one-to-one check below.
 */
const NOT_A_COMPONENT = ['Foundation.stories.tsx', 'TemanaiChat.stories.tsx'];

/**
 * BOTH extensions, matching `apps/design/.storybook/main.ts`'s
 * `*.stories.@(ts|tsx)` glob. Walking only `.tsx` would leave a `.stories.ts` file indexed by
 * Storybook and invisible to every assertion below — it would autotitle into a section nobody
 * chose while this guard reported a clean one-to-one correspondence.
 */
const isStory = (name: string) => name.endsWith('.stories.tsx') || name.endsWith('.stories.ts');

const storyFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? storyFiles(join(dir, e.name)) : isStory(e.name) ? [join(dir, e.name)] : [],
  );

const files = storyFiles(SRC);
const componentOf = (file: string) => file.split('/').pop()!.replace(/\.stories\.tsx?$/, '');
const componentFiles = files.filter((f) => !NOT_A_COMPONENT.includes(f.split('/').pop()!));

/** Accepts either quote style; a computed title matches nothing and reads as absent. */
const literalTitle = (file: string): string | undefined =>
  readFileSync(file, 'utf8').match(/^\s*title:\s*(['"])(.*?)\1\s*,/m)?.[2];

describe('the story set and the contract are one taxonomy', () => {
  /* Anti-vacuity, sized to what a PARTIAL failure leaves behind rather than to zero: a walk
     that stops at the first subdirectory still returns a handful of files, and every
     per-file assertion below would pass over the ones it never saw (UMK-958). 43 is the
     count today; the floor is the contract's own size, so it moves with the library instead
     of going stale. */
  it('actually found the story files', () => {
    /* The web-built entries only: a `declared` entry has no story (see below). */
    expect(files.length).toBeGreaterThanOrEqual(Object.values(contract).filter((e) => e.status === 'implemented').length);
  });

  /* Every WEB-BUILT entry. A `declared` entry has no web component yet — the native-ui-v2 entries
     (`Avatar`, `ListGroup`) never will, because the web does not follow that identity — so
     there is nothing for a Storybook story to render. Filtered on `status`, never on a name list,
     and in BOTH directions: a story for a declared entry reds here just as a missing one does. */
  it('gives every web-built contract entry exactly one story file', () => {
    const named = componentFiles.map(componentOf).sort();
    const built = Object.entries(contract)
      .filter(([, entry]) => entry.status === 'implemented')
      .map(([name]) => name)
      .sort();
    expect(named).toEqual(built);
  });

  it.each(componentFiles.map((f) => [componentOf(f), f]))(
    '%s carries the title its category derives',
    (name, file) => {
      expect(literalTitle(file), `${name} has no static string title`).toBe(
        storyTitle(name as ComponentName),
      );
    },
  );

  it('titles the token page as the Foundations section itself', () => {
    const foundation = files.find((f) => f.endsWith('Foundation.stories.tsx'))!;
    expect(literalTitle(foundation)).toBe('Foundations');
  });

  /**
   * AND THE EXAMPLE PAGE, WHICH THE PER-COMPONENT CHECK ABOVE CANNOT REACH.
   *
   * `NOT_A_COMPONENT` excludes a file from the derived-title loop because there is no contract
   * entry to derive from — which leaves its title asserted by nothing at all unless something
   * like this says so. That is the whole failure this guard exists for: a computed or misspelled
   * title is never read, Storybook autotitles from the path, and the page lands in a section
   * nobody chose with no error anywhere. The token page has always had its own line above; this
   * is the second file to need one, and the pairing is the reminder that a THIRD exclusion owes
   * one too.
   *
   * The section name is also what `apps/design/.storybook/preview.ts` orders by, so the literal
   * here and the entry in that list are one decision written in two places.
   */
  it('titles the example page as its own section', () => {
    const example = files.find((f) => f.endsWith('TemanaiChat.stories.tsx'))!;
    expect(literalTitle(example)).toBe('Examples/TemanAI chat');
  });

  /**
   * EVERY EXCLUSION IS SPOKEN FOR. The two assertions above name their files; this one refuses to
   * let the list grow past them silently, because the cost of a quiet third entry is a story file
   * with no title assertion and no contract entry — invisible to every check in this file.
   */
  it('asserts a title for each file the derived check excludes', () => {
    expect(NOT_A_COMPONENT.slice().sort()).toEqual(
      ['Foundation.stories.tsx', 'TemanaiChat.stories.tsx'],
    );
  });

  it('puts every component in one of the eight declared categories', () => {
    /* Not a count: a category losing its last member is a section that renders empty, and
       the sidebar has no way to say so. Assert each one is non-empty by name. */
    const categories: ComponentCategory[] = [
      'Foundations',
      'Form',
      'Content',
      'Navigation',
      'Feedback',
      'Overlays',
      'Shell',
      'Chat',
    ];
    for (const category of categories) {
      const members = Object.values(contract).filter((e) => e.category === category);
      expect(members.length, `${category} has no components`).toBeGreaterThan(0);
    }
    expect(
      Object.values(contract).filter((e) => !categories.includes(e.category)),
    ).toEqual([]);
  });
});
