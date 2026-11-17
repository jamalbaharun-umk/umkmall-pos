import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as ChatComposerStories from './ChatComposer/ChatComposer.stories';
import * as ChatComposerInputStories from './ChatComposer/ChatComposerInput.stories';
import * as ChatDrawerStories from './ChatComposer/ChatDrawer.stories';
import * as ChatAttachmentStories from './ChatComposer/ChatAttachment.stories';
import * as ChatToolsButtonStories from './ChatComposer/ChatToolsButton.stories';
import * as ChatAttachmentButtonStories from './ChatComposer/ChatAttachmentButton.stories';
import * as ChatVoiceButtonStories from './ChatComposer/ChatVoiceButton.stories';
import * as ChatSendButtonStories from './ChatComposer/ChatSendButton.stories';
import * as ChatSoundWaveStories from './ChatComposer/ChatSoundWave.stories';
import * as ChatVoiceBarStories from './ChatComposer/ChatVoiceBar.stories';
import {
  ChatAttachment,
  ChatAttachmentButton,
  ChatComposer,
  ChatComposerInput,
  ChatDrawer,
  ChatSendButton,
  ChatToolsButton,
  ChatVoiceBar,
  ChatVoiceButton,
  type ChatComposerProps,
  type ChatSendState,
} from './ChatComposer';
import { Icon, type IconName } from './Icon';
import { contract, storyTitle, type ComponentName } from '../contract';

/**
 * The chat composer family's behaviour guard.
 *
 * ONE PAIR FOR EIGHT COMPONENTS — the shell, the editor, the drawer, the attachment and the four
 * buttons all claim
 * `family: 'composer'`, and this file plus `composer.purge.test.ts` are the whole of their
 * coverage. The family key is what makes that legitimate rather than a gap: the reconciliation
 * below asserts against every entry claiming the family, so a component added to the contract with
 * no coverage here reddens by name.
 *
 * WHAT IT IS FOR, in order of how quietly each would fail:
 *
 *  - **A CONTROLLED COMPONENT DEMOED WITH A DEAD HANDLER.** The shell renders the `value` it is
 *    given. The stories used to pass `value: ''` with a no-op `onValueChange`, so nobody could type
 *    into any story — and the old guard asserted the callback FIRED, which a no-op satisfies. The
 *    round-trip test below is the one that would have caught it.
 *  - **THE SLOTS LANDING IN THE WRONG BOX.** Three sit INSIDE boxes the components own, and a slot
 *    rendered in the right document but the wrong parent looks fine in a story and is useless to a
 *    host: an upload overlay over the attachment AREA rather than over one chip cannot say which
 *    file failed. So each is asserted by CONTAINMENT, not by presence.
 *  - **THE `Image` TRAP.** The library's image primitive refuses any source that is not remote
 *    https, so a local blob preview would render as placeholder text — every preview a composer
 *    shows is local. `Lightbox` hit this exact trap.
 *  - **THE TWO DRAWINGS COLLAPSING INTO ONE.** Desktop and mobile differ in nine measurements, and
 *    a `variant` prop quietly ignored draws the desktop shell on a phone with nothing failing.
 *
 * Importing the story module also pulls it into the typecheck program: `tsconfig` excludes every
 * stories file, so a story imported by a test is the only way one is checked at all.
 */

type AnyStory = { args?: Record<string, unknown>; render?: (a: never, b: never) => React.ReactElement };
type AnyModule = {
  default: {
    component: React.ElementType;
    args?: Record<string, unknown>;
    render?: (a: never, b: never) => React.ReactElement;
  };
} & Record<string, unknown>;

/**
 * Resolve a story the way STORYBOOK does: the story's own `render`, else the META's, else the
 * component with the merged args.
 *
 * THE META FALLBACK IS NOT A DETAIL. The copies of this helper in the other family guards check
 * only `story.render`, so a meta-level `render` — which is how this set injects the stateful
 * wrapper every story needs — was skipped, and each story was mounted as a bare component with no
 * `value` at all. That is a guard rendering something Storybook never shows, which is the same
 * class of defect as reading source that is not source.
 */
const element = (mod: AnyModule, story: AnyStory): React.ReactElement => {
  const args = { ...(mod.default.args ?? {}), ...(story.args ?? {}) };
  const render = story.render ?? mod.default.render;
  if (typeof render === 'function') return render(args as never, {} as never);
  const Component = mod.default.component;
  return <Component {...args} />;
};

const stories = (mod: AnyModule) =>
  Object.entries(mod).filter(([n, s]) => n !== 'default' && s && typeof s === 'object');

/**
 * ONE STORY SET PER COMPONENT, keyed by its CONTRACT name.
 *
 * Every part of the composer is exported and usable on its own, so each gets its own set rather
 * than living inside a composite of the shell's — a reader looking for the send button's disabled
 * treatment should find it under that button. The keyset is reconciled against the contract below,
 * so a component that gains an entry without a story set, or loses its set, reddens by name; a
 * count could not say which one went.
 */
const MODULES = {
  ChatComposer: ChatComposerStories,
  ChatComposerInput: ChatComposerInputStories,
  ChatDrawer: ChatDrawerStories,
  ChatAttachment: ChatAttachmentStories,
  ChatToolsButton: ChatToolsButtonStories,
  ChatAttachmentButton: ChatAttachmentButtonStories,
  ChatVoiceButton: ChatVoiceButtonStories,
  ChatSendButton: ChatSendButtonStories,
  ChatSoundWave: ChatSoundWaveStories,
  ChatVoiceBar: ChatVoiceBarStories,
};

const contractFamilyMembers = (family: string): string[] =>
  Object.entries(contract)
    .filter(([, entry]) => (entry as { family?: string }).family === family)
    .map(([name]) => name)
    .sort();

const BASE: ChatComposerProps = {
  value: '',
  onValueChange: () => {},
  editorLabel: 'Tulis pesan',
  placeholder: 'Tanyakan bisnismu...',
};

/** The composition the docs describe, used wherever a story-shaped shell is needed. */
const TOOLS = (
  <>
    <ChatToolsButton label="Alat" />
    <ChatAttachmentButton label="Lampirkan file" />
  </>
);
const SEND = (
  <>
    <ChatVoiceButton label="Input suara" />
    <ChatSendButton label="Kirim pesan" />
  </>
);

const mount = (props: Partial<ChatComposerProps> = {}) => {
  cleanup();
  return render(<ChatComposer {...BASE} {...props} />);
};

const BLOB = 'blob:http://localhost/9f2c-4a11';
const editor = () => screen.getByRole('textbox') as HTMLTextAreaElement;
/*
  THE BORDERED BOX, BY NAME. This read `[class*="rounded-"]` — the first rounded element — until
  the tray wrapped the box in a second rounded element and quietly became the match. Every
  assertion below about "the shell" then described the tray, including the one asserting the header
  sits outside the focus band, which the tray trivially satisfies because it has no focus band.
*/
const shell = (c: HTMLElement) => c.querySelector('[data-testid="chat-composer-box"]') as HTMLElement;

/** The tinted panel around it, present only when a slot is filled. */
const tray = (c: HTMLElement) => c.querySelector('[data-tray]') as HTMLElement | null;

/**
 * Each component's source, READ FROM DISK with its prose stripped.
 *
 * `Component.toString()` was the obvious way to write this and is why this helper exists:
 * `React.forwardRef` returns an OBJECT, so that call yields `"[object Object]"` and every
 * `not.toMatch` over it passes whatever the component does. Comments are stripped because the
 * claims below are about what the code DOES, and these docblocks name the product surfaces the
 * components deliberately do not own.
 */
