import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as LightboxStories from './Lightbox/Lightbox.stories';
import { Lightbox } from './Lightbox';
import { storyTitle } from '../contract';

/**
 * The lightbox behaviour guard.
 *
 * IT EXISTS BECAUSE THE FAMILY GUARDS CANNOT SEE THIS COMPONENT — `Lightbox` declares no
 * contract `family`, the same answer `Button`, `Text`, `Icon`, `Label`, `Sidebar`, `Header`
 * and `AppShell` give, and each family pair reconciles only against the entries that CLAIM
 * its family. This file and `lightbox.purge.test.ts` are the whole of its coverage.
 *
 * READS `baseElement`, NEVER `container` (KTD18a). This one portals, so its panel lands
 * outside the render's `container` entirely — the recorded example of a guard that read
 * `container`, matched nothing and passed is slice 2's form-controls guard.
 *
 * MODALITY IS A BEHAVIOUR, AND THE `aria-modal` ATTRIBUTE IS ONLY THE CLAIM ABOUT IT. Every
 * assertion below reads a SIDE EFFECT — the body's scroll-lock marker, and the inertness
 * marker an outside node picks up — because turning the Radix root non-modal is a one-word
 * edit that removes the scroll lock, the focus trap and the background inertness while
 * leaving the announcement in place. That pairing is the defect the overlay guards exist to
 * kill, and reading the attribute could not tell.
 *
 * WHAT IS DELIBERATELY NOT ASSERTED — three separate limits, not one.
 *
 * PLACEMENT AND WIDTH. happy-dom has no layout engine, so nothing here can see that the panel
 * is full-bleed or that the image is contained inside it. Checked by eye in the stories.
 *
 * TAB-WRAP inside the trap. Radix implements it with focus guards whose behaviour depends on
 * layout-aware focus order, so an assertion would pass on the trap being ABSENT as readily as
 * on it working. What IS asserted is that opening moves focus INTO the panel.
 *
 * FOCUS RESTORE. Asserted as the falsifiable proxy the overlays guard already uses for the
 * modal case: the close-focus cycle ran exactly once. `document.activeElement` cannot be
 * asserted here because `react-remove-scroll` still holds the outside inertness marker when
 * the restore fires under happy-dom, so a restore that works in a browser would report as
 * broken. That is an environment limit, not a licence to assert nothing.
 *
 * Importing the story module also pulls it into the typecheck program: `tsconfig` excludes
 * every stories file, so a story imported by a test is the only way one is checked at all.
 */

type AnyStory = { args?: Record<string, unknown>; render?: (a: never, b: never) => React.ReactElement };
type AnyModule = { default: { component: React.ElementType; args?: Record<string, unknown> } } & Record<
  string,
  unknown
>;

const element = (mod: AnyModule, story: AnyStory): React.ReactElement => {
  const args = { ...(mod.default.args ?? {}), ...(story.args ?? {}) };
  if (typeof story.render === 'function') return story.render(args as never, {} as never);
  const Component = mod.default.component;
  return <Component {...args} />;
};

const stories = (mod: AnyModule) =>
  Object.entries(mod).filter(([n, s]) => n !== 'default' && s && typeof s === 'object');

/* ONE MOUNT AT A TIME. Every render in a file shares one `baseElement`, so a second render
   leaves the first one's portalled panel in front of it and a query returns the wrong one. */
const mount = (ui: React.ReactElement): HTMLElement => {
  cleanup();
  return render(ui).baseElement as HTMLElement;
};

const PIXEL =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

describe('the lightbox stories mount and say what they are', () => {
  it('titles the story set for Storybook', () => {
    expect((LightboxStories as unknown as { default: { title: string } }).default.title).toBe(
      storyTitle('Lightbox'),
    );
  });

  /* Open AND closed by name, not a count. The gate asks for both and a count cannot tell
     which one went missing; closed is the easy one to lose, because it renders nothing. */
  it('ships the open and closed stories the gate asks for', () => {
    const mod = LightboxStories as unknown as AnyModule;
    expect(stories(mod).length).toBeGreaterThan(2);
    expect(Object.keys(mod)).toContain('Open');
    expect(Object.keys(mod)).toContain('Closed');
  });

  it('mounts every story without throwing', () => {
    const mod = LightboxStories as unknown as AnyModule;
    for (const [, story] of stories(mod)) expect(mount(element(mod, story as AnyStory))).toBeTruthy();
  });
});

