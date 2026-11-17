import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { contract } from '../../contract';
import { Button } from './Button';

describe('Button', () => {
  it('renders its children as visible text', () => {
    render(<Button>Kirim</Button>);
    expect(screen.getByText('Kirim')).toBeVisible();
  });

  it('exposes an accessible button role', () => {
    render(<Button>Kirim</Button>);
    expect(screen.getByRole('button', { name: 'Kirim' })).toBeInTheDocument();
  });

  // Asserted on the class list rather than a computed colour: nothing imports
  // tokens.css here, so custom properties would resolve to nothing.
  // 12 cells, not the 2 a spot check covers. `text` (the BARE map) had no test at all, so a
  // broken BARE mapping would have shipped: every cell must render, and every cell must be
  // distinct from the other shapes of its own colour.
  it('renders every Type x Colors cell distinctly', () => {
    const seen = new Map<string, string>();
    for (const type of contract.Button.axes.type) {
      for (const color of contract.Button.axes.color) {
        const { unmount } = render(
          <Button type={type} color={color}>{`${type}-${color}`}</Button>,
        );
        const cls = screen.getByRole('button', { name: `${type}-${color}` }).className;
        expect(cls, `${type}/${color} rendered no classes`).not.toBe('');
        seen.set(`${type}/${color}`, cls);
        unmount();
      }
    }
    expect(seen.size).toBe(
      contract.Button.axes.type.length * contract.Button.axes.color.length,
    );
    // The three shapes of one colour must differ, or a Type is mapping to the wrong table.
    const of = (t: string) => seen.get(`${t}/danger`);
    expect(new Set([of('primary'), of('ghost'), of('outline'), of('text')]).size).toBe(4);
  });

  it('renders the loading spinner decoratively, not as part of the button name', () => {
    render(<Button isLoading>Kirim</Button>);
    expect(screen.getByRole('button', { name: 'Kirim' })).toBeInTheDocument();
  });

  it('composes Type and Colors independently', () => {
    render(
      <>
        <Button color="danger">Hapus</Button>
        <Button type="ghost" color="danger">Batal</Button>
      </>,
    );
    // Filled danger and outlined danger are the combination the old single `variant` axis
    // could not express: it had one `danger`, and it was always filled.
    expect(screen.getByRole('button', { name: 'Hapus' })).toHaveClass('bg-default-error');
    expect(screen.getByRole('button', { name: 'Batal' })).toHaveClass('ring-default-error');
  });

  it('composes disabled with any colour, not just one', () => {
    render(
      <>
        <Button color="danger" disabled>Hapus</Button>
        <Button color="light" disabled>Nanti</Button>
      </>,
    );
    for (const name of ['Hapus', 'Nanti']) {
      expect(screen.getByRole('button', { name })).toBeDisabled();
    }
  });

  /**
   * A DISABLED BUTTON TAKES A COLOUR, NOT A FADE (UMK-1091). One `disabled:opacity-50` on the
   * base made four disabled colours look like one, and it is not a treatment Figma publishes.
   * `General` 120:202 gives a filled step a disable FILL, a ghost step a disable STROKE, and a
   * text step no paint at all — so the three types are asserted separately, and every colour
   * with them: an arm written for `danger` alone would satisfy a single-colour check.
   *
   * These prove the class is PRESENT. That `bg-disable-error` is the right pink is a look.
   */
  it.each([
    ['primary', 'brand'],
    ['light', 'primary'],
    ['danger', 'error'],
    ['dark', 'invert'],
  ] as const)('gives a disabled filled %s button its own disable fill', (color, step) => {
    render(
      <Button color={color} disabled>
        Aksi
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Aksi' });
    expect(button).toHaveClass(`disabled:bg-disable-${step}`);
    expect(button.className, 'the fade is replaced by a colour, not joined by one').not.toMatch(
      /\bdisabled:opacity-\d+/,
    );
  });

  it.each([
    ['primary', 'brand'],
    ['light', 'primary'],
    ['danger', 'error'],
    ['dark', 'invert'],
  ] as const)('gives a disabled ghost %s button its own disable stroke', (color, step) => {
    render(
      <Button type="ghost" color={color} disabled>
        Aksi
      </Button>,
    );
    expect(screen.getByRole('button', { name: 'Aksi' })).toHaveClass(`disabled:ring-disable-${step}`);
  });

  it.each(['primary', 'light', 'danger', 'dark'] as const)(
    'gives a disabled text %s button no paint at all',
    (color) => {
      render(
        <Button type="text" color={color} disabled>
          Aksi
        </Button>,
      );
      const className = screen.getByRole('button', { name: 'Aksi' }).className;
      expect(className, 'a text button paints no fill when disabled').not.toMatch(/\bdisabled:bg-/);
      expect(className, 'a text button paints no stroke when disabled').not.toMatch(/\bdisabled:ring-/);
      expect(className, 'a disabled text button still needs pale ink').toMatch(/\bdisabled:text-disable-/);
    },
  );

  /**
   * `dark` IS A BUTTON FOR DARK CHROME, and its ink is WHITE at every type (`General` 120:202).
   *
   * This is the one cell the first migration got wrong, and it was reported by eye rather than
   * caught here: the legacy palette's `dark` meant "dark ink on light", so reading it across
   * gave `text-default-primary` — a navy ink — on the ghost and text steps, which is invisible
   * on the surface those buttons are drawn for. Every class resolved. Asserted per type, since
   * the filled step was right while the other two were not.
   */
  it.each(['primary', 'ghost', 'text'] as const)('inks a dark %s button white, not navy', (type) => {
    render(
      <Button type={type} color="dark">
        Aksi
      </Button>,
    );
    const className = screen.getByRole('button', { name: 'Aksi' }).className;
    expect(className.split(/\s+/), 'a dark button must read on dark chrome').toContain(
      'text-default-invert',
    );
    expect(className, 'the navy ink is the legacy meaning of `dark`, not Figma\'s').not.toMatch(
      /(?:^|\s)text-default-primary(?:\s|$)/,
    );
  });

  /**
   * Two filled cells carry a stroke and the other two do not — `General` 120:202 draws Light
   * at 1px `#F0F0F0` and Dark at 2px, while Brand and Danger are bare fills. Pinned because a
   * filled button with a stroke reads as an oversight to the next editor.
   */
  it.each([
    ['light', 'ring-1'],
    ['dark', 'ring-2'],
  ] as const)('gives the filled %s button its published stroke', (color, width) => {
    render(<Button color={color}>Aksi</Button>);
    expect(screen.getByRole('button', { name: 'Aksi' })).toHaveClass(width);
  });

  it.each(['primary', 'danger'] as const)('leaves the filled %s button unstroked', (color) => {
    render(<Button color={color}>Aksi</Button>);
    expect(screen.getByRole('button', { name: 'Aksi' }).className).not.toMatch(/(?:^|\s)ring-\d/);
  });

  /**
   * A 1px ghost stroke, per R9 — it was 2px. `dark` is NOT flattened into that: its published
   * stroke really is 2px (`General` 120:202), so following Figma means keeping the difference
   * rather than making the four agree.
   */
  it('draws a 1px ghost stroke everywhere Figma draws one', () => {
    for (const color of ['primary', 'light', 'danger'] as const) {
      const { unmount } = render(
        <Button type="ghost" color={color}>
          {color}
        </Button>,
      );
      expect(screen.getByRole('button', { name: color })).toHaveClass('ring-1');
      unmount();
    }
    render(
      <Button type="ghost" color="dark">
        dark
      </Button>,
    );
    expect(screen.getByRole('button', { name: 'dark' })).toHaveClass('ring-2');
  });

  /**
   * OUTLINE (UMK-1548) is the ghost on a solid fill with a REAL border: a ring is a box-shadow
   * that takes no layout space, a border adds 1px a side (the T3b "Salin" mockup draws a border).
   */
  it('draws an outline button as a white fill, a real brand border and brand ink, with no ring', () => {
    render(<Button type="outline" color="primary">Salin</Button>);
    const button = screen.getByRole('button', { name: 'Salin' });
    expect(button).toHaveClass('bg-default-primary', 'border', 'border-default-brand', 'text-default-brand');
    expect(button.className).not.toMatch(/(?:^|\s)(?:hover:|disabled:)?ring-/);
    expect(button.className).not.toMatch(/\bbg-transparent\b/);
  });

  it.each([
    ['primary', 'brand'],
    ['light', 'primary'],
    ['danger', 'error'],
    ['dark', 'invert'],
  ] as const)('gives an outline %s button a border, a hover border and a disable border', (color, step) => {
    render(<Button type="outline" color={color} disabled>Aksi</Button>);
    const button = screen.getByRole('button', { name: 'Aksi' });
    expect(button.className).toMatch(/(?:^|\s)border(?:-2)?(?:\s|$)/);
    expect(button.className).toMatch(/\bhover:border-hover-/);
    expect(button).toHaveClass(`disabled:border-disable-${step}`);
    expect(button.className).not.toMatch(/\bring-/);
  });

  /**
   * NO LEGACY PALETTE SURVIVES IN THIS COMPONENT. The `z-*` and `state-*` keys still resolve
   * — the app's own pages use them and they stay in the preset — so a leftover one is green
   * everywhere. The ban is on the file, which is the only place it can be seen.
   *
   * COMMENTS ARE STRIPPED, line comments first. `Button.tsx` documents the migration with a
   * table naming each key it moved AWAY from, and the first run of this ban matched that
   * table — a ban whose subject is quoted in the prose explaining it reds on correct code.
   * The order is the documented one: a line comment may itself contain the two characters
   * that open a block comment, and stripping blocks first lets that swallow the rest of the
   * file. See docs/solutions/conventions/a-comment-can-blind-a-regex-guard-test.md
   */
  it('names no legacy palette key', () => {
    const source = readFileSync(resolve(__dirname, 'Button.tsx'), 'utf8')
      .replace(/(^|[^:])\/\/.*$/gm, '$1')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    /* THE PALETTE SEGMENT, not a list of utility prefixes. An enumeration of
       `bg|text|ring|border|from|to` is a ban that only refuses the spellings someone thought
       of: `fill-z-primary`, `stroke-state-error`, `divide-`, `outline-`, `shadow-`, `accent-`,
       `caret-`, `decoration-` and `placeholder-` all name the same retired palette and all
       slipped through. What is actually forbidden is the palette, so that is what is matched —
       any utility, any variant prefix. */
    expect(source.match(/[\w-]*\b(?:z|state)-[a-z][\w]*/g)).toBeNull();
  });

  /**
   * THE DEFAULT SIZE IS `medium`, ON BOTH SURFACES, and it is the one path nothing covered.
   *
   * Almost every call site writes `<Button>` with no `size`, so the default is the size the
   * product actually ships — and it lived only in `defaultVariants` here and a parameter
   * default in `native/Button.tsx`, with no assertion on either. Changing one and not the
   * other, or changing either at all, moves the padding and type scale of most buttons in the
   * app with nothing red.
   *
   * Asserted as the rendered class, not by reading `defaultVariants` back: reading the
   * declaration and asserting the declaration is the self-measuring shape
   * (docs/solutions/conventions/a-guard-test-can-pass-by-measuring-itself.md). The explicit
   * `size="medium"` render is the control — it proves the expectation names the right classes,
   * so a default that changed would red rather than both sides moving together.
   */
  it('defaults to the medium size', () => {
    render(<Button>Kirim</Button>);
    const byDefault = screen.getByRole('button', { name: 'Kirim' }).className;

    const { unmount } = render(<Button size="medium">Kontrol</Button>);
    const explicit = screen.getByRole('button', { name: 'Kontrol' }).className;
    unmount();

    expect(byDefault, 'the default button no longer renders the medium size').toBe(explicit);
    for (const cls of ['px-8', 'py-3', 'text-ds-paragraph-desktop']) {
      expect(byDefault.split(/\s+/), `the medium size no longer carries ${cls}`).toContain(cls);
    }
  });

  /**
   * The native sibling's default is a parameter default rather than a variant table, so the two
   * are written in different places with nothing linking them. Read as source, because
   * `react-native` does not load under vitest — same reason `native/__tests__` scans text.
   */
  it('defaults the native sibling to medium as well', () => {
    const native = readFileSync(resolve(__dirname, '../../native/Button.tsx'), 'utf8')
      .replace(/(^|[^:])\/\/.*$/gm, '$1')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    expect(native, 'native Button does not default its size to medium').toMatch(
      /size\s*=\s*'medium'/,
    );
  });

  it('renders every size', () => {
    for (const size of ['large', 'medium', 'small', 'micro'] as const) {
      const { unmount } = render(<Button size={size}>{size}</Button>);
      expect(screen.getByRole('button', { name: size })).toBeInTheDocument();
      unmount();
    }
  });

  it('renders both widths', () => {
    render(
      <>
        <Button width="auto">A</Button>
        <Button width="full">B</Button>
      </>,
    );
    expect(screen.getByRole('button', { name: 'A' })).toHaveClass('w-auto');
    expect(screen.getByRole('button', { name: 'B' })).toHaveClass('w-full');
  });

  it('disables while loading and renders the Spinner primitive, not an inline svg', () => {
    const { container } = render(<Button isLoading>Kirim</Button>);
    expect(screen.getByRole('button', { name: /Kirim/ })).toBeDisabled();
    expect(container.querySelector('svg')).toBeNull();
    expect(container.querySelector('.animate-spin')).toBeInTheDocument();
  });

  // The contract is the source, not a copy of it: changing an axis there has to change what
  // renders here, or the two can drift while both look authoritative.
  it('reads its axes from the contract', () => {
    for (const color of contract.Button.axes.color) {
      const { unmount } = render(<Button color={color}>{color}</Button>);
      expect(screen.getByRole('button', { name: color }).className).not.toBe('');
      unmount();
    }
    expect(contract.Button.axes.color).not.toContain('disable');
  });
});

describe('an icon-only Button needs no call-site override', () => {
  const classesOf = (el: HTMLElement) => [...el.classList];

  it('renders square padding and no horizontal step', () => {
    for (const size of contract.Button.axes.size) {
      const { container } = render(
        <Button iconOnly aria-label="Tutup" size={size}>
          <span>x</span>
        </Button>,
      );
      const classes = classesOf(container.querySelector('button')!);
      expect(classes.some((c) => /^p-/.test(c)), `${size} has no square padding`).toBe(true);
      expect(classes.some((c) => /^px-/.test(c)), `${size} still carries a horizontal step`).toBe(
        false,
      );
    }
  });

  /* The other half of what every icon-only call site overrides: the width default is `full`,
     so a glyph would otherwise sit in a stretched pill. */
  it('does not stretch to full width even though that is the default', () => {
    const { container } = render(
      <Button iconOnly aria-label="Tutup">
        <span>x</span>
      </Button>,
    );
    const classes = classesOf(container.querySelector('button')!);
    expect(classes).toContain('w-auto');
    expect(classes).not.toContain('w-full');
  });

  it('exposes an accessible name from aria-label', () => {
    render(
      <Button iconOnly aria-label="Tutup">
        <span aria-hidden>x</span>
      </Button>,
    );
    expect(screen.getByRole('button', { name: 'Tutup' })).toBeTruthy();
  });

  /* The compile-time half — that omitting the name does not build — is in `Button.test-d.ts`,
     because a nameless button still renders. */

  it('leaves an ordinary button byte-identical to before the prop existed', () => {
    const plain = render(<Button color="danger">Hapus</Button>).container.innerHTML;
    const explicit = render(
      <Button color="danger" iconOnly={false}>
        Hapus
      </Button>,
    ).container.innerHTML;
    expect(plain).toBe(explicit);
  });

  /* The equality lock in `variants.platform-neutral.test.ts` already fails on a widened
     `width`; this says the same thing from the other side, so the reason the axis was NOT the
     place for this survives a reader who never opens the contract guard. */
  it('adds nothing to the width axis', () => {
    expect(contract.Button.axes.width).toEqual(['auto', 'full']);
  });
});

describe('Button unstyled and asChild', () => {
  describe('unstyled', () => {
    it('renders no class at all, base included', () => {
      render(<Button unstyled>Kirim</Button>);
      expect(screen.getByRole('button', { name: 'Kirim' }).className).toBe('');
    });

    it('adds no icon-only step either', () => {
      render(
        <Button unstyled iconOnly aria-label="Tutup">
          x
        </Button>,
      );
      expect(screen.getByRole('button', { name: 'Tutup' }).className).toBe('');
    });

    it('passes className through and nothing else', () => {
      render(
        <Button unstyled className="p-1 font-bold">
          Kirim
        </Button>,
      );
      expect(screen.getByRole('button', { name: 'Kirim' }).className).toBe('p-1 font-bold');
    });

    it('blocks clicks when disabled and when loading', () => {
      let n = 0;
      render(
        <Button unstyled disabled action={() => n++}>
          A
        </Button>,
      );
      render(
        <Button unstyled isLoading action={() => n++}>
          B
        </Button>,
      );
      fireEvent.click(screen.getByRole('button', { name: 'A' }));
      fireEvent.click(screen.getByRole('button', { name: /B/ }));
      expect(n).toBe(0);
    });

    // The HTML type is `htmlType` today (the style axis owns `type`); pinned so unstyled keeps it.
    it('submits a form through htmlType="submit"', () => {
      let submitted = 0;
      render(
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submitted++;
          }}
        >
          <Button unstyled htmlType="submit">
            Kirim
          </Button>
        </form>,
      );
      fireEvent.click(screen.getByRole('button', { name: 'Kirim' }));
      expect(submitted).toBe(1);
    });

    it('defaults to type="button" so it never submits by accident', () => {
      render(<Button unstyled>Kirim</Button>);
      expect(screen.getByRole('button', { name: 'Kirim' })).toHaveAttribute('type', 'button');
    });
  });

  describe('asChild', () => {
    it('renders the child element carrying the button props', () => {
      let clicked = 0;
      render(
        <Button unstyled asChild className="underline" action={() => clicked++}>
          <a href="/x">Lihat</a>
        </Button>,
      );
      expect(screen.queryByRole('button')).toBeNull();
      const a = screen.getByRole('link', { name: 'Lihat' });
      expect(a).toHaveAttribute('href', '/x');
      expect(a.className).toBe('underline');
      fireEvent.click(a);
      expect(clicked).toBe(1);
    });

    it('merges the child\'s own className and handler with the button\'s', () => {
      let own = 0;
      let mine = 0;
      render(
        <Button unstyled asChild className="a" onClick={() => mine++}>
          <a href="/x" className="b" onClick={() => own++}>
            Lihat
          </a>
        </Button>,
      );
      const a = screen.getByRole('link');
      expect(a.className).toBe('a b');
      fireEvent.click(a);
      expect([own, mine]).toEqual([1, 1]);
    });

    it('blocks the click and the navigation when disabled or loading', () => {
      let n = 0;
      for (const flag of [{ disabled: true }, { isLoading: true }]) {
        const { unmount } = render(
          <Button unstyled asChild action={() => n++} onClick={() => n++} {...flag}>
            <a href="/x" onClick={() => n++}>
              Lihat
            </a>
          </Button>,
        );
        const a = screen.getByRole('link');
        expect(a).toHaveAttribute('aria-disabled', 'true');
        expect(fireEvent.click(a)).toBe(false); // preventDefault was called
        unmount();
      }
      expect(n).toBe(0);
    });

    it('keeps the child\'s own ref and also fills the forwarded one', () => {
      const own = React.createRef<HTMLAnchorElement>();
      const fwd = React.createRef<HTMLButtonElement>();
      render(
        <Button unstyled asChild ref={fwd}>
          <a href="/x" ref={own}>
            Lihat
          </a>
        </Button>,
      );
      const a = screen.getByRole('link');
      expect(own.current).toBe(a);
      expect(fwd.current).toBe(a);
    });

    it('takes an inert child out of the tab order', () => {
      render(
        <Button unstyled asChild disabled>
          <a href="/x">Lihat</a>
        </Button>,
      );
      expect(screen.getByRole('link')).toHaveAttribute('tabindex', '-1');
    });

    it('works on the styled button too', () => {
      render(
        <Button asChild>
          <a href="/x">Lihat</a>
        </Button>,
      );
      expect(screen.getByRole('link').className).toContain('bg-default-brand');
    });
  });
});
