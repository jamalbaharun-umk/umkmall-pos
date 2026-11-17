/** Keyboard-aware `fullHeight` (UMK-1499): the sheet gets `--dialog-sheet-h` / `--dialog-sheet-top` only with a keyboard open. */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render } from '@testing-library/react';
import { Dialog } from '../Dialog';

class FakeViewport extends EventTarget {
  height = 800;
  offsetTop = 0;
  scale = 1;
}
const INNER = 800;
let vv: FakeViewport;
const original = Object.getOwnPropertyDescriptor(window, 'visualViewport');

const fire = (type: 'resize' | 'scroll' = 'resize') => act(() => { vv.dispatchEvent(new Event(type)); vi.advanceTimersByTime(20); });
const panelOf = (props: Partial<React.ComponentProps<typeof Dialog>> = {}) => {
  const view = render(
    <Dialog open onOpenChange={() => {}} title="Penuh" {...props}>
      <div>isi</div>
    </Dialog>,
  );
  act(() => { vi.advanceTimersByTime(20); });
  return { ...view, panel: () => view.baseElement.querySelector('[role="dialog"]') as HTMLElement };
};
const vars = (el: HTMLElement) => [el.style.getPropertyValue('--dialog-sheet-h'), el.style.getPropertyValue('--dialog-sheet-top')];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout', 'clearTimeout'] });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: INNER });
  vv = new FakeViewport();
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: vv });
});
afterEach(() => {
  vi.useRealTimers();
  if (original) Object.defineProperty(window, 'visualViewport', original);
  else delete (window as unknown as Record<string, unknown>).visualViewport;
});

describe('Dialog fullHeight keyboard vars', () => {
  it('sets none with no keyboard, both when it opens, and removes both when it closes', () => {
    const { panel } = panelOf({ fullHeight: true });
    expect(vars(panel())).toEqual(['', '']);
    vv.height = INNER - 300;
    fire();
    expect(vars(panel())).toEqual(['500px', '0px']);
    vv.height = INNER;
    fire();
    expect(vars(panel())).toEqual(['', '']);
  });

  it('sets the top from a nonzero offsetTop (iOS scrolled viewport)', () => {
    const { panel } = panelOf({ fullHeight: true });
    vv.height = 500;
    vv.offsetTop = 100;
    fire('scroll');
    expect(vars(panel())).toEqual(['500px', '100px']);
  });

  it('sets none when the viewport is shorter only because of offsetTop (inset 0)', () => {
    const { panel } = panelOf({ fullHeight: true });
    vv.height = 700;
    vv.offsetTop = 100;
    fire('scroll');
    expect(vars(panel())).toEqual(['', '']);
  });

  it('sets none while pinch-zoomed', () => {
    const { panel } = panelOf({ fullHeight: true });
    vv.height = 400;
    vv.scale = 2;
    fire();
    expect(vars(panel())).toEqual(['', '']);
  });

  it.each([
    ['a plain sheet', {}],
    ['a centred card', { centered: true }],
    ['a side drawer', { side: 'right' as const }],
  ])('sets none on %s even with the keyboard open', (_n, props) => {
    const { panel } = panelOf(props);
    vv.height = INNER - 300;
    fire();
    expect(vars(panel())).toEqual(['', '']);
  });

  it('sets none where visualViewport is absent', () => {
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: undefined });
    const { panel } = panelOf({ fullHeight: true });
    expect(vars(panel())).toEqual(['', '']);
  });

  it.each([
    ['a plain sheet', {}],
    ['a centred card', { centered: true }],
    ['a side drawer', { side: 'right' as const }],
  ])('adds no viewport listener for %s', (_n, props) => {
    const add = vi.spyOn(vv, 'addEventListener');
    panelOf(props);
    expect(add).not.toHaveBeenCalled();
  });

  it('listens for a fullHeight sheet, and not while it is closed', () => {
    const add = vi.spyOn(vv, 'addEventListener');
    const closed = render(
      <Dialog open={false} onOpenChange={() => {}} title="x" fullHeight>
        <div>isi</div>
      </Dialog>,
    );
    expect(add).not.toHaveBeenCalled();
    closed.unmount();
    panelOf({ fullHeight: true });
    expect(add).toHaveBeenCalled();
  });

  it('reopening after the keyboard closed starts with no stale vars, then listens again', () => {
    const add = vi.spyOn(vv, 'addEventListener');
    const ui = (open: boolean) => (
      <Dialog open={open} onOpenChange={() => {}} title="Penuh" fullHeight>
        <div>isi</div>
      </Dialog>
    );
    const view = render(ui(true));
    const panel = () => view.baseElement.querySelector('[role="dialog"]') as HTMLElement;
    act(() => { vi.advanceTimersByTime(20); });
    vv.height = 500;
    fire();
    expect(vars(panel())).toEqual(['500px', '0px']);

    view.rerender(ui(false));
    vv.height = INNER;
    add.mockClear();
    view.rerender(ui(true));
    // Before any frame: the measurement from the earlier open must not be drawn.
    expect(vars(panel())).toEqual(['', '']);
    act(() => { vi.advanceTimersByTime(20); });
    expect(vars(panel())).toEqual(['', '']);
    expect(add.mock.calls.map((c) => c[0]).sort()).toEqual(['resize', 'scroll']);
  });
});

