import { useEffect, useState } from 'react';

/** Width used on the server and before the first measurement: a phone. */
export const FALLBACK_WIDTH = 320;

/** Phone widths are below this; the chart picks its default height from it. */
export const DESKTOP_MIN = 640;

/**
 * The width a chart draws at. An explicit `width` wins (the PDF passes one) and nothing is
 * measured. Otherwise the first render uses `FALLBACK_WIDTH` (the same on the server and in
 * the browser, so hydration matches), and an effect measures the wrapper and follows it.
 * Nothing here touches `window` while rendering.
 */
export function useChartWidth(explicit?: number): readonly [(el: HTMLDivElement | null) => void, number] {
  /* A callback ref held in state: the wrapper only exists once the chart leaves loading/empty. */
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const [measured, setMeasured] = useState(FALLBACK_WIDTH);
  useEffect(() => {
    if (explicit != null || !el) return;
    const read = () => {
      const w = Math.floor(el.getBoundingClientRect().width);
      if (w > 0) setMeasured(w);
    };
    read();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [explicit, el]);
  return [setEl, explicit ?? measured] as const;
}

/** Mobile 140 px, desktop 220 px, inside the ranges of the guideline (110-140, 180-240). */
export function defaultHeight(width: number): number {
  return width < DESKTOP_MIN ? 140 : 220;
}
