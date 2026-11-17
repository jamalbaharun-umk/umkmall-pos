'use client';

import React from 'react';
import { contract } from '../../contract';
import { cn } from '../../utils';
import {
  CODE_BLOCK_ACTION,
  CODE_BLOCK_ACTIONS,
  CODE_BLOCK_BAR,
  CODE_BLOCK_BASE,
  CODE_BLOCK_BODY,
  CODE_BLOCK_FAILED,
  CODE_BLOCK_SIZE,
} from '../content-classes';
import {
  A2UI_CODE_ACTION,
  A2UI_CODE_BAR,
  A2UI_CODE_BLOCK,
  A2UI_CODE_BODY,
  A2UI_CODE_LABEL,
} from '../a2ui-classes';
import { Icon } from '../Icon';

type Axes = typeof contract.CodeBlock.axes;
type Of<K extends keyof Axes> = Axes[K][number];

const SIZE = CODE_BLOCK_SIZE satisfies Record<Of<'size'>, string>;

/** How long the copied state shows before reverting, in milliseconds. */
const SETTLE_MS = 2000;

export interface CodeBlockProps {
  /** The fenced content. */
  children: React.ReactNode;
  /**
   * What the copy control writes. Defaults to `children` when it is a string.
   *
   * Explicit rather than walked out of the rendered tree: the two live copies each carry their
   * own recursive text extractor, and a component that guesses at its own payload copies the
   * line numbers and the language label along with the code.
   */
  copyText?: string;
  /** The header bar's label — a language, a filename. The bar collapses without one. */
  label?: React.ReactNode;
  size?: Of<'size'>;
  /** `a2ui` is the agent surface's pre-library light copy card (UMK-1307); only its adapter passes it. */
  appearance?: Of<'appearance'>;
  /**
   * Fires once after the clipboard write succeeds — a notification, not the copy itself.
   * Deliberately not `onCopy`: the native sibling's `onCopy` PERFORMS the write, so the same
   * name would mean two different things across platforms. Web-only, so no contract entry.
   */
  onCopied?: () => void;
  /**
   * Controls rendered in the header bar, before the copy control. Native mirror: UMK-1371 (UMK-1041): the Mermaid
   * diagram's download/expand toolbar lives here rather than in a second bar of its own.
   */
  actions?: React.ReactNode;
  /** `false` removes the copy control — for a body that is not text to copy. Defaults to `true`. */
  copyable?: boolean;
  /** `true` renders the body as a `div` rather than `code`, for an SVG diagram. Defaults to `false`. */
  diagram?: boolean;
  className?: string;
}

type State = 'idle' | 'copied' | 'failed';

const LABELS: Record<State, string> = {
  idle: 'Salin',
  copied: 'Tersalin',
  failed: 'Gagal menyalin',
};

/**
 * A fenced block with a header bar and a copy control.
 *
 * A REJECTED WRITE FAILS VISIBLY. `navigator.clipboard` is absent outside a secure context and
 * its write rejects when the document is not focused or permission is refused — and both live
 * copies call `.then()` with no rejection handler at all, so the button silently does nothing
 * and the user tries again. There is no `execCommand` fallback: it is deprecated, it needs a
 * live selection, and telling someone the copy failed is more useful than a second silent
 * path. The state is announced as well as coloured, because a glyph swap is not a channel
 * every reader has.
 */
export const CodeBlock = React.forwardRef<HTMLDivElement, CodeBlockProps>(
  ({ children, copyText, label, size = 'large', appearance = 'default', onCopied, actions, copyable = true, diagram = false, className }, ref) => {
    const [state, setState] = React.useState<State>('idle');
    const timer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

    /* Cleared on unmount, or a block copied and then closed sets state on a gone component. */
    React.useEffect(() => () => clearTimeout(timer.current), []);

    const settle = (next: State) => {
      setState(next);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setState('idle'), SETTLE_MS);
    };

    const copy = async () => {
      const text = copyText ?? (typeof children === 'string' ? children : '');
      /* NOTHING TO COPY IS A FAILURE, not a success. `writeText('')` resolves happily, so
         without this the control announces "Tersalin" having put nothing on the clipboard —
         and element children with no `copyText` is the normal case for both named consumers,
         so the first migration would hit it. */
      if (!text) return settle('failed');
      try {
        await navigator.clipboard.writeText(text);
        settle('copied');
      } catch {
        /* Swallowed on purpose, and REPLACED by a visible state — the rejection carries
           nothing a user can act on, and rethrowing it here would take the surface down. */
        return settle('failed');
      }
      /* OUTSIDE the try: a throwing callback is the caller's bug, and must not turn a copy that
         succeeded into a visible "Gagal menyalin". */
      onCopied?.();
    };

    const Body = diagram ? 'div' : 'code';
    const actionsSlot = actions !== undefined && actions !== null && <span className={CODE_BLOCK_ACTIONS}>{actions}</span>;

    if (appearance === 'a2ui') {
      // The pre-library card: light, label left, an orange text action with no glyph, and the body in mono.
      return (
        <div ref={ref} className={cn(A2UI_CODE_BLOCK, className)}>
          <div className={A2UI_CODE_BAR}>
            <span className={A2UI_CODE_LABEL}>{label}</span>
            {actionsSlot}
            {copyable && (
              <button
                type="button"
                onClick={copy}
                className={cn(A2UI_CODE_ACTION, state === 'failed' && CODE_BLOCK_FAILED)}
              >
                <span aria-live="polite">{state === 'copied' ? 'Tersalin ✓' : LABELS[state]}</span>
              </button>
            )}
          </div>
          <Body className={A2UI_CODE_BODY}>{children}</Body>
        </div>
      );
    }

    return (
      <div ref={ref} className={cn(CODE_BLOCK_BASE, className)}>
        <div className={cn(CODE_BLOCK_BAR, SIZE[size])}>
          <span>{label}</span>
          {actionsSlot}
          {copyable && (
            <button
              type="button"
              onClick={copy}
              className={cn(CODE_BLOCK_ACTION, state === 'failed' && CODE_BLOCK_FAILED)}
            >
              <Icon name={state === 'copied' ? 'check-circle' : 'copy'} size="sm" aria-hidden />
              {/* The word, not only the glyph — and in a live region, so the change is heard
                  rather than only seen. */}
              <span aria-live="polite">{LABELS[state]}</span>
            </button>
          )}
        </div>
        <Body className={cn(CODE_BLOCK_BODY, SIZE[size])}>{children}</Body>
      </div>
    );
  },
);

CodeBlock.displayName = 'CodeBlock';