describe('Dialog keyboardAware (opt-in lift of a plain sheet, UMK-1499 F1)', () => {
  const kb = (el: HTMLElement) => [el.style.getPropertyValue('--dialog-kb-inset'), el.style.getPropertyValue('--dialog-kb-h')];

  it('off (the default): no keyboard style and no lift classes, even with a keyboard open', () => {
    const { panel } = panelOf();
    vv.height = INNER - 300;
    fire();
    expect(kb(panel())).toEqual(['', '']);
    expect(panel().className).not.toContain('--dialog-kb-inset');
  });

  it('on with the keyboard open: lifted by the inset and capped to the visible height', () => {
    const { panel } = panelOf({ keyboardAware: true });
    vv.height = INNER - 300;
    fire();
    expect(kb(panel())).toEqual(['300px', '500px']);
    expect(panel().className).toContain('bottom-[var(--dialog-kb-inset,0px)]');
    expect(panel().className).toContain('max-h-[min(88dvh,var(--dialog-kb-h,88dvh))]');
  });

  it('on with an iOS scrolled viewport: the inset is what the keyboard covers (offsetTop excluded)', () => {
    const { panel } = panelOf({ keyboardAware: true });
    vv.height = 400;
    vv.offsetTop = 100;
    fire('scroll');
    expect(kb(panel())).toEqual(['300px', '400px']);
  });

  it('on with the keyboard closed: no style at all, and it clears again when the keyboard goes', () => {
    const { panel } = panelOf({ keyboardAware: true });
    expect(kb(panel())).toEqual(['', '']);
    vv.height = INNER - 300;
    fire();
    expect(kb(panel())[0]).toBe('300px');
    vv.height = INNER;
    fire();
    expect(kb(panel())).toEqual(['', '']);
  });

  it.each([
    ['a centred card', { centered: true }],
    ['a side drawer', { side: 'right' as const }],
  ])('keyboardAware is ignored on %s: no style, no lift class, no viewport listener', (_n, props) => {
    const add = vi.spyOn(vv, 'addEventListener');
    const { panel } = panelOf({ keyboardAware: true, ...props });
    vv.height = INNER - 300;
    fire();
    expect(kb(panel())).toEqual(['', '']);
    expect(panel().className).not.toContain('--dialog-kb-inset');
    expect(add).not.toHaveBeenCalled();
  });

  it('does not touch a fullHeight sheet (it keeps its own vars)', () => {
    const { panel } = panelOf({ keyboardAware: true, fullHeight: true });
    vv.height = INNER - 300;
    fire();
    expect(kb(panel())).toEqual(['', '']);
    expect(vars(panel())).toEqual(['500px', '0px']);
  });
});