const codeOf = (relative: string): string => {
  const source = readFileSync(resolve(__dirname, relative), 'utf8');
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
  expect(code.length, `${relative}: the comment strip left no code`).toBeGreaterThan(source.length / 4);
  return code;
};

/** The glyph a button draws, as its rendered path data — see `codeOf` for why not by name. */
const drawingOf = (el: HTMLElement) => el.querySelector('svg')?.innerHTML ?? '';
const expectedGlyph = (name: IconName): string => {
  cleanup();
  const { container } = render(<Icon name={name} />);
  return container.querySelector('svg')?.innerHTML ?? '';
};

describe('the composer family is fully covered', () => {
  /**
   * THE CONTRACT DECIDES WHO BELONGS HERE, not a number this file keeps about itself. Add a
   * component to the family, forget its story set, and a count would simply be one shorter and
   * still equal itself. Reconciling the keyset is the check a count only looked like.
   */
  it('has a story set for every component the contract puts in this family', () => {
    expect(Object.keys(MODULES).sort()).toEqual(contractFamilyMembers('composer'));
  });

  /**
   * NESTED UNDER ONE FOLDER, which is the first nesting in this package and deliberate: eight
   * siblings flat in `Components` bury every other primitive between them. The leaf keeps the
   * EXPORT name rather than being shortened to `Chat/Composer` — a reader searching Storybook for
   * the symbol they are about to import should find it — so the mild repetition is the price.
   */
  it('files every story set under the Chat folder, named for its export', () => {
    for (const [name, mod] of Object.entries(MODULES)) {
      expect((mod as unknown as AnyModule).default.title).toBe(storyTitle(name as ComponentName));
    }
  });

  /* The mount-everything assertions have to have something to mount: a set that lost its stories
     would otherwise make every loop below pass by never running — a guard measuring itself. This
     is a floor, NOT the coverage check; see the state sweep below for why a count is not one. */
  it('gives every component more than one story', () => {
    for (const [name, mod] of Object.entries(MODULES)) {
      expect(stories(mod as unknown as AnyModule).length, `${name} has too few stories`).toBeGreaterThan(1);
    }
  });

  /** `landing` is 36px and `compact` 32px, read off what each set renders rather than its name. */
  it('draws the landing size at 36px and the default at 32px for every button', () => {
    for (const name of ['ChatToolsButton', 'ChatAttachmentButton', 'ChatVoiceButton', 'ChatSendButton'] as const) {
      const mod = MODULES[name] as unknown as AnyModule;
      const sizes = new Set<string>();
      for (const [, story] of stories(mod)) {
        cleanup();
        render(element(mod, story as AnyStory));
        for (const button of screen.queryAllByRole('button')) {
          if (/\bh-9 w-9\b/.test(button.className)) sizes.add('landing');
          if (/\bh-8 w-8\b/.test(button.className)) sizes.add('compact');
        }
      }
      expect([...sizes].sort(), `${name} does not demonstrate both sizes`).toEqual(['compact', 'landing']);
    }
  });

  /**
   * EVERY STATE THE CONTRACT DECLARES IS DEMONSTRATED SOMEWHERE IN THAT COMPONENT'S SET — by what
   * the stories RENDER, not by what they are called.
   *
   * The count above cannot do this job: deleting a button's `Active` story leaves three others and
   * a green suite, which is the "pin by name, not by count" rule this repo already records. Nor
   * would story names work — they are prose. So each button's set is mounted in full and the
   * rendered treatments are collected: a set that never draws the active fill fails naming the
   * component, whichever story went missing.
   */
  it('demonstrates every declared state of every button somewhere in its own set', () => {
    /**
     * SEND IS NO LONGER THE EXCEPTION, and that is the point of the axis. This used to record it
     * as un-sweepable — resting and "active" were the same fill, so no rendered difference existed
     * to find — which was an honest note about a boolean that could not say anything. `stop` takes
     * the error fill, so it is now as distinguishable as the other three, and its own sweep below
     * covers all three states by name.
     */
    /*
      THE FILL EACH BUTTON RESTS ON IS PART OF THE RULE, because send rests FILLED. The sweep read
      "carries a brand or error fill" as "is in its engaged state", which is right for the three
      outlined buttons and exactly backwards for send: its resting state is the brand fill, so a
      story showing plain send was being counted as engaged and its resting state as never shown.
    */
    const BUTTONS = {
      ChatToolsButton: { resting: /bg-default-primary/, engaged: /bg-default-(brand|error)/ },
      ChatAttachmentButton: { resting: /bg-default-primary/, engaged: /bg-default-(brand|error)/ },
      ChatVoiceButton: { resting: /bg-default-primary/, engaged: /bg-default-(brand|error)/ },
      ChatSendButton: { resting: /bg-default-brand/, engaged: /bg-default-error/ },
    } as const;

    for (const [name, { resting: restingFill, engaged: engagedFill }] of Object.entries(BUTTONS)) {
      const mod = MODULES[name as keyof typeof MODULES] as unknown as AnyModule;
      const seen = { resting: false, active: false, disabled: false };

      for (const [, story] of stories(mod)) {
        cleanup();
        render(element(mod, story as AnyStory));
        for (const button of screen.queryAllByRole('button')) {
          if ((button as HTMLButtonElement).disabled) {
            seen.disabled = true;
            continue;
          }
          /* Read off the class the table actually applies, so a story that merely SAYS it is
             engaged proves nothing. Each button declares both fills above, because "filled" means
             opposite things for the outlined three and for send. */
          if (engagedFill.test(button.className)) seen.active = true;
          else if (restingFill.test(button.className)) seen.resting = true;
        }
      }

      expect(seen.resting, `${name} never demonstrates its resting state`).toBe(true);
      expect(seen.disabled, `${name} never demonstrates its disabled state`).toBe(true);
      {
        expect(seen.active, `${name} never demonstrates its active state`).toBe(true);
      }
    }
  });

  it('renders every exported story of every component without throwing', () => {
    for (const [name, module_] of Object.entries(MODULES)) {
      const mod = module_ as unknown as AnyModule;
      for (const [story, def] of stories(mod)) {
        cleanup();
        expect(() => render(element(mod, def as AnyStory)), `${name}/${story} threw`).not.toThrow();
      }
    }
  });
});

