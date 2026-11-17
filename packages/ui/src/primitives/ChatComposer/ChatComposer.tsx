'use client';

import React from 'react';
import { contract } from '../../contract';
import { cn } from '../../utils';
import {
  COMPOSER_BASE,
  COMPOSER_GROUP,
  COMPOSER_OUTER,
  COMPOSER_OVERLAY,
  COMPOSER_RAISED,
  COMPOSER_HERO_EDGE,
  COMPOSER_ROW,
  COMPOSER_SHELL,
  COMPOSER_TRAY,
  COMPOSER_TRAY_TONE,
} from '../composer-classes';
import { ChatComposerInput, type ChatComposerInputProps } from './ChatComposerInput';

type Axes = typeof contract.ChatComposer.axes;

/**
 * The tray's semantic treatments — `Alert`'s vocabulary, as everywhere else in this family.
 *
 * THE DEPENDENCY RUNS CONTRACT → TABLE, not the reverse (UMK-900). It was `keyof typeof
 * COMPOSER_TRAY_TONE`, which made the class table the vocabulary: a fifth key there would have
 * been a tone the contract never heard of, and native could not have mirrored it.
 */
export type ChatComposerTone = Axes['tone'][number];

export interface ChatComposerProps {
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  placeholderSlot?: React.ReactNode;
  /** Required: the editor carries no visible label of its own. */
  editorLabel: string;
  /**
   * Disables the EDITOR only.
   *
   * It does not cascade to the action slots, and cannot: their contents are the caller's elements,
   * and reaching into children to inject a prop would break the moment one is wrapped. A host
   * disabling the composer passes the same flag to the buttons it puts in the slots.
   */
  disabled?: boolean;

  onEditorKeyDown?: React.KeyboardEventHandler<HTMLTextAreaElement>;
  onEditorPaste?: React.ClipboardEventHandler<HTMLTextAreaElement>;
  onEditorFocus?: React.FocusEventHandler<HTMLTextAreaElement>;
  onEditorBlur?: React.FocusEventHandler<HTMLTextAreaElement>;

  /**
   * The control row's two groups.
   *
   * SLOTS RATHER THAN PER-BUTTON PROPS. These replaced thirteen — three `show*` booleans, four
   * `*Active` flags, four handlers, `sendDisabled` and a `labels` record — every one of which was
   * plumbing for state the host already held. The four buttons are exported components; a host
   * composes the ones it wants, in the order it wants, and adding a fifth control later needs no
   * change here.
   *
   * The trade is that the shell can no longer guarantee a send button exists. That is covered by a
   * story and a guard over the documented composition rather than by types, because a type that
   * demanded one would also forbid the surfaces that legitimately have none.
   */
  toolActions?: React.ReactNode;
  sendActions?: React.ReactNode;

  /**
   * REPLACES the two groups and spans the row. `ChatVoiceBar` is what goes in it.
   *
   * IT IS NOT A THIRTEENTH PROP OF THE KIND THE SLOTS EXIST TO AVOID. The two groups are a
   * LAYOUT — one flex item each side of a `justify-between` row, both sized to their content —
   * and a control that has to span the row cannot be expressed as either of them. Passing the bar
   * as `toolActions` renders it at its intrinsic width with the rest of the row empty beside it:
   * every class on the element is still correct and nothing fails, which is the shape of defect
   * this package keeps recording.
   *
   * REPLACING RATHER THAN STACKING, because that is what the surface does. The listening bar
   * stands in for the attach / voice / send row below the editor (UMK-679 moved it there from
   * above the editor), and its two heights exist so the composer does not jump when recording
   * starts — a bar rendered in ADDITION to the row would grow the composer by its own height and
   * make both of those measurements meaningless.
   *
   * `toolActions` and `sendActions` are ignored while this is filled, silently and on purpose: a
   * host swapping the row in does not want to unmount its own buttons first, and the state is
   * momentary.
   */
  actionRow?: React.ReactNode;

  /**
   * Chrome ABOVE and BELOW the bordered box — `ChatDrawer` is what usually goes in them.
   *
   * Outside the box on purpose: it carries `focus-within` styling, so anything inside it gets the
   * focus band drawn around it when the editor is focused. `header` and `footer` are the names
   * `AppShell` and `Sidebar` already use for chrome around a body.
   *
   * Filling either one turns the outer column into a TRAY: a tinted, rounded panel that runs
   * behind the editor box and shows as a margin around it. Filling neither leaves a bare bar, so a
   * composer at rest adds no container and no gap.
   */
  header?: React.ReactNode;
  footer?: React.ReactNode;
  /**
   * The tray's tone. Has no effect until a `header` or `footer` is filled, because there is no
   * tray until then.
   *
   * ONE TONE PER COMPOSER, deliberately. The tint is a property of the panel, not of each slot, so
   * a header and a footer on the same composer share it — a composer cannot say danger at the top
   * and warning at the bottom. That is the honest reading of a surface telling the user one thing,
   * and it is what keeps the colour from being chosen in two places that can disagree.
   */
  tone?: ChatComposerTone;
  /** Anchored top-right inside the editor box — the mobile fullscreen trigger's home. */
  editorAffordance?: React.ReactNode;
  /**
   * Absolutely positioned over the whole component: the slash menu, the fullscreen modal.
   * Distinct from `header`/`footer`, which take space in the column.
   *
   * THE LISTENING BAR IS NOT ONE OF THESE, though it was listed here until `ChatVoiceBar` landed
   * — it REPLACES the action row rather than floating over the composer, which is `actionRow`.
   */
  overlay?: React.ReactNode;

