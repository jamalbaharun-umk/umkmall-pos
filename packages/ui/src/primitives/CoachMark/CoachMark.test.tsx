import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CoachMark, placeBubble } from './index';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('placeBubble (UMK-2134)', () => {
  const vp = { width: 375, height: 800 };
  it('puts the bubble under the target when it fits, else above, never off screen', () => {
    expect(placeBubble({ top: 100, left: 20, width: 100, height: 40 }, vp, 200)).toEqual({
      top: 152,
      left: 16,
      width: 343,
    });
    expect(placeBubble({ top: 700, left: 20, width: 100, height: 40 }, vp, 200).top).toBe(488);
    expect(placeBubble({ top: 100, left: 20, width: 100, height: 650 }, vp, 200).top).toBe(584);
  });
  it('without a target sits at the bottom, centred', () => {
    expect(placeBubble(null, { width: 1280, height: 800 }, 200)).toEqual({ top: 584, left: 460, width: 360 });
  });
});

describe('CoachMark (UMK-2134)', () => {
  let root: Root | undefined;
  let host: HTMLDivElement;
  afterEach(() => {
    act(() => root?.unmount());
    host?.remove();
  });
  const render = (el: React.ReactElement) => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root!.render(el));
    return host;
  };
  const buttons = () => [...host.querySelectorAll('button')].map((b) => b.textContent);

  it('shows the step, never a dialog, and moves only on a button', () => {
    const onNext = vi.fn();
    const onBack = vi.fn();
    const onSkip = vi.fn();
    render(
      <CoachMark step={2} total={5} title="Lihat total" text="Total dihitung sistem." onNext={onNext} onBack={onBack} onSkip={onSkip} />,
    );
    expect(host.textContent).toContain('2 dari 5');
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(buttons()).toEqual(['Lewati panduan', 'Kembali', 'Lanjut']);
    host.querySelectorAll('button')[2].click();
    host.querySelectorAll('button')[1].click();
    host.querySelectorAll('button')[0].click();
    expect([onNext.mock.calls.length, onBack.mock.calls.length, onSkip.mock.calls.length]).toEqual([1, 1, 1]);
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    expect(onSkip).toHaveBeenCalledTimes(2);
  });

  it('says Selesai on the last step, hides Kembali on the first, and grows the text on request', () => {
    render(<CoachMark step={1} total={1} title="T" text="X" largeText onNext={() => {}} onBack={() => {}} onSkip={() => {}} />);
    expect(buttons()).toEqual(['Lewati panduan', 'Selesai']);
    expect(host.querySelector('[data-coach-mark]')!.className).toContain('text-ds-h5-desktop');
  });

  it('outlines the target when there is one', () => {
    const target = document.createElement('button');
    document.body.appendChild(target);
    render(<CoachMark target={target} step={1} total={3} title="T" text="X" onNext={() => {}} onSkip={() => {}} />);
    expect(host.querySelector('[data-coach-outline]')).not.toBeNull();
    target.remove();
  });
});
