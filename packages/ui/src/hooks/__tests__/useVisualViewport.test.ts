/** The visual-viewport hook (UMK-1499): null without a viewport or while pinch-zoomed, else height / offsetTop / inset. happy-dom has no visualViewport, so it is faked. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useVisualViewport } from '../useVisualViewport';

class FakeViewport extends EventTarget {
  height = 800;
  offsetTop = 0;
  scale = 1;
}
const INNER = 800;
let vv: FakeViewport;
const original = Object.getOwnPropertyDescriptor(window, 'visualViewport');
const install = (v: FakeViewport | undefined) => Object.defineProperty(window, 'visualViewport', { configurable: true, value: v });
const fire = (type: 'resize' | 'scroll') => act(() => { vv.dispatchEvent(new Event(type)); vi.advanceTimersByTime(20); });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout', 'clearTimeout'] });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: INNER });
  vv = new FakeViewport();
  install(vv);
});
afterEach(() => {
  vi.useRealTimers();
  if (original) Object.defineProperty(window, 'visualViewport', original);
  else delete (window as unknown as Record<string, unknown>).visualViewport;
});

describe('useVisualViewport', () => {
  it('reads the shape on mount, then follows resize', () => {
    const { result } = renderHook(() => useVisualViewport());
    act(() => { vi.advanceTimersByTime(20); });
    expect(result.current).toEqual({ height: 800, offsetTop: 0, inset: 0 });
    vv.height = INNER - 300;
    fire('resize');
    expect(result.current).toEqual({ height: 500, offsetTop: 0, inset: 300 });
  });

  it('takes offsetTop off the inset and follows scroll', () => {
    const { result } = renderHook(() => useVisualViewport());
    vv.height = 500;
    vv.offsetTop = 100;
    fire('scroll');
    expect(result.current).toEqual({ height: 500, offsetTop: 100, inset: 200 });
  });

  it('is null while pinch-zoomed, and recovers', () => {
    const { result } = renderHook(() => useVisualViewport());
    vv.height = 400;
    vv.scale = 2;
    fire('resize');
    expect(result.current).toBeNull();
    vv.scale = 1;
    vv.height = INNER;
    fire('resize');
    expect(result.current).toEqual({ height: 800, offsetTop: 0, inset: 0 });
  });

  it('is null where visualViewport is absent', () => {
    install(undefined);
    const { result } = renderHook(() => useVisualViewport());
    act(() => { vi.advanceTimersByTime(20); });
    expect(result.current).toBeNull();
  });

  it('coalesces a burst of events into one frame', () => {
    const raf = vi.spyOn(globalThis, 'requestAnimationFrame');
    renderHook(() => useVisualViewport());
    act(() => { vi.advanceTimersByTime(20); });
    raf.mockClear();
    act(() => {
      vv.dispatchEvent(new Event('resize'));
      vv.dispatchEvent(new Event('scroll'));
      vv.dispatchEvent(new Event('resize'));
    });
    expect(raf).toHaveBeenCalledTimes(1);
  });

  it('removes the very handlers it added on unmount', () => {
    const add = vi.spyOn(vv, 'addEventListener');
    const remove = vi.spyOn(vv, 'removeEventListener');
    const { unmount } = renderHook(() => useVisualViewport());
    unmount();
    expect(add.mock.calls.map((c) => c[0]).sort()).toEqual(['resize', 'scroll']);
    expect(remove.mock.calls.map((c) => c[0]).sort()).toEqual(['resize', 'scroll']);
    for (const type of ['resize', 'scroll']) {
      const added = add.mock.calls.find((c) => c[0] === type)![1];
      const removed = remove.mock.calls.find((c) => c[0] === type)![1];
      expect(removed).toBe(added);
    }
  });

  it('cancels a pending frame on unmount and updates nothing afterwards', () => {
    const cancel = vi.spyOn(globalThis, 'cancelAnimationFrame');
    const { result, unmount } = renderHook(() => useVisualViewport());
    act(() => { vi.advanceTimersByTime(20); });
    vv.height = INNER - 300;
    act(() => { vv.dispatchEvent(new Event('resize')); });
    cancel.mockClear();
    unmount();
    expect(cancel).toHaveBeenCalledTimes(1);
    act(() => { vi.advanceTimersByTime(50); });
    expect(result.current).toEqual({ height: 800, offsetTop: 0, inset: 0 });
  });

  it('adds no listener and reads null while disabled, and listens once enabled', () => {
    const add = vi.spyOn(vv, 'addEventListener');
    const { result, rerender } = renderHook(({ on }) => useVisualViewport(on), { initialProps: { on: false } });
    act(() => { vi.advanceTimersByTime(20); });
    expect(add).not.toHaveBeenCalled();
    expect(result.current).toBeNull();
    rerender({ on: true });
    act(() => { vi.advanceTimersByTime(20); });
    expect(add).toHaveBeenCalledTimes(2);
    expect(result.current).toEqual({ height: 800, offsetTop: 0, inset: 0 });
    rerender({ on: false });
    expect(result.current).toBeNull();
  });
});