describe('the lightbox is a real dialog', () => {
  const Harness = ({
    onCloseAutoFocus,
    ...rest
  }: Partial<React.ComponentProps<typeof Lightbox>>) => {
    const [open, setOpen] = React.useState(false);
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>
          Buka
        </button>
        <Lightbox
          open={open}
          onOpenChange={setOpen}
          src={PIXEL}
          alt="Gambar"
          label="Pratinjau gambar"
          onCloseAutoFocus={onCloseAutoFocus}
          {...rest}
        />
      </>
    );
  };

  it('moves focus INTO the panel on open, and shows the image', async () => {
    const user = userEvent.setup();
    const { baseElement, getByRole } = render(<Harness />);
    await user.click(getByRole('button', { name: 'Buka' }));
    const panel = baseElement.querySelector('[role="dialog"]');
    expect(panel).not.toBeNull();
    /* THE TRAP ENGAGED — the half a hand-rolled "trap" always gets wrong. The component this
       replaces adds a keydown listener and moves focus nowhere at all. */
    expect(panel!.contains(document.activeElement)).toBe(true);
    expect(panel!.querySelector('img')).not.toBeNull();
    cleanup();
  });

  it('takes its accessible name from a real title element, not a bare attribute', async () => {
    const user = userEvent.setup();
    const { baseElement, getByRole } = render(<Harness />);
    await user.click(getByRole('button', { name: 'Buka' }));
    const panel = baseElement.querySelector('[role="dialog"]') as HTMLElement;
    /* A bare naming ATTRIBUTE would leave the element Radix requires in the tree and unused,
       and two ways to name one dialog is how a label ends up on neither. */
    expect(panel.getAttribute('aria-label')).toBeNull();
    const id = panel.getAttribute('aria-labelledby');
    expect(id).toBeTruthy();
    expect(baseElement.querySelector(`#${id}`)?.textContent).toBe('Pratinjau gambar');
    cleanup();
  });

  /**
   * MODALITY BY SIDE EFFECT (KTD8). Both consequences are observable here, so this is two
   * assertions rather than a browser gate.
   */
  it('makes the page behind genuinely inert, not just labelled modal', async () => {
    const user = userEvent.setup();
    const { baseElement, getByRole } = render(<Harness />);
    const outside = getByRole('button', { name: 'Buka' });
    await user.click(outside);
    expect(baseElement.querySelector('[role="dialog"]')).not.toBeNull();
    /* `react-remove-scroll` marks the body while a modal layer is mounted. */
    expect(document.body.hasAttribute('data-scroll-locked')).toBe(true);
    /* Asserted on the OPENER — a real node outside the portal — so it cannot pass by
       matching the portal itself. */
    expect(outside.closest('[aria-hidden="true"]')).not.toBeNull();
    cleanup();
  });

  it('releases the scroll lock and the inertness when it closes', async () => {
    const user = userEvent.setup();
    const cycles: number[] = [];
    const { baseElement, getByRole } = render(
      <Harness onCloseAutoFocus={() => cycles.push(1)} />,
    );
    const outside = getByRole('button', { name: 'Buka' });
    await user.click(outside);
    await user.keyboard('{Escape}');
    expect(baseElement.querySelector('[role="dialog"]')).toBeNull();
    expect(document.body.hasAttribute('data-scroll-locked')).toBe(false);
    expect(outside.closest('[aria-hidden="true"]')).toBeNull();
    /* FOCUS RESTORE, AS FAR AS THIS ENVIRONMENT CAN SEE IT — see the file docblock. */
    expect(cycles.length).toBe(1);
    cleanup();
  });

  /**
   * THE REGRESSION KTD15 NAMES. The `Image` primitive renders its placeholder and no image
   * element at all for any src that is not a remote https one, as a deliberate SSRF control —
   * and this component is handed base64 payloads and object URLs. Routing through it would
   * blank every one of those previews with nothing failing.
   */
  it('renders a real image element for a base64 payload src', async () => {
    const user = userEvent.setup();
    const { baseElement, getByRole } = render(<Harness />);
    await user.click(getByRole('button', { name: 'Buka' }));
    const img = baseElement.querySelector('[role="dialog"] img') as HTMLImageElement;
    expect(img).not.toBeNull();
    expect(img.tagName).toBe('IMG');
    expect(img.getAttribute('src')).toBe(PIXEL);
    expect(img.getAttribute('alt')).toBe('Gambar');
    cleanup();
  });
});

