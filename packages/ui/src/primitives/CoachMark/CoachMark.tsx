'use client';

import React from 'react';
import { cn } from '../../utils';
import { Button } from '../Button';

/**
 * POS LOCAL ADDITION (owner exception 2026-11-28, UMK-2134, like the charts): one step of a step-by-step guide.
 *
 * It outlines one element of the page (`target`) in the primary blue and puts a short bubble next to it: "1 dari 5",
 * a title, one sentence, and Lanjut (Selesai on the last step) / Kembali / Lewati panduan. It NEVER advances on its
 * own: only the buttons (or Escape, which skips) move it. Without a target (the element is not on the page) the
 * bubble sits at the bottom of the screen with no outline.
 *
 * Not a modal: the page behind stays usable, so the bubble is a labelled group, not a dialog, and it does not
 * trap focus. Text is at least 16 px; `largeText` makes it 20 px (the "Teks besar" switch).
 *
 * Buttons follow the POS button rule: on a phone a full-width column, primary on top; from `sm` one right-aligned
 * row, secondary first and primary last; one line, 44 px, 12 px radius.
 */
export type CoachMarkProps = {
  /** The element to outline; null or absent places the bubble at the bottom without an outline. */
  target?: Element | null;
  /** 1-based step number and the number of steps. */
  step: number;
  total: number;
  title: string;
  text: string;
  onNext: () => void;
  onBack?: () => void;
  onSkip: () => void;
  largeText?: boolean;
  /** Labels, Indonesian by default. */
  nextLabel?: string;
  doneLabel?: string;
  backLabel?: string;
  skipLabel?: string;
  className?: string;
};

type Box = { top: number; left: number; width: number; height: number };

const GAP = 12;
const BUBBLE_MAX = 360;

/** Where the bubble goes: below the target when it fits, else above; never off screen. Pure, for tests. */
export function placeBubble(
  box: Box | null,
  viewport: { width: number; height: number },
  bubbleHeight: number,
): { top: number; left: number; width: number } {
  const width = Math.min(BUBBLE_MAX, viewport.width - 2 * 16);
  if (!box) return { top: viewport.height - bubbleHeight - 16, left: (viewport.width - width) / 2, width };
  const below = box.top + box.height + GAP;
  const above = box.top - GAP - bubbleHeight;
  const top =
    below + bubbleHeight <= viewport.height - 16
      ? below
      : above >= 16
        ? above
        : Math.max(16, viewport.height - bubbleHeight - 16);
  const centre = box.left + box.width / 2 - width / 2;
  const left = Math.min(Math.max(16, centre), viewport.width - width - 16);
  return { top, left, width };
}

function useBox(target: Element | null | undefined): Box | null {
  const [box, setBox] = React.useState<Box | null>(null);
  React.useLayoutEffect(() => {
    if (!target) {
      setBox(null);
      return;
    }
    target.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    let frame = 0;
    const read = () => {
      const r = target.getBoundingClientRect();
      setBox((b) =>
        b && b.top === r.top && b.left === r.left && b.width === r.width && b.height === r.height
          ? b
          : { top: r.top, left: r.left, width: r.width, height: r.height },
      );
    };
    const tick = () => {
      read();
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [target]);
  return box;
}

export function CoachMark({
  target,
  step,
  total,
  title,
  text,
  onNext,
  onBack,
  onSkip,
  largeText,
  nextLabel = 'Lanjut',
  doneLabel = 'Selesai',
  backLabel = 'Kembali',
  skipLabel = 'Lewati panduan',
  className,
}: CoachMarkProps) {
  const box = useBox(target);
  const bubble = React.useRef<HTMLDivElement>(null);
  const [height, setHeight] = React.useState(200);
  const [viewport, setViewport] = React.useState({ width: 1024, height: 768 });
  const titleId = React.useId();
  const last = step >= total;

  React.useLayoutEffect(() => {
    const read = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    read();
    window.addEventListener('resize', read);
    return () => window.removeEventListener('resize', read);
  }, []);
  React.useLayoutEffect(() => {
    if (bubble.current) setHeight(bubble.current.offsetHeight);
  }, [step, text, largeText, viewport.width]);
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onSkip();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onSkip]);
  // The bubble takes focus on each step, so a keyboard or screen-reader user hears the step.
  React.useEffect(() => {
    bubble.current?.focus({ preventScroll: true });
  }, [step]);

  const place = placeBubble(box, viewport, height);
  const button = 'h-11 rounded-[12px] whitespace-nowrap w-full sm:w-auto';

  return (
    <>
      {box && (
        <div
          aria-hidden
          data-coach-outline=""
          className="pointer-events-none fixed z-ds-overlay rounded-ds-lg border-2 border-default-brand"
          style={{ top: box.top - 4, left: box.left - 4, width: box.width + 8, height: box.height + 8 }}
        />
      )}
      <div
        ref={bubble}
        role="group"
        aria-roledescription="panduan"
        aria-labelledby={titleId}
        tabIndex={-1}
        data-coach-mark=""
        className={cn(
          'fixed z-ds-overlay flex flex-col gap-3 rounded-ds-lg border border-default-brand bg-default-primary p-4 shadow-lg outline-none',
          largeText ? 'text-ds-h5-desktop' : 'text-ds-paragraph-desktop',
          className,
        )}
        style={{ top: place.top, left: place.left, width: place.width }}
      >
        <p className={cn('text-default-secondary', largeText ? 'text-ds-h6-desktop' : 'text-ds-paragraph-desktop')}>
          {step} dari {total}
        </p>
        <p id={titleId} className="font-semibold text-default-primary">
          {title}
        </p>
        <p className="text-default-primary">{text}</p>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
          <Button type="text" color="primary" width="auto" className={cn(button, 'order-3 sm:order-1 sm:mr-auto')} onClick={onSkip}>
            {skipLabel}
          </Button>
          {onBack && step > 1 && (
            <Button type="outline" color="primary" width="auto" className={cn(button, 'order-2')} onClick={onBack}>
              {backLabel}
            </Button>
          )}
          <Button type="primary" color="primary" width="auto" className={cn(button, 'order-1 sm:order-3')} onClick={onNext}>
            {last ? doneLabel : nextLabel}
          </Button>
        </div>
      </div>
    </>
  );
}
