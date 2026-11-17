/**
 * THE NATIVE CHAT COMPONENTS ACCEPT WHAT THE WEB ONES GAINED IN UMK-1041 AND UMK-1373, AND USE IT
 * (UMK-1371).
 *
 * Ten contract entries were `partial` because the web siblings gained props and two axes that
 * native did not have. `contract/native-parity.test.ts` sees the AXES — `size` on the four
 * composer buttons and on `ChatAttachment` — and, since this ticket, reds on a prop still
 * recorded as missing after native declares it. What it cannot see is the half that actually
 * matters to a screen:
 *
 * - a prop DECLARED AND DROPPED. `raised?: boolean` on the interface with nothing reading it
 *   compiles, satisfies the parity guard, and renders the default — which is the exact failure
 *   the `native` field exists to prevent, moved one line down;
 * - a wrapper typing its `size` off a SIBLING's entry (the hole `composer-state.test.ts` closes
 *   for `state`);
 * - a style table whose numbers stopped being the web's.
 *
 * SOURCE-SCANNED, not rendered: `react-native` does not load under vitest (its entry is Flow).
 * The two style modules import nothing from it at runtime, so they ARE imported and compared
 * against the web's real class tables — two sources, not one read back.
 * Sited in `packages/ui` for the turbo-cache reason every guard in this folder gives.
 * See docs/solutions/conventions/a-guard-test-only-guards-its-own-package.md
 *
 * WHAT THIS CANNOT SEE. A pixel, a colour that resolves and is wrong, or behaviour: that
 * `resetKey` really re-pins, that the drilled menu level really steps back. Those need a device
 * or the mobile Jest suite; the playbook specimens are their first render.
 *
 * PROVED RED, one injection each (`vitest run src/native/__tests__/web-chat-props.test.ts`):
 *
 * | Injection | Reds |
 * | -- | -- |
 * | `inputMode={inputMode}` removed from `ChatComposerInput`'s `TextInput` | 1 — editor hints reach the input |
 * | `raised && COMPOSER_RAISED` removed from `ChatComposer`'s box | 1 — shell forwards |
 * | `[resetKey, engage, settle]` → `[engage, settle]` in `ChatThread` | 1 — resetKey is read |
 * | `danger ? MENU_ITEM_DANGER_PRESSED : MENU_ITEM_PRESSED` → `MENU_ITEM_PRESSED` | 1 — menu rows |
 * | `copyable && onCopy` → `onCopy` in `CodeBlock` | 1 — code block |
 * | `ChatVoiceButton.tsx` types `Axes` off `contract.ChatToolsButton.axes` | 1 — voice reads its own entry |
 * | `size={size}` removed from `ChatSendButton` | 1 — send hands size down |
 * | `COMPOSER_BUTTON_SIZE.landing` to `measure['2-5']` (40) | 1 — button box matches the web |
 * | `variant === 'tile' ?` arm deleted from `ChatAttachment` | 1 — tile has its own arm |
 * | `'compressing'` dropped from `COMPOSER_STATUS` | 1 — status table |
 * | `|| status === 'compressing'` deleted from `busy` in `ChatAttachment` | 1 — status table |
 * | `status === 'done' ? 'check' : 'alert-triangle'` → `'alert-triangle'` | 1 — status table |
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contract } from '../../contract';
import * as WEB from '../../primitives/composer-classes';
import * as NATIVE from '../composer-styles';

const NATIVE_DIR = resolve(__dirname, '..');

/**
 * Comments stripped, line comments FIRST — a line comment may hold the two characters that open
 * a block comment, and stripping blocks first lets that swallow the file to the next close.
 * See docs/solutions/conventions/a-comment-can-blind-a-regex-guard-test.md
 */
const code = (src: string) => src.replace(/(^|[^:])\/\/.*$/gm, '$1').replace(/\/\*[\s\S]*?\*\//g, '');
const read = (file: string) => code(readFileSync(resolve(NATIVE_DIR, file), 'utf8'));

/** Tailwind's `h-N` as points: its spacing unit is 4. */
const px = (cls: string) => Number(/\bh-(\d+)\b/.exec(cls)?.[1]) * 4;

describe('the editor', () => {
  const input = read('ChatComposerInput.tsx');
  const shell = read('ChatComposer.tsx');

  it('hands every soft-keyboard hint to the TextInput under the web name', () => {
    for (const hint of ['inputMode', 'enterKeyHint', 'autoCapitalize', 'spellCheck']) {
      expect(input, `${hint} is not declared`).toMatch(new RegExp(`\\b${hint}\\?: TextInputProps\\['${hint}'\\]`));
      expect(input, `${hint} is declared and never reaches the input`).toContain(`${hint}={${hint}}`);
    }
  });

  it('renders the editor overlay inside the editor box', () => {
    expect(input).toMatch(/\boverlay\?: React\.ReactNode/);
    expect(input).toMatch(/\{overlay\}\s*<\/View>\s*\);/);
  });

  it('forwards each shell prop to the input, and reads `raised`', () => {
    const forwards = {
      editorOverlay: 'overlay',
      editorInputMode: 'inputMode',
      editorEnterKeyHint: 'enterKeyHint',
      editorAutoCapitalize: 'autoCapitalize',
      editorSpellCheck: 'spellCheck',
      /* The native spelling of the web's `editorClassName` — `style` for `className`. */
      editorStyle: 'inputStyle',
    };
    for (const [shellProp, inputProp] of Object.entries(forwards)) {
      expect(shell, `${shellProp} is not declared`).toMatch(new RegExp(`\\b${shellProp}\\?:`));
      expect(shell, `${shellProp} is declared and dropped`).toContain(`${inputProp}={${shellProp}}`);
    }
    expect(input).toMatch(/\binputStyle,\s*\]\}/);
    expect(shell).toMatch(/\braised\?: boolean/);
    expect(shell).toContain('raised && COMPOSER_RAISED');
  });
});

