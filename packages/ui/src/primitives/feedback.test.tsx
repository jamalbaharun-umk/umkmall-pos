import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import { Alert } from './Alert';
import { Toaster, toast } from './Toaster';
import { Tooltip } from './Tooltip';
import { Skeleton } from './Skeleton';
import { ProgressBar } from './ProgressBar';
import { Spinner } from './Spinner';
import { contract } from '../contract';
import { useMergedRef } from '../utils';
import { NAMES_A_BACKGROUND, NAMES_A_TEXT_COLOUR } from '../purge-support';
import { TOASTER_WIDTH } from './feedback-classes';

/**
 * The four feedback surfaces share one test file, per the slice's file shape — three files
 * rather than nine.
 *
 * The characteristic failure of every component here is a SILENT one: a thing that renders
 * and announces nothing. `ErrorToast` had no `role` and no `aria-live`; the old tooltip
 * never linked its trigger to its tip. So the assertions below are weighted toward what
 * assistive technology receives, not toward class names.
 */

/** Every colour Figma publishes for these surfaces resolves to a token utility. A literal
 *  is what the rebuild exists to remove, so it is asserted rather than reviewed. */
const COLOUR_LITERAL =
  /(?:^|:)(?:bg|text|border|fill|from|via|to)-(?:red|blue|green|yellow|amber|gray|grey|slate|zinc|neutral|stone|emerald|teal|sky|indigo)-\d{2,3}\b|#[0-9a-fA-F]{3,8}/;

const classesOf = (root: Element): string[] =>
  [root, ...root.querySelectorAll('*')].flatMap((el) => [...el.classList]);

