'use client';

import { useEffect, useState } from 'react';

/** What the visual viewport looks like right now, in layout-viewport px. */
export interface VisualViewportState {
  /** The visual viewport's height (the layout viewport minus the on-screen keyboard). */
  height: number;
  /** How far the visual viewport is scrolled down inside the layout viewport (iOS Safari with the keyboard open). */
  offsetTop: number;
  /** px of the layout viewport the keyboard covers: `max(0, innerHeight - height - offsetTop)`. */
  inset: number;
}

/**
 * The visual viewport, or `null` where `window.visualViewport` is absent (SSR, old browsers) and
 * while pinch-zoomed (a zoomed viewport is smaller without any keyboard, so it says nothing about one).
 * Updates are coalesced per animation frame. Web entry only: native has no `window`.
 *
 * `enabled` (default true) is for a caller that only sometimes needs the measurement: while it is false
 * there is no listener and no re-render, and the state reads `null`.
 */
export function useVisualViewport(enabled = true): VisualViewportState | null {
  const [state, setState] = useState<VisualViewportState | null>(null);

  useEffect(() => {
    if (!enabled) {
      setState((prev) => (prev === null ? prev : null));
      return;
    }
    const vv = window.visualViewport;
    if (!vv) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      if (vv.scale > 1.01) {
        setState((prev) => (prev === null ? prev : null));
        return;
      }
      const { height, offsetTop } = vv;
      const inset = Math.max(0, window.innerHeight - height - offsetTop);
      setState((prev) =>
        prev && prev.height === height && prev.offsetTop === offsetTop && prev.inset === inset
          ? prev
          : { height, offsetTop, inset },
      );
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    schedule();
    vv.addEventListener('resize', schedule);
    vv.addEventListener('scroll', schedule);
    return () => {
      vv.removeEventListener('resize', schedule);
      vv.removeEventListener('scroll', schedule);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [enabled]);

  return enabled ? state : null;
}
