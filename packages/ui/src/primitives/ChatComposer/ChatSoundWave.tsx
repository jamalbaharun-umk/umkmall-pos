'use client';

import React from 'react';
import { contract } from '../../contract';
import { cn } from '../../utils';
import { COMPOSER_WAVE, COMPOSER_WAVE_BAR, COMPOSER_WAVE_STATE } from '../composer-classes';

type Axes = typeof contract.ChatSoundWave.axes;
type Of<K extends keyof Axes> = Axes[K][number];

export interface ChatSoundWaveProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Whether the bars are moving. Defaults to `listening`, which is when this is ever mounted. */
  state?: Of<'state'>;
  /**
   * How many bars. A QUANTITY, not a look — see the contract entry for why it is not an axis.
   * Five is what both shipped surfaces draw.
   */
  bars?: number;
}

/** The delay that turns one keyframe into a waveform. Per element, so it cannot be a class. */
const STAGGER_MS = 100;

/**
 * The five bars that say a microphone is open.
 *
 * `aria-hidden`, UNCONDITIONALLY. It is decoration for a state the bar around it already
 * announces, and a waveform that announced itself would read out five empty elements on every
 * frame of a live region. The caller that needs the state spoken says so on its own row — which
 * `ChatVoiceBar` does.
 *
 * THE DELAY IS AN INLINE STYLE AND CANNOT BE A CLASS. Tailwind can express one delay per utility,
 * and this needs a different one per bar off a count the caller supplies; an arbitrary value built
 * from `i` would be generated from a template literal the JIT never reads, which is the quietest
 * way to ship five bars moving in unison.
 */
export const ChatSoundWave = React.forwardRef<HTMLDivElement, ChatSoundWaveProps>(
  function ChatSoundWave({ state = 'listening', bars = 5, className, ...rest }, ref) {
    return (
      <div
        ref={ref}
        aria-hidden
        data-state={state}
        className={cn(COMPOSER_WAVE, className)}
        {...rest}
      >
        {Array.from({ length: bars }, (_, i) => (
          <div
            key={i}
            className={cn(COMPOSER_WAVE_BAR, COMPOSER_WAVE_STATE[state])}
            style={state === 'listening' ? { animationDelay: `${i * STAGGER_MS}ms` } : undefined}
          />
        ))}
      </div>
    );
  },
);