describe('the editor is actually usable (the defect the old guard missed)', () => {
  /**
   * THE ROUND TRIP, not the callback. `ChatComposer` is controlled, so "the handler fired" is
   * satisfied by a no-op that never updates the value — which is exactly what every story passed,
   * leaving the editor pinned to empty and untypeable. Asserting the value COMES BACK is the only
   * form that can tell the difference.
   */
  it('shows what the user typed when the host stores it', () => {
    function Host() {
      const [value, setValue] = React.useState('');
      return <ChatComposer {...BASE} value={value} onValueChange={setValue} />;
    }
    cleanup();
    render(<Host />);

    fireEvent.change(editor(), { target: { value: 'halo dunia' } });
    expect(editor().value).toBe('halo dunia');
  });

  /**
   * EVERY STORY THAT RENDERS AN EDITOR IS WIRED THAT WAY, across both sets that have one, so
   * Storybook is a real demo rather than a screenshot. Swept rather than spot-checked because the
   * defect was in `meta.args` — one place, inherited by every story at once.
   */
  it('every story with an editor lets a person type into it', () => {
    let typed = 0;
    for (const [component, module_] of Object.entries(MODULES)) {
      const mod = module_ as unknown as AnyModule;
      for (const [name, story] of stories(mod)) {
        cleanup();
        render(element(mod, story as AnyStory));
        const boxes = screen.queryAllByRole('textbox') as HTMLTextAreaElement[];
        if (boxes.length === 0 || boxes[0].disabled) continue;
        const text = `mengetik di ${name}`;
        fireEvent.change(boxes[0], { target: { value: text } });
        expect(boxes[0].value, `${component}/${name} ignores what the user types`).toBe(text);
        typed += 1;
      }
    }
    /* The sweep must have found editors to type into, or it passes by skipping everything. */
    expect(typed, 'no story rendered an editor at all').toBeGreaterThan(5);
  });

  /**
   * THE SAME DEFECT, ON THE OTHER CONTROL. `onDismiss` is a callback the host acts on — the drawer
   * never unmounts itself — so "the handler fired" is satisfied by a no-op, and every dismiss story
   * passed exactly that. The X rendered, the click registered, and nothing went away.
   *
   * Swept over every story that shows a dismiss control, and asserting the drawer LEAVES rather
   * than that the callback ran, because only the round trip can tell a wired story from a dead one.
   */
  it('every story with a dismiss control actually dismisses', () => {
    let dismissed = 0;
    for (const [component, module_] of Object.entries(MODULES)) {
      const mod = module_ as unknown as AnyModule;
      for (const [name, story] of stories(mod)) {
        cleanup();
        render(element(mod, story as AnyStory));
        const drawers = screen.queryAllByTestId('chat-drawer');
        if (drawers.length === 0) continue;
        /* Scoped to a DRAWER: several buttons in this family are legitimately labelled "Tutup". */
        const buttons = within(drawers[0]).queryAllByRole('button', { name: /^(Tutup|Dismiss)/ });
        if (buttons.length === 0) continue;
        const before = drawers.length;
        fireEvent.click(buttons[0]);
        expect(
          screen.queryAllByTestId('chat-drawer').length,
          `${component}/${name} renders a dismiss control that dismisses nothing`,
        ).toBeLessThan(before);
        dismissed += 1;
      }
    }
    /* And it must have found some, or the sweep passes by skipping every story. */
    expect(dismissed, 'no story rendered a dismiss control at all').toBeGreaterThan(2);
  });

  it('reports each keystroke to the host', () => {
    const onValueChange = vi.fn();
    mount({ onValueChange });
    fireEvent.change(editor(), { target: { value: 'halo' } });
    expect(onValueChange).toHaveBeenCalledWith('halo');
  });

  /**
   * AUTOGROW, ASSERTED AS A MECHANISM. happy-dom has no layout engine, so nothing here can measure
   * that the box grew — which is how this shipped once with the class module promising autogrow
   * and the component doing nothing but `rows={1}`.
   */
  it('sizes the editor itself rather than leaving it a fixed one-line box', () => {
    mount({ value: 'satu\ndua\ntiga' });
    expect(editor().style.height).toMatch(/^\d+px$/);
    expect(codeOf('ChatComposer/ChatComposerInput.tsx')).toMatch(/scrollHeight/);
  });

  it('works standalone, outside the shell', () => {
    function Host() {
      const [value, setValue] = React.useState('');
      return <ChatComposerInput value={value} onValueChange={setValue} label="Tulis pesan" />;
    }
    cleanup();
    render(<Host />);
    fireEvent.change(editor(), { target: { value: 'sendiri' } });
    expect(editor().value).toBe('sendiri');
  });
});

describe('the axes the contract declares', () => {
  /**
   * THE SHELL'S ONE AXIS IS THE TRAY'S TONE. Figma's `State` described the bar with an attachment
   * in it; the drawer moved OUTSIDE the bordered box, so that axis belongs to
   * `ChatAttachment.variant` and the bar has one presentation. `Type` was collapsed earlier. What
   * is left is the tint of the panel behind the box — pinned here because a second axis appearing
   * is exactly the regression this family keeps having.
   */
  it('gives the shell only the tray tone, and names what is pending instead', () => {
    expect(Object.keys(contract.ChatComposer.axes)).toEqual(['tone']);
    expect(contract.ChatComposer.pendingAxes).toEqual(['density']);
  });

  /**
   * ONE VOCABULARY, TWO PLACES. The tray's tone and the drawer's own variant name the same four
   * treatments, so a caller never translates between them. Asserted as an equality rather than a
   * containment: the drawer's extra `inherit` and `floating` are the only legal differences —
   * `inherit` paints nothing, and `floating` is native-ui-v2's sidebar presentation (a tray has no
   * sidebar to tint), so neither is a tone.
   */
  it('spells the tray tone the same way the drawer spells its variant', () => {
    expect([...contract.ChatComposer.axes.tone]).toEqual(
      contract.ChatDrawer.axes.variant.filter((v) => v !== 'inherit' && v !== 'floating'),
    );
  });

  /**
   * The drawer carries the semantic axis, and it is `Alert`'s vocabulary rather than a new one.
   * `floating` is the one non-semantic value: native-ui-v2's sidebar presentation, which the web
   * only paints (see the entry's divergence).
   */
  it('gives the drawer Alert\'s four variants, plus inherit, its own neutral and the native floating panel', () => {
    expect([...contract.ChatDrawer.axes.variant]).toEqual(['inherit', 'neutral', 'info', 'warning', 'danger', 'floating']);
    for (const v of contract.Alert.axes.function) {
      if (v === 'success') continue; // the drawer has no success case to say
      expect(contract.ChatDrawer.axes.variant).toContain(v);
    }
    /* `danger`, never `error` — the word Figma won and slice 3 settled. */
    expect(contract.ChatDrawer.axes.variant).not.toContain('error');
  });

  for (const variant of ['inherit', 'neutral', 'info', 'warning', 'danger'] as const) {
    it(`the drawer renders its ${variant} treatment`, () => {
      cleanup();
      const { container } = render(<ChatDrawer variant={variant}>isi</ChatDrawer>);
      expect(container.querySelector(`[data-variant="${variant}"]`)).toBeTruthy();
    });
  }
});

