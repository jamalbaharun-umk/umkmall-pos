'use client';

import React from 'react';
import { contract } from '../../contract';
import { cn } from '../../utils';
import { Icon } from '../Icon';
import {
  COMPOSER_VOICE_BAR,
  COMPOSER_VOICE_BAR_SIZE,
  COMPOSER_VOICE_GLYPH,
  COMPOSER_VOICE_HALO,
  COMPOSER_VOICE_LABEL,
  COMPOSER_VOICE_MIDDLE,
  COMPOSER_VOICE_PUCK,
  COMPOSER_VOICE_PUCK_SIZE,
  COMPOSER_VOICE_STOP,
  COMPOSER_VOICE_STOP_GLYPH,
  COMPOSER_VOICE_STOP_SIZE,
} from '../composer-classes';
import { ChatSoundWave } from './ChatSoundWave';

type Axes = typeof contract.ChatVoiceBar.axes;
type Of<K extends keyof Axes> = Axes[K][number];

export interface ChatVoiceBarProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'children'> {
  /** Which icon row this bar is standing in for — it is the bar's height, not a general scale. */
  size: Of<'size'>;
  /** What the bar says it is doing. The caller's, because it is the only copy on the row. */
  label: React.ReactNode;
  /** The accessible name of the stop control, which is a different sentence from `label`. */
  stopLabel: string;
  /** Halts the recording. The bar never stops anything itself. */
  onStop: () => void;
}

/**
 * The row the composer shows in place of its icon row while the microphone is open.
 *
 * IT OWNS NO MICROPHONE. No permission prompt, no recorder, no transcript, no metering — it is
 * TOLD it is listening and draws that. Everything the app's two copies of this bar do beyond
 * drawing lives in the hook behind them, which is why this adopts on both surfaces unchanged.
 *
 * IT ANNOUNCES ITSELF POLITELY. The bar appears mid-composition, takes no focus, and replaces the
 * controls a reader was about to reach for; without a live region a screen-reader user finds out
 * only by discovering the send button has gone. `polite` rather than `assertive` because nothing
 * here is an emergency and the user is the one who started it.
 *
 * THE STOP CONTROL DRAWS A PAUSE ON THE ERROR FILL, which looks like a contradiction and is not:
 * red says "this is recording, act on it" and the pause shape says the recording HALTS rather than
 * being discarded. Those are two different promises to two different readers, so the accessible
 * name is the caller's and is asserted to be the action rather than the glyph.
 */
export const ChatVoiceBar = React.forwardRef<HTMLDivElement, ChatVoiceBarProps>(
  function ChatVoiceBar({ size, label, stopLabel, onStop, className, ...rest }, ref) {
    return (
      <div
        ref={ref}
        data-size={size}
        data-testid="chat-voice-bar"
        aria-live="polite"
        className={cn(COMPOSER_VOICE_BAR, COMPOSER_VOICE_BAR_SIZE[size], className)}
        {...rest}
      >
        <div className="relative shrink-0">
          <span aria-hidden className={COMPOSER_VOICE_HALO} />
          <span className={cn(COMPOSER_VOICE_PUCK, COMPOSER_VOICE_PUCK_SIZE[size])}>
            {/* From the registry, never redrawn here: the app inlined this artwork at both of its
                call sites and the two copies had already diverged (UMK-956's lesson, one glyph on). */}
            <Icon name="composer-mic" aria-hidden className={COMPOSER_VOICE_GLYPH[size]} />
          </span>
        </div>

        <div className={COMPOSER_VOICE_MIDDLE}>
          <span className={COMPOSER_VOICE_LABEL[size]}>{label}</span>
          <ChatSoundWave state="listening" />
        </div>

        <button
          type="button"
          onClick={onStop}
          title={stopLabel}
          aria-label={stopLabel}
          className={cn(COMPOSER_VOICE_STOP, COMPOSER_VOICE_STOP_SIZE[size])}
        >
          <Icon
            name="pause"
            aria-hidden
            fill="currentColor"
            strokeWidth={0}
            className={COMPOSER_VOICE_STOP_GLYPH[size]}
          />
        </button>
      </div>
    );
  },
);