  /** Extra classes for the editor textarea (a minimum height). Native mirror: UMK-1371 (UMK-1041). */
  editorClassName?: string;
  /**
   * Anchored to the EDITOR box rather than the whole composer, so a menu positioned against the
   * text sits against the text. Distinct from `overlay`, which anchors to the composer. Native mirror: UMK-1371
   * (UMK-1041).
   */
  editorOverlay?: React.ReactNode;
  /** The editor's soft-keyboard hints — see `ChatComposerInput`. Native mirror: UMK-1371 (UMK-1041, L17). */
  editorInputMode?: ChatComposerInputProps['inputMode'];
  editorEnterKeyHint?: ChatComposerInputProps['enterKeyHint'];
  editorAutoCapitalize?: ChatComposerInputProps['autoCapitalize'];
  editorSpellCheck?: ChatComposerInputProps['spellCheck'];
  /**
   * Lifts the box with a larger shadow, at rest and on focus. For the one composer that is the page's
   * subject (a hero), not for the composer in a thread. Native mirror: UMK-1371 (UMK-1041, L19).
   */
  raised?: boolean;
  /**
   * With `raised` only: the V2 hero's brand → success edge and, from `md`, its Desktop radius and padding
   * (UMK-1755, `COMPOSER_HERO_EDGE`). The web sets it where `temanai-web-beranda-v2` is on; a hero from before
   * the web Beranda v2 keeps the lift alone. Native's landing draws the same edge on its own.
   */
  heroEdge?: boolean;

  className?: string;
}

/**
 * The chat composer.
 *
 * A COMPOSITION, NOT A MONOLITH. The shell owns the frame, the editor and the arrangement;
 * everything else is a component a host can also use on its own — `ChatComposerInput`,
 * `ChatDrawer`, `ChatAttachment`, and the four buttons. That split is what lets a surface with an
 * unusual toolbar build its own arrangement instead of growing this component a prop per
 * variation, and it is why the prop surface here is a third of what it was.
 *
 * WHAT IS INSIDE THE BORDERED BOX IS THE WHOLE LAYOUT DECISION. The box carries the focus band, so
 * only what is genuinely focused belongs in it: the editor and its controls. Attachments,
 * warnings and hints sit in `header`/`footer` OUTSIDE it — otherwise focusing the editor rings a
 * region the focus is not in.
 *
 * SHIPS UNCONSUMED. Nothing in `apps/` imports it; adoption is M4 (UMK-878).
 */
export const ChatComposer = React.forwardRef<HTMLTextAreaElement, ChatComposerProps>(
  function ChatComposer(
    {
      value,
      onValueChange,
      placeholder,
      placeholderSlot,
      editorLabel,
      disabled = false,
      onEditorKeyDown,
      onEditorPaste,
      onEditorFocus,
      onEditorBlur,
      toolActions,
      sendActions,
      actionRow,
      header,
      footer,
      tone = 'neutral',
      editorAffordance,
      overlay,
      editorClassName,
      editorOverlay,
      editorInputMode,
      editorEnterKeyHint,
      editorAutoCapitalize,
      editorSpellCheck,
      raised = false,
      heroEdge = false,
      className,
    },
    ref,
  ) {
    /* The tray exists only when it has something to hold — see the `header`/`footer` note. */
    const hasTray = Boolean(header) || Boolean(footer);

    return (
      <div className={COMPOSER_OVERLAY}>
        <div
          className={cn(COMPOSER_OUTER, hasTray && COMPOSER_TRAY, hasTray && COMPOSER_TRAY_TONE[tone], className)}
          data-tray={hasTray ? tone : undefined}
        >
          {header}

          {/*
            NAMED FOR THE GUARD, DELIBERATELY. The box used to be findable as "the first rounded
            element"; with the tray wrapping it, that selector picks the tray instead and the
            assertion that the header sits OUTSIDE the focus band passed against the wrong node.
          */}
          <div className={cn(COMPOSER_BASE, raised && COMPOSER_RAISED, raised && heroEdge && COMPOSER_HERO_EDGE, COMPOSER_SHELL)} data-testid="chat-composer-box">
            <ChatComposerInput
              ref={ref}
              value={value}
              onValueChange={onValueChange}
              placeholder={placeholder}
              placeholderSlot={placeholderSlot}
              label={editorLabel}
              disabled={disabled}
              affordance={editorAffordance}
              className={editorClassName}
              overlay={editorOverlay}
              inputMode={editorInputMode}
              enterKeyHint={editorEnterKeyHint}
              autoCapitalize={editorAutoCapitalize}
              spellCheck={editorSpellCheck}
              onKeyDown={onEditorKeyDown}
              onPaste={onEditorPaste}
              onFocus={onEditorFocus}
              onBlur={onEditorBlur}
            />

            {/* ONE ROW EITHER WAY, so the composer's height does not change when the row is
                swapped — see `actionRow`. The row keeps its own class in both arms because it
                owns the spacing above the controls, whatever is standing in them. */}
            <div className={COMPOSER_ROW} data-row={actionRow ? 'replaced' : 'groups'}>
              {actionRow ?? (
                <>
                  <div className={COMPOSER_GROUP}>{toolActions}</div>
                  <div className={COMPOSER_GROUP}>{sendActions}</div>
                </>
              )}
            </div>
          </div>

          {footer}
        </div>
        {overlay}
      </div>
    );
  },
);