describe('one presentation, at every width', () => {
  /**
   * THE AXIS WAS COLLAPSED, so the assertion inverts: it used to be that desktop and mobile must
   * DISAGREE, and now it is that no drawing survives to disagree with. A `variant` prop growing
   * back — the most plausible regression, since it was here a day ago — would show up as the shell
   * rendering two different class strings for two different props.
   */
  it('renders the same shell whatever else the caller passes', () => {
    const { container: a } = mount();
    const first = shell(a).className;
    const { container: b } = mount({ state: 'image', attachments: [] });
    expect(shell(b).className).toBe(first);
  });

  /**
   * The shell declares no size PROP. It does pass a `variant` down to each attachment — that is
   * the chip's image/file treatment, a different axis entirely — so this asserts on the prop
   * DECLARATION and on the published size words, not on the identifier anywhere in the file.
   */
  it('exposes no size or type prop to get wrong', () => {
    const code = codeOf('ChatComposer/ChatComposer.tsx');
    expect(code).not.toMatch(/variant\?:/);
    expect(code).not.toMatch(/desktop|mobile/);
  });

  /** Driven by CSS, not a measured viewport — asserted over the real source, per `codeOf`. */
  it('reads no viewport at runtime', () => {
    for (const f of ['ChatComposer/ChatComposer.tsx', 'ChatComposer/ChatComposerInput.tsx']) {
      expect(codeOf(f)).not.toMatch(/innerWidth|matchMedia/);
    }
  });

  /**
   * THE ACTIVE STATE, on the element a user actually focuses into. The class table holds the
   * treatment; this pins that it is on the SHELL rather than on the editor, because a ring drawn
   * around the textarea instead of the bar is a different component.
   */
  it('puts the elevation and the focus lift on the shell', () => {
    const { container } = mount();
    const cls = shell(container).className;
    expect(cls).toMatch(/(?:^|\s)shadow-\S+/);
    expect(cls).toMatch(/focus-within:shadow-\S+/);
    /* One hue AND the pale stop: the halo and the focus border name one token at one strength.
       Naming them both here rather than only in the purge sibling is what keeps this assertion
       about the RENDERED shell — the strong stop drew a visible hairline inside the glow, which
       the earlier "same token" pairing permitted. See the purge sibling for the full account.
       `FOCUS_RING.field`'s two-tone pair is wrong at this size for the same reason. */
    expect(cls).toContain('focus-within:border-halo');
    expect(cls).toContain('focus-within:ring-halo');
    expect(cls, 'the shell draws its focus edge in the strong stop').not.toContain(
      'focus-within:border-focus-brand',
    );
  });
});

