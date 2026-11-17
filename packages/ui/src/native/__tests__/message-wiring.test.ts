/**
 * The native transcript's WIRING: the frame mounts its seam and the list feeds it (UMK-1129). The
 * never-newest-first ban that used to sit here is `transcript-order.test.ts` now, over the whole
 * native directory, with a render-level half in `apps/mobile`.
 *
 * WHY THIS IS A GUARD AND NOT A PROMISE. The seam between `ChatThread` and `ChatMessageList` is
 * absent-tolerant on purpose — a list outside a frame is an ordinary list — and that tolerance is
 * the UMK-1002 hazard: a frame that stopped mounting its provider, or a list that stopped handing
 * over one of its events, is a SUCCESSFUL read of an absent context. Nothing throws, nothing is
 * blank, every row renders, and the follow is simply dead: the transcript stops tracking a
 * streaming reply, or the pill never appears. The web family's behaviour guard asserts its wiring
 * for the same reason (`message.test.tsx`).
 *
 * READ OFF THE SYNTAX TREE (`ScriptKind.TSX`, parents set, walk callbacks that return nothing —
 * `docs/solutions/conventions/the-typescript-compiler-api-traps-that-fail-silently.md`), so a
 * comment naming a handler cannot satisfy a check and a comment explaining inversion cannot fail
 * one. `react-native` does not load under vitest; the playbook's jest render test in `apps/mobile`
 * drives the real components.
 *
 * PROVED RED (2026-09-22), one injection each, applied, run and reverted, written from the failure
 * described rather than off the matcher:
 *
 * | Injection | Reds |
 * | -- | -- |
 * | `ChatThread` renders `{children}` bare, outside `ThreadProvider` | 1 — the frame mounts the seam |
 * | `ThreadProvider` wraps only the pill slot, children outside it | 1 — the frame mounts the seam |
 * | the default pill's `onPress` dropped | 1 — the default pill brings the reader back |
 * | the list's `onLayout` no longer calls `thread?.onLayout` (keyboard stops re-following) | 1 — onLayout |
 * | the list's `ref` becomes a local ref (the frame cannot scroll it) | 1 — ref |
 * | the `lastKey` report effect deleted (the new-message mark goes dark) | 1 — onLastItem |
 * | the list's `onScroll` drops `onScroll?.(event)` (the host's handler never runs) | 1 — host onScroll |
 * | the list's `onContentSizeChange` drops the host call | 1 — host onContentSizeChange |
 * | the list's `onLayout` drops the host call | 1 — host onLayout |
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const parse = (name: string) => {
  const file = resolve(__dirname, '..', name);
  return ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
};

const THREAD = parse('ChatThread.tsx');
const LIST = parse('ChatMessageList.tsx');

/** Every node in a subtree. The walk callback returns nothing, so `forEachChild` never stops early. */
const nodes = (root: ts.Node): ts.Node[] => {
  const out: ts.Node[] = [];
  const walk = (n: ts.Node): void => {
    out.push(n);
    ts.forEachChild(n, (c) => {
      walk(c);
    });
  };
  walk(root);
  return out;
};

const tagName = (n: ts.JsxOpeningLikeElement) => n.tagName.getText();

const elements = (root: ts.Node, name: string) =>
  nodes(root).filter(
    (n): n is ts.JsxOpeningLikeElement => (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) && tagName(n) === name,
  );

const attribute = (el: ts.JsxOpeningLikeElement, name: string) =>
  el.attributes.properties.find((a): a is ts.JsxAttribute => ts.isJsxAttribute(a) && a.name.getText() === name);

/** Does this subtree call `thread.<handler>(…)` / `thread?.<handler>(…)`? */
const callsThread = (root: ts.Node, handler: string) =>
  nodes(root).some(
    (n) =>
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      n.expression.name.text === handler &&
      ts.isIdentifier(n.expression.expression) &&
      n.expression.expression.text === 'thread',
  );

/** Does this subtree READ `thread.<handler>` / `thread?.<handler>` at all? */
const readsThread = (root: ts.Node, handler: string) =>
  nodes(root).some(
    (n) =>
      ts.isPropertyAccessExpression(n) &&
      n.name.text === handler &&
      ts.isIdentifier(n.expression) &&
      n.expression.text === 'thread',
  );

