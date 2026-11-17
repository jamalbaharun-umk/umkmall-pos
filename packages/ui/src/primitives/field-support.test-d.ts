import { describe, expectTypeOf, it } from 'vitest';
import { CheckBox } from './CheckBox';
import { DateTimeInput } from './DateTimeInput';
import { Dialog } from './Dialog';
import { OtpInput } from './OtpInput';
import { Radio } from './Radio';
import { Slider } from './Slider';
import { Switch } from './Switch';
import { TextField } from './TextField';

/**
 * THE COMPILE-TIME HALF OF KTD4, and the only place it exists.
 *
 * The union's whole value is that omitting both a visible label and an accessible name is a
 * type error. No runtime test can see that — a control rendered without either still renders
 * — so if this file is not actually compiled, the guarantee is a comment. It is compiled by
 * vitest's `typecheck` mode against `tsconfig.typecheck.json`; see `vitest.config.ts`.
 *
 * `@ts-expect-error` is the assertion here: the line fails if the error it expects STOPS
 * happening, which is exactly the regression — someone loosening the union back to an
 * optional `label`.
 */
describe('the labelling union refuses a nameless control', () => {
  it('rejects a Slider with neither arm', () => {
    // @ts-expect-error - neither `label` nor `aria-label`
    Slider({ size: 'large' });
  });

  it('rejects a DateTimeInput with neither arm', () => {
    // @ts-expect-error - neither `label` nor `aria-label`
    DateTimeInput({ size: 'large' });
  });

  it('rejects a control that supplies BOTH, so one element never carries two names', () => {
    // @ts-expect-error - the arms are mutually exclusive
    Slider({ label: 'Harga', 'aria-label': 'Harga' });
  });

  it('accepts either arm on its own', () => {
    expectTypeOf(Slider).toBeCallableWith({ label: 'Harga' });
    expectTypeOf(Slider).toBeCallableWith({ 'aria-label': 'Harga' });
    expectTypeOf(DateTimeInput).toBeCallableWith({ label: 'Tanggal' });
    expectTypeOf(DateTimeInput).toBeCallableWith({ 'aria-label': 'Tanggal' });
  });

  /**
   * THE RELAXATION IS DELIBERATE AND BOUNDED. UMK-955 relaxed TextField and CheckBox to the
   * union (a search box and a consent row have no caption to draw); Radio and Switch still
   * require the visible label, and quietly relaxing them too would give that up with nothing
   * failing.
   */
  it('accepts an accessible name alone on TextField and CheckBox, refuses a bare one', () => {
    expectTypeOf(TextField).toBeCallableWith({ 'aria-label': 'Nama' });
    expectTypeOf(CheckBox).toBeCallableWith({ 'aria-label': 'Setuju' });
    // @ts-expect-error - neither `label` nor `aria-label`
    TextField({});
    // @ts-expect-error - neither `label` nor `aria-label`
    CheckBox({});
  });

  it('leaves Radio and Switch requiring a visible label', () => {
    // @ts-expect-error - Radio still requires `label`
    Radio({ 'aria-label': 'Pilihan', name: 'g', value: 'a' });
    // @ts-expect-error - Switch still requires `label`
    Switch({ 'aria-label': 'Aktif' });
  });
});

describe('Dialog refuses a centred drawer', () => {
  it('rejects `centered` together with a `side` (UMK-1186)', () => {
    // @ts-expect-error - a centred card has no edge to slide from
    Dialog({ open: true, onOpenChange: () => {}, children: null, label: 'x', centered: true, side: 'right' });
  });

  it('accepts each on its own', () => {
    expectTypeOf(Dialog).toBeCallableWith({ open: true, onOpenChange: () => {}, children: null, label: 'x', centered: true });
    expectTypeOf(Dialog).toBeCallableWith({ open: true, onOpenChange: () => {}, children: null, label: 'x', side: 'left' });
  });
});

describe('OtpInput takes the labelling union too (UMK-1186)', () => {
  it('rejects an OtpInput with neither arm', () => {
    // @ts-expect-error - neither `label` nor `aria-label`
    OtpInput({ value: '', onChange: () => {} });
  });
});