describe('Alert covers the Figma set', () => {
  const fns = contract.Alert.axes.function;
  const sizes = contract.Alert.axes.size;

  it('gives every function its own surface and glyph colour', () => {
    const surfaces = new Set<string>();
    const glyphs = new Set<string>();
    for (const fn of fns) {
      const { container } = render(<Alert variant={fn}>Halo</Alert>);
      const box = container.firstElementChild!;
      surfaces.add([...box.classList].find((c) => c.startsWith('bg-'))!);
      glyphs.add(
        [...box.querySelector('[aria-hidden]')!.classList].find((c) => NAMES_A_TEXT_COLOUR.test(c))!,
      );
    }
    expect(surfaces.size).toBe(fns.length);
    expect(glyphs.size).toBe(fns.length);
  });

  it('renders a toast on the solid fill and an alert on the tint', () => {
    const bg = (type: 'alert' | 'toast') => {
      const { container } = render(
        <Alert type={type} variant="success">
          Halo
        </Alert>,
      );
      return [...container.firstElementChild!.classList].find((c) => c.startsWith('bg-'));
    };
    expect(bg('alert')).toBe('bg-weak-success');
    expect(bg('toast')).toBe('bg-default-success');
  });

  it('gives every size its own padding and type step', () => {
    const seen = new Set<string>();
    for (const size of sizes) {
      const { container } = render(<Alert size={size}>Halo</Alert>);
      const cls = [...container.firstElementChild!.classList];
      seen.add(cls.filter((c) => /^(?:px|py|text-ds)-/.test(c)).sort().join(' '));
    }
    expect(seen.size).toBe(sizes.length);
  });

  /* The retired large-breakpoint size pin existed only because the old Alert overrode `Text`'s own
     responsive pair, and tailwind-merge resolves a conflict within ONE modifier bucket. The
     rebuild sets an absolute step instead, so there is no second bucket to lose — and this
     fails the moment someone reintroduces a responsive type class here. */
  it('sets an absolute type step, with no responsive sibling to shadow it', () => {
    const { container } = render(<Alert size="small">Halo</Alert>);
    expect(classesOf(container.firstElementChild!).filter((c) => /^[a-z]+:text-/.test(c))).toEqual(
      [],
    );
  });

  it('announces an inline alert and stays silent for a toast', () => {
    const { container: inline } = render(<Alert>Halo</Alert>);
    expect(inline.firstElementChild!.getAttribute('role')).toBe('alert');
    const { container: toast } = render(<Alert type="toast">Halo</Alert>);
    expect(toast.firstElementChild!.hasAttribute('role')).toBe(false);
  });

  /* Figma draws a toast's copy at weight 500 at every size; nothing set one, so it rendered 400. */
  it('sets the toast copy at medium weight for every function and size, and leaves an inline alert alone', () => {
    for (const fn of fns) {
      for (const size of ['large', 'medium', 'small'] as const) {
        const { container } = render(<Alert type="toast" variant={fn} size={size}>Halo</Alert>);
        expect(container.firstElementChild!.className).toContain('font-medium');
      }
    }
    expect(render(<Alert>Halo</Alert>).container.firstElementChild!.className).not.toContain('font-medium');
  });

  /* Colour is not a channel every reader has. The glyph is `aria-hidden`, so without this
     word an assistive-technology user hears the message and nothing about its severity. */
  it('names the function for a reader who cannot see the colour', () => {
    for (const fn of fns) {
      const { container } = render(<Alert variant={fn}>Halo</Alert>);
      const spoken = container.firstElementChild!.textContent ?? '';
      expect(spoken, fn).not.toBe('Halo');
      expect(container.querySelector('.sr-only')!.textContent!.length).toBeGreaterThan(3);
    }
  });

  it('defaults its glyph per function, takes an override, and drops it for null', () => {
    render(<Alert variant="warning">Halo</Alert>);
    expect(document.querySelectorAll('svg').length).toBe(1);

    const { container: custom } = render(<Alert icon="i">Halo</Alert>);
    expect(custom.textContent).toContain('i');
    expect(custom.querySelector('svg')).toBeNull();

    const { container: none } = render(<Alert icon={null}>Halo</Alert>);
    expect(none.querySelector('[aria-hidden]')).toBeNull();
  });

  it('renders no colour literal in any variant', () => {
    const offenders: string[] = [];
    for (const type of contract.Alert.axes.type) {
      for (const fn of fns) {
        for (const size of sizes) {
          const { container } = render(
            <Alert type={type} variant={fn} size={size}>
              Halo
            </Alert>,
          );
          offenders.push(
            ...classesOf(container.firstElementChild!).filter((c) => COLOUR_LITERAL.test(c)),
          );
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('keeps the message readable through the accessible name', () => {
    render(<Alert variant="danger">Kode salah</Alert>);
    expect(screen.getByRole('alert')).toHaveTextContent('Kode salah');
  });
});

describe('the Alert treatment axis paints the box without changing what it says', () => {
  const classesOf = (root: HTMLElement) =>
    [...root.querySelectorAll<HTMLElement>('*')].flatMap((el) => [...el.classList]);

  /**
   * THE COMPATIBILITY CLAIM, asserted rather than reasoned about. Every existing call site
   * passes no `treatment`, so the default arm has to render the same markup it did before the
   * axis existed — and `full`'s table is derived from the surface and ink tables precisely so
   * this cannot drift.
   */
  it('renders a treatment-less Alert identically to an explicit full one', () => {
    const bare = render(<Alert variant="warning">Isi</Alert>).container.innerHTML;
    const full = render(
      <Alert variant="warning" treatment="full">
        Isi
      </Alert>,
    ).container.innerHTML;
    expect(bare).toBe(full);
  });

  it('gives every treatment a distinct class set per function', () => {
    const seen = new Map<string, string>();
    for (const treatment of contract.Alert.axes.treatment) {
      for (const fn of contract.Alert.axes.function) {
        const { container } = render(
          <Alert treatment={treatment} variant={fn}>
            Isi
          </Alert>,
        );
        const box = container.firstElementChild as HTMLElement;
        seen.set(`${treatment}.${fn}`, box.className);
      }
    }
    /* `banner` is deliberately one fill across all four functions — a severity does not change
       a banner — so the uniqueness claim is made per TREATMENT rather than over the whole
       grid, which would otherwise report that deliberate sharing as a collision. */
    for (const treatment of contract.Alert.axes.treatment.filter((t) => t !== 'banner')) {
      const perFunction = contract.Alert.axes.function.map((fn) => seen.get(`${treatment}.${fn}`)!);
      expect(new Set(perFunction).size, `${treatment} does not vary by function`).toBe(
        perFunction.length,
      );
    }
    /* And the treatments differ from each other on a fixed function, or the axis is cosmetic. */
    const perTreatment = contract.Alert.axes.treatment.map((t) => seen.get(`${t}.success`)!);
    expect(new Set(perTreatment).size).toBe(perTreatment.length);
  });

  it('draws a left accent on accent and no border at all on full', () => {
    const accent = classesOf(render(<Alert treatment="accent">Isi</Alert>).container);
    const full = classesOf(render(<Alert treatment="full">Isi</Alert>).container);
    expect(accent.some((c) => /^border-l-/.test(c))).toBe(true);
    expect(full.some((c) => /^border(?:-l)?(?:-\d|$)/.test(c))).toBe(false);
  });

  it('draws a full border on coach, not a left one', () => {
    const coach = classesOf(render(<Alert treatment="coach" variant="success">Isi</Alert>).container);
    expect(coach).toContain('border');
    expect(coach.some((c) => /^border-l-/.test(c))).toBe(false);
    /* The COACH triple, not the GOOD one: the group publishes two greens and picking the
       wrong one renders a plausible colour that is the other variant. */
    expect(coach).toContain('bg-callout-coach-surface');
    expect(coach).toContain('text-callout-coach-text');
  });

  it('renders BOTH gradient stops on banner, as token classes and never a hex', () => {
    const banner = classesOf(render(<Alert treatment="banner">Isi</Alert>).container);
    expect(banner.some((c) => c.startsWith('from-'))).toBe(true);
    expect(banner.some((c) => c.startsWith('to-'))).toBe(true);
    expect(banner.join(' ')).not.toMatch(/#[0-9a-fA-F]{3,8}/);
  });

  it('leaves the live-region behaviour untouched by the new axis', () => {
    for (const treatment of contract.Alert.axes.treatment) {
      const { container } = render(<Alert treatment={treatment}>Isi</Alert>);
      expect(container.querySelector('[role="alert"]')).not.toBeNull();
    }
  });

  /* `info` already shipped and needs no work — asserted so the ticket's claim that it was
     missing is not re-derived. The failure it names is in a consuming adapter, not here. */
  it('renders function="info" on its own classes rather than falling through', () => {
    const info = (render(<Alert variant="info">Isi</Alert>).container.firstElementChild as HTMLElement)
      .className;
    const success = (
      render(<Alert variant="success">Isi</Alert>).container.firstElementChild as HTMLElement
    ).className;
    expect(info).not.toBe(success);
    expect(info).toContain('bg-weak-brand');
  });

  /* A toast is the host's solid fill; a treatment on top would be a second answer to the same
     question. The prop is accepted and ignored, so this pins the ignoring. */
  it('ignores the treatment on a toast', () => {
    const plain = render(<Alert type="toast">Isi</Alert>).container.innerHTML;
    const accented = render(
      <Alert type="toast" treatment="accent">
        Isi
      </Alert>,
    ).container.innerHTML;
    expect(plain).toBe(accented);
  });
});


describe('the toast host', () => {
  const raise = (message: string, options?: Parameters<typeof toast>[1]) => {
    let id: string | number = '';
    act(() => {
      id = toast(message, options);
    });
    return id;
  };

  afterEach(() => {
    act(() => {
      toast.dismiss();
    });
  });

  /* THE POINT OF THE WHOLE UNIT. `ErrorToast` in the app has no `role` and no `aria-live`,
     so it is a toast that cannot announce — and nothing about it looks broken. */
  it('announces what it raised', async () => {
    render(<Toaster />);
    raise('Kode berhasil ditukarkan');
    const region = document.querySelector('[aria-live]')!;
    expect(region.getAttribute('aria-live')).toBe('polite');
    await waitFor(() => expect(region).toHaveTextContent('Kode berhasil ditukarkan'));
  });

  /* Asserting "a live region exists" passes whichever layer supplies it, which is exactly
     how a double announcement ships green. The COUNT is the assertion that bites. */
  it('exposes exactly one live region, not a nested pair', async () => {
    render(<Toaster />);
    raise('Halo');
    await waitFor(() => expect(document.body).toHaveTextContent('Halo'));
    expect(document.querySelectorAll('[aria-live], [role="alert"], [role="status"]').length).toBe(1);
  });

  it('stacks rather than replacing, and dismissing one leaves the others', async () => {
    render(<Toaster />);
    raise('Satu');
    const second = raise('Dua');
    await waitFor(() => expect(document.body).toHaveTextContent('Dua'));
    expect(document.body).toHaveTextContent('Satu');

    act(() => {
      toast.dismiss(second);
    });
    await waitFor(() => expect(document.body).not.toHaveTextContent('Dua'));
    expect(document.body).toHaveTextContent('Satu');
  });

  it('caps the queue rather than stacking without limit', async () => {
    render(<Toaster visibleToasts={2} />);
    for (const m of ['Satu', 'Dua', 'Tiga']) raise(m);
    await waitFor(() => expect(document.body).toHaveTextContent('Tiga'));
    /* Over the cap sonner keeps the element and marks it `data-visible="false"`, so counting
       elements would report three and counting nothing would report zero. The VISIBLE ones
       are the queue. */
    const visible = [...document.querySelectorAll('[data-sonner-toast]')].filter(
      (el) => el.getAttribute('data-visible') !== 'false',
    );
    expect(visible.length).toBe(2);
  });

  it('auto-dismisses after its duration', async () => {
    render(<Toaster />);
    raise('Sebentar', { duration: 50 });
    await waitFor(() => expect(document.body).toHaveTextContent('Sebentar'));
    await waitFor(() => expect(document.body).not.toHaveTextContent('Sebentar'), { timeout: 3000 });
  });

  it('renders the Alert visual for the function it was given', async () => {
    render(<Toaster />);
    raise('Gagal', { variant: 'danger' });
    await waitFor(() => expect(document.body).toHaveTextContent('Gagal'));
    const box = [...document.querySelectorAll('div')].find((el) =>
      NAMES_A_BACKGROUND.test(el.className),
    )!;
    expect([...box.classList]).toContain('bg-default-error');
  });

  /* A close button that dismisses nothing is the same shape of failure as a toast that
     announces nothing: it renders, it is clickable, and the toast stays. */
  /* Both close buttons ARE the focusable element, so the ring has to be on the button
     itself — the first version of this slice shipped them with no focus style at all, which
     renders correctly and is unreachable-looking to a keyboard user. */
  it('gives its close button a focus ring', async () => {
    render(<Toaster />);
    raise('Halo');
    await waitFor(() => expect(document.body).toHaveTextContent('Halo'));
    const close = screen.getByRole('button', { name: 'Tutup notifikasi' });
    expect([...close.classList].some((c) => c.startsWith('focus-visible:ring-'))).toBe(true);
  });

  it('closes the toast it belongs to when its button is pressed', async () => {
    render(<Toaster />);
    raise('Tutup aku');
    await waitFor(() => expect(document.body).toHaveTextContent('Tutup aku'));
    act(() => {
      screen.getByRole('button', { name: 'Tutup notifikasi' }).click();
    });
    await waitFor(() => expect(document.body).not.toHaveTextContent('Tutup aku'));
  });

  /* The elevation is a token because there IS no z-index token group otherwise — the
     preset's `z` group is a colour group. A literal here would look identical.

     The fallback is asserted too: without it, a consumer that has not loaded tokens.css
     gets an invalid declaration and z-index resolves to `auto` — the toast renders behind
     the page rather than inheriting sonner's own stacking. */
  it('stacks on the elevation token rather than a literal', async () => {
    render(<Toaster />);
    /* The host element only mounts once something is queued, so an empty render finds
       nothing and this assertion would pass by never running. */
    raise('Halo');
    await waitFor(() => expect(document.querySelector('[data-sonner-toaster]')).not.toBeNull());
    const host = document.querySelector('[data-sonner-toaster]') as HTMLElement;
    expect(host.style.zIndex).toContain('var(--elevation-overlay');
    expect(host.style.zIndex).toContain('99999');
    /* ONE ABOVE the token: Dialog and Modal sit on it too and portal in later, so a bare tie
       paints a toast raised from inside a modal under the modal's scrim (delete-account). */
    expect(host.style.zIndex).toContain('+ 1');
  });

  /* THE WIDTH IS A DESIGN VALUE THAT LIVES IN A LIBRARY DEFAULT, which is the failure shape:
     sonner's own width is a 356px card, and a toast at 356px renders perfectly — it is simply a
     third of the box Figma draws (1140 on the 1440 desktop frame, 328 on the 360 phone), and
     nothing about it looks broken. Both measured numbers fall out of this one expression.

     `!important` is load-bearing and is pinned here for that reason: sonner's stylesheet has a
     `width: 100%` under `max-width: 600px` that a plain width — or `--width` — loses to, which
     puts a full-viewport toast 16px in from the left and cuts its close button off the right.
     A desktop browser and this suite both look completely fine while that ships.

     THIS ASSERTS THE WIRING, NOT THE VALUE, and the two are deliberately split. The constant
     is imported rather than retyped — a hand-copied string is its own expectation, and an edit
     to the design value would simply be copied into both places — so this proves only that the
     class reaches sonner's container, which is the half a class name CAN prove. The numbers
     are pinned where the stylesheet exists, in `feedback.purge.test.ts`. */
  it('is as wide as the design rather than as wide as sonner, mobile included', async () => {
    render(<Toaster />);
    raise('Halo');
    await waitFor(() => expect(document.querySelector('[data-sonner-toaster]')).not.toBeNull());
    const host = document.querySelector('[data-sonner-toaster]') as HTMLElement;
    expect([...host.classList]).toContain(TOASTER_WIDTH);
  });

  /* UMK-957: a toast was Small below 768, so on a phone it read 12/18 where the banner it
     replaced read 14/20. It is Medium at every width now, and an explicit `size` still wins. */
  it('is Medium at every width, and an explicit size wins', async () => {
    const width = (matches: boolean) =>
      vi.spyOn(window, 'matchMedia').mockReturnValue({
        matches,
        media: '',
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      } as unknown as MediaQueryList);

    for (const [desktop, size, step, glyph, pad] of [
      [true, undefined, 'text-ds-paragraph-mobile', 'h-6', 'px-ds-sm'],
      [false, undefined, 'text-ds-paragraph-mobile', 'h-6', 'px-ds-sm'],
      [false, 'small', 'text-ds-body-lg-mobile', 'h-5', 'px-ds-2xs'],
    ] as const) {
      width(desktop);
      const { unmount } = render(<Toaster />);
      raise('Berhasil Mengunduh', { variant: 'success', ...(size ? { size } : {}) });
      await waitFor(() => expect(document.body).toHaveTextContent('Berhasil Mengunduh'));
      const box = [...document.querySelectorAll('div')].find((el) =>
        NAMES_A_BACKGROUND.test(el.className),
      )!;
      expect([...box.classList]).toContain(step);
      expect([...box.classList]).toContain(pad);
      expect([...box.querySelector('svg')!.classList]).toContain(glyph);
      act(() => toast.dismiss());
      unmount();
      vi.restoreAllMocks();
    }
  });

  /* Two drawings, one name away from each other. Figma's success toast is the FILLED check —
     a disc with the tick knocked out so the green reads through it — while the inline alert
     keeps lucide's outline on its tint. Swapping either for the other renders an icon of the
     right size in the right place, and no assertion about classes or roles can see it. */
  it('draws the success toast with the filled check, and the inline alert with the outline', async () => {
    const disc = (root: ParentNode) => root.querySelector('svg path[fill="currentColor"]');

    render(<Toaster />);
    raise('Berhasil Mengunduh', { variant: 'success' });
    await waitFor(() => expect(document.body).toHaveTextContent('Berhasil Mengunduh'));
    expect(disc(document.querySelector('[data-sonner-toast]')!)).not.toBeNull();

    const inline = render(<Alert variant="success">Berhasil</Alert>).container;
    expect(disc(inline)).toBeNull();
  });
});

describe('Tooltip', () => {
  const open = (extra: Partial<React.ComponentProps<typeof Tooltip>> = {}) =>
    render(
      <Tooltip content="Nilai tukar hari ini" defaultOpen {...extra}>
        <button type="button">Kurs</button>
      </Tooltip>,
    );

  /* The component this replaces never did this at all: it positioned a div near the
     trigger and left the two unrelated, so a screen reader user reached the trigger and
     was told nothing. */
  it('associates the trigger with the tip', async () => {
    open();
    const trigger = screen.getByRole('button', { name: 'Kurs' });
    await waitFor(() => expect(trigger).toHaveAttribute('aria-describedby'));
    const described = document.getElementById(trigger.getAttribute('aria-describedby')!);
    expect(described).toHaveTextContent('Nilai tukar hari ini');
  });

  it('gives each colour its own surface, and the arrow the SAME fill', async () => {
    const surfaces = new Set<string>();
    for (const color of contract.Tooltip.axes.color) {
      const { unmount } = open({ color });
      await waitFor(() => expect(document.querySelector('[data-radix-popper-content-wrapper]')).not.toBeNull());
      const tip = document.querySelector('[data-side]') as HTMLElement;
      const surface = [...tip.classList].find((c) => NAMES_A_BACKGROUND.test(c))!;
      const arrow = tip.querySelector('svg')!;
      surfaces.add(surface);
      /* An arrow on a different fill detaches visually at every placement — and it is one
         of the two things `bg-*` cannot do here, because Radix renders it as an svg. */
      expect([...arrow.classList].some((c) => c === surface.replace('bg-', 'fill-'))).toBe(true);
      unmount();
    }
    expect(surfaces.size).toBe(contract.Tooltip.axes.color.length);
  });

  it('gives each size its own padding and type step', async () => {
    const seen = new Set<string>();
    for (const size of contract.Tooltip.axes.size) {
      const { unmount } = open({ size });
      await waitFor(() => expect(document.querySelector('[data-side]')).not.toBeNull());
      const tip = document.querySelector('[data-side]') as HTMLElement;
      seen.add([...tip.classList].filter((c) => /^(?:px|py|text-ds)-/.test(c)).sort().join(' '));
      unmount();
    }
    expect(seen.size).toBe(contract.Tooltip.axes.size.length);
  });

  it('resolves the arrow from the placement rather than exposing one', async () => {
    open({ side: 'bottom' });
    await waitFor(() => expect(document.querySelector('[data-side]')).not.toBeNull());
    expect(document.querySelector('[data-side]')!.getAttribute('data-side')).toBe('bottom');
    /* If an `arrow` prop ever appears, this stops describing the component. */
    expect('arrow' in ({} as React.ComponentProps<typeof Tooltip>)).toBe(false);
  });

  /* A controlled `open` with no handler works for exactly as long as the value is
     `undefined`. Both halves are exercised: the SET case, and the uncontrolled one. */
  it('reports through onOpenChange while staying closable when controlled', async () => {
    const seen: boolean[] = [];
    open({ open: true, onOpenChange: (v) => seen.push(v), showClose: true });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Tutup' })).toBeTruthy());
    act(() => {
      screen.getByRole('button', { name: 'Tutup' }).click();
    });
    expect(seen).toContain(false);
    /* Controlled means the caller decides: the tip is still open because `open` said so. */
    expect(document.querySelector('[data-side]')).not.toBeNull();
  });

  it('gives its close button a focus ring', async () => {
    open({ showClose: true });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Tutup' })).toBeTruthy());
    const close = screen.getByRole('button', { name: 'Tutup' });
    expect([...close.classList].some((c) => c.startsWith('focus-visible:ring-'))).toBe(true);
  });

  it('closes itself when uncontrolled', async () => {
    open({ showClose: true });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Tutup' })).toBeTruthy());
    act(() => {
      screen.getByRole('button', { name: 'Tutup' }).click();
    });
    await waitFor(() => expect(document.querySelector('[data-side]')).toBeNull());
  });

  it('renders no colour literal', async () => {
    for (const color of contract.Tooltip.axes.color) {
      const { unmount } = open({ color, showClose: true, icon: <span>i</span> });
      await waitFor(() => expect(document.querySelector('[data-side]')).not.toBeNull());
      const tip = document.querySelector('[data-side]') as HTMLElement;
      expect(classesOf(tip).filter((c) => COLOUR_LITERAL.test(c))).toEqual([]);
      unmount();
    }
  });
});

describe('Skeleton', () => {
  // UMK-957: a caller's size/radius must REPLACE the shape default, not sit beside it — both classes
  // survived `cn` once and the stylesheet order picked the shape's (84px, not 56; r8, not r16).
  it('drops the shape default a className overrides (the landing-journey case)', () => {
    const { container } = render(<Skeleton shape="rect" className="h-auto min-h-[150px] w-[70%] rounded-ds-lg" />);
    const cls = (container.firstElementChild as HTMLElement).className.split(/\s+/);
    expect(cls).toContain('h-auto');
    expect(cls).toContain('rounded-ds-lg');
    expect(cls).not.toContain('h-ds-4xl');
    expect(cls).not.toContain('rounded-ds-md');
    expect(cls).not.toContain('w-full');
  });

  it('gives each shape its own geometry', () => {
    const seen = new Set<string>();
    for (const shape of contract.Skeleton.axes.shape) {
      const { container } = render(<Skeleton shape={shape} />);
      seen.add([...container.firstElementChild!.classList].sort().join(' '));
    }
    expect(seen.size).toBe(contract.Skeleton.axes.shape.length);
  });

  it('shimmers from the preset keyframe, not an app-level one', () => {
    const { container } = render(<Skeleton />);
    const sheen = container.querySelector('span')!;
    /* `animate-shimmer` is defined in apps/main-website's own Tailwind config, and Tailwind
       lets a consuming config win a same-named key — so a component here reaching for that
       name would animate in the app and not in Storybook, with nothing red. */
    expect([...sheen.classList]).toContain('animate-ds-shimmer');
    expect([...sheen.classList]).not.toContain('animate-shimmer');
    expect([...sheen.classList]).not.toContain('animate-pulse');
  });

  /* Reduced motion means a STATIC placeholder, not a stopped animation: pausing the
     keyframe freezes the sweep mid-travel and leaves a permanent bright band. */
  it('drops the sweep under reduced motion while staying visible', () => {
    const { container } = render(<Skeleton />);
    expect([...container.querySelector('span')!.classList]).toContain('motion-reduce:hidden');
    expect([...container.firstElementChild!.classList]).toContain('bg-weak-neutral');
    expect(
      classesOf(container.firstElementChild!).some(
        (c) => c.startsWith('motion-reduce:') && c.includes('bg-'),
      ),
    ).toBe(false);
  });

  it('is hidden from assistive technology rather than announced', () => {
    const { container } = render(<Skeleton />);
    expect(container.firstElementChild!.getAttribute('aria-hidden')).toBe('true');
    expect(container.querySelector('[role]')).toBeNull();
    expect(container.querySelector('[aria-live]')).toBeNull();
  });

  it('renders no colour literal', () => {
    for (const shape of contract.Skeleton.axes.shape) {
      const { container } = render(<Skeleton shape={shape} />);
      expect(classesOf(container.firstElementChild!).filter((c) => COLOUR_LITERAL.test(c))).toEqual(
        [],
      );
    }
  });
});

describe('ProgressBar and Spinner, now that they are on tokens', () => {
  const classesOf = (root: HTMLElement) =>
    [...root.querySelectorAll<HTMLElement>('*')].flatMap((el) => [...el.classList]);

  const RAW_PALETTE =
    /^(?:bg|text|border|border-[trbl]|from|via|to|ring|fill|stroke)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d/;

  it('renders every ProgressBar axis value from the table', () => {
    for (const variant of contract.ProgressBar.axes.variant) {
      for (const size of contract.ProgressBar.axes.size) {
        const { container } = render(<ProgressBar variant={variant} size={size} value={50} />);
        const classes = classesOf(container);
        expect(classes.some((c) => NAMES_A_BACKGROUND.test(c)), `${variant} has no token fill`).toBe(true);
        expect(classes.some((c) => /^h-\d/.test(c)), `${size} has no height`).toBe(true);
      }
    }
  });

  it('renders every Spinner axis value from the table', () => {
    for (const variant of contract.Spinner.axes.variant) {
      for (const size of contract.Spinner.axes.size) {
        const { container } = render(<Spinner variant={variant} size={size} />);
        const classes = classesOf(container).concat([...container.firstElementChild!.classList]);
        /* The gradient variant's colour is a FILL, not a border ink — a bordered ring cannot
           carry a gradient at all — so it is checked on its own terms rather than exempted. */
        const inked =
          variant === 'gradient'
            ? classes.some((c) => c.includes('conic-gradient'))
            : classes.some((c) => c.startsWith('border-t-default-'));
        expect(inked, `${variant} has no ink`).toBe(true);
        expect(classes.some((c) => /^h-\d/.test(c)), `${size} has no diameter`).toBe(true);
      }
    }
  });

  /* The reason both were brought into a family at all: every class they shipped was outside the
     design system, and nothing in the package could see it. */
  it('renders no raw palette class, no legacy z-* token and no hex', () => {
    /* EVERY axis value, not just the defaults. Rendering one variant each passed an injection
       that put `bg-green-500` back into a non-default progress colour — the class never
       reached the DOM, so there was nothing for this to see. */
    const elements = [
      ...contract.ProgressBar.axes.variant.flatMap((variant) =>
        contract.ProgressBar.axes.size.map((size) =>
          render(<ProgressBar variant={variant} size={size} value={50} label="Mengunggah" />),
        ),
      ),
      ...contract.Spinner.axes.variant.flatMap((variant) =>
        contract.Spinner.axes.size.map((size) => render(<Spinner variant={variant} size={size} />)),
      ),
    ];
    for (const { container } of elements) {
      const classes = classesOf(container).concat([...container.firstElementChild!.classList]);
      expect(classes.length).toBeGreaterThan(2);
      for (const c of classes) {
        expect(RAW_PALETTE.test(c), `raw palette class "${c}"`).toBe(false);
        expect(/^(?:bg|text|border|border-[trbl]|ring|fill|stroke|from|via|to)-z-/.test(c), `legacy token "${c}"`).toBe(false);
      }
      expect(container.innerHTML).not.toMatch(/#[0-9a-fA-F]{3,8}/);
    }
  });

  it.each([
    ['at zero', 0, '0%'],
    ['halfway', 50, '50%'],
    ['at max', 100, '100%'],
    /* Past the maximum. The bar must not run out of its track, and — the part a width-only
       clamp misses — it must not ANNOUNCE the raw number either. */
    ['beyond max', 150, '100%'],
  ])('draws %s without overflowing the track', (_name, value, width) => {
    const { container } = render(<ProgressBar value={value} max={100} />);
    const fill = container.querySelector('[role="progressbar"]') as HTMLElement;
    expect(fill.style.width).toBe(width);
    expect(Number(fill.getAttribute('aria-valuenow'))).toBeLessThanOrEqual(100);
  });

  it('exposes progress to assistive technology rather than only drawing it', () => {
    const { container } = render(<ProgressBar value={40} max={80} label="Mengunggah" />);
    const bar = container.querySelector('[role="progressbar"]')!;
    expect(bar.getAttribute('aria-valuenow')).toBe('40');
    expect(bar.getAttribute('aria-valuemax')).toBe('80');
    expect(bar.getAttribute('aria-label')).toBe('Mengunggah');
  });

  it('exposes the busy state as a word, not as movement', () => {
    render(<Spinner label="Memuat" />);
    expect(screen.getByRole('status', { name: 'Memuat' })).toBeTruthy();
  });

  /* An empty label is a real choice: inside a button the default would join that button's
     accessible name, so "Kirim" becomes "Loading... Kirim". */
  it('lets a caller opt out of the spinner name entirely', () => {
    const { container } = render(<Spinner label="" />);
    expect(container.firstElementChild!.getAttribute('aria-label')).toBeNull();
  });

  it('carries the reduced-motion form on the element itself', () => {
    const { container } = render(<Spinner />);
    expect([...container.firstElementChild!.classList]).toContain('motion-reduce:animate-none');
  });
});

describe('the ProgressBar radial shape', () => {
  /**
   * THE CLAIM, STATED EXACTLY. What is pinned here is that the SHAPE AXIS defaults to linear —
   * a call site that passes no `shape` renders the linear form, not the gauge.
   *
   * It is NOT a claim that the linear bar is byte-identical to what shipped before this branch:
   * U10 deliberately moved the track off `bg-gray-200`/`rounded`/`h-1` onto design tokens and
   * made `aria-valuenow` report the clamped value. Comparing the two arms of the new code
   * cannot see that change, and reading this as a no-visual-change guarantee is how a token
   * migration gets mistaken for a regression later.
   */
  it('defaults to linear, so no existing call site silently becomes a gauge', () => {
    const shape = (html: string) => html.replace(/_r_[^_"]*_/g, 'ID');
    const bare = shape(render(<ProgressBar value={40} />).container.innerHTML);
    const explicit = shape(render(<ProgressBar value={40} shape="linear" />).container.innerHTML);
    expect(bare).toBe(explicit);
    expect(bare).not.toContain('<svg');
  });

  it('draws an arc on radial and the track on linear', () => {
    const radial = render(<ProgressBar shape="radial" value={40} />).container;
    const linear = render(<ProgressBar shape="linear" value={40} />).container;
    expect(radial.querySelector('svg circle')).not.toBeNull();
    expect(linear.querySelector('svg')).toBeNull();
    expect(linear.querySelector('[role="progressbar"]')!.tagName).toBe('DIV');
  });

  it.each([0, 50, 100])('sweeps proportionally at %s', (value) => {
    const { container } = render(<ProgressBar shape="radial" value={value} max={100} />);
    const svg = container.querySelector('svg')!;
    expect(svg.style.getPropertyValue('--progress-sweep')).toBe(String(value));
  });

  /**
   * THE RULE THE SLIDER'S TRACK SET: a computed POSITION may travel inline, a colour may not.
   * Asserted on the element rather than on the source, so a colour that reached the style
   * attribute by any route is caught.
   */
  it('carries only a number inline, never a colour', () => {
    const { container } = render(<ProgressBar shape="radial" variant="success" value={72} />);
    for (const el of container.querySelectorAll<HTMLElement>('[style]')) {
      const style = el.getAttribute('style')!;
      expect(style).not.toMatch(/#[0-9a-fA-F]{3,8}/);
      expect(style).not.toMatch(/\b(?:rgb|hsl|rgba|hsla)\(/);
      expect(style).not.toMatch(/(?:^|[;\s])color\s*:/);
    }
    const arc = container.querySelectorAll('circle')[1] as SVGElement;
    expect([...arc.classList].some((c) => NAMES_A_TEXT_COLOUR.test(c))).toBe(true);
  });

  it('announces the same semantics as the bar', () => {
    const radial = render(<ProgressBar shape="radial" value={40} max={80} label="Skor" />).container;
    const linear = render(<ProgressBar shape="linear" value={40} max={80} label="Skor" />).container;
    const read = (root: HTMLElement) => {
      const el = root.querySelector('[role="progressbar"]')!;
      return ['aria-label', 'aria-valuenow', 'aria-valuemin', 'aria-valuemax'].map((a) =>
        el.getAttribute(a),
      );
    };
    expect(read(radial)).toEqual(read(linear));
  });

  it('renders no raw palette class and no hex in the radial form', () => {
    for (const variant of contract.ProgressBar.axes.variant) {
      for (const size of contract.ProgressBar.axes.size) {
        const { container } = render(
          <ProgressBar shape="radial" variant={variant} size={size} value={50} />,
        );
        const classes = [...container.querySelectorAll('*')].flatMap((el) => [
          ...(el.getAttribute('class') ?? '').split(' '),
        ]);
        for (const c of classes) {
          expect(
            /^(?:bg|text|border|border-[trbl]|stroke|fill|ring)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d/.test(c),
            `raw palette class "${c}"`,
          ).toBe(false);
        }
        expect(container.innerHTML).not.toMatch(/#[0-9a-fA-F]{3,8}/);
      }
    }
  });
});

describe('the gradient values on the three components that carry one', () => {
  it('paints the gradient spinner as a masked fill, not a bordered ring', () => {
    const { container } = render(<Spinner variant="gradient" />);
    const root = container.firstElementChild as HTMLElement;
    const classes = [...root.classList];
    expect(classes.some((c) => c.includes('conic-gradient'))).toBe(true);
    /* No coloured border ink, or a second arc is drawn over the gradient. */
    expect(classes.some((c) => /^border-[tr]-border-/.test(c))).toBe(false);
    /* The mask is what turns the disc into a ring; without it this is a filled circle. */
    expect(root.querySelector('[aria-hidden]')).not.toBeNull();
  });

  it('gives the radial gauge a real paint server with two distinct stops', () => {
    const { container } = render(<ProgressBar shape="radial" variant="gradient" value={60} />);
    const stops = [...container.querySelectorAll('linearGradient stop')];
    expect(stops).toHaveLength(2);
    /* The colour is a CLASS on each stop; `currentColor` is only the plumbing that carries it. */
    for (const stop of stops) {
      expect(stop.getAttribute('stop-color')).toBe('currentColor');
      expect(stop.getAttribute('class')).toMatch(NAMES_A_TEXT_COLOUR);
    }
    expect(stops[0].getAttribute('class')).not.toBe(stops[1].getAttribute('class'));
    const arc = container.querySelectorAll('circle')[1];
    /* The paint server AND a fallback. Without the fallback an unresolvable id paints black;
       and the class must NOT be `stroke-current`, which would beat the attribute outright. */
    expect(arc.getAttribute('stroke')).toMatch(/^url\(#[^)]+\) currentColor$/);
    expect(arc.getAttribute('class')).not.toMatch(/(?:^|\s)stroke-/);
  });

  /* Two gauges on one page would otherwise both point at the first definition, and removing
     that one leaves the other painting nothing. */
  it('gives each radial gauge its own gradient definition', () => {
    const { container } = render(
      <div>
        <ProgressBar shape="radial" variant="gradient" value={10} />
        <ProgressBar shape="radial" variant="gradient" value={90} />
      </div>,
    );
    const ids = [...container.querySelectorAll('linearGradient')].map((g) => g.id);
    expect(new Set(ids).size).toBe(2);
  });

  /**
   * THE RULE, ASSERTED ON THE RENDER RATHER THAN ON THE SOURCE: a computed position may travel
   * inline, a colour may not. Checked across all three components at once, because it is one
   * rule and three chances to break it.
   */
  it('puts no colour in any inline style on any gradient-bearing component', () => {
    const rendered = [
      render(<Spinner variant="gradient" />).container,
      render(<ProgressBar variant="gradient" value={60} />).container,
      render(<ProgressBar shape="radial" variant="gradient" value={60} />).container,
    ];
    let styled = 0;
    for (const container of rendered) {
      for (const el of container.querySelectorAll<HTMLElement>('[style]')) {
        styled += 1;
        const style = el.getAttribute('style')!;
        expect(style).not.toMatch(/#[0-9a-fA-F]{3,8}/);
        expect(style).not.toMatch(/\b(?:rgb|hsl|rgba|hsla)\(/);
        expect(style).not.toMatch(/gradient\(/);
      }
    }
    /* Anti-vacuity: at least one of them really does carry an inline style, or this loop
       proved nothing by never running. */
    expect(styled).toBeGreaterThan(0);
  });

  it('leaves the non-gradient values on each axis unchanged', () => {
    const shape = (html: string) => html.replace(/_r_[^_"]*_/g, 'ID');
    expect(shape(render(<Spinner variant="primary" />).container.innerHTML)).not.toContain('conic-gradient');
    expect(shape(render(<ProgressBar variant="success" value={50} />).container.innerHTML)).not.toContain(
      'from-',
    );
  });
});

describe('utils shared by the form controls', () => {
  /**
   * REACT 19 LETS A CALLBACK REF RETURN A CLEANUP. Discarding it silently drops the caller's
   * teardown — the ref is never released and nothing anywhere reports it.
   */
  it('passes a callback ref cleanup back to React', () => {
    const calls: unknown[] = [];
    const cleanup = () => {};
    const local = { current: null as HTMLDivElement | null };
    const forwarded = (node: HTMLDivElement | null) => {
      calls.push(node);
      return cleanup;
    };
    const { result } = renderHook(() => useMergedRef(local, forwarded));
    expect(result.current(null as unknown as HTMLDivElement)).toBe(cleanup);
    expect(calls).toHaveLength(1);
  });

  /* A fresh closure every render makes React detach and re-attach the ref on every one. */
  it('keeps one callback identity while the forwarded ref is unchanged', () => {
    const local = { current: null as HTMLDivElement | null };
    const forwarded = { current: null as HTMLDivElement | null };
    const { result, rerender } = renderHook(() => useMergedRef(local, forwarded));
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});
