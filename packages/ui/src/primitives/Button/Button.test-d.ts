import { describe, expectTypeOf, it } from 'vitest';
import { Button } from './Button';

/**
 * A GLYPH ANNOUNCES NOTHING, so an icon-only button with no `aria-label` is a control a screen
 * reader reads as empty — and it renders perfectly, which is why no runtime test can be the
 * gate. Compiled by vitest's `typecheck` mode; see `vitest.config.ts`.
 */
describe('an icon-only Button cannot be nameless', () => {
  it('rejects iconOnly with no accessible name', () => {
    // @ts-expect-error - `iconOnly` requires `aria-label`
    Button({ iconOnly: true, children: 'x' });
  });

  it('accepts an icon-only button that names itself', () => {
    expectTypeOf(Button).toBeCallableWith({
      iconOnly: true,
      'aria-label': 'Tutup',
      children: 'x',
    });
  });

  it('leaves an ordinary button unchanged, with no name required', () => {
    expectTypeOf(Button).toBeCallableWith({ children: 'Kirim' });
  });
});

describe('unstyled refuses the style axes', () => {
  it('rejects color and size under unstyled', () => {
    // @ts-expect-error - `color` is a style axis
    Button({ unstyled: true, color: 'danger', children: 'x' });
    // @ts-expect-error - `size` is a style axis
    Button({ unstyled: true, size: 'small', children: 'x' });
    // @ts-expect-error - `width` is a style axis
    Button({ unstyled: true, width: 'full', children: 'x' });
    // @ts-expect-error - the cva `type` value is a style axis
    Button({ unstyled: true, type: 'ghost', children: 'x' });
  });

  it('accepts unstyled with a className, so the refusals above are not a blanket error', () => {
    expectTypeOf(Button).toBeCallableWith({ unstyled: true, className: 'p-1', children: 'x' });
  });

  it('keeps the HTML type expressible as htmlType', () => {
    expectTypeOf(Button).toBeCallableWith({ unstyled: true, htmlType: 'submit', children: 'x' });
  });

  it('still requires a name for an icon-only button', () => {
    // @ts-expect-error - `iconOnly` requires `aria-label`
    Button({ unstyled: true, iconOnly: true, children: 'x' });
  });
});