describe('the native transcript frame mounts its seam', () => {
  /**
   * The provider must wrap the frame's CHILDREN — the list — and not merely exist somewhere in the
   * file: a provider around the pill alone leaves the list reading an absent context.
   */
  it('wraps the children in ThreadProvider', () => {
    const providers = nodes(THREAD).filter(
      (n): n is ts.JsxElement => ts.isJsxElement(n) && tagName(n.openingElement) === 'ThreadProvider',
    );
    expect(providers.length, 'ChatThread renders no ThreadProvider').toBe(1);
    const wrapsChildren = providers[0].children.some(
      (c) => ts.isJsxExpression(c) && c.expression !== undefined && ts.isIdentifier(c.expression) && c.expression.text === 'children',
    );
    expect(wrapsChildren, 'ThreadProvider does not wrap {children}').toBe(true);
    expect(attribute(providers[0].openingElement, 'value'), 'ThreadProvider has no value').toBeDefined();
  });

  it('gives the default pill a way back to the latest message', () => {
    const pills = elements(THREAD, 'ChatScrollButton');
    expect(pills.length, 'ChatThread renders no default pill').toBe(1);
    const onPress = attribute(pills[0], 'onPress');
    expect(onPress?.initializer?.getText(), 'the default pill does not call scrollToBottom').toBe('{scrollToBottom}');
  });
});

describe('the native list feeds the frame', () => {
  const flatLists = elements(LIST, 'FlatList');

  it('renders exactly one FlatList and reads the seam', () => {
    expect(flatLists).toHaveLength(1);
    const reads = nodes(LIST).some(
      (n) => ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'useThreadContext',
    );
    expect(reads, 'ChatMessageList never calls useThreadContext').toBe(true);
  });

  /**
   * Per contributor (UMK-956): one event handed over is one assertion, so a lost handler names
   * itself instead of printing a set difference.
   */
  it.each(['onScroll', 'onContentSizeChange', 'onLayout'])('hands %s to the frame', (handler) => {
    const attr = attribute(flatLists[0], handler);
    expect(attr, `the FlatList carries no ${handler}`).toBeDefined();
    expect(callsThread(attr!, handler), `${handler} does not call thread.${handler}`).toBe(true);
  });

  /**
   * AND the host's own handler, per contributor. The list takes `onScroll` / `onContentSizeChange` /
   * `onLayout` out of `...rest` to feed the frame, so dropping the host call is silent: the list
   * scrolls, the frame follows, the handler the host passed simply never runs (PR #1117 review).
   */
  it.each(['onScroll', 'onContentSizeChange', 'onLayout'])('still hands %s to the host', (handler) => {
    const attr = attribute(flatLists[0], handler);
    expect(attr, `the FlatList carries no ${handler}`).toBeDefined();
    const found: ts.Node[] = [];
    const walk = (n: ts.Node): void => {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === handler) found.push(n);
      ts.forEachChild(n, walk);
    };
    walk(attr!);
    expect(found.length, `${handler} never calls the host's own ${handler}`).toBeGreaterThan(0);
  });

  it('hands the frame its instance through ref', () => {
    const ref = attribute(flatLists[0], 'ref');
    expect(ref, 'the FlatList carries no ref').toBeDefined();
    expect(readsThread(ref!, 'attachList'), 'the ref is not the frame’s attachList').toBe(true);
  });

  /**
   * The last item's key is reported from an effect, so the check is that the file reads
   * `thread.onLastItem` AND calls what it read — reading it without calling it is a dead mark.
   */
  it('reports its last item so an arrival can be told from growth', () => {
    const decl = nodes(LIST).find(
      (n): n is ts.VariableDeclaration =>
        /* The initializer IS the read — not merely contains it, or the component's own
           declaration (whose body contains everything) is the first match. */
        ts.isVariableDeclaration(n) &&
        n.initializer !== undefined &&
        ts.isPropertyAccessExpression(n.initializer) &&
        readsThread(n.initializer, 'onLastItem'),
    );
    expect(decl, 'ChatMessageList never reads thread.onLastItem').toBeDefined();
    const bound = decl!.name.getText();
    const called = nodes(LIST).some(
      (n) => ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === bound,
    );
    expect(called, `thread.onLastItem is read into ${bound} and never called`).toBe(true);
  });
});