// UMK-1690: the gallery treatment. Every prop is opt-in, so the cases above (no prop at all) are the
// existing callers' look, unchanged.
describe('the gallery viewer props (UMK-1690)', () => {
  const open = (props: Partial<React.ComponentProps<typeof Lightbox>>) =>
    mount(<Lightbox open onOpenChange={() => {}} src={PIXEL} alt="Gambar" label="Pratinjau" {...props} />);
  const scrimOf = (root: HTMLElement) => (root.querySelector('[role="dialog"]')!.previousElementSibling as HTMLElement).className;
  const closeOf = (root: HTMLElement) => (root.querySelector('[data-lightbox-close]') as HTMLElement).className;

  it('keeps the dense scrim and the square close by default, and lightens both on `light`', () => {
    const dense = open({});
    expect(scrimOf(dense)).toContain('bg-default-overlay/90');
    expect(closeOf(dense)).toContain('rounded-lg');
    const light = open({ scrim: 'light' });
    expect(scrimOf(light)).toContain('bg-default-overlay/60');
    expect(closeOf(light)).toContain('rounded-full');
    expect(closeOf(light)).toContain('h-12');
  });

  it('renders `media` in place of the image', () => {
    const root = open({ src: undefined, media: <video data-testid="player" /> });
    const panel = root.querySelector('[role="dialog"]')!;
    expect(panel.querySelector('[data-lightbox-media] [data-testid="player"]')).not.toBeNull();
    expect(panel.querySelector('img')).toBeNull();
  });

  // A tall portrait image must leave room for the bar (layout is checked by eye in the GalleryViewer story; this pins
  // the box that makes it possible, and that the chat callers' markup is unchanged).
  it('puts the image in a shrinkable body box when there is a bar, and directly in the panel otherwise', () => {
    const withBar = open({ actions: [{ key: 'unduh', icon: 'file-download', label: 'Unduh', onSelect: () => {} }] });
    expect(withBar.querySelector('[role="dialog"] [data-lightbox-body] > img')).not.toBeNull();
    const plain = open({});
    expect(plain.querySelector('[data-lightbox-body]')).toBeNull();
    expect(plain.querySelector('[role="dialog"] > img')).not.toBeNull();
  });

  it('shows no action bar unless actions are supplied', () => {
    expect(open({}).querySelector('[data-lightbox-bar]')).toBeNull();
    expect(open({ actions: [] }).querySelector('[data-lightbox-bar]')).toBeNull();
  });

  it('labels each action, links an href through `linkAs`, and calls `onSelect` on a button', async () => {
    const onSelect = vi.fn();
    const onLink = vi.fn();
    const LinkAs = ({ href, onClick, children, ...rest }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
      <a href={href} data-link-as onClick={(e) => { e.preventDefault(); onClick?.(e); }} {...rest}>
        {children}
      </a>
    );
    const root = open({
      linkAs: LinkAs,
      actions: [
        { key: 'diskusi', icon: 'nav-chat', label: 'Diskusi', href: '/temanai/s1?message=m1', onSelect: onLink },
        { key: 'bagikan', icon: 'share', label: 'Bagikan', onSelect },
      ],
    });
    const link = root.querySelector('[data-lightbox-action="diskusi"]') as HTMLAnchorElement;
    expect(link.hasAttribute('data-link-as')).toBe(true);
    expect(link.getAttribute('href')).toBe('/temanai/s1?message=m1');
    expect(link.textContent).toBe('Diskusi');
    await userEvent.click(link);
    expect(onLink).toHaveBeenCalledTimes(1);
    const button = root.querySelector('[data-lightbox-action="bagikan"]') as HTMLButtonElement;
    expect(button.tagName).toBe('BUTTON');
    expect(button.getAttribute('type')).toBe('button');
    await userEvent.click(button);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('renders an href action as a plain anchor when no `linkAs` is given', () => {
    const root = open({ actions: [{ key: 'ubah', icon: 'pen', label: 'Ubah', href: '/x' }] });
    expect((root.querySelector('[data-lightbox-action="ubah"]') as HTMLElement).tagName).toBe('A');
  });
});

describe('the affordances', () => {
  const open = (props: Partial<React.ComponentProps<typeof Lightbox>>) =>
    mount(
      <Lightbox open onOpenChange={() => {}} src={PIXEL} alt="Gambar" label="Pratinjau" {...props} />,
    );

  it('shows no download or share control unless a callback is supplied', () => {
    const root = open({});
    expect(root.querySelector('[data-lightbox-download]')).toBeNull();
    expect(root.querySelector('[data-lightbox-share]')).toBeNull();
  });

  it('fires the download callback from an accessibly named control', async () => {
    const onDownload = vi.fn();
    const root = open({ onDownload, downloadLabel: 'Unduh' });
    const el = root.querySelector('[data-lightbox-download]') as HTMLElement;
    expect(el.getAttribute('aria-label') ?? el.textContent).toContain('Unduh');
    await userEvent.click(el);
    expect(onDownload).toHaveBeenCalledTimes(1);
  });

  it('fires the share callback from an accessibly named control', async () => {
    const onShare = vi.fn();
    const root = open({ onShare, shareLabel: 'Bagikan' });
    const el = root.querySelector('[data-lightbox-share]') as HTMLElement;
    expect(el.getAttribute('aria-label') ?? el.textContent).toContain('Bagikan');
    await userEvent.click(el);
    expect(onShare).toHaveBeenCalledTimes(1);
  });

  it('always offers a named close control', async () => {
    const onOpenChange = vi.fn();
    cleanup();
    const { baseElement } = render(
      <Lightbox open onOpenChange={onOpenChange} src={PIXEL} label="Pratinjau" closeLabel="Tutup" />,
    );
    const el = (baseElement as HTMLElement).querySelector('[data-lightbox-close]') as HTMLElement;
    expect(el.getAttribute('aria-label')).toBe('Tutup');
    await userEvent.click(el);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  /**
   * DISMISSAL IS DECIDED ON THE PRESS, NOT ON THE CLICK. A `click` targets the common
   * ancestor of its mousedown and its mouseup, so a drag off the image reports the PANEL as
   * its target — and a viewer that dismisses on that closes on every slipped press and every
   * text selection ending outside. Both directions are asserted: the second is the control,
   * without which "never dismisses" would pass.
   */
  it('does not dismiss when the press began on the image and ended on the panel', () => {
    const onOpenChange = vi.fn();
    const root = open({ onOpenChange });
    const panel = root.querySelector('[role="dialog"]') as HTMLElement;
    const img = panel.querySelector('img') as HTMLElement;

    fireEvent.pointerDown(img);
    /* The browser's own target for that gesture: the common ancestor, i.e. the panel. */
    fireEvent.click(panel);
    expect(onOpenChange).not.toHaveBeenCalled();

    /* And the stale press must not leak into the next interaction either. */
    fireEvent.click(panel);
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('dismisses when the press both began and ended on the panel', () => {
    const onOpenChange = vi.fn();
    const panel = open({ onOpenChange }).querySelector('[role="dialog"]') as HTMLElement;
    fireEvent.pointerDown(panel);
    fireEvent.click(panel);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  /**
   * NO ZOOM, NO PAN, NO GALLERY, NO SWIPE (KTD10). The component this mirrors has none of
   * them, and a drag-to-dismiss here would be the fourth implementation of a gesture whose
   * one correctness rule three app-side copies each had to get right alone.
   */
  it('offers no gesture, zoom or gallery surface', () => {
    const root = open({});
    const panel = root.querySelector('[role="dialog"]') as HTMLElement;
    expect(panel.querySelector('[data-dialog-handle]')).toBeNull();
    expect(root.querySelectorAll('[role="dialog"] img').length).toBe(1);
  });
});
