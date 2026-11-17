/**
 * The design system's prose — one source, rendered by both platforms.
 *
 * The pages are AUTHORED as `.md` beside this file and compiled to `generated.ts` by
 * `npm run docs:build`, the same arrangement `tokens:build` uses. The web renders them through
 * Storybook's own `<Markdown>` block, so its docs look exactly as they did when these words
 * lived in `.mdx`; the native playbook renders them with its own small renderer.
 *
 * `Contributing` IS DELIBERATELY NOT HERE. It is the one page that is genuinely about the web:
 * Storybook's CSF indexer, why `meta.title` has to be a literal, how a story lands in a
 * section. Native has none of those mechanisms — its equivalent obligations are the four
 * hand-kept lists a new sibling has to move — so sharing that page would put instructions on a
 * surface where they are false. It stays a `.mdx` in `apps/design`, and this paragraph is the
 * record of why the count here is ten rather than eleven.
 */
export { DOC_PAGES, type DocPageKey } from './generated';

/**
 * Which prose page belongs to which sidebar category, so a menu can offer a category's
 * Guidelines without either platform keeping its own map.
 *
 * `Foundations` has no Guidelines page — the web sidebar opens it on `Color`, and its members
 * are documented by their own stories. An absent entry is the honest answer rather than a
 * page invented to fill the row.
 */
export const CATEGORY_DOC = {
  Form: 'FORM_GUIDELINES',
  Content: 'CONTENT_GUIDELINES',
  Navigation: 'NAVIGATION_GUIDELINES',
  Feedback: 'FEEDBACK_GUIDELINES',
  Overlays: 'OVERLAYS_GUIDELINES',
  Shell: 'SHELL_GUIDELINES',
  Chat: 'CHAT_GUIDELINES',
} as const;

/** The pages that stand alone, in the order the web sidebar leads with. */
export const TOP_LEVEL_DOCS = [
  { key: 'GETTING_STARTED', title: 'Getting Started' },
  { key: 'GUIDELINES', title: 'Guidelines' },
  { key: 'PATTERNS', title: 'Patterns' },
] as const;