describe('the four buttons are four components', () => {
  /**
   * PER BUTTON, and the glyph pair is what distinguishes them. Send is in the list precisely
   * because its glyph does NOT change — a blanket "swap the glyph on active" rule passes the first
   * three and fails this one, which is the mistake the case is here to catch.
   */
  const CASES: Array<[React.ElementType, string, IconName, IconName]> = [
    [ChatToolsButton, 'Alat', 'composer-plus', 'composer-minus'],
    [ChatAttachmentButton, 'Lampirkan file', 'composer-attach', 'composer-minus'],
    [ChatVoiceButton, 'Input suara', 'composer-mic', 'pause'],
  ];

  /*
    SEND LEFT THIS TABLE WHEN IT LEFT THE BOOLEAN. It used to sit here as the "glyph does NOT
    change" case, which was true and became meaningless the moment `active` stopped being one of
    its props: the row kept passing by rendering the same glyph twice against a prop the component
    now ignores. Its states are an axis, so they get an axis-shaped case — and every glyph must
    DIFFER from the others, since two states drawing one picture is the defect this whole axis
    exists to correct.
  */
  const SEND_STATES: Array<[ChatSendState, IconName]> = [
    ['send', 'composer-send'],
    ['stop', 'square'],
    ['waiting', 'loader'],
  ];

  it('draws a different glyph in each of send\'s three states', () => {
    const drawings = new Map<ChatSendState, string>();
    for (const [state, glyph] of SEND_STATES) {
      const expected = expectedGlyph(glyph);
      expect(expected.length, `${glyph} is not in the registry`).toBeGreaterThan(0);
      cleanup();
      render(<ChatSendButton label="Kirim pesan" state={state} />);
      expect(drawingOf(screen.getByRole('button')), `send/${state} draws the wrong glyph`).toBe(expected);
      drawings.set(state, expected);
    }
    expect(new Set(drawings.values()).size, 'two send states draw the same glyph').toBe(SEND_STATES.length);
  });

  /**
   * STOP IS THE INTERRUPT, AND IT MUST NOT LOOK LIKE SEND. A composer on a surface that streams
   * every reply spends every turn in this state; it shipped once drawing the ordinary blue send
   * glyph, so the state a user most needs to see was the one that looked like all the others.
   *
   * `waiting` is asserted as the other half: it must STAY on the brand fill, because nothing has
   * gone wrong and nothing is interruptible — a spinner in error red would say the upload failed.
   */
  it('gives stop the error fill and leaves waiting on the brand fill', () => {
    cleanup();
    render(<ChatSendButton label="Hentikan" state="stop" />);
    const stop = screen.getByRole('button').className;
    expect(stop, 'stop does not take the error fill').toContain('bg-default-error');
    expect(stop, 'stop still carries the brand fill').not.toContain('bg-default-brand');

    cleanup();
    render(<ChatSendButton label="Menunggu" state="waiting" />);
    const waiting = screen.getByRole('button').className;
    expect(waiting, 'waiting left the brand fill').toContain('bg-default-brand');
    expect(waiting, 'waiting took the error fill').not.toContain('bg-default-error');
  });

  /** No state of send is a pressed state — see the contract divergence. */
  it('never announces a pressed state, in any of send\'s states', () => {
    for (const [state] of SEND_STATES) {
      cleanup();
      render(<ChatSendButton label="Kirim pesan" state={state} />);
      expect(
        screen.getByRole('button').hasAttribute('aria-pressed'),
        `send/${state} announces a pressed state`,
      ).toBe(false);
    }
  });

  for (const [Button, label, idle, active] of CASES) {
    it(`${label}: ${idle} idle, ${active} active`, () => {
      const idleDrawing = expectedGlyph(idle);
      const activeDrawing = expectedGlyph(active);
      /* The premise the two assertions rest on: where the glyph is meant to CHANGE, the two
         drawings must actually differ, or both would hold against a component that never swapped. */
      expect(idleDrawing.length).toBeGreaterThan(0);
      expect(idleDrawing === activeDrawing).toBe(idle === active);

      cleanup();
      render(<Button label={label} />);
      expect(drawingOf(screen.getByRole('button'))).toBe(idleDrawing);

      cleanup();
      render(<Button label={label} state="active" />);
      expect(drawingOf(screen.getByRole('button'))).toBe(activeDrawing);
    });
  }

  /**
   * THE ACTIVE FILL IS PER BUTTON. A shared constant satisfies "active differs from idle" on all
   * four at once while turning the recording indicator into an arming one.
   */
  it('renders the active voice button on the error surface and the rest on brand', () => {
    cleanup();
    render(<ChatVoiceButton label="berhenti" state="active" />);
    const voice = screen.getByRole('button').className;
    expect(voice).toContain('bg-default-error');
    expect(voice).not.toContain('bg-default-brand');

    for (const [Button, label] of [
      [ChatToolsButton, 'Alat'],
      [ChatAttachmentButton, 'Lampirkan file'],
    ] as const) {
      cleanup();
      render(<Button label={label} state="active" />);
      const cls = screen.getByRole('button').className;
      expect(cls, `${label} is not on the brand surface`).toContain('bg-default-brand');
      expect(cls, `${label} is on the error surface`).not.toContain('bg-default-error');
    }

    /* Send is on the same brand surface but reaches it from its OWN three-value axis — it does
       not take the family's `state` at all, which is the whole reason it is asserted apart. */
    cleanup();
    render(<ChatSendButton label="Kirim pesan" />);
    const send = screen.getByRole('button').className;
    expect(send, 'send is not on the brand surface').toContain('bg-default-brand');
    expect(send, 'send is on the error surface').not.toContain('bg-default-error');
  });

  /**
   * THREE REST OUTLINED AND SEND RESTS FILLED — asserted as a split, not as a shared rule. Send is
   * the composer's primary action and the surface draws it that way; a "consistency" pass that
   * gave all four one idle would undo that and pass any check written as "every button rests on
   * the composer surface".
   */
  it('rests three buttons outlined and send filled', () => {
    for (const [Button, label] of [
      [ChatToolsButton, 'Alat'],
      [ChatAttachmentButton, 'Lampirkan file'],
      [ChatVoiceButton, 'Input suara'],
    ] as const) {
      cleanup();
      render(<Button label={label} />);
      expect(screen.getByRole('button').className, `${label} does not rest outlined`).toContain(
        'bg-default-primary',
      );
    }
    cleanup();
    render(<ChatSendButton label="Kirim pesan" />);
    const send = screen.getByRole('button').className;
    expect(send).toContain('bg-default-brand');
    expect(send).not.toContain('bg-default-primary');
  });

  /**
   * DISABLED SEND IS A NEUTRAL FILL, NOT A FADE. The composer starts empty, so this is the state
   * the button spends most of its time in — and a faded blue circle still reads as blue, which
   * would leave an unpressable control looking like the primary action.
   */
  it('disables send to a neutral fill while the others fade', () => {
    cleanup();
    render(<ChatSendButton label="Kirim pesan" disabled />);
    const send = screen.getByRole('button').className;
    expect(send).toMatch(/disabled:bg-\S+/);
    expect(send).not.toContain('disabled:opacity');

    cleanup();
    render(<ChatAttachmentButton label="Lampirkan file" disabled />);
    expect(screen.getByRole('button').className).toContain('disabled:opacity');
  });

  /**
   * The three toggles announce their state; send does not, because it is an action. Emitting
   * `aria-pressed="false"` on send describes a switch that cannot be switched.
   */
  it('announces pressed state for the three toggles and not for send', () => {
    for (const [Button, label] of [
      [ChatToolsButton, 'Alat'],
      [ChatAttachmentButton, 'Lampirkan file'],
      [ChatVoiceButton, 'Input suara'],
    ] as const) {
      cleanup();
      render(<Button label={label} />);
      expect(screen.getByRole('button').getAttribute('aria-pressed')).toBe('false');
      cleanup();
      render(<Button label={label} state="active" />);
      expect(screen.getByRole('button').getAttribute('aria-pressed')).toBe('true');
    }
    cleanup();
    render(<ChatSendButton label="Kirim pesan" state="stop" />);
    expect(screen.getByRole('button').getAttribute('aria-pressed')).toBeNull();
  });

  it('carries the caller-supplied accessible name and no text', () => {
    cleanup();
    render(<ChatVoiceButton label="Input suara" />);
    expect(screen.getByRole('button', { name: 'Input suara' }).textContent).toBe('');
  });

  /** Pinned to `button`: a composer control inside a form must not submit it on Enter. */
  it('pins the DOM type so none of them can submit a form', () => {
    for (const [Button, label] of CASES.map(([B, l]) => [B, l] as const)) {
      cleanup();
      render(<Button label={label} {...({ type: 'submit' } as Record<string, string>)} />);
      expect((screen.getByRole('button') as HTMLButtonElement).type).toBe('button');
    }
  });

  it('fires the caller handler and disables independently', () => {
    const onClick = vi.fn();
    cleanup();
    render(<ChatToolsButton label="Alat" onClick={onClick} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledTimes(1);

    cleanup();
    render(<ChatSendButton label="Kirim pesan" disabled />);
    expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('the attachment', () => {
  /** The `Image` trap, asserted directly: a composer's previews are local by definition. */
  it('renders a local blob preview rather than refusing it', () => {
    cleanup();
    const { container } = render(<ChatAttachment name="produk.jpg" previewUrl={BLOB} />);
    const img = container.querySelector('img') as HTMLImageElement;
    expect(img).toBeTruthy();
    expect(img.getAttribute('src')).toBe(BLOB);
    expect(img.getAttribute('alt')).toBe('produk.jpg');
  });

  it('draws the file chip with its badge, filename and type label', () => {
    cleanup();
    render(<ChatAttachment variant="file" name="CoffeeBrew_harian" typeLabel="XLSX" extension="X" />);
    expect(screen.getByText('CoffeeBrew_harian')).toBeTruthy();
    expect(screen.getByText('XLSX')).toBeTruthy();
    expect(screen.getByText('X')).toBeTruthy();
  });

  it('renders a size only when showSize is on, in the sent-message shape', () => {
    cleanup();
    render(<ChatAttachment variant="file" name="laporan.xlsx" typeLabel="XLSX" sizeBytes={4915} showSize />);
    expect(screen.getByText(/4\.8 KB/)).toBeTruthy();

    cleanup();
    render(<ChatAttachment variant="file" name="laporan.xlsx" typeLabel="XLSX" sizeBytes={4915} />);
    expect(screen.queryByText(/4\.8 KB/)).toBeNull();
  });

  it('offers removal only when the caller supplies a handler', () => {
    const onRemove = vi.fn();
    cleanup();
    render(<ChatAttachment name="a.jpg" previewUrl={BLOB} onRemove={onRemove} />);
    fireEvent.click(screen.getByRole('button', { name: 'Hapus a.jpg' }));
    expect(onRemove).toHaveBeenCalledTimes(1);

    cleanup();
    render(<ChatAttachment name="a.jpg" previewUrl={BLOB} />);
    expect(screen.queryByRole('button', { name: /^Hapus / })).toBeNull();
  });

  /**
   * EACH STATUS ITS OWN TREATMENT, INSIDE ITS OWN CHIP. A bar over the drawer could not say which
   * file failed, which is why status is per attachment rather than per drawer.
   */
  it('gives the three statuses three different treatments', () => {
    const classes = (['uploading', 'error', 'done'] as const).map((status) => {
      cleanup();
      const { container } = render(<ChatAttachment name="a.jpg" previewUrl={BLOB} status={status} />);
      return (container.querySelector('[data-status]') as HTMLElement).className;
    });
    expect(new Set(classes).size).toBe(3);
  });

  it('draws nothing for an idle attachment', () => {
    cleanup();
    const { container } = render(<ChatAttachment name="a.jpg" previewUrl={BLOB} />);
    expect(container.querySelector('[data-status]')).toBeNull();
  });

  /**
   * CHILDREN LAND INSIDE THE CHIP, asserted by CONTAINMENT. A node that merely exists somewhere in
   * the document satisfies nothing — the requirement is that it lands in the box it is positioned
   * against, which is the one thing a host cannot do from outside.
   */
  it('places host content inside the chip it belongs to', () => {
    cleanup();
    const { container } = render(
      <>
        <ChatAttachment name="a.jpg" previewUrl={BLOB}>
          <span data-testid="ov-a">coba lagi</span>
        </ChatAttachment>
        <ChatAttachment name="b.jpg" previewUrl={BLOB} />
      </>,
    );
    const chipA = container.querySelector('[data-attachment-name="a.jpg"]') as HTMLElement;
    const chipB = container.querySelector('[data-attachment-name="b.jpg"]') as HTMLElement;
    expect(within(chipA).getByTestId('ov-a')).toBeTruthy();
    expect(within(chipB).queryByTestId('ov-a')).toBeNull();
  });
});

describe('the drawer holds, collapses and dismisses', () => {
  it('holds attachments composed by hand', () => {
    cleanup();
    render(
      <ChatDrawer>
        <ChatAttachment variant="file" name="x.pdf" typeLabel="PDF" />
        <ChatAttachment variant="file" name="y.pdf" typeLabel="PDF" />
      </ChatDrawer>,
    );
    expect(screen.getByText('x.pdf')).toBeTruthy();
    expect(screen.getByText('y.pdf')).toBeTruthy();
  });

  /** And anything else — the point of splitting the chips out of it. */
  it('holds content that is not an attachment at all', () => {
    cleanup();
    render(
      <ChatDrawer>
        <span data-testid="not-a-chip">Ringkas ini</span>
      </ChatDrawer>,
    );
    expect(within(screen.getByTestId('chat-drawer')).getByTestId('not-a-chip')).toBeTruthy();
  });

  it('renders nothing when it holds nothing, rather than an empty panel', () => {
    cleanup();
    const { container } = render(<ChatDrawer>{null}</ChatDrawer>);
    expect(container.querySelector('[data-testid="chat-drawer"]')).toBeNull();
  });

  /**
   * COLLAPSIBLE ONLY WHEN BOTH HALVES ARE SUPPLIED — the controlled shape `Menu` uses. The toggle
   * appearing without a working handler is the affordance lie a `showHandle` boolean used to be.
   */
  it('shows no toggle unless the caller drives the state', () => {
    cleanup();
    render(<ChatDrawer>isi</ChatDrawer>);
    expect(screen.queryByRole('button', { name: 'Sembunyikan' })).toBeNull();

    cleanup();
    render(<ChatDrawer collapsed={false} onCollapsedChange={() => {}}>isi</ChatDrawer>);
    expect(screen.getByRole('button', { name: 'Sembunyikan' })).toBeTruthy();
  });

  it('reports the toggle and announces what it controls', () => {
    const onCollapsedChange = vi.fn();
    cleanup();
    render(
      <ChatDrawer collapsed={false} onCollapsedChange={onCollapsedChange}>
        isi
      </ChatDrawer>,
    );
    const toggle = screen.getByRole('button', { name: 'Sembunyikan' });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.getAttribute('aria-controls')).toBeTruthy();
    fireEvent.click(toggle);
    expect(onCollapsedChange).toHaveBeenCalledWith(true);
  });

  /**
   * COLLAPSED HIDES, IT DOES NOT UNMOUNT. `aria-controls` has to point at a node that exists, and
   * children dropped from the tree would take any state they hold with them — an upload in flight
   * being the obvious one.
   */
  it('hides its children when collapsed without unmounting them', () => {
    cleanup();
    const { container } = render(
      <ChatDrawer collapsed onCollapsedChange={() => {}}>
        <span data-testid="held">isi</span>
      </ChatDrawer>,
    );
    const held = container.querySelector('[data-testid="held"]');
    expect(held, 'the children were unmounted').toBeTruthy();
    const row = (held as HTMLElement).parentElement as HTMLElement;
    /*
      THE CLASS, NOT JUST THE ATTRIBUTE. This asserted only `closest('[hidden]')` while the row's
      class list said `flex` — which beats `[hidden] { display: none }` in a real browser, so the
      drawer announced itself collapsed and stayed fully visible. happy-dom ships no UA stylesheet,
      so nothing about the rendered node could have caught it; the class is the observable part.
    */
    expect(row.className, 'the collapsed row still names a visible display').toContain('hidden');
    expect(row.className, 'the collapsed row keeps its flex display').not.toMatch(/(?:^|\s)flex(?:$|\s)/);
    expect(row.hasAttribute('hidden'), 'the collapsed row drops the attribute assistive tech reads').toBe(true);
    expect(screen.getByRole('button', { name: 'Sembunyikan' }).getAttribute('aria-expanded')).toBe('false');
  });

  /** Dismiss is gated on its callback, the rule `Lightbox` already follows. */
  /**
   * THE COLLAPSED FACE. A shut drawer showing only a hairline says nothing about what it is
   * holding, so the toggle wears the host's summary instead — and it is the SAME control, which is
   * the part worth pinning: a summary rendered as a sibling would leave a collapsed drawer with two
   * things to press and no obvious way back.
   */
  it('shows the summary inside the toggle when collapsed, and the line when open', () => {
    cleanup();
    const onCollapsedChange = vi.fn();
    const { rerender } = render(
      <ChatDrawer
        collapsed
        onCollapsedChange={onCollapsedChange}
        collapsedSummary={<span data-testid="summary">4 Lampiran</span>}
      >
        <span data-testid="held">isi</span>
      </ChatDrawer>,
    );
    const toggle = screen.getByRole('button', { name: 'Sembunyikan' });
    expect(toggle.contains(screen.getByTestId('summary')), 'the summary is not the toggle').toBe(true);
    /* Pressing the summary is what reopens it — one control, two faces. */
    fireEvent.click(screen.getByTestId('summary'));
    expect(onCollapsedChange).toHaveBeenCalledWith(false);

    rerender(
      <ChatDrawer
        collapsed={false}
        onCollapsedChange={onCollapsedChange}
        collapsedSummary={<span data-testid="summary">4 Lampiran</span>}
      >
        <span data-testid="held">isi</span>
      </ChatDrawer>,
    );
    expect(screen.queryByTestId('summary'), 'the summary survived the drawer opening').toBeNull();
  });

  /** No summary supplied: the line alone, which is right when the content is already obvious. */
  it('falls back to the line when no summary is given', () => {
    cleanup();
    render(
      <ChatDrawer collapsed onCollapsedChange={() => {}}>
        <span data-testid="held">isi</span>
      </ChatDrawer>,
    );
    const toggle = screen.getByRole('button', { name: 'Sembunyikan' });
    expect(toggle.textContent, 'a drawer with no summary invented one').toBe('');
  });

  /** And the other direction: open means a real display, not merely the absence of `hidden`. */
  it('gives the open row a display class of its own', () => {
    cleanup();
    const { container } = render(
      <ChatDrawer collapsed={false} onCollapsedChange={() => {}}>
        <span data-testid="held">isi</span>
      </ChatDrawer>,
    );
    const row = (container.querySelector('[data-testid="held"]') as HTMLElement).parentElement as HTMLElement;
    expect(row.className).toMatch(/(?:^|\s)flex(?:$|\s)/);
    expect(row.className).not.toContain('hidden');
    expect(row.hasAttribute('hidden')).toBe(false);
  });

  it('shows the dismiss control only when a handler is supplied', () => {
    const onDismiss = vi.fn();
    cleanup();
    render(<ChatDrawer variant="warning">isi</ChatDrawer>);
    expect(screen.queryByRole('button', { name: 'Tutup' })).toBeNull();

    cleanup();
    render(
      <ChatDrawer variant="warning" onDismiss={onDismiss}>
        isi
      </ChatDrawer>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Tutup' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});

describe('the named slots', () => {
  /**
   * THE HEADER AND FOOTER ARE OUTSIDE THE BORDERED BOX, and this is the assertion the whole
   * rearrangement exists for: the box carries `focus-within` styling, so anything inside it gets
   * the focus band drawn around it when the editor is focused. A drawer in the header must not.
   */
  it('renders header and footer outside the focus-ringed box', () => {
    const { container } = mount({
      header: <span data-testid="head" />,
      footer: <span data-testid="foot" />,
    });
    const box = shell(container);
    expect(box.className).toContain('focus-within:');
    /* And the tray around them carries none, which is what makes it safe to put them there. */
    expect((tray(container) as HTMLElement).className).not.toContain('focus-within:');
    expect(box.contains(screen.getByTestId('head')), 'the header is inside the focus box').toBe(false);
    expect(box.contains(screen.getByTestId('foot')), 'the footer is inside the focus box').toBe(false);
    /* But still inside the component, and in order. */
    const head = screen.getByTestId('head');
    const foot = screen.getByTestId('foot');
    expect(head.compareDocumentPosition(foot) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(head.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  /**
   * NO SLOT, NO TRAY — and this assertion exists because the guard above did NOT catch it. Making
   * the tray unconditional passed every other check here: the header still rendered outside the
   * focus band, the tones still resolved, the radii still matched. What it did was wrap the
   * composer's MOST COMMON state — a bare bar, nothing attached, nothing to warn about — in a grey
   * panel and 8px of padding it should not have.
   *
   * Both directions, because only asserting the absence would pass with a tray that never appears.
   */
  it('adds the tray only when a slot is filled', () => {
    const { container: bare } = mount();
    expect(tray(bare), 'a composer with no slots grew a tray').toBeNull();

    cleanup();
    const { container: withHeader } = mount({ header: <span data-testid="head" /> });
    expect(tray(withHeader), 'a filled header did not produce a tray').toBeTruthy();

    cleanup();
    const { container: withFooter } = mount({ footer: <span data-testid="foot" /> });
    expect(tray(withFooter), 'a filled footer did not produce a tray').toBeTruthy();
  });

  /** The tone reaches the tray, and only the tray — the box keeps its own surface. */
  it('tints the tray with the tone, leaving the box alone', () => {
    const { container } = mount({ header: <span data-testid="head" />, tone: 'danger' });
    expect((tray(container) as HTMLElement).dataset.tray).toBe('danger');
    expect((tray(container) as HTMLElement).className).toContain('callout-neg');
    expect(shell(container).className, 'the tone leaked onto the bordered box').not.toContain('callout-neg');
  });

  it('anchors the editor affordance inside the editor box', () => {
    mount({ editorAffordance: <button type="button">buka</button> });
    const box = editor().parentElement as HTMLElement;
    expect(within(box).getByRole('button', { name: 'buka' })).toBeTruthy();
  });

  it('renders the overlay outside the shell but inside the component', () => {
    const { container } = mount({ overlay: <div data-testid="menu" /> });
    const menu = screen.getByTestId('menu');
    expect(shell(container).contains(menu)).toBe(false);
    expect(container.firstElementChild?.contains(menu)).toBe(true);
  });

  it('lets a node replace the placeholder text property', () => {
    mount({ placeholderSlot: <span data-testid="rotating">Buat gambar produk…</span> });
    expect(screen.getByTestId('rotating')).toBeTruthy();
    expect(editor().placeholder).toBe('');
  });

  it('falls back to the text property when no node is supplied', () => {
    mount({ placeholder: 'Tanyakan bisnismu...' });
    expect(editor().placeholder).toBe('Tanyakan bisnismu...');
  });
});

describe('the action slots', () => {
  /**
   * SLOTS, NOT THIRTEEN PROPS. The host composes the buttons it wants; the shell places two
   * groups. What has to hold is that the groups land on the right sides of the row and that the
   * shell adds nothing of its own to them.
   */
  /**
   * THE ROW SLOT REPLACES THE GROUPS AND SPANS, and both halves are the assertion.
   *
   * The failure this exists for is the plausible wrong answer rather than a broken one: the
   * listening bar passed as `toolActions` renders perfectly — correct classes, correct glyphs, an
   * accessible stop button — inside a content-sized flex item, so it sits at its intrinsic width
   * with the right half of the row empty beside it. Nothing throws and no class is wrong, which is
   * why the shape had to become a slot of its own rather than a convention.
   *
   * `data-row` is what makes the swap visible to a test at all: the row keeps its own class in
   * both arms, so a selector on the row cannot tell the two apart.
   */
  it('lets a row slot replace both groups and become the row itself', () => {
    const bar = <ChatVoiceBar size="compact" label="Mendengarkan" stopLabel="Berhenti" onStop={() => {}} />;
    const { container } = mount({ actionRow: bar });

    const row = container.querySelector('[data-row]') as HTMLElement;
    expect(row.dataset.row, 'the row did not report itself replaced').toBe('replaced');
    /* The bar is the row's ONLY child and its OWN child — not nested in a group, which is what
       lets it span. Asserted as the whole child list rather than by a class selector: the group's
       first class is `flex`, which the bar also wears, so a selector built from it matches the bar
       itself and the check passes for the wrong reason whichever way the component is written. */
    expect([...row.children]).toEqual([screen.getByTestId('chat-voice-bar')]);
  });

  /**
   * AND THE GROUPS ARE IGNORED RATHER THAN STACKED WITH. A host swapping the row in does not
   * unmount its own buttons first, so both are passed at once on the live surface; rendering both
   * would put a second row of controls under the bar and grow the composer by its height, which
   * is exactly what the bar's two sizes exist to prevent.
   */
  it('drops the groups entirely while the row slot is filled', () => {
    mount({
      actionRow: <ChatVoiceBar size="compact" label="Mendengarkan" stopLabel="Berhenti" onStop={() => {}} />,
      toolActions: <ChatToolsButton label="Alat" />,
      sendActions: <ChatSendButton label="Kirim pesan" />,
    });
    expect(screen.queryByRole('button', { name: 'Alat' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Kirim pesan' })).toBeNull();
    /* And the bar's own control is still there, so the absence above is the swap rather than a
       composer that rendered no row at all. */
    expect(screen.getByRole('button', { name: 'Berhenti' })).toBeTruthy();
  });

  /** The default arm still reports itself, or the check above passes against a missing attribute. */
  it('reports the ordinary two-group row as itself', () => {
    const { container } = mount();
    expect((container.querySelector('[data-row]') as HTMLElement).dataset.row).toBe('groups');
  });

  it('places the two groups on opposite sides of the control row', () => {
    mount({
      toolActions: <span data-testid="tools" />,
      sendActions: <span data-testid="send" />,
    });
    const tools = screen.getByTestId('tools');
    const send = screen.getByTestId('send');
    expect(tools.compareDocumentPosition(send) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(tools.parentElement).not.toBe(send.parentElement);
  });

  it('renders no button of its own when the slots are empty', () => {
    mount();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  /** The documented composition, which is what the guarantee rests on now that types cannot. */
  it('renders the four buttons a host composes, each reachable by name', () => {
    mount({ toolActions: TOOLS, sendActions: SEND });
    for (const name of ['Alat', 'Lampirkan file', 'Input suara', 'Kirim pesan']) {
      expect(screen.getByRole('button', { name }), `${name} is missing`).toBeTruthy();
    }
  });

  /**
   * `disabled` REACHES THE EDITOR ONLY, and that is deliberate rather than an oversight: the slot
   * contents are the caller's elements, and reaching into children to inject a prop breaks the
   * moment one is wrapped. Pinned so nobody "fixes" it by cloning children.
   */
  it('disables the editor without touching the caller\'s buttons', () => {
    const onClick = vi.fn();
    const { container } = mount({
      disabled: true,
      toolActions: TOOLS,
      sendActions: <ChatSendButton label="Kirim pesan" onClick={onClick} />,
    });
    expect(editor().disabled).toBe(true);

    /* CLICKED, not inspected: `button.disabled` reflects the attribute only, so a cascade that
       worked by cloning children would leave it reading false. */
    fireEvent.click(screen.getByRole('button', { name: 'Kirim pesan' }));
    expect(onClick, 'the shell disabled a button it does not own').toHaveBeenCalledTimes(1);

    /*
     * AND THE SHAPE, because the click alone cannot see every cascade. happy-dom does not
     * implement `fieldset[disabled]` semantics, so wrapping the slot in one would disable the
     * buttons in a real browser while this environment still dispatched the click — the assertion
     * above passes over exactly that. Counting the disabled elements catches it: with the shell
     * disabled there must be precisely ONE, the editor.
     */
    const disabledNodes = container.querySelectorAll('[disabled]');
    expect(disabledNodes).toHaveLength(1);
    expect((disabledNodes[0] as HTMLElement).tagName).toBe('TEXTAREA');
  });

  it('takes a focus-WITHIN treatment, because the focusable element is inside it', () => {
    const { container } = mount();
    const cls = shell(container).className;
    expect(cls).toContain('focus-within:');
    expect(cls).not.toContain('focus-visible:');
  });
});

describe('the components own no product logic (R8)', () => {
  it('actually read the sources, so the absence checks below mean something', () => {
    for (const f of [
      'ChatComposer/ChatComposer.tsx',
      'ChatComposer/ChatComposerInput.tsx',
      'ChatComposer/ChatDrawer.tsx',
    ]) {
      expect(codeOf(f).length).toBeGreaterThan(500);
    }
    expect(codeOf('ChatComposer/ChatComposer.tsx')).toContain('export const ChatComposer');
  });

  it('names no product concept in their own code', () => {
    for (const f of [
      'ChatComposer/ChatComposer.tsx',
      'ChatComposer/ChatComposerInput.tsx',
      'ChatComposer/ChatDrawer.tsx',
    ]) {
      const code = codeOf(f);
      for (const word of ['slash', 'capability', 'quota', 'upload(', 'fetch(']) {
        expect(code, `${f} names ${word}`).not.toContain(word);
      }
    }
  });

  /**
   * The kind-taking base stays PRIVATE. Exporting it would give callers a fifth way to render a
   * composer button — one that takes its type as a prop, which is the exact shape the four named
   * components exist to replace.
   */
  it('does not export the shared button base', async () => {
    const barrel = await import('./ChatComposer');
    expect(Object.keys(barrel)).not.toContain('ComposerButton');
  });
});

/* UMK-1041: an overlay anchored to the editor box, and a class on the editor itself. */
describe('editor-anchored additions', () => {
  const box = () =>
    render(
      <ChatComposer
        value=""
        onValueChange={() => {}}
        editorLabel="Pesan"
        editorClassName="min-h-10"
        editorOverlay={<div data-testid="slash">menu</div>}
        overlay={<div data-testid="outer">outer</div>}
      />,
    );

  it('renders editorOverlay inside the editor box and overlay outside it', () => {
    box();
    const editor = document.querySelector('[data-composer-editor]')!;
    expect(editor.contains(screen.getByTestId('slash'))).toBe(true);
    expect(editor.contains(screen.getByTestId('outer'))).toBe(false);
  });

  it('puts editorClassName on the textarea', () => {
    box();
    expect(screen.getByRole('textbox').className).toContain('min-h-10');
  });

  it('renders as before when neither is given', () => {
    render(<ChatComposer value="" onValueChange={() => {}} editorLabel="Pesan" />);
    expect(document.querySelector('[data-composer-editor]')!.children).toHaveLength(1);
  });
});

describe('keyboard hints and the raised hero (UMK-1041, L17 + L19)', () => {
  it('forwards all four soft-keyboard attributes onto the textarea', () => {
    render(
      <ChatComposer
        value=""
        onValueChange={() => {}}
        editorLabel="Pesan"
        editorInputMode="text"
        editorEnterKeyHint="enter"
        editorAutoCapitalize="sentences"
        editorSpellCheck
      />,
    );
    const ta = screen.getByRole('textbox');
    expect(ta.getAttribute('inputmode')).toBe('text');
    expect(ta.getAttribute('enterkeyhint')).toBe('enter');
    expect(ta.getAttribute('autocapitalize')).toBe('sentences');
    expect(ta.getAttribute('spellcheck')).toBe('true');
  });

  it('adds the lift only when raised, replacing the base shadows', () => {
    const { rerender } = render(<ChatComposer value="" onValueChange={() => {}} editorLabel="Pesan" />);
    const cls = () => screen.getByTestId('chat-composer-box').className;
    expect(cls()).toContain('shadow-sm');
    expect(cls()).not.toContain('shadow-xl');
    rerender(<ChatComposer value="" onValueChange={() => {}} editorLabel="Pesan" raised />);
    expect(cls()).toContain('shadow-xl');
    expect(cls()).toContain('focus-within:shadow-xl');
    expect(cls()).not.toContain('shadow-sm');
  });

  /* UMK-1755: the hero wears the brand → success edge of Figma's home `01 Chat Bar`, running to the
     bottom at every width; the thread's composer keeps the plain border. The edge is drawn by the
     border box's background, so the border's own colour has to go transparent, at rest and on
     focus, while the halo ring stays as the focus cue. */
  it('draws the gradient edge only when raised with heroEdge (the V2 hero, temanai-web-beranda-v2)', () => {
    const HERO_EDGE =
      '[background:linear-gradient(rgb(var(--surface-default-primary)),rgb(var(--surface-default-primary)))_padding-box,linear-gradient(to_bottom,rgb(var(--surface-default-brand)),rgb(var(--surface-default-success)))_border-box]';
    const { rerender } = render(<ChatComposer value="" onValueChange={() => {}} editorLabel="Pesan" />);
    const cls = () => screen.getByTestId('chat-composer-box').className;
    expect(cls()).toContain('border-default-primary');
    expect(cls()).not.toContain('border-transparent');
    expect(cls()).not.toContain('border-box');
    // A hero from before the web Beranda v2 keeps the lift alone, and heroEdge without raised draws nothing.
    rerender(<ChatComposer value="" onValueChange={() => {}} editorLabel="Pesan" raised />);
    expect(cls()).not.toContain('border-box');
    expect(cls()).toContain('border-default-primary');
    rerender(<ChatComposer value="" onValueChange={() => {}} editorLabel="Pesan" heroEdge />);
    expect(cls()).not.toContain('border-box');
    rerender(<ChatComposer value="" onValueChange={() => {}} editorLabel="Pesan" raised heroEdge />);
    expect(cls()).toContain(HERO_EDGE);
    expect(cls()).toContain('border-transparent');
    expect(cls()).toContain('focus-within:border-transparent');
    expect(cls()).not.toContain('border-default-primary');
    expect(cls()).not.toContain('focus-within:border-halo');
    expect(cls()).toContain('focus-within:ring-halo');
  });

  /* UMK-1755: from `md` the hero takes the published Desktop radius and padding (24, and 20 by 32);
     below it, and on the thread's composer at every width, the shell's one presentation stays. */
  it('takes the desktop radius and padding from md only when raised with heroEdge', () => {
    const HERO_DESKTOP = ['md:rounded-ds-2xl', 'md:px-ds-2xl', 'md:py-ds-lg'];
    const { rerender } = render(<ChatComposer value="" onValueChange={() => {}} editorLabel="Pesan" />);
    const classes = () => screen.getByTestId('chat-composer-box').className.split(' ');
    expect(classes().filter((c) => c.startsWith('md:'))).toEqual([]);
    rerender(<ChatComposer value="" onValueChange={() => {}} editorLabel="Pesan" raised />);
    expect(classes().filter((c) => c.startsWith('md:'))).toEqual([]);
    rerender(<ChatComposer value="" onValueChange={() => {}} editorLabel="Pesan" raised heroEdge />);
    expect(classes()).toEqual(expect.arrayContaining(HERO_DESKTOP));
    expect(classes()).toEqual(expect.arrayContaining(['rounded-2xl', 'p-4']));
  });
});