describe('the thread', () => {
  const thread = read('ChatThread.tsx');

  it('reads resetKey both where it forgets and where it re-pins', () => {
    expect(thread).toMatch(/\bresetKey\?: string \| number/);
    /* The refs, during render — before the list's own effects report the new tail. */
    expect(thread).toContain('conversation.current !== resetKey');
    /* The visible half: the effect is keyed on it. */
    expect(thread).toMatch(/\}, \[resetKey, engage, settle\]\);/);
  });
});

describe('the menu', () => {
  const menu = read('Menu.tsx');

  it('draws a separator, a destructive row and a second level', () => {
    for (const field of ['items?: readonly MenuItem[]', 'onOpenChange?: (open: boolean) => void', 'drillIn?: boolean', 'backLabel?: string', 'separator?: boolean', 'danger?: boolean']) {
      expect(menu, `MenuItem lost \`${field}\``).toContain(field);
    }
    expect(menu).toContain('MENU_SEPARATOR[variant]');
    expect(menu).toContain('danger ? MENU_ITEM_DANGER_PRESSED : MENU_ITEM_PRESSED');
    expect(menu).toMatch(/color=\{danger \? 'error'/);
    /* The level opens from a row of the menu's own list, and reports it both ways. */
    expect(menu).toContain('item.items !== undefined && drilled === null');
    expect(menu).toContain('item?.onOpenChange?.(true)');
    /* The leave is keyed on what is SHOWING — sheet open and a row drilled — so a controlled
       host closing the sheet reports it too. Behaviour: apps/mobile's menu-second-level test. */
    expect(menu).toContain('const showing = isOpen ? drilled : null');
    expect(menu).toContain('left.onOpenChange?.(false)');
    /* The level is held by id and resolved from `items` each render, never a row snapshot. */
    expect(menu).toMatch(/useState<string \| null>\(null\)/);
    expect(menu).toMatch(/drilled\.backLabel \?\? 'Kembali'/);
  });
});

describe('the code block', () => {
  const block = read('CodeBlock.tsx');

  it('places actions in the bar, lets copy be removed, and draws a diagram as given', () => {
    expect(block).toMatch(/\bactions\?: React\.ReactNode/);
    expect(block).toMatch(/<View style=\{CODE_BLOCK_ACTIONS\}>\s*\{actions\}/);
    expect(block).toMatch(/\bcopyable\?: boolean/);
    expect(block).toContain('copyable && onCopy !== undefined');
    expect(block).toMatch(/diagram: true;/);
    expect(block).toMatch(/\{diagram \? \(\s*<View style=\{\[CODE_BLOCK_BODY, padding\]\}>\{children\}<\/View>/);
  });
});

describe('the composer buttons', () => {
  const BUTTONS = ['ChatToolsButton', 'ChatAttachmentButton', 'ChatVoiceButton', 'ChatSendButton'] as const;
  const base = read('composer-button.tsx');

  it('covers every entry in the family that declares the size axis', () => {
    const declared = Object.entries(contract)
      .filter(([name, entry]) => /^Chat.*Button$/.test(name) && 'size' in entry.axes && entry.family === 'composer')
      .map(([name]) => name);
    expect([...declared].sort()).toEqual([...BUTTONS].sort());
  });

  it.each(BUTTONS)('%s types size off its OWN entry', (name) => {
    const source = read(`${name}.tsx`);
    expect(source).toContain(`type Axes = typeof contract.${name}.axes;`);
    expect(source).toMatch(/\bsize\?: Axes\['size'\]\[number\]/);
  });

  it('sizes the box and the glyph from the axis in the shared base', () => {
    expect(base).toContain('COMPOSER_BUTTON_SIZE[size]');
    expect(base).toContain('glyphSizeFor(name, size)');
  });

  it('hands size down from send, the one wrapper that destructures its props', () => {
    expect(read('ChatSendButton.tsx')).toMatch(/<ComposerButton\s*\{\.\.\.props\}\s*size=\{size\}/);
  });

  it('draws the tools badge', () => {
    expect(read('ChatToolsButton.tsx')).toMatch(/\bbadge\?: boolean/);
    expect(base).toMatch(/\{badge && <View [^>]*style=\{COMPOSER_BUTTON_BADGE\}/);
  });

  it('draws the box at the web sizes', () => {
    const size = contract.ChatToolsButton.axes.size;
    expect(Object.keys(NATIVE.COMPOSER_BUTTON_SIZE)).toEqual([...size]);
    for (const value of size) {
      const box = { ...NATIVE.COMPOSER_BUTTON_BASE, ...NATIVE.COMPOSER_BUTTON_SIZE[value] };
      expect(box.width, `${value} width`).toBe(px(WEB.COMPOSER_BUTTON_SIZE[value]));
      expect(box.height, `${value} height`).toBe(px(WEB.COMPOSER_BUTTON_SIZE[value]));
    }
  });
});

describe('the attachment', () => {
  const attachment = read('ChatAttachment.tsx');

  it('reads the size axis for the box and the caption', () => {
    expect(attachment).toMatch(/Axes\['size'\]\[number\]/);
    expect(attachment).toContain('const box = COMPOSER_PREVIEW_SIZE[size];');
    expect(attachment).toContain('[COMPOSER_PREVIEW, box]');
    expect(attachment).toContain('[COMPOSER_FILE_TILE, box]');
    expect(attachment).toContain('width: box.width');
  });

  it('draws the box at the web sizes', () => {
    const size = contract.ChatAttachment.axes.size;
    expect(Object.keys(NATIVE.COMPOSER_PREVIEW_SIZE)).toEqual([...size]);
    for (const value of size) {
      expect(NATIVE.COMPOSER_PREVIEW_SIZE[value].width, value).toBe(px(WEB.COMPOSER_PREVIEW_SIZE[value]));
      expect(NATIVE.COMPOSER_PREVIEW_SIZE[value].height, value).toBe(px(WEB.COMPOSER_PREVIEW_SIZE[value]));
    }
  });

  /**
   * `variant` is typed off the contract, so a value with no arm compiles and falls into the last
   * one. Every value but the final fallback must be tested by name.
   */
  it('gives every variant but the image its own arm', () => {
    const [fallback, ...named] = contract.ChatAttachment.axes.variant;
    expect(fallback).toBe('image');
    for (const value of named) {
      expect(attachment, `variant="${value}" has no arm and draws the image`).toContain(`variant === '${value}' ?`);
    }
    expect(attachment).toContain("icon ?? 'file-generic'");
  });

  it('draws every status but idle, with the host words under the glyph', () => {
    const drawn = ['compressing', 'uploading', 'error', 'done'];
    expect(Object.keys(NATIVE.COMPOSER_STATUS).sort()).toEqual([...drawn].sort());
    expect(Object.keys(WEB.COMPOSER_STATUS).sort()).toEqual(['idle', ...drawn].sort());
    expect(attachment).toMatch(/status !== 'idle' && \(\s*<View pointerEvents="none" style=\{COMPOSER_STATUS\[status\]\}>/);

    /* Which glyph each status draws, read at the sites that DECIDE it. Looking for the status
       names anywhere in the file is satisfied by the `ChatAttachmentStatus` union alone: with
       `|| status === 'compressing'` deleted from `busy`, a compressing file draws the error
       triangle and that scan stayed green. So the union is cut out first, and the cut has to
       have found it. */
    const reads = attachment.replace(/export type ChatAttachmentStatus\s*=[^;]*;/, '');
    expect(reads, 'the ChatAttachmentStatus union was not found to cut').not.toBe(attachment);
    const busy = /\bconst busy = ([^;]+);/.exec(reads)?.[1] ?? '';
    for (const status of ['compressing', 'uploading']) {
      expect(busy, `status="${status}" does not draw the spinner`).toContain(`status === '${status}'`);
    }
    expect(busy.split('||'), 'only the two in-flight statuses spin').toHaveLength(2);
    expect(reads).toMatch(/\{busy \? \(\s*<Spinner /);
    /* `done` has its own glyph and `error` is the fallback of the same expression. */
    expect(reads).toContain("status === 'done' ? 'check' : 'alert-triangle'");
    expect(attachment).toMatch(/statusLabel !== undefined && status !== 'done'/);
  });

  it('makes the preview a button and prints the caption outside the anchor', () => {
    expect(attachment).toContain('onPress={onPreview}');
    expect(attachment).toMatch(/caption !== undefined && variant !== 'file'/);
  });
});
