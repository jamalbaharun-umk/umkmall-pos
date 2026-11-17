import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CheckBox } from './CheckBox';
import { DateTimeInput } from './DateTimeInput';
import { OtpInput } from './OtpInput';
import { parseIsoDate } from '../shared/date-input';
import { Radio } from './Radio';
import { Select } from './Select';
import { Dialog } from './Dialog';
import { Label } from './Label';
import { SelectionCard, splitDescription } from './SelectionCard';
import { Slider } from './Slider';
import { Switch } from './Switch';
import { TextField } from './TextField';
import { Upload } from './Upload';
import { CONTROL_BOX, OTP_BOX_ACTIVE, RADIO_BOX, UPLOAD_BASE, UPLOAD_DRAG_OVER, UPLOAD_STATUS } from './field-classes';
import { FOCUS_RING } from '../utils';
import { contract } from '../contract';

/**
 * ONE suite for the six controls, because most of what is asserted is the same rule applied
 * six times — a label that cannot be omitted, an error that is associated, a ring from one
 * constant, and no colour literal anywhere.
 *
 * `fireEvent`, not `user-event`: this package's only testing-library dependency is
 * `@testing-library/react`, and click/change/keydown is the whole surface these need.
 *
 * WHAT THIS SUITE CANNOT SEE. happy-dom implements no native key defaults, so dispatching
 * ArrowRight at a range input or Space at a checkbox changes nothing — a keyboard test
 * written against CORRECT native code fails here. Those are exercised in the stories on a
 * real browser instead, and the assertions below stop at "the native element ships, with no
 * handler of ours in the way".
 */

/** A hex, or a Tailwind palette colour that is not one of ours. */
const COLOUR_LITERAL =
  /#[0-9a-fA-F]{3,8}|\b(?:bg|text|border|ring|fill|stroke|accent)-(?:gray|slate|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|white|black)\b/;

const classesOf = (root: HTMLElement) =>
  [root, ...root.querySelectorAll<HTMLElement>('*')].map((el) => el.className).join(' ');

describe('TextField', () => {
  it('renders a distinct class set per size, and composes error with disabled', () => {
    const { container: large } = render(<TextField label="Nama" size="large" />);
    const { container: small } = render(<TextField label="Nama" size="small" />);
    expect(classesOf(large as unknown as HTMLElement)).not.toBe(
      classesOf(small as unknown as HTMLElement),
    );

    for (const size of contract.TextField.axes.size) {
      const { container } = render(
        <TextField label="Nama" size={size} error="Wajib diisi" disabled />,
      );
      const box = container.querySelector('[class*="border-default-"]')!;
      expect(box.className).toContain('cursor-not-allowed');
    }
  });

  it('associates the label and the error message with the input', () => {
    render(<TextField label="Email" error="Format salah" />);
    const input = screen.getByLabelText('Email');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    const errorId = input.getAttribute('aria-describedby')!;
    expect(document.getElementById(errorId)).toHaveTextContent('Format salah');
  });

  it('draws the error message in the focus ink while the field has focus (UMK-1334)', () => {
    const { container } = render(<TextField label="Email" error="Format salah" />);
    expect(container.firstElementChild).toHaveClass('group');
    const errorId = screen.getByLabelText('Email').getAttribute('aria-describedby')!;
    expect(document.getElementById(errorId)).toHaveClass('group-focus-within:text-focus-error');
  });

  it('keeps the error region mounted before there is a message to put in it', () => {
    render(<TextField label="Email" />);
    const errorId = screen.getByLabelText('Email').getAttribute('aria-describedby')!;
    expect(document.getElementById(errorId)).toBeInTheDocument();
  });

  it('marks the field required and renders a decorative marker', () => {
    render(<TextField label="Nama" required />);
    expect(screen.getByLabelText(/Nama/)).toBeRequired();
    expect(screen.getByText('*')).toHaveAttribute('aria-hidden');
  });

  it('renders a textarea for multiline, keeping the size and error styling', () => {
    const { container } = render(
      <TextField label="Deskripsi" multiline size="small" error="Terlalu pendek" />,
    );
    expect(container.querySelector('textarea')).toBeInTheDocument();
    expect(classesOf(container as unknown as HTMLElement)).toContain('border-default-error');
  });

  it('leaves a read-only field focusable, unlike a disabled one', () => {
    render(<TextField label="Kode" readOnly defaultValue="ABC" />);
    const input = screen.getByLabelText('Kode');
    input.focus();
    expect(document.activeElement).toBe(input);
    expect(input).not.toBeDisabled();
  });

  it('gives the reveal toggle an accessible name and switches the input type', () => {
    render(<TextField label="Kata sandi" type="password" />);
    const toggle = screen.getByRole('button', { name: 'Tampilkan kata sandi' });
    expect(screen.getByLabelText('Kata sandi')).toHaveAttribute('type', 'password');
    fireEvent.click(toggle);
    expect(screen.getByLabelText('Kata sandi')).toHaveAttribute('type', 'text');
    expect(screen.getByRole('button', { name: 'Sembunyikan kata sandi' })).toBeInTheDocument();
  });

  it('does not let a caller prop unwire the error association', () => {
    // The label and the error association are the two things this component exists to make
    // un-forgettable; a late `{...props}` spread would let a caller silently replace either.
    render(<TextField label="Email" error="Format salah" aria-describedby="somewhere-else" />);
    const input = screen.getByLabelText('Email');
    const [errorId, ...rest] = input.getAttribute('aria-describedby')!.split(' ');
    expect(document.getElementById(errorId)).toHaveTextContent('Format salah');
    // The caller's pointer rides along after it (UMK-955: the /kursus search description).
    expect(rest).toEqual(['somewhere-else']);
  });

  it('marks itself filled once it has a value', () => {
    const { container } = render(<TextField label="Nama" />);
    expect(container.querySelector('[data-filled]')).toBeNull();
    fireEvent.change(screen.getByLabelText('Nama'), { target: { value: 'Andi' } });
    expect(container.querySelector('[data-filled]')).not.toBeNull();
  });
});

describe('TextField without a visible label (UMK-955)', () => {
  it('names the control by aria-label and renders no <label>', () => {
    const { container } = render(<TextField aria-label="Cari kursus" />);
    expect(screen.getByRole('textbox', { name: 'Cari kursus' })).toBeInTheDocument();
    expect(container.querySelector('label')).toBeNull();
  });

  it('draws the required asterisk only with a visible label, in the error token', () => {
    const { container } = render(<TextField label="Nama" required />);
    expect(container.querySelector('label span[aria-hidden]')!.className).toContain('text-default-error');
    const { container: bare } = render(<TextField aria-label="Nama" required />);
    expect(bare.querySelector('[aria-hidden]')).toBeNull();
  });

  it('lets an aria-label override the name of a visible label, which is still drawn', () => {
    const { container } = render(<TextField label={<>Nama<span aria-label="wajib">*</span></>} aria-label="Nama" />);
    expect(screen.getByRole('textbox', { name: 'Nama' })).toBeInTheDocument();
    expect(container.querySelector('label')).not.toBeNull();
  });

  it('autoResize follows scrollHeight and caps at maxRows', () => {
    const scroll = vi.spyOn(HTMLTextAreaElement.prototype, 'scrollHeight', 'get').mockReturnValue(120);
    const { container } = render(<TextField aria-label="Catatan" multiline autoResize />);
    const area = container.querySelector('textarea')!;
    expect(area.style.height).toBe('120px');
    expect(area.className).toContain('resize-none');
    scroll.mockReturnValue(300);
    fireEvent.change(area, { target: { value: 'a\nb\nc' } });
    expect(area.style.height).toBe('300px');
    scroll.mockRestore();
  });

  it('ignores autoResize on a single-line field', () => {
    const { container } = render(<TextField aria-label="Nama" autoResize />);
    expect(container.querySelector('input')!.getAttribute('style')).toBeNull();
  });
});

describe('field captions draw through Label, Figma-exact (UMK-955)', () => {
  const caption = (container: HTMLElement) => container.querySelector('label')!;
  const cases: [string, (size: 'large' | 'small', extra?: object) => ReturnType<typeof render>][] = [
    ['TextField', (size, extra) => render(<TextField label="Nama" size={size} {...extra} />)],
    ['Select', (size, extra) => render(<Select label="Nama" size={size} options={[]} {...extra} />)],
    ['DateTimeInput', (size, extra) => render(<DateTimeInput label="Nama" size={size} {...extra} />)],
  ];

  it.each(cases)('%s: large is 14/20, small is 12/18, labelSize overrides, regular weight, no margin', (_n, draw) => {
    const large = caption(draw('large').container).className;
    expect(large).toContain('text-ds-paragraph-mobile');
    expect(large).toContain('font-normal');
    expect(large).not.toContain('font-medium');
    expect(large).not.toContain('mb-2');
    expect(caption(draw('small').container).className).toContain('text-ds-body-lg-mobile');
    expect(caption(draw('large', { labelSize: 'small' }).container).className).toContain('text-ds-body-lg-mobile');
  });

  it.each(cases)('%s: the label still names the control', (_n, draw) => {
    draw('large');
    expect(screen.getByLabelText('Nama')).toBeTruthy();
  });

  it.each(cases.filter(([n]) => n !== 'Select'))('%s: required draws an aria-hidden asterisk outside the name', (_n, draw) => {
    const { container } = draw('large', { required: true });
    expect(container.querySelector('label [aria-hidden]')!.textContent).toBe('*');
    expect(screen.getByLabelText(/^Nama/)).toBeTruthy();
  });

  it("Label's default look keeps its classes", () => {
    const { container } = render(<Label>Judul</Label>);
    expect(container.querySelector('label')!.className).toBe(
      'block font-semibold mb-2 transition-colors text-z-text-primary text-ds-paragraph-mobile',
    );
  });
});

describe('CheckBox without a visible label (UMK-955)', () => {
  it('names the control by aria-label and renders no label text', () => {
    const { container } = render(<CheckBox aria-label="Pilih semua" />);
    expect(screen.getByRole('checkbox', { name: 'Pilih semua' })).toBeInTheDocument();
    expect(container.querySelector('label')!.textContent).toBe('');
  });
});

describe('Select detail column and contained Escape (UMK-955)', () => {
  const RATIOS = [
    { label: '1:1', value: '1:1', detail: 'Feed Instagram' },
    { label: '16:9', value: '16:9', detail: 'YouTube' },
  ];

  it('renders the detail beside the label, and the trigger shows only the label', () => {
    render(<Select label="Ukuran" options={RATIOS} value="1:1" />);
    expect(screen.getByRole('combobox').textContent).toBe('1:1');
    fireEvent.click(screen.getByRole('combobox'));
    expect(screen.getByRole('option', { name: /1:1.*Feed Instagram/ })).toBeInTheDocument();
  });

  it('Escape closes the list and leaves the enclosing Dialog open; the next one closes the Dialog', async () => {
    const onOpenChange = vi.fn();
    render(
      <Dialog open onOpenChange={onOpenChange} label="Edit">
        <Select label="Ukuran" options={RATIOS} />
      </Dialog>,
    );
    fireEvent.click(screen.getByRole('combobox'));
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(onOpenChange).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Escape' });
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });
});

describe('CheckBox and Radio', () => {
  it('renders a distinct class per size, and Radio has no xlarge step', () => {
    const rendered = contract.CheckBox.axes.size.map(
      (size) => render(<CheckBox label={size} size={size} />).container.querySelector('input')!.className,
    );
    expect(new Set(rendered).size).toBe(rendered.length);
    expect(contract.Radio.axes.size).not.toContain('xlarge');
    expect(contract.CheckBox.axes.size).toContain('xlarge');
  });

  it('renders checked, unchecked and indeterminate distinctly, and indeterminate is not checked', () => {
    const { container } = render(<CheckBox label="Semua" indeterminate />);
    const input = container.querySelector('input')!;
    expect(input.indeterminate).toBe(true);
    expect(input.checked).toBe(false);
    expect(within(container).getByRole('checkbox')).toBeInTheDocument();

    const { container: checked } = render(<CheckBox label="Semua" defaultChecked />);
    expect(checked.querySelector('input')!.checked).toBe(true);
  });

  it('never puts a Radio into an indeterminate state', () => {
    // R6: the prop does not exist on Radio, and nothing sets the DOM property behind its
    // back either — a radio in a group is chosen or it is not.
    const { container } = render(<Radio label="Ya" />);
    expect(container.querySelector('input')!.type).toBe('radio');
    expect(container.querySelector('input')!.indeterminate).toBe(false);
  });

  it('keeps the indeterminate box indeterminate after a click', () => {
    // The browser clears the DOM property on user activation without the prop changing, so
    // an effect keyed on the prop never re-runs — leaving the input reporting checked while
    // the glyph still paints the dash. The prop is authoritative.
    const { container } = render(<CheckBox label="Semua" indeterminate />);
    const input = container.querySelector('input')!;
    fireEvent.click(input);
    expect(input.indeterminate).toBe(true);
  });

  /**
   * THE FILL FOLLOWS A STATE THE CONTROL ACTUALLY SETS (UMK-1091). The box used to fill on
   * `checked:` alone, which an indeterminate box deliberately clears — so it painted white
   * under a white dash. Asserted on the class string, because a rendered colour is a look.
   *
   * These read one shared table, so they cover `Radio` as well by construction. The pair
   * below pins that: the indeterminate arms are inert on a radio, the disabled-and-checked
   * one is not, and BOTH facts are load-bearing.
   */
  it('fills the box for indeterminate as well as checked, and keeps the fill when locked', () => {
    const { container } = render(<CheckBox label="Semua" indeterminate />);
    const cls = container.querySelector('input')!.className.split(/\s+/);
    expect(cls, 'an indeterminate box paints from :indeterminate, not :checked').toContain(
      'indeterminate:bg-default-brand',
    );
    expect(cls, 'a locked indeterminate box keeps a fill rather than going empty').toContain(
      'disabled:indeterminate:bg-disable-brand',
    );
    expect(cls, 'a locked checked box keeps a fill rather than going empty').toContain(
      'disabled:checked:bg-disable-brand',
    );
  });

  it('gives Radio the locked-selection fill and no indeterminate arm', () => {
    const { container } = render(<Radio label="Ya" defaultChecked disabled />);
    const words = container.querySelector('input')!.className.split(/\s+/);
    expect(words).toContain('disabled:checked:bg-disable-brand');
    /* A radio in an unchecked group matches :indeterminate, so any such arm would paint it brand. */
    expect(words.filter((w) => /(^|:)indeterminate:/.test(w))).toEqual([]);
  });

  it('keeps RADIO_BOX equal to CONTROL_BOX less its indeterminate words', () => {
    expect(RADIO_BOX.split(' ')).toEqual(CONTROL_BOX.split(' ').filter((w) => !/(^|:)indeterminate:/.test(w)));
  });

  it('toggles when the label is clicked', () => {
    render(<CheckBox label="Setuju" />);
    const box = screen.getByRole('checkbox');
    fireEvent.click(screen.getByText('Setuju'));
    expect(box).toBeChecked();
  });

  it('keeps two radios sharing a name mutually exclusive', () => {
    render(
      <>
        <Radio label="Satu" name="pilihan" value="1" />
        <Radio label="Dua" name="pilihan" value="2" />
      </>,
    );
    fireEvent.click(screen.getByLabelText('Satu'));
    expect(screen.getByLabelText('Satu')).toBeChecked();
    fireEvent.click(screen.getByLabelText('Dua'));
    expect(screen.getByLabelText('Dua')).toBeChecked();
    expect(screen.getByLabelText('Satu')).not.toBeChecked();
  });

  it('marks required and composes error with disabled at every size', () => {
    render(<CheckBox label="Setuju" required error="Harus dicentang" disabled />);
    const box = screen.getByRole('checkbox');
    expect(box).toBeRequired();
    expect(box).toBeDisabled();
    expect(box.className).toContain('border-default-error');
    expect(document.getElementById(box.getAttribute('aria-describedby')!)).toHaveTextContent(
      'Harus dicentang',
    );
  });
});

describe('Switch', () => {
  it('renders on and off distinctly and keeps one accessible name across both', () => {
    render(<Switch label="Notifikasi" />);
    const toggle = screen.getByRole('switch', { name: 'Notifikasi' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    const off = toggle.className;
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(toggle.className).not.toBe(off);
    expect(screen.getByRole('switch', { name: 'Notifikasi' })).toBe(toggle);
  });

  it('makes loading perceivable beyond colour, and composes it with disabled', () => {
    render(<Switch label="Notifikasi" loading />);
    const toggle = screen.getByRole('switch');
    expect(toggle).toHaveAttribute('aria-busy', 'true');
    expect(toggle).toBeDisabled();
  });

  it('carries neither an error nor a required state', () => {
    expect(contract.Switch.booleans).toEqual(['disabled', 'loading']);
    expect(contract.Switch.booleans).not.toContain('error');
  });

  /**
   * THE STATE SURVIVES THE LOCK (UMK-1091). A disabled switch used to paint from an
   * unconditional `disabled:bg-default-secondary`, so a switch that was ON but locked told
   * the user the setting was OFF. Both positions are asserted, and the enabled pair with
   * them: a fix that painted everything disable-brand would satisfy one assertion alone.
   *
   * These read CLASS NAMES, which is all this repo can check — `bg-disable-brand` resolving
   * to the right blue is a look, not a test (KTD6).
   */
  it.each([
    ['on and disabled', { defaultChecked: true, disabled: true }, 'bg-disable-brand'],
    ['off and disabled', { defaultChecked: false, disabled: true }, 'bg-disable-primary'],
    ['on and enabled', { defaultChecked: true }, 'bg-default-brand'],
    ['off and enabled', { defaultChecked: false }, 'bg-default-secondary'],
  ])('paints a switch that is %s from one resolution of both dimensions', (_what, props, expected) => {
    render(<Switch label="Notifikasi" {...props} />);
    const toggle = screen.getByRole('switch');
    expect(toggle.className.split(/\s+/)).toContain(expected);
    expect(toggle.className, 'the fade is replaced by a colour, not joined by one').not.toMatch(
      /\bdisabled:opacity-\d+/,
    );
  });

  /**
   * THE LABEL IS PART OF THE STATE. Figma's `05 Toggle` 775:3361 paints it `#c3cbd3` in both
   * disabled variants. A locked switch whose label still reads at full strength looks
   * available, and the track is a small target to be the only signal — so this is asserted
   * separately from the track, and on the enabled case too, which is what a one-sided fix
   * would break.
   */
  it.each([
    [true, 'text-disable-primary'],
    [false, 'text-default-primary'],
  ])('paints the label for disabled=%s', (disabled, expected) => {
    render(<Switch label="Notifikasi" disabled={disabled} />);
    const label = screen.getByText('Notifikasi');
    expect(label.className.split(/\s+/)).toContain(expected);
  });

  /**
   * `loading` RESOLVES THE SAME WAY AS `disabled`, and nothing covered it. Both feed one
   * `isOff`, which drives the track colour, the label ink and the `disabled` attribute
   * together — so a busy switch reads as locked, deliberately: it already WAS non-interactive
   * at the base commit (`disabled={disabled || loading}` set the attribute, and the old
   * `disabled:` arms applied), and the pale label is the only new part. Pinned so the three
   * consumers of `isOff` cannot drift apart unnoticed.
   */
  it('resolves a loading switch like a locked one', () => {
    render(<Switch label="Notifikasi" defaultChecked loading />);
    const toggle = screen.getByRole('switch');
    expect(toggle, 'a loading switch must not be pressable').toBeDisabled();
    expect(toggle).toHaveAttribute('aria-busy', 'true');
    expect(toggle.className.split(/\s+/), 'loading takes the same track as locked').toContain(
      'bg-disable-brand',
    );
    expect(screen.getByText('Notifikasi').className.split(/\s+/)).toContain('text-disable-primary');
  });
});

describe('Slider', () => {
  it('ships the native range input, with no key handler of ours in the way', () => {
    render(<Slider label="Kualitas" defaultValue={40} />);
    const range = screen.getByRole('slider', { name: 'Kualitas' });
    expect(range).toHaveAttribute('type', 'range');
    expect(range).toHaveAttribute('min', '0');
    expect(range).toHaveAttribute('max', '100');
    expect((range as HTMLInputElement).value).toBe('40');
    // The native mapping is what ships (KTD8). Arrow-key stepping is exercised in the story:
    // happy-dom implements no native key defaults, so asserting it here would fail against
    // correct code.
    expect(range.getAttribute('onkeydown')).toBeNull();
  });

  it('sets aria-valuetext only when a formatter is given', () => {
    const { rerender } = render(<Slider label="Kualitas" defaultValue={40} />);
    expect(screen.getByRole('slider')).not.toHaveAttribute('aria-valuetext');
    rerender(<Slider label="Kualitas" defaultValue={40} formatValue={(v) => `${v} persen`} />);
    expect(screen.getByRole('slider')).toHaveAttribute('aria-valuetext', '40 persen');
  });

  it('reflects the value in the filled track through a custom property alone', () => {
    render(<Slider label="Kualitas" value={25} onChange={() => {}} />);
    const range = screen.getByRole('slider');
    expect(range.getAttribute('style')).toContain('--slider-fill: 25%');
    expect(range.getAttribute('style')).not.toMatch(/#[0-9a-fA-F]{3,8}/);
  });

  it('removes a disabled slider from the tab order', () => {
    render(<Slider label="Kualitas" disabled />);
    expect(screen.getByRole('slider')).toBeDisabled();
  });
});

describe('DateTimeInput', () => {
  it('rejects a date that is not a real calendar day', () => {
    expect(parseIsoDate('2026-02-31')).toBeUndefined();
    expect(parseIsoDate('not-a-date')).toBeUndefined();
    expect(parseIsoDate('2026-03-01')?.getDate()).toBe(1);
  });

  it('accepts and normalises a typed date', () => {
    const seen: string[] = [];
    render(<DateTimeInput label="Tanggal" onValueChange={(v) => seen.push(v)} />);
    const input = screen.getByLabelText('Tanggal');
    fireEvent.change(input, { target: { value: '01/03/2026' } });
    fireEvent.blur(input);
    expect(seen).toEqual(['2026-03-01']);
  });

  it('shows a plain date as dd/mm/yyyy and speaks YYYY-MM-DD (UMK-955)', () => {
    const seen: string[] = [];
    render(<DateTimeInput label="Tanggal" defaultValue="2026-10-09" onValueChange={(v) => seen.push(v)} />);
    const input = screen.getByLabelText('Tanggal') as HTMLInputElement;
    expect(input.value).toBe('09/10/2026');
    fireEvent.change(input, { target: { value: '10/10/2026' } });
    fireEvent.blur(input);
    expect(seen).toEqual(['2026-10-10']);
    expect(input.value).toBe('10/10/2026');
  });

  it('keeps ISO text for the a2ui look, withTime and a range (UMK-955)', () => {
    render(<DateTimeInput label="A" appearance="a2ui" defaultValue="2026-10-09" />);
    expect((screen.getByLabelText('A') as HTMLInputElement).value).toBe('2026-10-09');
    expect((screen.getByLabelText('A') as HTMLInputElement).placeholder).toBe('YYYY-MM-DD');
    render(<DateTimeInput label="T" withTime defaultValue="2026-10-09T08:30" />);
    expect((screen.getByLabelText('T') as HTMLInputElement).value).toBe('2026-10-09T08:30');
  });

  it('shows the dd/mm/yyyy placeholder and emits nothing for an unreal or ISO-typed date (UMK-955)', () => {
    const seen: string[] = [];
    render(<DateTimeInput label="Tanggal" defaultValue="2026-10-09" onValueChange={(v) => seen.push(v)} />);
    const input = screen.getByLabelText('Tanggal') as HTMLInputElement;
    expect(input.placeholder).toBe('dd/mm/yyyy');
    for (const bad of ['31/02/2026', 'abc', '2026-10-10', '9/10/2026']) {
      fireEvent.change(input, { target: { value: bad } });
      fireEvent.blur(input);
      expect(input.value, bad).toBe('09/10/2026');
    }
    expect(seen).toEqual([]);
  });

  it('rejects an out-of-range date when TYPED, not only when picked', () => {
    const seen: string[] = [];
    render(
      <DateTimeInput label="Tanggal" min="2026-01-01" max="2026-01-31" onValueChange={(v) => seen.push(v)} />,
    );
    const input = screen.getByLabelText('Tanggal');
    fireEvent.change(input, { target: { value: '01/06/2027' } });
    fireEvent.blur(input);
    // Refused outright: nothing is emitted, and the box falls back to the last ACCEPTED
    // value rather than to the value it just rejected.
    expect(seen).toEqual([]);
    expect((input as HTMLInputElement).value).toBe('');
  });

  it('opens the calendar from a named control and populates the field from it', () => {
    render(<DateTimeInput label="Tanggal" defaultValue="2026-03-10" />);
    fireEvent.click(screen.getByRole('button', { name: 'Buka kalender' }));
    fireEvent.click(screen.getByRole('button', { name: /15/ }));
    expect((screen.getByLabelText('Tanggal') as HTMLInputElement).value).toBe('15/03/2026');
  });

  /**
   * A SELECTED DAY STAYS SELECTED UNDER THE POINTER (UMK-1091). The selection fill sat on the
   * day CELL and the hover tint on the BUTTON inside it, so hovering a selected day painted
   * over the selection — the reported symptom, and a stacking problem rather than a colour one.
   *
   * Asserted as "the selection paints the interactive element", because that is the property
   * that makes the two rules resolvable at all. Whether the pointer actually leaves it blue is
   * the Storybook check; happy-dom applies no stylesheet and has no pointer.
   */
  it('paints the selection on the day button rather than the cell around it', () => {
    render(<DateTimeInput label="Tanggal" defaultValue="2026-03-10" />);
    fireEvent.click(screen.getByRole('button', { name: 'Buka kalender' }));
    const day = screen.getByRole('button', { name: /10/ });
    const cell = day.closest('td')!;
    /* The reach-through is what puts the fill on the same element the hover is on. A bare
       `bg-default-brand` on the cell is the defect, so its ABSENCE is asserted too. */
    expect(cell.className).toMatch(/\[&>button\]:bg-default-brand/);
    expect(cell.className, 'the cell paints its own fill again, which the hover will cover').not.toMatch(
      /(?:^|\s)bg-default-brand(?:\s|$)/,
    );
    expect(cell.className, 'the selected day has no hover arm, so the plain hover tint wins').toMatch(
      /\[&>button\]:hover:bg-default-brand/,
    );
  });

  /**
   * Figma `Date` 789:3310 `State=Disable` is `#93A2B0` — exactly `text-default-secondary`, and
   * not the `disable` ramp the cell used to read. Found by the button's own `disabled`
   * property rather than by a class, so the assertion cannot be satisfied by the very class it
   * is checking for: keying the SELECTION on the answer is how the first version of this test
   * passed while reverted, because `outside` days legitimately carry the same ink.
   */
  it('gives an out-of-range day secondary ink', () => {
    render(<DateTimeInput label="Tanggal" defaultValue="2026-03-10" min="2026-03-05" />);
    fireEvent.click(screen.getByRole('button', { name: 'Buka kalender' }));
    const cells = [...screen.getByRole('grid').querySelectorAll('td')].filter((td) =>
      td.querySelector('button[disabled]'),
    );
    expect(cells.length, 'the fixture produced no out-of-range day to check').toBeGreaterThan(0);
    for (const cell of cells) {
      /* ON THE BUTTON, not merely present on the cell. The cell also carries the default ink
         from the `day` slot, and two plain classes on one element is a tie broken by stylesheet
         emission order — which `important: true` in the app does not save, since both sides are
         then `!important`. Asserting mere presence would pass while the day painted at full
         strength. A direct declaration on the button beats the inherited one at any order. */
      expect(cell.className, "Figma's disabled day is #93A2B0, the secondary ink").toMatch(
        /\[&>button\]:text-default-secondary/,
      );
      expect(cell.className, 'a disabled day still wears the disable ramp').not.toMatch(
        /text-disable-/,
      );
      expect(
        cell.className,
        'the ink sits on the cell, where it ties with the default ink the cell already carries',
      ).not.toMatch(/(?:^|\s)text-default-secondary(?:\s|$)/);
    }
  });

  /**
   * Figma's `State=Today` moves the COLOUR and nothing else. The bold was ours, and it made a
   * day that is both today and selected read as a different shape from every other selected
   * day. Rendered on the real current month, because a fixture month contains no today at all
   * — which is how the first version of this assertion passed over the bold still being there.
   */
  it('gives today ink with no weight change', () => {
    render(<DateTimeInput label="Tanggal" />);
    fireEvent.click(screen.getByRole('button', { name: 'Buka kalender' }));
    const today = [...screen.getByRole('grid').querySelectorAll('td')].filter((td) =>
      /text-default-brand/.test(td.className),
    );
    expect(today.length, 'no today cell rendered, so this assertion checks nothing').toBe(1);
    expect(today[0].className, 'today carries a weight change Figma does not publish').not.toMatch(
      /\bfont-(?:semibold|bold|medium)\b/,
    );
    expect(today[0].className, "today's ink must reach the button, like every other ink rule").toMatch(
      /\[&:not\(\.day-selected\)>button\]:text-default-brand/,
    );
  });

  /**
   * TODAY AND SELECTED AT ONCE — the combination the `today` slot's own note cites as the
   * reason the bold was dropped, and the one no other case here renders. The selection fill
   * must survive; a day does not stop being selected because it is also today.
   */
  it('keeps the selection on a day that is also today', () => {
    const today = new Date();
    const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    render(<DateTimeInput label="Tanggal" defaultValue={iso} />);
    fireEvent.click(screen.getByRole('button', { name: 'Buka kalender' }));
    const cells = [...screen.getByRole('grid').querySelectorAll('td')].filter((td) =>
      /\[&>button\]:bg-default-brand/.test(td.className),
    );
    expect(cells.length, 'no day rendered as selected').toBe(1);
    const cell = cells[0].className;

    /**
     * THE OUTCOME, not the presence of both classes. The first version of this test selected
     * its cell by `[&>button]:bg-default-brand` AND `text-default-brand` and then asserted the
     * first of those — both are present in the BROKEN configuration too, so it passed either
     * way. That is the same vacuity shape as the two this branch already fixed: selecting by
     * the property it then asserts.
     *
     * What must hold is that today's brand ink DOES NOT APPLY to a selected day — otherwise it
     * paints on the brand selection fill and the date number is invisible. `:not()` removes the
     * rule, so the check is that the unscoped form is absent and the scoped form is what shipped.
     */
    expect(cell, 'today is selected, so the selection fill must still be there').toMatch(
      /\[&>button\]:bg-default-brand/,
    );
    expect(
      cell,
      "today's ink applies unscoped, so it ties with the selection ink and brand wins on brand",
    ).not.toMatch(/\[&>button\]:text-default-brand/);
    expect(cell, "today's ink must scope itself out of a selected day").toMatch(
      /\[&:not\(\.day-selected\)>button\]:text-default-brand/,
    );
    expect(cell, 'the selection marker the scope depends on is missing').toMatch(
      /(?:^|\s)day-selected(?:\s|$)/,
    );
  });

  it('closes the calendar on Escape and puts focus back in the field', async () => {
    render(<DateTimeInput label="Tanggal" defaultValue="2026-03-10" />);
    fireEvent.click(screen.getByRole('button', { name: 'Buka kalender' }));
    expect(screen.getByRole('grid')).toBeInTheDocument();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    expect(screen.queryByRole('grid')).not.toBeInTheDocument();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Tanggal')));
  });

  it('navigates months when the field already holds a date', () => {
    // A defined `month` makes react-day-picker's calendar CONTROLLED and, with no
    // `onMonthChange`, inert. The empty-field case passes `undefined` and works, so this
    // regressed invisibly until someone opened the picker on an existing value.
    render(<DateTimeInput label="Tanggal" defaultValue="2026-03-10" />);
    fireEvent.click(screen.getByRole('button', { name: 'Buka kalender' }));
    const before = screen.getByRole('grid').getAttribute('aria-label');
    fireEvent.click(screen.getByRole('button', { name: /previous/i }));
    expect(screen.getByRole('grid').getAttribute('aria-label')).not.toBe(before);
  });

  it('shows only what a controlling owner has accepted', () => {
    // The owner ignores the change; the box must not sit there displaying a value its
    // parent never took.
    render(<DateTimeInput label="Tanggal" value="2026-03-10" onValueChange={() => {}} />);
    const input = screen.getByLabelText('Tanggal') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '01/04/2026' } });
    fireEvent.blur(input);
    expect(input.value).toBe('10/03/2026');
  });

  it('carries a name into a form like every other control here', () => {
    // The ISO-text looks keep `name` on the visible input; the day-first one posts a hidden ISO input instead.
    render(<DateTimeInput label="Tanggal" name="mulai" defaultValue="2026-03-10T09:00" withTime />);
    expect(screen.getByLabelText('Tanggal')).toHaveAttribute('name', 'mulai');
  });

  it('names the clear control for what it clears', () => {
    render(<DateTimeInput label="Tanggal" defaultValue="2026-03-10" />);
    fireEvent.click(screen.getByRole('button', { name: 'Kosongkan tanggal' }));
    expect((screen.getByLabelText('Tanggal') as HTMLInputElement).value).toBe('');
  });

  it('marks required and renders error and disabled distinctly', () => {
    const { container } = render(
      <DateTimeInput label="Tanggal" required error="Wajib diisi" />,
    );
    expect(screen.getByLabelText(/Tanggal/)).toBeRequired();
    expect(classesOf(container as unknown as HTMLElement)).toContain('border-default-error');

    const { container: off } = render(<DateTimeInput label="Tanggal" disabled />);
    expect(classesOf(off as unknown as HTMLElement)).toContain('cursor-not-allowed');
  });
});


describe('TextField adornments and the counter', () => {
  it('renders a leading adornment before the control and a trailing one after it', () => {
    const { container } = render(
      <TextField label="Harga" leadingAdornment={<span>Rp</span>} trailingAdornment={<span>kg</span>} />,
    );
    const box = container.querySelector('[data-filled], .flex.w-full')!;
    const order = [...box.querySelectorAll('span, input')].map((el) => el.tagName);
    expect(order[0]).toBe('SPAN');
    expect(order).toContain('INPUT');
    expect(order.indexOf('INPUT')).toBeLessThan(order.lastIndexOf('SPAN'));
  });

  /**
   * THE RECORDED RULE: they CO-EXIST. Absorbing would mean a caller adding a decorative glyph
   * silently removes the password toggle, which is a behaviour change wearing a layout prop.
   */
  it('keeps the password reveal alongside a trailing adornment', () => {
    render(
      <TextField label="Kata sandi" type="password" trailingAdornment={<span>kg</span>} />,
    );
    expect(screen.getByRole('button', { name: 'Tampilkan kata sandi' })).toBeTruthy();
    expect(screen.getByText('kg')).toBeTruthy();
  });

  it('marks adornments decorative so they do not join the accessible name', () => {
    const { container } = render(<TextField label="Harga" leadingAdornment={<span>Rp</span>} />);
    const slot = [...container.querySelectorAll('span')].find((el) => el.textContent === 'Rp')!
      .closest('[aria-hidden]');
    expect(slot).not.toBeNull();
  });

  it('renders markup identical to before when no adornment or counter is passed', () => {
    /* `useId` differs per render, so the generated id is normalised out — everything else has
       to match byte for byte, which is the actual claim. */
    const shape = (html: string) => html.replace(/_r_[^_"]*_/g, 'ID');
    const before = shape(render(<TextField label="Nama" />).container.innerHTML);
    const after = shape(
      render(
        <TextField label="Nama" leadingAdornment={undefined} trailingAdornment={undefined} />,
      ).container.innerHTML,
    );
    expect(before).toBe(after);
  });

  /* UMK-1186: the interactive slot a phone field puts its country picker in. */
  it('renders the prefix inside the field box without taking the label from the input', () => {
    const { container } = render(
      <TextField label="Nomor HP" prefix={<button type="button">+62</button>} />,
    );
    const input = screen.getByLabelText('Nomor HP');
    expect(input.tagName).toBe('INPUT');
    const prefix = container.querySelector('[data-field-prefix]')!;
    /* The SAME box the input sits in, so it shares the border and the focus ring. */
    expect(prefix.parentElement).toBe(input.parentElement);
    expect(screen.getByRole('button', { name: '+62' })).toBeTruthy();
  });

  it('leaves the prefix reachable and orders it before the adornment and the input', () => {
    const { container } = render(
      <TextField label="Nomor HP" prefix={<button type="button">+62</button>} leadingAdornment={<span>☎</span>} />,
    );
    const prefix = container.querySelector('[data-field-prefix]')!;
    expect(prefix.closest('[aria-hidden]')).toBeNull();
    const adornment = [...container.querySelectorAll('span')].find((el) => el.textContent === '☎')!;
    const input = container.querySelector('input')!;
    const follows = (a: Node, b: Node) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(follows(prefix, adornment)).toBe(true);
    expect(follows(adornment, input)).toBe(true);
  });

  it('counts the current length and updates on input', () => {
    const { container } = render(<TextField label="Kode" showCounter maxLength={10} />);
    expect(screen.getByText('0/10')).toBeTruthy();
    fireEvent.change(container.querySelector('input')!, { target: { value: 'ABC' } });
    expect(screen.getByText('3/10')).toBeTruthy();
  });

  /* One source of truth for the limit: the counter reads `maxLength`, and `maxLength` also
     reaches the control — so the number shown and the number enforced cannot disagree. */
  it('drives the counter from maxLength and passes the same value to the control', () => {
    const { container } = render(<TextField label="Kode" showCounter maxLength={5} />);
    expect(container.querySelector('input')!.getAttribute('maxlength')).toBe('5');
    expect(screen.getByText('0/5')).toBeTruthy();
  });

  it('renders no counter at all without a maxLength, rather than half of one', () => {
    const { container } = render(<TextField label="Kode" showCounter />);
    expect(container.textContent).not.toMatch(/\d+\//);
  });

  it('takes the limit ink at and past maxLength', () => {
    const under = render(<TextField label="Kode" showCounter maxLength={5} defaultValue="AB" />);
    const at = render(<TextField label="Kode" showCounter maxLength={5} defaultValue="ABCDE" />);
    expect(under.getByText('2/5').className).toContain('text-default-secondary');
    expect(at.getByText('5/5').className).toContain('text-default-error');
  });

  it('points the control at the counter without dropping the error association', () => {
    const { container } = render(
      <TextField label="Kode" showCounter maxLength={5} error="Terlalu pendek" />,
    );
    const described = container.querySelector('input')!.getAttribute('aria-describedby')!.split(' ');
    expect(described).toHaveLength(2);
    for (const id of described) expect(container.querySelector(`#${id}`)).not.toBeNull();
  });

  it('keeps the counter outside the box so multiline keeps its resize corner', () => {
    const { container } = render(
      <TextField label="Deskripsi" multiline showCounter maxLength={50} />,
    );
    const counter = screen.getByText('0/50');
    expect(counter.closest('textarea')).toBeNull();
    expect(container.querySelector('textarea')!.parentElement!.contains(counter)).toBe(false);
  });

  /* The lock in the contract guard already fails on a widened list; saying it here keeps the
     REASON next to the props it governs. */
  it('adds nothing to the contract booleans', () => {
    expect(contract.TextField.booleans).toEqual(['error', 'disabled']);
  });
});

describe('the two relaxed controls take a visible label OR an accessible name', () => {
  /* The compile-time half — that omitting BOTH does not build — lives in
     `field-support.test-d.ts`, because no render can observe a control that never existed.
     What is asserted here is the half that IS observable: each arm produces exactly one name,
     and the visible arm keeps rendering a real label element. */
  it('gives the Slider a visible label associated with the input', () => {
    render(<Slider label="Harga" />);
    const input = screen.getByLabelText('Harga');
    expect(input.tagName).toBe('INPUT');
    expect(input.getAttribute('aria-label')).toBeNull();
  });

  /* `''` is ABSENT, not a name. Otherwise a caller that compiles gets an empty `<label>` over a
     control with no accessible name — the exact failure the union exists to make unbuildable. */
  it('treats an empty-string label as absent on both relaxed controls', () => {
    for (const el of [
      <Slider key="s" label="" aria-label={undefined as never} />,
      <DateTimeInput key="d" label="" aria-label={undefined as never} />,
    ]) {
      const { container } = render(el);
      expect(container.querySelector('label')).toBeNull();
    }
  });

  it('gives the Slider an accessible name and NO visible label on the other arm', () => {
    const { container } = render(<Slider aria-label="Harga" />);
    expect(container.querySelector('label')).toBeNull();
    expect(screen.getByLabelText('Harga').getAttribute('aria-label')).toBe('Harga');
  });

  it('gives the DateTimeInput a visible label associated with the input', () => {
    render(<DateTimeInput label="Tanggal" />);
    const input = screen.getByLabelText('Tanggal');
    expect(input.tagName).toBe('INPUT');
    expect(input.getAttribute('aria-label')).toBeNull();
  });

  it('gives the DateTimeInput an accessible name and no visible label on the other arm', () => {
    const { container } = render(<DateTimeInput aria-label="Tanggal" />);
    expect(container.querySelector('label')).toBeNull();
    expect(screen.getByLabelText('Tanggal').getAttribute('aria-label')).toBe('Tanggal');
  });

  /**
   * PRECEDENCE IS PINNED, not left undefined. Passing both is a type error, but a plain-JS
   * caller can still do it — and a control announcing one name while showing another is worse
   * than either arm alone. The visible label wins and the string is dropped.
   */
  it('lets the visible label win when a JS caller passes both', () => {
    const both = { label: 'Terlihat', 'aria-label': 'Terdengar' } as unknown as { label: string };
    const { container } = render(<DateTimeInput {...both} />);
    expect(container.querySelector('label')?.textContent).toBe('Terlihat');
    expect(container.querySelector('input')?.getAttribute('aria-label')).toBeNull();
  });

  /**
   * THE RELAXATION IS TWO CONTROLS WIDE. The other four render a real `<label>` element for
   * every one of their call sites, and a regression that widened the union would show up here
   * as a control with no label element at all.
   */
  it.each([
    ['TextField', <TextField key="t" label="Nama" />],
    ['CheckBox', <CheckBox key="c" label="Setuju" />],
    ['Radio', <Radio key="r" label="Ya" />],
    ['Switch', <Switch key="s" label="Notifikasi" />],
  ])('%s still renders a visible label element', (_name, element) => {
    const { container } = render(element);
    expect(container.querySelector('label')).not.toBeNull();
  });
});

describe('OtpInput (UMK-1186)', () => {
  /* Controlled, like the native one; the harness is the owner a caller would be. */
  const Harness = ({ onComplete }: { onComplete?: (v: string) => void }) => {
    const [value, setValue] = React.useState('');
    return <OtpInput label="Kode OTP" value={value} onChange={setValue} onComplete={onComplete} />;
  };
  const boxes = (container: HTMLElement) =>
    [...container.querySelectorAll('span[aria-hidden]')].map((b) => b.textContent);

  /* By tag, not by role: a role count would depend on HOW the input is hidden. */
  it('renders exactly ONE input, so a one-field autofill has one place to land', () => {
    const { container } = render(<Harness />);
    expect(container.querySelectorAll('input')).toHaveLength(1);
  });

  it('puts the autofill hint on that same input', () => {
    const { container } = render(<Harness />);
    const inputs = container.querySelectorAll('input');
    expect(inputs).toHaveLength(1);
    expect(inputs[0].getAttribute('autocomplete')).toBe('one-time-code');
    expect(screen.getByLabelText('Kode OTP')).toBe(inputs[0]);
  });

  it('fills every box from a formatted paste and completes once', async () => {
    const user = userEvent.setup();
    const done = vi.fn();
    const { container } = render(<Harness onComplete={done} />);
    await user.click(container.querySelector('input')!);
    await user.paste('12 34-56');
    expect(boxes(container)).toEqual(['1', '2', '3', '4', '5', '6']);
    expect(done).toHaveBeenCalledTimes(1);
    expect(done).toHaveBeenCalledWith('123456');
  });

  it('replaces a partly typed code with a pasted whole one', async () => {
    const user = userEvent.setup();
    const done = vi.fn();
    const { container } = render(<Harness onComplete={done} />);
    const input = container.querySelector('input')!;
    await user.type(input, '12');
    await user.paste('654321');
    expect(input.value).toBe('654321');
    expect(done).toHaveBeenCalledWith('654321');
  });

  /* The OS suggestion, SMS Retriever and password managers fire no `paste`: the code arrives as
     a change with the run spliced in at the caret. */
  it('replaces a partly typed code with a whole one that arrives as a plain change', async () => {
    const user = userEvent.setup();
    const done = vi.fn();
    const { container } = render(<Harness onComplete={done} />);
    const input = container.querySelector('input')!;
    await user.type(input, '12');
    fireEvent.change(input, { target: { value: '12654321' } });
    expect(input.value).toBe('654321');
    expect(done).toHaveBeenCalledWith('654321');
  });

  it('neither changes nor completes when a keystroke meets a full value held by the parent', () => {
    const done = vi.fn();
    const seen = vi.fn();
    const { container } = render(<OtpInput label="Kode" value="123456" onChange={seen} onComplete={done} />);
    fireEvent.change(container.querySelector('input')!, { target: { value: '1234567' } });
    expect(seen).not.toHaveBeenCalled();
    expect(done).not.toHaveBeenCalled();
  });

  /* The retry: a wrong code failed verify, the parent kept it, and the right one arrives. */
  it('completes with a different full code that replaces a full one', () => {
    const done = vi.fn();
    const seen = vi.fn();
    const { container } = render(<OtpInput label="Kode" value="111111" onChange={seen} onComplete={done} />);
    fireEvent.change(container.querySelector('input')!, { target: { value: '111111654321' } });
    expect(seen).toHaveBeenCalledWith('654321');
    expect(done).toHaveBeenCalledWith('654321');
  });

  it('pins the caret to the end, but leaves a select-all alone', () => {
    const { container } = render(<OtpInput label="Kode" value="1234" onChange={() => {}} />);
    const input = container.querySelector('input')!;
    input.setSelectionRange(1, 1);
    fireEvent.select(input);
    expect([input.selectionStart, input.selectionEnd]).toEqual([4, 4]);
    input.setSelectionRange(0, 4);
    fireEvent.select(input);
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, 4]);
  });

  it('refuses input while disabled', async () => {
    const user = userEvent.setup();
    const seen = vi.fn();
    const { container } = render(<OtpInput label="Kode" value="" onChange={seen} disabled />);
    const input = container.querySelector('input')!;
    expect(input.disabled).toBe(true);
    await user.type(input, '12');
    expect(seen).not.toHaveBeenCalled();
  });

  it('marks the next box while focused, and nothing once blurred', async () => {
    const user = userEvent.setup();
    const { container } = render(<Harness />);
    const active = () => container.querySelectorAll(`span.${OTP_BOX_ACTIVE}`).length;
    expect(active()).toBe(0);
    await user.type(container.querySelector('input')!, '1');
    expect(active()).toBe(1);
    expect(container.querySelectorAll('span[aria-hidden]')[1].classList.contains(OTP_BOX_ACTIVE)).toBe(true);
    await user.tab();
    expect(active()).toBe(0);
  });

  it('ignores a letter', async () => {
    const user = userEvent.setup();
    const { container } = render(<Harness />);
    await user.type(container.querySelector('input')!, '1a2');
    expect(container.querySelector('input')!.value).toBe('12');
  });

  it('removes the last digit on Backspace', async () => {
    const user = userEvent.setup();
    const { container } = render(<Harness />);
    const input = container.querySelector('input')!;
    await user.type(input, '123{Backspace}');
    expect(input.value).toBe('12');
    expect(boxes(container).filter(Boolean)).toEqual(['1', '2']);
  });

  it('marks an error on the input', () => {
    const { container } = render(<OtpInput label="Kode" value="" onChange={() => {}} error="Kode salah" />);
    expect(container.querySelector('input')!.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText('Kode salah')).toBeTruthy();
  });

  it('takes an accessible name and no visible label on the other arm', () => {
    const { container } = render(<OtpInput aria-label="Kode OTP" value="" onChange={() => {}} />);
    expect(container.querySelector('label')).toBeNull();
    expect(screen.getByLabelText('Kode OTP').tagName).toBe('INPUT');
  });
});

describe('every control, one rule at a time', () => {
  const CONTROLS: [string, React.ReactElement][] = [
    ['TextField', <TextField key="t" label="Nama" error="x" required />],
    ['CheckBox', <CheckBox key="c" label="Setuju" error="x" required indeterminate />],
    ['Radio', <Radio key="r" label="Ya" error="x" required />],
    ['Switch', <Switch key="s" label="Notifikasi" loading />],
    ['Slider', <Slider key="l" label="Kualitas" formatValue={(v) => `${v}%`} />],
    ['DateTimeInput', <DateTimeInput key="d" label="Tanggal" error="x" required />],
    ['OtpInput', <OtpInput key="o" label="Kode" value="12" onChange={() => {}} error="x" />],
  ];

  it.each(CONTROLS)('%s renders no colour literal', (_name, element) => {
    const { container } = render(element);
    expect(classesOf(container as unknown as HTMLElement)).not.toMatch(COLOUR_LITERAL);
  });

  // OtpInput is the one exception (UMK-1377, owner decision): its row carries no ring, and focus is shown
  // by the active-digit border (OTP_BOX_ACTIVE) alone.
  it.each(CONTROLS.filter(([name]) => name !== 'OtpInput'))('%s takes its focus ring from the one constant', (_name, element) => {
    const { container } = render(element);
    const classes = classesOf(container as unknown as HTMLElement);
    const ring = [FOCUS_RING.field, FOCUS_RING.control].find((r) =>
      r.split(' ').every((c) => classes.includes(c)),
    );
    expect(ring, 'no focus-ring constant is present on the rendered control').toBeTruthy();
  });

  it('names no focus token outside the shared constant', () => {
    expect(FOCUS_RING.field).toContain('focus-brand');
    expect(FOCUS_RING.field).toContain('halo');
    expect(FOCUS_RING.control).toContain('focus-brand');
    expect(FOCUS_RING.control).toContain('halo');
  });
});

describe('SelectionCard', () => {
  /**
   * UMK-1537. `detail` is additive: unset (or null) every appearance renders byte for byte what
   * it did before, and set it is exactly one more node in the text column, below the body.
   */
  describe('option detail slot', () => {
    const MODES = [
      { name: 'default row', props: {} },
      { name: 'default tile', props: { layout: 'tile' as const } },
      { name: 'choice', props: { appearance: 'choice' as const } },
      { name: 'activation', props: { activation: true } },
    ];
    const base = { label: 'Paket', value: 'a', description: 'Judul\nIsi', badge: 'B' };
    const html = (option: Record<string, unknown>, props: Record<string, unknown>) =>
      render(<SelectionCard label="x" name="g" options={[option as never]} {...props} />).container.innerHTML;

    for (const mode of MODES) {
      it(`${mode.name}: unset or null detail leaves the markup identical`, () => {
        const plain = html(base, mode.props);
        /* PINNED, not self-compared: the unset markup must be the pre-slot markup, so an empty
           wrapper rendered for an absent detail cannot hide behind equal-to-itself. */
        expect(plain).toMatchSnapshot();
        expect(html({ ...base, detail: undefined }, mode.props)).toBe(plain);
        expect(html({ ...base, detail: null }, mode.props)).toBe(plain);
      });

      it(`${mode.name}: a set detail adds only its own node, after the description`, () => {
        const plain = html(base, mode.props);
        const withDetail = html({ ...base, detail: <i data-testid="detail">Rincian</i> }, mode.props);
        expect(withDetail.replace('<i data-testid="detail">Rincian</i>', '')).toBe(plain);
        expect(withDetail.indexOf('Rincian')).toBeGreaterThan(withDetail.indexOf('Isi'));
      });
    }
  });

  const OPTIONS = [
    { label: 'Jualan', value: 'jualan' },
    { label: 'Dikenal', value: 'dikenal' },
  ];

  it('renders the label as the heading when there is no description', () => {
    render(<SelectionCard label="Tujuan" options={[{ label: 'Jualan', value: 'jualan' }]} />);
    expect(screen.getByText('Jualan')).toBeTruthy();
  });

  /**
   * THE INVERSION. The flow validation matches against the AUTHORED label, so a generated title
   * cannot be written into it — the split-out first line is the only place it can live, and a
   * card that ignores this renders every one of the live instances wrong.
   */
  it('inverts the hierarchy when the description carries a title', () => {
    const { container } = render(
      <SelectionCard
        label="Pilih"
        options={[
          { label: 'Strategi 1', value: 's1', description: 'Etalase pertama\nTiga kotak teratas.' },
        ]}
      />,
    );
    const eyebrow = container.querySelector('[class*="text-default-secondary"]')!;
    const heading = container.querySelector('[class*="font-bold"]')!;
    expect(eyebrow.textContent).toBe('Strategi 1');
    expect(heading.textContent).toBe('Etalase pertama');
    expect(container.textContent).toContain('Tiga kotak teratas.');
  });

  describe('UMK-1295 gaps', () => {
    const FOUR = ['a', 'b', 'c', 'd'].map((v) => ({ label: v.toUpperCase(), value: v }));
    const inputs = (c: HTMLElement) => Array.from(c.querySelectorAll('input')) as HTMLInputElement[];

    it('maxSelect disables unselected options at the cap and re-enables on deselect', () => {
      const at = (value: string[]) =>
        inputs(render(<SelectionCard label="x" multiple maxSelect={2} options={FOUR} value={value} />).container);
      const capped = at(['a', 'b']);
      expect(capped.map((i) => i.disabled)).toEqual([false, false, true, true]);
      expect(at(['a']).map((i) => i.disabled)).toEqual([false, false, false, false]);
    });

    it('maxSelect: a click on a capped option emits nothing', () => {
      const seen: string[][] = [];
      const { container } = render(
        <SelectionCard label="x" multiple maxSelect={1} options={FOUR} value={['a']} onValueChange={(v) => seen.push(v)} />,
      );
      fireEvent.click(inputs(container)[2]);
      expect(seen).toEqual([]);
    });

    it('maxSelect is ignored in single-select', () => {
      const { container } = render(<SelectionCard label="x" maxSelect={1} options={FOUR} value={['a']} />);
      expect(inputs(container).some((i) => i.disabled)).toBe(false);
    });

    it('renderText wraps the title and body, never the label', () => {
      const { container } = render(
        <SelectionCard
          label="x"
          renderText={(t) => <em data-rt>{t}</em>}
          options={[{ label: 'Lbl', value: 'a', description: 'Judul\nIsi' }]}
        />,
      );
      expect(Array.from(container.querySelectorAll('[data-rt]')).map((e) => e.textContent)).toEqual(['Judul', 'Isi']);
      expect(screen.getByText('Lbl').closest('[data-rt]')).toBeNull();
    });

    it('renders plain strings by default', () => {
      const { container } = render(
        <SelectionCard label="x" options={[{ label: 'Lbl', value: 'a', description: 'Judul\nIsi' }]} />,
      );
      expect(container.querySelector('em')).toBeNull();
      expect(container.textContent).toContain('Isi');
    });

    it('columns=2 swaps the flex column for the grid; default is unchanged', () => {
      const two = render(<SelectionCard label="x" columns={2} options={FOUR} />).container.querySelector('fieldset')!;
      expect(two.className).toContain('sm:grid-cols-2');
      expect(two.className).not.toContain('flex-col');
      const one = render(<SelectionCard label="x" options={FOUR} />).container.querySelector('fieldset')!;
      expect(one.className).toContain('flex-col');
      expect(one.className).not.toContain('grid');
    });

    it('the eyebrow is uppercase', () => {
      render(<SelectionCard label="x" options={[{ label: 'Lbl', value: 'a', description: 'Judul\nIsi' }]} />);
      expect(screen.getByText('Lbl').className).toContain('uppercase');
    });
  });

  it('keeps the label as the heading when the description has no newline', () => {
    const { container } = render(
      <SelectionCard
        label="Pilih"
        options={[{ label: 'Jualan', value: 'jualan', description: 'Orang langsung pesan.' }]}
      />,
    );
    expect(container.querySelector('[class*="font-bold"]')!.textContent).toBe('Jualan');
    expect(container.textContent).toContain('Orang langsung pesan.');
  });

  /* Split ONCE. Everything after the first newline is body, further newlines included. */
  it('splits the description on the first newline only', () => {
    expect(splitDescription('a\nb\nc')).toEqual({ title: 'a', body: 'b\nc' });
    expect(splitDescription('a')).toEqual({ title: undefined, body: 'a' });
    expect(splitDescription(undefined)).toEqual({ title: undefined, body: undefined });
  });

  it('renders icon and badge when present, and nothing at all when absent', () => {
    const withBoth = render(
      <SelectionCard
        label="Pilih"
        options={[{ label: 'Jualan', value: 'jualan', icon: 'ICON', badge: 'BADGE' }]}
      />,
    ).container;
    expect(withBoth.textContent).toContain('ICON');
    expect(withBoth.textContent).toContain('BADGE');
    const without = render(<SelectionCard label="Pilih" options={OPTIONS} />).container;
    expect(without.textContent).not.toContain('ICON');
    expect(without.textContent).not.toContain('BADGE');
  });

  it('emits a one-element array in single-select, never a bare value', () => {
    const seen: string[][] = [];
    const { container } = render(
      <SelectionCard label="Pilih" options={OPTIONS} onValueChange={(v) => seen.push(v)} />,
    );
    fireEvent.click(container.querySelectorAll('input')[1]);
    expect(seen).toEqual([['dikenal']]);
  });

  it('adds to and removes from the array in multi-select', () => {
    const seen: string[][] = [];
    const { container, rerender } = render(
      <SelectionCard
        label="Pilih"
        multiple
        value={['jualan']}
        options={OPTIONS}
        onValueChange={(v) => seen.push(v)}
      />,
    );
    fireEvent.click(container.querySelectorAll('input')[1]);
    expect(seen.at(-1)).toEqual(['jualan', 'dikenal']);
    rerender(
      <SelectionCard
        label="Pilih"
        multiple
        value={['jualan', 'dikenal']}
        options={OPTIONS}
        onValueChange={(v) => seen.push(v)}
      />,
    );
    fireEvent.click(container.querySelectorAll('input')[0]);
    expect(seen.at(-1)).toEqual(['dikenal']);
  });

  /* Ordered by the OPTION list, not by click order — otherwise the emitted array depends on
     what the user happened to tap first. */
  it('emits the multi-selection in option order', () => {
    const seen: string[][] = [];
    const { container } = render(
      <SelectionCard
        label="Pilih"
        multiple
        value={['dikenal']}
        options={OPTIONS}
        onValueChange={(v) => seen.push(v)}
      />,
    );
    fireEvent.click(container.querySelectorAll('input')[0]);
    expect(seen.at(-1)).toEqual(['jualan', 'dikenal']);
  });

  /* The selection reaches assistive technology through a real control, not through colour. */
  it('exposes the selection rather than only colouring the card', () => {
    const { container } = render(
      <SelectionCard label="Pilih" value={['dikenal']} options={OPTIONS} />,
    );
    const inputs = [...container.querySelectorAll('input')];
    expect(inputs.map((i) => i.checked)).toEqual([false, true]);
    expect(inputs[0].type).toBe('radio');
  });

  it('renders checkboxes in multi-select and radios in single-select', () => {
    const multi = render(<SelectionCard label="a" multiple options={OPTIONS} />).container;
    const single = render(<SelectionCard label="b" options={OPTIONS} />).container;
    expect(multi.querySelector('input')!.type).toBe('checkbox');
    expect(single.querySelector('input')!.type).toBe('radio');
  });

  /* Two pickers on one page must not share a radio group, or selecting in one clears the other. */
  it('gives two ungrouped pickers different radio group names', () => {
    const { container } = render(
      <div>
        <SelectionCard label="a" options={OPTIONS} />
        <SelectionCard label="b" options={OPTIONS} />
      </div>,
    );
    const names = [...container.querySelectorAll('input')].map((i) => i.name);
    expect(new Set(names).size).toBe(2);
  });

  it('renders a real ChoicePicker card payload without loss', () => {
    const payload = [
      {
        label: '🔲 Feed dilihat sekaligus',
        value: 'sekaligus',
        icon: '🔲',
        description: 'Orang lihat 9 kotak barengan, bukan satu-satu.',
      },
      {
        label: '👀 Baris pertama = etalase',
        value: 'etalase',
        icon: '👀',
        description: '3 kotak teratas nentuin orang lanjut atau kabur.',
      },
    ];
    const { container } = render(<SelectionCard label="Pilih insight" options={payload} />);
    for (const option of payload) {
      expect(container.textContent).toContain(String(option.label));
      expect(container.textContent).toContain(option.description);
    }
    expect(container.querySelectorAll('input')).toHaveLength(2);
  });

  /**
   * UMK-1218: `layout="tile"` — centred content and the control DRAWN in the top-right corner.
   *
   * PROVED RED, one injection each, reverted:
   * | Injection | Reds |
   * | -- | -- |
   * | the indicator rendered for `row` too | draws no corner control on a row |
   * | the tile step APPENDED over the size step (both selected) | one rung per spacing property |
   * | the mark rendered whatever the state | marks only the selected tile |
   * | `LAYOUT[layout]` dropped from the card | lays the tile out centred |
   */
  describe('layout="tile"', () => {
    const tiles = (value: string[] = [], extra: Partial<React.ComponentProps<typeof SelectionCard>> = {}) =>
      render(<SelectionCard aria-label="Pilih paket" layout="tile" options={OPTIONS} value={value} {...extra} />).container;

    it('draws a corner control on every tile, marked only on the selected one', () => {
      const container = tiles(['dikenal']);
      const indicators = container.querySelectorAll('[data-testid="selection-card-indicator"]');
      expect(indicators).toHaveLength(2);
      for (const indicator of indicators) {
        expect(indicator.getAttribute('aria-hidden')).toBe('true');
        expect(indicator.className).toMatch(/(^|\s)absolute(\s|$)/);
        expect(indicator.className).toContain('rounded-ds-full');
        expect(indicator.className).toContain('border-default-invert');
      }
      expect(indicators[0].children).toHaveLength(0);
      expect(indicators[1].children).toHaveLength(1);
      expect(indicators[1].firstElementChild!.className).toContain('bg-default-brand');
    });

    it('lays the tile out centred, with a 2px border whose colour marks the selection', () => {
      const container = tiles(['dikenal']);
      const cards = container.querySelectorAll('label');
      for (const card of cards) {
        expect(card.getAttribute('data-layout')).toBe('tile');
        expect(card.className).toMatch(/(^|\s)flex-col(\s|$)/);
        expect(card.className).toMatch(/(^|\s)items-center(\s|$)/);
        expect(card.className).toMatch(/(^|\s)border-2(\s|$)/);
        expect(card.className).not.toMatch(/(^|\s)items-start(\s|$)/);
      }
      expect(cards[1].className).toMatch(/(^|\s)border-default-brand(\s|$)/);
      expect(cards[1].className).toMatch(/(^|\s)bg-weak-brand(\s|$)/);
      // `hover:border-default-brand` is on every card; the RESTING brand border is the selection.
      expect(cards[0].className).not.toMatch(/(^|\s)border-default-brand(\s|$)/);
    });

    it('keeps the REAL radio: a hidden input per tile, one group, selection through the control', async () => {
      const seen: string[][] = [];
      render(<SelectionCard aria-label="Pilih paket" layout="tile" options={OPTIONS} onValueChange={(v) => seen.push(v)} />);
      const radios = screen.getAllByRole('radio') as HTMLInputElement[];
      expect(radios).toHaveLength(2);
      expect(new Set(radios.map((r) => r.name)).size).toBe(1);
      for (const r of radios) expect(r.className).toContain('sr-only');
      await userEvent.click(screen.getByText('Dikenal'));
      expect(seen).toEqual([['dikenal']]);
    });

    /* Review round 3: `cn` does not resolve two `ds-` rungs of one property, so a tile that APPENDED
       its spacing over the size step shipped both (8px gap, 16px sides on large). One rung per
       property, and it is the tile's. */
    it.each(['large', 'small'] as const)('ships ONE rung per spacing property on a %s tile — the tile\'s', (size) => {
      const { container } = render(<SelectionCard aria-label="Pilih" layout="tile" size={size} options={OPTIONS} />);
      const classes = container.querySelector('label')!.className.split(/\s+/);
      const rungs = (prefix: string) => classes.filter((c) => c.startsWith(prefix));
      expect(rungs('gap-')).toEqual(['gap-ds-3xs']);
      expect(rungs('px-')).toEqual(['px-ds-sm']);
      expect(rungs('pt-')).toEqual(['pt-ds-xl']);
      expect(rungs('pb-')).toEqual(['pb-ds-sm']);
      expect(rungs('py-')).toEqual([]);
      expect(rungs('rounded-')).toEqual(['rounded-ds-lg']);
    });

    it('ships ONE gap rung on a small row too (the base no longer carries its own)', () => {
      const { container } = render(<SelectionCard aria-label="Pilih" size="small" options={OPTIONS} />);
      const gaps = container.querySelector('label')!.className.split(/\s+/).filter((c) => c.startsWith('gap-'));
      expect(gaps).toEqual(['gap-ds-3xs']);
    });

    it('draws a square control for a multi-select tile', () => {
      const container = tiles([], { multiple: true });
      const indicator = container.querySelector('[data-testid="selection-card-indicator"]')!;
      expect(indicator.className).toContain('rounded-ds-xs');
    });

    it('draws no corner control on a row (the default layout is unchanged)', () => {
      const { container } = render(<SelectionCard aria-label="Pilih" options={OPTIONS} value={['jualan']} />);
      expect(container.querySelector('[data-testid="selection-card-indicator"]')).toBeNull();
      expect(container.querySelector('label')!.getAttribute('data-layout')).toBe('row');
    });
  });

  /**
   * UMK-1296. ACTIVATION: a one-tap step must submit on a PRESS, never on an arrow key. In a radio
   * group an arrow key moves focus AND checks the next radio, which fires `change`; a plain button
   * has no such behaviour. jsdom does not emulate the arrow-key check, so the guard is the markup:
   * no radio, no checkbox, and a press (repeated too) calls the handler.
   */
  describe('activation', () => {
    it('renders plain buttons, never radios or checkboxes', () => {
      const { container } = render(<SelectionCard aria-label="Pilih" activation options={OPTIONS} />);
      expect(container.querySelectorAll('input').length).toBe(0);
      expect(container.querySelectorAll('button[type="button"]').length).toBe(2);
    });

    it('calls onValueChange with the pressed value, every time it is pressed', () => {
      const onValueChange = vi.fn();
      render(<SelectionCard aria-label="Pilih" activation options={OPTIONS} onValueChange={onValueChange} />);
      const first = screen.getByText('Jualan').closest('button')!;
      fireEvent.click(first);
      fireEvent.click(first);
      expect(onValueChange.mock.calls).toEqual([[['jualan']], [['jualan']]]);
    });

    it('holds no selected state even when handed a value', () => {
      const { container } = render(<SelectionCard aria-label="Pilih" activation options={OPTIONS} value={['jualan']} />);
      expect(container.querySelector('[aria-pressed], [aria-checked], :checked')).toBeNull();
    });

    it('disables every button and ignores a press when disabled', () => {
      const onValueChange = vi.fn();
      const { container } = render(
        <SelectionCard aria-label="Pilih" activation disabled options={OPTIONS} onValueChange={onValueChange} />,
      );
      const buttons = [...container.querySelectorAll('button')];
      expect(buttons.every((b) => b.disabled)).toBe(true);
      fireEvent.click(buttons[0]);
      expect(onValueChange).not.toHaveBeenCalled();
    });
  });

  /**
   * UMK-1296. THE `choice` APPEARANCE reproduces the pre-library agent cards, so what is pinned is
   * the VALUES: font sizes and ink are the old card's, not the default look's, and the default look
   * is untouched.
   */
  describe('appearance="choice"', () => {
    const CARD = [
      { label: 'Strategi 1', value: '1', badge: <span>Populer</span>, icon: '📈', description: 'Judul\nIsi teks' },
      { label: 'Hemat', value: '2', description: 'Satu baris' },
    ];

    it('keeps the old geometry: 10px grid gap, 12px padding, 12px radius, 12px icon-to-text gap', () => {
      const { container } = render(<SelectionCard aria-label="Pilih" appearance="choice" columns={2} options={CARD} />);
      expect(container.querySelector('fieldset')!.className).toContain('gap-2.5');
      const label = container.querySelector('label')!;
      for (const c of ['p-3', 'gap-3', 'rounded-xl', 'border']) expect(label.className).toContain(c);
      expect(label.className).not.toContain('px-ds-md');
    });

    it('paints an idle card default-primary on default-primary and a selected one brand on weak-brand', () => {
      const { container } = render(<SelectionCard aria-label="Pilih" appearance="choice" options={CARD} value={['2']} />);
      const [idle, selected] = [...container.querySelectorAll('label')];
      expect(idle.className).toContain('border-default-primary');
      expect(idle.className).toContain('bg-default-primary');
      expect(selected.className).toContain('border-default-brand');
      expect(selected.className).toContain('bg-weak-brand');
    });

    it('draws the 40px icon box and puts the badge in the label row, with the eyebrow 12px semibold', () => {
      const { container } = render(<SelectionCard aria-label="Pilih" appearance="choice" options={CARD} />);
      const icon = screen.getByText('📈');
      for (const c of ['h-10', 'w-10', 'rounded-xl', 'bg-weak-brand', 'text-ds-h6-desktop']) expect(icon.className).toContain(c);
      const eyebrow = screen.getByText('Strategi 1');
      for (const c of ['text-ds-legacy-xs', 'font-semibold', 'uppercase']) expect(eyebrow.className).toContain(c);
      expect(eyebrow.parentElement!.contains(screen.getByText('Populer'))).toBe(true);
      expect(container.querySelector('label')).toBeTruthy();
    });

    it('sets no font size on the heading (it inherits, as the old card did) and the body is 14px', () => {
      render(<SelectionCard aria-label="Pilih" appearance="choice" options={CARD} />);
      const heading = screen.getByText('Hemat');
      expect(heading.className).toContain('font-bold');
      expect(heading.className).not.toMatch(/text-(xs|sm|base|lg|ds-)/);
      expect(screen.getByText('Satu baris').className).toContain('text-ds-paragraph-mobile');
    });

    it('dims a disabled card with opacity and keeps its idle or selected paint', () => {
      const { container } = render(<SelectionCard aria-label="Pilih" appearance="choice" disabled options={CARD} value={['2']} />);
      const [idle, selected] = [...container.querySelectorAll('label')];
      expect(idle.className).toContain('opacity-60');
      expect(idle.className).toContain('bg-default-primary');
      expect(selected.className).toContain('opacity-60');
      expect(selected.className).toContain('bg-weak-brand');
    });

    it('emphasizeSelected keeps the picked card at full strength and dims the rest (UMK-1883)', () => {
      const { container } = render(
        <SelectionCard aria-label="Pilih" appearance="choice" disabled emphasizeSelected options={CARD} value={['2']} />,
      );
      const [idle, selected] = [...container.querySelectorAll('label')];
      expect(idle.className).toContain('opacity-60');
      expect(selected.className).not.toContain('opacity-60');
      expect(selected.className).toContain('bg-weak-brand');
    });

    it('treats an empty title as no title: the label stays the heading', () => {
      render(<SelectionCard aria-label="Pilih" appearance="choice" options={[{ label: 'L', value: 'l', description: '\nisi' }]} />);
      expect(screen.getByText('L').className).toContain('font-bold');
      expect(screen.getByText('L').className).not.toContain('uppercase');
    });

    it('combines with activation: buttons in the choice look', () => {
      const { container } = render(<SelectionCard aria-label="Pilih" appearance="choice" activation options={CARD} />);
      const button = container.querySelector('button')!;
      expect(button.className).toContain('border-default-primary');
      expect(container.querySelectorAll('input').length).toBe(0);
    });

    it('leaves the default appearance alone', () => {
      const { container } = render(<SelectionCard aria-label="Pilih" options={CARD} />);
      expect(container.querySelector('label')!.className).toContain('px-ds-md');
      for (const c of ['rounded-xl', 'p-3', 'gap-3']) expect(container.querySelector('label')!.className.split(/\s+/)).not.toContain(c);
    });
  });
});

describe('Upload', () => {
  const drop = (container: HTMLElement, files: File[]) => {
    const zone = [...container.querySelectorAll('label')].find((l) => l.querySelector('input'))!;
    fireEvent.drop(zone, { dataTransfer: { files } });
  };

  /**
   * THE BROWSER APPLIES `accept` AND `multiple` TO THE PICKER ONLY. Neither reaches
   * `dataTransfer.files`, so without filtering inside `emit` an accept-constrained Upload hands
   * its caller an executable on drop — the exact divergence the shared-emit comment forbids.
   */
  it('applies accept to dropped files, not just to the picker', () => {
    const seen: File[][] = [];
    const { container } = render(
      <Upload label="Foto" accept="image/*" multiple onFilesChange={(f) => seen.push(f)}>
        zone
      </Upload>,
    );
    drop(container, [
      new File(['x'], 'a.png', { type: 'image/png' }),
      new File(['x'], 'evil.exe', { type: 'application/x-msdownload' }),
    ]);
    expect(seen.at(-1)!.map((f) => f.name)).toEqual(['a.png']);
  });

  it('matches an accept list by extension as well as by mime type', () => {
    const seen: File[][] = [];
    const { container } = render(
      <Upload label="Dok" accept=".pdf,text/csv" multiple onFilesChange={(f) => seen.push(f)}>
        zone
      </Upload>,
    );
    drop(container, [
      new File(['x'], 'a.PDF', { type: '' }),
      new File(['x'], 'b.csv', { type: 'text/csv' }),
      new File(['x'], 'c.txt', { type: 'text/plain' }),
    ]);
    expect(seen.at(-1)!.map((f) => f.name)).toEqual(['a.PDF', 'b.csv']);
  });

  it('hands back a single file when multiple is off, however many were dropped', () => {
    const seen: File[][] = [];
    const { container } = render(
      <Upload label="Foto" onFilesChange={(f) => seen.push(f)}>zone</Upload>,
    );
    drop(container, [new File(['x'], 'a.png'), new File(['x'], 'b.png')]);
    expect(seen.at(-1)).toHaveLength(1);
  });

  it('accepts everything when no accept list is given', () => {
    const seen: File[][] = [];
    const { container } = render(
      <Upload label="Apa saja" multiple onFilesChange={(f) => seen.push(f)}>zone</Upload>,
    );
    drop(container, [new File(['x'], 'a.exe'), new File(['x'], 'b.png')]);
    expect(seen.at(-1)).toHaveLength(2);
  });

  /**
   * ONE DRIVER PER STATUS, spelled out rather than inferred.
   *
   * The loop this replaced drove every status through `filled`/`disabled`/`error` alone, so it
   * produced four class sets however many the axis declared — `dragOver` was unreachable and
   * `busy` would have rendered as `default` while the count assertion below quietly passed at
   * the wrong number. Each entry here says how its own status is actually reached.
   */
  const DRIVE: Record<
    (typeof contract.Upload.axes.status)[number],
    Partial<React.ComponentProps<typeof Upload>>
  > = {
    default: {},
    filled: { filled: true },
    error: { error: 'Terlalu besar' },
    disabled: { disabled: true },
    busy: { busy: true },
  };

  const zoneOf = (container: HTMLElement) =>
    [...container.querySelectorAll('label')].find((l) => l.querySelector('input'))!;

  const renderStatus = (status: (typeof contract.Upload.axes.status)[number]) => {
    const { container } = render(
      <Upload label="Foto" {...(DRIVE[status] as object)}>
        zone
      </Upload>,
    );
    return container;
  };

  it.each(contract.Upload.axes.status)('gives %s its own class set', (status) => {
    expect(zoneOf(renderStatus(status)), `${status} rendered no zone`).toBeTruthy();
  });

  it('gives every status on the ramp a distinct class set', () => {
    const seen = new Set(
      contract.Upload.axes.status.map((status) => zoneOf(renderStatus(status)).className),
    );
    expect(seen.size).toBe(contract.Upload.axes.status.length);
  });

  it('renders the required mark decoratively while the semantics ride the control', () => {
    const { container } = render(<Upload label="Foto" required>zone</Upload>);
    const mark = [...container.querySelectorAll('[aria-hidden]')].find((el) => el.textContent === '*');
    expect(mark).toBeTruthy();
    expect(container.querySelector('input')!.required).toBe(true);
  });

  it('mounts the error region before it has any text to hold', () => {
    const { container } = render(<Upload label="Foto">zone</Upload>);
    const region = container.querySelector('[role="alert"]')!;
    expect(region).not.toBeNull();
    expect(region.textContent).toBe('');
  });

  /* One emit path for both routes, or a caller ends up with two branches for one event. */
  it('reports a drop and a picker choice with the same payload', () => {
    const seen: File[][] = [];
    const file = new File(['x'], 'foto.jpg', { type: 'image/jpeg' });
    const { container } = render(
      <Upload label="Foto" onFilesChange={(f) => seen.push(f)}>
        zone
      </Upload>,
    );
    const zone = [...container.querySelectorAll('label')].at(-1)!;
    fireEvent.drop(zone, { dataTransfer: { files: [file] } });
    fireEvent.change(container.querySelector('input')!, { target: { files: [file] } });
    expect(seen).toHaveLength(2);
    expect(seen[0].map((f) => f.name)).toEqual(seen[1].map((f) => f.name));
  });

  /* Without the drag-over handler the browser NAVIGATES to the dropped file and the drop
     handler never runs. The prevented default is the whole fix and it is invisible otherwise. */
  it('prevents the default drag-over, or the browser opens the file instead', () => {
    const { container } = render(<Upload label="Foto">zone</Upload>);
    const zone = [...container.querySelectorAll('label')].at(-1)!;
    const event = new Event('dragover', { bubbles: true, cancelable: true });
    /* `fireEvent`, not a bare `dispatchEvent`: the handler now sets drag state too, and a raw
       dispatch leaves that update outside `act`. */
    fireEvent(zone, event);
    expect(event.defaultPrevented).toBe(true);
  });

  it('blocks both routes when disabled', () => {
    const seen: File[][] = [];
    const file = new File(['x'], 'foto.jpg');
    const { container } = render(
      <Upload label="Foto" disabled onFilesChange={(f) => seen.push(f)}>
        zone
      </Upload>,
    );
    const zone = [...container.querySelectorAll('label')].at(-1)!;
    fireEvent.drop(zone, { dataTransfer: { files: [file] } });
    expect(seen).toEqual([]);
    expect(container.querySelector('input')!.disabled).toBe(true);
  });

  /* The zone IS a label for the file input, so Enter and Space reach the picker through the
     native control rather than through a key handler of ours. */
  it('reaches the picker through the native control rather than a hand-rolled handler', () => {
    const { container } = render(<Upload label="Foto" id="f">zone</Upload>);
    const zone = [...container.querySelectorAll('label')].at(-1)!;
    /* The zone WRAPS the input rather than pointing at it: an implicit association still opens
       the picker, and only one label may name the control. */
    expect(zone.getAttribute('for')).toBeNull();
    expect(zone.querySelector('input')).not.toBeNull();
    expect(container.querySelector('input')!.id).toBe('f');
  });

  /**
   * EXACTLY ONE LABEL NAMES THE INPUT. Two `htmlFor`s on one id make the accessible name the
   * concatenation of both — "Foto produk Tarik file ke sini…" — which renders perfectly and
   * announces as nonsense.
   */
  it('binds exactly one label to the file input', () => {
    const { container } = render(<Upload label="Foto produk" id="f">Tarik file ke sini</Upload>);
    const bound = [...container.querySelectorAll('label')].filter((l) => l.getAttribute('for') === 'f');
    expect(bound).toHaveLength(1);
    expect(bound[0].textContent).toBe('Foto produk');
  });

  /* The empty-string hole: `label=""` satisfies the visible arm, which forbids `aria-label`. */
  it('treats an empty-string label as absent rather than as a name', () => {
    const { container } = render(<Upload label="" aria-label={undefined as never}>zone</Upload>);
    expect(container.querySelector('label[for]')).toBeNull();
  });

  /**
   * FIGMA'S THREE ROWS — the library shipped only the middle one, and that one was dashed.
   */
  describe('renders the anatomy `Upload Area` publishes', () => {
    const browse = (container: HTMLElement) =>
      [...container.querySelectorAll('button')].find((b) => b.textContent === 'Browse')!;

    /* THE STROKE STYLE IS AN AXIS, and `UPLOAD_BASE` must not pin one — a style left in the
       base wins or loses against the axis class by class order, which is a coin flip nothing
       else here can see. */
    it('leaves the stroke style to the axis rather than pinning one in the base', () => {
      expect(UPLOAD_BASE).not.toMatch(/(?:^|\s)border-(?:solid|dashed)(?:\s|$)/);
      expect(UPLOAD_BASE).toMatch(/(?:^|\s)border(?:\s|$)/);
    });

    /* SOLID BY DEFAULT is the parity claim: a caller who says nothing gets Figma's stroke. */
    it('strokes the zone solid unless asked for dashed', () => {
      const { container } = render(<Upload label="Foto">zone</Upload>);
      const z = [...container.querySelectorAll('label')].find((l) => l.querySelector('input'))!;
      expect(z.className.split(' ')).toContain('border-solid');
      expect(z.className.split(' ')).not.toContain('border-dashed');

      const { container: dashed } = render(
        <Upload label="Foto" border="dashed">zone</Upload>,
      );
      const dz = [...dashed.querySelectorAll('label')].find((l) => l.querySelector('input'))!;
      expect(dz.className.split(' ')).toContain('border-dashed');
      expect(dz.className.split(' ')).not.toContain('border-solid');
    });

    it('renders the helper row when given and omits it when not', () => {
      const { container: withHelp } = render(
        <Upload label="Foto" helperText="Maksimal 5 MB">zone</Upload>,
      );
      expect(withHelp.textContent).toContain('Maksimal 5 MB');
      const { container: without } = render(<Upload label="Foto">zone</Upload>);
      expect(without.querySelectorAll('p')).toHaveLength(1); // the error region alone
    });

    /**
     * ONE TEXT ROW, WHICH IS THE DECISION Figma's anatomy forces: it publishes a single helper
     * row that turns red, not a helper row plus an error row. So an `error` REPLACES the
     * helper rather than stacking under it — and the row that survives is the error region,
     * which is the one carrying the error tokens.
     */
    it('replaces the helper row with the error, rather than stacking the two', () => {
      const { container } = render(
        <Upload label="Foto" helperText="Maksimal 5 MB" error="Terlalu besar">zone</Upload>,
      );
      expect(container.textContent).not.toContain('Maksimal 5 MB');
      expect(container.querySelectorAll('[role="alert"]')).toHaveLength(1);
      expect(container.querySelector('[role="alert"]')!.className).toContain('text-default-error');
      const zone = [...container.querySelectorAll('label')].find((l) => l.querySelector('input'))!;
      expect(zone.className).toContain('border-default-error');
    });

    it('renders the tooltip trigger only when a tooltip is supplied', () => {
      const { container: withTip } = render(
        <Upload label="Foto" tooltip="Foto yang jelas menjual lebih baik">zone</Upload>,
      );
      expect(withTip.querySelector('button[aria-label="Info"]')).not.toBeNull();
      const { container: without } = render(<Upload label="Foto">zone</Upload>);
      expect(without.querySelector('button[aria-label="Info"]')).toBeNull();
    });

    /**
     * "EXACTLY ONE PICKER" IS A BROWSER CLAIM, AND jsdom CANNOT HOLD IT — said here rather
     * than faked, because these tests used to look like they pinned it.
     *
     * They were written as `vi.spyOn(input, 'click')`, which is structurally blind to the
     * label route: label activation dispatches a click AT the labelled control instead of
     * calling `input.click()`. Deleting the handler's `preventDefault` left all three green.
     * Rewriting them onto a real `click` LISTENER exposed the deeper problem — jsdom does not
     * implement the interactive-content exclusion, so it forwards label activation to the
     * input even for a click on a `<button>` and reports TWO opens where a browser reports
     * one. Measured in Chrome at this commit: one from the button, one from the zone.
     *
     * So the count belongs to the browser gate. What jsdom CAN see is asserted below: the
     * affordance exists, it is the first keyboard stop, and it reaches the input.
     *
     * WHAT THESE TESTS DO NOT COVER — stated because `toBeGreaterThan(0)` under a docblock
     * about one-versus-two reads stronger than it is:
     *
     *   1. NOT exactly-once. Measured in jsdom, a browse click dispatches TWO clicks on the
     *      input (label activation + our explicit open); Chrome dispatches one. `toBe(1)`
     *      would fail on correct code here, so it cannot be written.
     *   2. NOT that the button works at all. Deleting `inputRef.current?.click()` — the
     *      load-bearing half — leaves this whole file GREEN, because jsdom's label activation
     *      covers for it. In a browser, which skips activation for interactive content, the
     *      button would open nothing: the zero-picker failure, shipped green.
     *   3. NOT the blocked-zone `dropEffect = 'none'`. Removing it stays green too; jsdom's
     *      `DataTransfer` does not carry the effect back to assert on.
     *
     * All three are browser-gate items. There is no assertion that closes them from here, and
     * pretending otherwise is how the method-spy version of these tests survived so long.
     */
    const countOpens = (container: HTMLElement) => {
      const input = container.querySelector('input')!;
      const seen = { n: 0 };
      input.addEventListener('click', () => { seen.n += 1; });
      return seen;
    };

    it('reaches the picker from the browse button', () => {
      const { container } = render(<Upload label="Foto">zone</Upload>);
      const opens = countOpens(container);
      fireEvent.click(browse(container));
      expect(opens.n).toBeGreaterThan(0);
    });

    /**
     * ONE KEYBOARD STOP, NOT TWO. `UPLOAD_INPUT` is `sr-only`, which hides the file input
     * visually and leaves it tabbable — so before `tabIndex={-1}` the first Tab landed on an
     * INVISIBLE control that opens the same picker as the visible button behind it. Driven
     * through the real keyboard rather than a synthesised click carrying `detail: 0`, which
     * was the pointer path in disguise and proved nothing about reachability.
     */
    it('makes the browse button the first keyboard stop, not the hidden input', async () => {
      const user = userEvent.setup();
      const { container } = render(<Upload label="Foto">zone</Upload>);
      const opens = countOpens(container);
      await user.tab();
      expect(document.activeElement).toBe(browse(container));
      expect(container.querySelector('input')!.tabIndex).toBe(-1);
      await user.keyboard('{Enter}');
      expect(opens.n).toBeGreaterThan(0);
    });

    it('reaches the picker from the zone around the button', () => {
      const { container } = render(<Upload label="Foto">zone</Upload>);
      const zone = [...container.querySelectorAll('label')].find((l) => l.querySelector('input'))!;
      const opens = countOpens(container);
      fireEvent.click(zone);
      expect(opens.n).toBeGreaterThan(0);
    });

    it('disables the browse button alongside the zone', () => {
      const { container } = render(<Upload label="Foto" disabled>zone</Upload>);
      expect(browse(container).disabled).toBe(true);
    });
  });

  /**
   * THE FOUR STATES FIGMA PUBLISHES NONE OF — drag-over, busy, preview and failure. Each is
   * recorded as a divergence on the contract entry; these are what make them real.
   */
  describe('reaches the states a real upload has', () => {
    const zone = (container: HTMLElement) =>
      [...container.querySelectorAll('label')].find((l) => l.querySelector('input'))!;
    const browse = (container: HTMLElement) =>
      [...container.querySelectorAll('button')].find((b) => b.textContent === 'Browse')!;

    /* Asserted against the WHOLE status strings, not a token substring: `default` carries
       `hover:border-default-brand`, so a bare `border-default-brand` check passes in both
       states and sees nothing. */
    const carries = (container: HTMLElement, klass: string) =>
      klass.split(' ').every((c) => zone(container).className.split(' ').includes(c));

    /**
     * COMPOSED OVER THE STATUS, and reversible.
     *
     * The drag treatment WINS the paint — `cn` is tailwind-merge, so its border, surface and
     * ink displace the status's rather than stacking with it, which is what makes the
     * highlight visible at all. What "additive" buys is architectural rather than visual: the
     * status is resolved without reference to the drag, so releasing restores it whole. That
     * is why the drag can be absent on a platform with no pointer without the axis changing.
     */
    it('paints over the status while dragging, and restores it whole on leave', () => {
      const { container } = render(<Upload label="Foto" filled>zone</Upload>);
      expect(carries(container, UPLOAD_STATUS.filled)).toBe(true);
      fireEvent.dragOver(zone(container));
      expect(carries(container, UPLOAD_DRAG_OVER)).toBe(true);
      fireEvent.dragLeave(zone(container));
      expect(carries(container, UPLOAD_DRAG_OVER)).toBe(false);
      /* `filled`, not `default` — the status the caller declared survived the drag untouched. */
      expect(carries(container, UPLOAD_STATUS.filled)).toBe(true);
    });

    /* A BLOCKED ZONE MUST NOT LIGHT UP — it is about to refuse the drop. Gated on the derived
       visual rather than on the state, so a `busy` that arrives mid-drag still darkens it. */
    it.each([{ disabled: true }, { busy: true }] as const)(
      'refuses the drag treatment while %o',
      (props) => {
        const { container } = render(<Upload label="Foto" {...(props as object)}>zone</Upload>);
        fireEvent.dragOver(zone(container));
        expect(carries(container, UPLOAD_DRAG_OVER)).toBe(false);
      },
    );

    it('clears the drag state on drop, and still hands over the payload', () => {
      const seen: File[][] = [];
      const { container } = render(
        <Upload label="Foto" onFilesChange={(f) => seen.push(f)}>zone</Upload>,
      );
      fireEvent.dragOver(zone(container));
      fireEvent.drop(zone(container), { dataTransfer: { files: [new File(['x'], 'a.png')] } });
      expect(seen).toHaveLength(1);
      expect(carries(container, UPLOAD_DRAG_OVER)).toBe(false);
    });

    /**
     * THE PRECEDENCE, PAIR BY PAIR. Six values on one ramp is where an under-specified chain
     * ships a defect: each case below sets TWO states at once and names which must win.
     */
    it.each([
      [{ disabled: true, busy: true }, UPLOAD_STATUS.disabled],
      [{ busy: true, error: 'x' }, UPLOAD_STATUS.busy],
      [{ error: 'x', filled: true }, UPLOAD_STATUS.error],
      [{ filled: true }, UPLOAD_STATUS.filled],
    ] as const)('ranks %o as the winning status', (props, expected) => {
      const { container } = render(
        <Upload label="Foto" {...(props as object)}>zone</Upload>,
      );
      expect(carries(container, expected)).toBe(true);
    });

    it('refuses both routes while busy, exactly as disabled does', () => {
      const seen: File[][] = [];
      const { container } = render(
        <Upload label="Foto" busy onFilesChange={(f) => seen.push(f)}>zone</Upload>,
      );
      const input = container.querySelector('input')!;
      const opened = vi.spyOn(input, 'click');
      fireEvent.drop(zone(container), { dataTransfer: { files: [new File(['x'], 'a.png')] } });
      fireEvent.change(input, { target: { files: [new File(['x'], 'b.png')] } });
      fireEvent.click(browse(container));
      expect(seen).toEqual([]);
      expect(opened).not.toHaveBeenCalled();
      expect(browse(container).disabled).toBe(true);
      /* THE LABEL ROUTE, which the button assertion above cannot see. A busy zone with an
         enabled input still opens the OS picker on a label click; `emit` then drops the chosen
         file in silence, which is worse than refusing it. */
      expect(input.disabled).toBe(true);
    });

    /* `fireEvent.dragLeave` cannot carry `relatedTarget` — jsdom has no `DragEvent`, so
       testing-library falls back to a plain `Event` and drops it. A `MouseEvent` is the
       nearest thing that keeps the field, and `relatedTarget` is the whole point here. */
    const leave = (el: HTMLElement, to: Node) =>
      fireEvent(el, new MouseEvent('dragleave', { bubbles: true, relatedTarget: to }));

    /* A `dragleave` onto one of the zone's OWN children is not a leave — the pointer never
       left. Unguarded, the highlight strobes every time it crosses the browse button. */
    it('keeps the highlight when the pointer crosses onto its own children', () => {
      const { container } = render(<Upload label="Foto">zone</Upload>);
      fireEvent.dragOver(zone(container));
      expect(carries(container, UPLOAD_DRAG_OVER)).toBe(true);
      leave(zone(container), browse(container));
      expect(carries(container, UPLOAD_DRAG_OVER)).toBe(true);
      /* And a real leave still clears it. */
      leave(zone(container), document.body);
      expect(carries(container, UPLOAD_DRAG_OVER)).toBe(false);
    });

    /* An empty-string error is falsy everywhere else here — the status chain, `aria-invalid`,
       `FieldError`'s `empty:hidden`. Treating it as "in error" hides the helper row and shows
       nothing in its place: one blank row where there should be guidance. */
    it('keeps the helper row for an empty-string error', () => {
      const { container } = render(
        <Upload label="Foto" helperText="Maksimal 5 MB" error="">zone</Upload>,
      );
      expect(container.textContent).toContain('Maksimal 5 MB');
    });

    /**
     * `aria-describedby` and the helper element are ONE fact — two conditions expressing it is
     * how the input ends up citing an id that never rendered.
     *
     * The falsy cases are the ones that bite. `helperText` is a `ReactNode`, so the ordinary
     * `helperText={showHelp && '…'}` idiom passes `false` when off — neither `null` nor `''`.
     * A null check mounted an EMPTY `<p>` and cited it, which this guard's rendered-ness test
     * cannot catch on its own: the row exists, it just says nothing. Hence the emptiness
     * assertion below alongside the existence one.
     */
    it('never describes the input by a row it did not render', () => {
      for (const props of [
        { helperText: 'Maksimal 5 MB' },
        { helperText: 'Maksimal 5 MB', error: 'Terlalu besar' },
        { error: 'Terlalu besar' },
        { helperText: false as never },
        { helperText: '' },
        {},
      ]) {
        const { container } = render(<Upload label="Foto" {...props}>zone</Upload>);
        const cited = container.querySelector('input')!.getAttribute('aria-describedby')!.split(' ');
        for (const id of cited) {
          const el = container.querySelector(`#${CSS.escape(id)}`);
          expect(el, `${id} is cited but not rendered`).not.toBeNull();
          /* A mounted-but-empty row is a described-by pointing at nothing. The error region is
             the deliberate exception — it is always mounted so its live region can announce. */
          if (!id.endsWith('-error')) {
            expect(el!.textContent, `${id} is cited but says nothing`).not.toBe('');
          }
        }
      }
    });

    it('renders the preview in place of the placeholder, and keeps the browse button', () => {
      const { container } = render(
        <Upload label="Foto" filled icon={<span>glyph</span>} preview={<span>foto.jpg</span>}>
          Tarik file ke sini
        </Upload>,
      );
      expect(container.textContent).toContain('foto.jpg');
      expect(container.textContent).not.toContain('Tarik file ke sini');
      expect(container.textContent).not.toContain('glyph');
      expect(browse(container)).toBeTruthy();
    });

    /**
     * FAILURE IS A STATUS, NOT A SECOND MESSAGE CHANNEL. A `failure` message prop would put
     * two live regions on one control with no stated precedence — a reader hears both, or one,
     * unpredictably. The channel stays `error`, so there is exactly one.
     */
    it('keeps exactly one live region for a failed upload', () => {
      const { container } = render(
        <Upload label="Foto" filled error="Gagal mengunggah" preview={<span>foto.jpg</span>}>
          zone
        </Upload>,
      );
      expect(container.querySelectorAll('[role="alert"]')).toHaveLength(1);
      expect(container.querySelector('[role="alert"]')!.textContent).toBe('Gagal mengunggah');
    });

    /* PRESENTATION ONLY. A component that held the file would need a size limit, an error
       vocabulary and a compression policy, and every caller has a different one. */
    it('holds no file state and creates no object URL', () => {
      const created = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:x');
      const seen: File[][] = [];
      const { container } = render(
        <Upload label="Foto" onFilesChange={(f) => seen.push(f)}>zone</Upload>,
      );
      fireEvent.drop(zone(container), { dataTransfer: { files: [new File(['x'], 'a.png')] } });
      expect(seen).toHaveLength(1);
      expect(created).not.toHaveBeenCalled();
      /* Nothing about the zone changed: `filled` is the caller's to set. */
      expect(zone(container).hasAttribute('data-filled')).toBe(false);
      created.mockRestore();
    });
  });
});

describe('Select', () => {
  const OPTIONS = [
    { label: 'Makanan', value: 'makanan' },
    { label: 'Minuman', value: 'minuman' },
    { label: 'Fesyen', value: 'fesyen' },
  ];

  const open = (container: HTMLElement) => {
    fireEvent.click(container.querySelector('[role="combobox"]')!);
    return container;
  };

  it('reflects the selection in the trigger and reports it once', () => {
    const seen: string[] = [];
    const { container } = render(
      <Select label="Kategori" options={OPTIONS} onValueChange={(v) => seen.push(v)} />,
    );
    open(container);
    fireEvent.click(screen.getByRole('option', { name: 'Minuman' }));
    expect(seen).toEqual(['minuman']);
  });

  it('exposes a listbox with the selected option marked', () => {
    const { container } = render(<Select label="Kategori" options={OPTIONS} value="minuman" />);
    open(container);
    const options = screen.getAllByRole('option');
    expect(options.filter((o) => o.getAttribute('aria-selected') === 'true')).toHaveLength(1);
    expect(screen.getByRole('listbox')).toBeTruthy();
  });

  it('moves the active option with the arrows and selects with Enter', () => {
    const seen: string[] = [];
    const { container } = render(
      <Select label="Kategori" options={OPTIONS} onValueChange={(v) => seen.push(v)} />,
    );
    const wrapper = container.querySelector('.relative')!;
    fireEvent.keyDown(wrapper, { key: 'ArrowDown' });
    fireEvent.keyDown(wrapper, { key: 'ArrowDown' });
    fireEvent.keyDown(wrapper, { key: 'Enter' });
    expect(seen).toEqual(['minuman']);
  });

  it('closes on Escape and puts focus back on the trigger', () => {
    const { container } = render(<Select label="Kategori" options={OPTIONS} />);
    open(container);
    expect(screen.queryByRole('listbox')).not.toBeNull();
    fireEvent.keyDown(container.querySelector('.relative')!, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(document.activeElement).toBe(container.querySelector('[role="combobox"]'));
  });

  it('filters on type-to-search', () => {
    const { container } = render(<Select label="Kategori" options={OPTIONS} showSearch />);
    open(container);
    fireEvent.change(screen.getByLabelText('Cari'), { target: { value: 'min' } });
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Minuman']);
  });

  /* An empty box reads as a component that broke rather than a search that found nothing. */
  it('renders an empty-state message rather than a blank box', () => {
    const { container } = render(
      <Select label="Kategori" options={OPTIONS} showSearch emptyMessage="Tidak ketemu" />,
    );
    open(container);
    fireEvent.change(screen.getByLabelText('Cari'), { target: { value: 'zzz' } });
    expect(screen.queryAllByRole('option')).toHaveLength(0);
    expect(screen.getByText('Tidak ketemu')).toBeTruthy();
  });

  it('keeps keyboard selection working with the search off', () => {
    const seen: string[] = [];
    const { container } = render(
      <Select
        label="Kategori"
        options={OPTIONS}
        showSearch={false}
        onValueChange={(v) => seen.push(v)}
      />,
    );
    expect(container.querySelector('input')).toBeNull();
    const wrapper = container.querySelector('.relative')!;
    fireEvent.keyDown(wrapper, { key: 'ArrowDown' });
    fireEvent.keyDown(wrapper, { key: 'Enter' });
    expect(seen).toEqual(['makanan']);
  });

  it('does not open when disabled', () => {
    const { container } = render(<Select label="Kategori" options={OPTIONS} disabled />);
    fireEvent.keyDown(container.querySelector('.relative')!, { key: 'ArrowDown' });
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('refuses a disabled option', () => {
    const seen: string[] = [];
    const { container } = render(
      <Select
        label="Kategori"
        options={[...OPTIONS, { label: 'Segera', value: 'soon', disabled: true }]}
        onValueChange={(v) => seen.push(v)}
      />,
    );
    open(container);
    fireEvent.click(screen.getByRole('option', { name: 'Segera' }));
    expect(seen).toEqual([]);
  });

  /* Filtering shortens the list, so a stale active index points past the end and Enter selects
     nothing while looking like it should. */
  it('resets the keyboard cursor when the filter shortens the list', () => {
    const seen: string[] = [];
    const { container } = render(
      <Select
        label="Kategori"
        options={OPTIONS}
        showSearch
        onValueChange={(v) => seen.push(v)}
      />,
    );
    const wrapper = container.querySelector('.relative')!;
    open(container);
    fireEvent.keyDown(wrapper, { key: 'ArrowDown' });
    fireEvent.keyDown(wrapper, { key: 'ArrowDown' });
    fireEvent.change(screen.getByLabelText('Cari'), { target: { value: 'fes' } });
    fireEvent.keyDown(wrapper, { key: 'Enter' });
    expect(seen).toEqual(['fesyen']);
  });

  /* Escape and a selection are not the only ways out. A list left open behind whatever the
     user clicked next is the failure every hand-rolled dropdown has. */
  it('closes on an outside click', () => {
    const { container } = render(
      <div>
        <Select label="Kategori" options={OPTIONS} />
        <button type="button">elsewhere</button>
      </div>,
    );
    open(container);
    expect(screen.queryByRole('listbox')).not.toBeNull();
    fireEvent.mouseDown(screen.getByRole('button', { name: 'elsewhere' }));
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  /* `mousedown` rather than `click`, so a drag that starts on an option and finishes outside
     the list does not close it out from under its own handler. */
  it('stays open for a click that starts inside the list', () => {
    const { container } = render(<Select label="Kategori" options={OPTIONS} />);
    open(container);
    fireEvent.mouseDown(screen.getByRole('option', { name: 'Minuman' }));
    expect(screen.queryByRole('listbox')).not.toBeNull();
  });

  /**
   * THE VIRTUAL CURSOR IS PUBLISHED. Focus stays on the trigger while `active` moves, so
   * without `aria-activedescendant` a screen-reader user pressing an arrow key hears nothing —
   * the highlight is a colour, and colour is not a channel every reader has.
   */
  it('publishes the active option as the trigger active descendant', () => {
    const { container } = render(<Select label="Kategori" options={OPTIONS} />);
    const trigger = container.querySelector('[role="combobox"]')!;
    expect(trigger.getAttribute('aria-activedescendant')).toBeNull();
    const wrapper = container.querySelector('.relative')!;
    fireEvent.keyDown(wrapper, { key: 'ArrowDown' });
    const first = trigger.getAttribute('aria-activedescendant');
    expect(first).toBeTruthy();
    expect(container.querySelector(`#${first}`)!.getAttribute('role')).toBe('option');
    fireEvent.keyDown(wrapper, { key: 'ArrowDown' });
    expect(trigger.getAttribute('aria-activedescendant')).not.toBe(first);
  });

  /* A listbox whose options are grandchildren exposes none of them. */
  it('lets the listbox own its options directly', () => {
    const { container } = render(<Select label="Kategori" options={OPTIONS} />);
    open(container);
    for (const li of container.querySelectorAll('[role="listbox"] > li')) {
      expect(li.getAttribute('role')).toBe('presentation');
    }
  });

  /**
   * THE FOCUSED OPTION AND THE CURSOR CANNOT DISAGREE. A focusable option's Enter bubbles to the
   * wrapper handler, which preventDefaults the native click and selects `visible[active]` — so
   * a user who Tabs onto one option and presses Enter would pick a different one.
   */
  it('keeps the options out of the tab order so Enter cannot select a different one', () => {
    const { container } = render(<Select label="Kategori" options={OPTIONS} />);
    open(container);
    for (const opt of container.querySelectorAll('[role="option"]')) {
      expect(opt.getAttribute('tabindex')).toBe('-1');
    }
  });

  /* A disabled BUTTON leaves the a11y tree and fires no mouseenter; the refusal lives in the
     handler, so the option stays announced and hoverable while still being unselectable. */
  it('marks a disabled option aria-disabled rather than removing it from the tree', () => {
    const { container } = render(
      <Select label="Kategori" options={[...OPTIONS, { label: 'Segera', value: 'soon', disabled: true }]} />,
    );
    open(container);
    const soon = screen.getByRole('option', { name: 'Segera' });
    expect(soon.getAttribute('aria-disabled')).toBe('true');
    expect(soon.hasAttribute('disabled')).toBe(false);
  });

  it('resets the cursor on close, so a stale hover does not decide the next Enter', () => {
    const seen: string[] = [];
    const { container } = render(
      <Select label="Kategori" options={OPTIONS} onValueChange={(v) => seen.push(v)} />,
    );
    const wrapper = container.querySelector('.relative')!;
    open(container);
    fireEvent.mouseEnter(screen.getByRole('option', { name: 'Fesyen' }));
    fireEvent.keyDown(wrapper, { key: 'Escape' });
    open(container);
    fireEvent.keyDown(wrapper, { key: 'Enter' });
    expect(seen).toEqual(['makanan']);
  });

  /**
   * A CALLER THAT OWNS THE SEARCH OWNS ALL OF IT. With `onSearch` the options arrive already
   * filtered — often by a server matching on more than the label — so filtering again here would
   * silently drop rows it deliberately returned. That failure looks like "the search is bad",
   * not like a bug in this component.
   */
  it('stops filtering internally once the caller takes the query', () => {
    const seen: string[] = [];
    const { container } = render(
      <Select label="Kategori" options={OPTIONS} showSearch onSearch={(q) => seen.push(q)} />,
    );
    open(container);
    fireEvent.change(screen.getByLabelText('Cari'), { target: { value: 'zzz' } });
    expect(seen).toEqual(['zzz']);
    /* Every option still rendered: the caller decides what the list holds. */
    expect(screen.getAllByRole('option')).toHaveLength(OPTIONS.length);
  });

  /* Two cities of the same name differ only by their province — the exact case the hint is for,
     so a filter that ignored it would make them indistinguishable. */
  it('renders an option hint and searches it alongside the label', () => {
    const withHints = [
      { label: 'Bogor', value: 'bogor-kota', hint: 'Jawa Barat' },
      { label: 'Bogor', value: 'bogor-kab', hint: 'Kabupaten' },
    ];
    const { container } = render(<Select label="Kota" options={withHints} showSearch />);
    open(container);
    expect(screen.getByText(/Jawa Barat/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Cari'), { target: { value: 'kabupaten' } });
    expect(screen.getAllByRole('option')).toHaveLength(1);
    expect(screen.getAllByRole('option')[0].textContent).toContain('Kabupaten');
  });

  /* "Loading" and "found nothing" are different answers and get different words. */
  it('says it is loading rather than saying there is nothing', () => {
    const { container } = render(<Select label="Kota" options={[]} loading loadingMessage="Memuat…" />);
    open(container);
    expect(screen.getByText('Memuat…')).toBeTruthy();
    expect(screen.queryByText('Tidak ada pilihan')).toBeNull();
  });

  /* The disabled hint explains a state; it must not be mistaken for a failure. */
  it('explains why a disabled field is disabled, without announcing it as an error', () => {
    const { container } = render(
      <Select label="Kota" options={OPTIONS} disabled disabledHint="Pilih provinsi dulu" />,
    );
    const hint = screen.getByText('Pilih provinsi dulu');
    expect(hint.closest('[role="alert"]')).toBeNull();
    expect(container.querySelector('[role="alert"]')!.textContent).toBe('');
  });

  it('shows no disabled hint once the field is usable', () => {
    render(<Select label="Kota" options={OPTIONS} disabledHint="Pilih provinsi dulu" />);
    expect(screen.queryByText('Pilih provinsi dulu')).toBeNull();
  });

  /* An empty filtered list has no option to point at — publishing an id nothing owns leaves a
     screen reader following a dangling reference. */
  it('publishes no active descendant when the filter empties the list', () => {
    const { container } = render(<Select label="Kategori" options={OPTIONS} showSearch />);
    open(container);
    const combobox = () => container.querySelector('[role="combobox"]')!;
    fireEvent.change(screen.getByLabelText('Cari'), { target: { value: 'zzz' } });
    expect(screen.queryAllByRole('option')).toHaveLength(0);
    expect(combobox().getAttribute('aria-activedescendant')).toBeNull();
  });

  /* `visible.length - 1` is -1 on an empty list, so an unclamped ArrowDown drives the cursor
     off the front of the array. */
  it('never drives the cursor below the first option', () => {
    const seen: string[] = [];
    const { container } = render(
      <Select label="Kategori" options={OPTIONS} showSearch onValueChange={(v) => seen.push(v)} />,
    );
    const wrapper = container.querySelector('.relative')!;
    open(container);
    fireEvent.change(screen.getByLabelText('Cari'), { target: { value: 'zzz' } });
    fireEvent.keyDown(wrapper, { key: 'ArrowDown' });
    fireEvent.change(screen.getByLabelText('Cari'), { target: { value: '' } });
    fireEvent.keyDown(wrapper, { key: 'Enter' });
    expect(seen).toEqual(['makanan']);
  });

  /* Tab moves focus without a pointer event, so a mousedown-only dismissal leaves the list open
     behind a user who has already moved on. */
  it('closes when focus leaves the control entirely', () => {
    const { container } = render(
      <div>
        <Select label="Kategori" options={OPTIONS} />
        <button type="button">elsewhere</button>
      </div>,
    );
    open(container);
    expect(screen.queryByRole('listbox')).not.toBeNull();
    const root = container.querySelector('.relative')!;
    fireEvent.focusOut(root, { relatedTarget: screen.getByRole('button', { name: 'elsewhere' }) });
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('stays open while focus moves within the control', () => {
    const { container } = render(<Select label="Kategori" options={OPTIONS} showSearch />);
    open(container);
    const root = container.querySelector('.relative')!;
    fireEvent.focusOut(root, { relatedTarget: screen.getByLabelText('Cari') });
    expect(screen.queryByRole('listbox')).not.toBeNull();
  });

  /* The outside-click path bypasses `close()`, so the cursor has to be reset there too. */
  it('resets the cursor after an outside click, not just after Escape', () => {
    const seen: string[] = [];
    const { container } = render(
      <div>
        <Select label="Kategori" options={OPTIONS} onValueChange={(v) => seen.push(v)} />
        <button type="button">elsewhere</button>
      </div>,
    );
    const wrapper = container.querySelector('.relative')!;
    open(container);
    fireEvent.mouseEnter(screen.getByRole('option', { name: 'Fesyen' }));
    fireEvent.mouseDown(screen.getByRole('button', { name: 'elsewhere' }));
    open(container);
    fireEvent.keyDown(wrapper, { key: 'Enter' });
    expect(seen).toEqual(['makanan']);
  });

  /**
   * EXACTLY ONE ELEMENT CARRIES THE COMBOBOX PATTERN, and it is the one focus is on. In search
   * mode `autoFocus` puts focus on the input, so a cursor published on the trigger would be
   * announced on an element the user is not standing on.
   */
  it('moves the combobox pattern onto the search input when that is where focus goes', () => {
    const { container } = render(<Select label="Kategori" options={OPTIONS} showSearch />);
    open(container);
    const boxes = [...container.querySelectorAll('[role="combobox"]')];
    expect(boxes).toHaveLength(1);
    expect(boxes[0].tagName).toBe('INPUT');
    expect(boxes[0].getAttribute('aria-activedescendant')).toBeTruthy();
  });

  it('leaves the combobox pattern on the trigger when there is no search input', () => {
    const { container } = render(<Select label="Kategori" options={OPTIONS} />);
    open(container);
    const boxes = [...container.querySelectorAll('[role="combobox"]')];
    expect(boxes).toHaveLength(1);
    expect(boxes[0].tagName).toBe('BUTTON');
  });

  /* The list is NOT portalled, which is what keeps it out of the dialog-modality conflict. */
  it('renders the list in place rather than through a portal', () => {
    const { container, baseElement } = render(<Select label="Kategori" options={OPTIONS} />);
    open(container);
    expect(container.querySelector('[role="listbox"]')).not.toBeNull();
    expect(baseElement.querySelectorAll('[role="listbox"]')).toHaveLength(1);
  });
});

describe('Select list width (UMK-1186)', () => {
  const OPTIONS = [{ label: '+62', value: 'ID', hint: 'Indonesia' }];
  const listOf = (root: HTMLElement) => {
    fireEvent.click(root.querySelector('[role="combobox"]')!);
    /* The element carrying the list's classes, found by one of them rather than by position. */
    return root.querySelector('[role="listbox"]')!.closest('.overflow-auto')!;
  };

  /* In place, the list grows to its rows — a narrow trigger no longer squeezes them — and is
     capped at the screen so a long row cannot run off a phone's edge. */
  it('widens an in-place list to its rows, capped at the screen', () => {
    const { container } = render(<Select aria-label="Kode negara" options={OPTIONS} />);
    const list = listOf(container);
    /* On `width`, not `min-width`: CSS applies min-width last, so a min-width widening would
       override the cap. jsdom has no layout; the rendered width was measured in a browser. */
    for (const c of ['w-max', 'min-w-full', 'max-w-[calc(100vw-2rem)]']) expect(list.classList.contains(c)).toBe(true);
    expect(list.classList.contains('min-w-max')).toBe(false);
  });

  /* Portalled, the popover is pinned to the trigger's width; a wider list would spill out of it. */
  it('keeps a portalled list to its popover', () => {
    const { baseElement } = render(<Select aria-label="Kode negara" options={OPTIONS} portal />);
    const list = listOf(baseElement as HTMLElement);
    expect(list.classList.contains('w-full')).toBe(true);
    expect(list.classList.contains('w-max')).toBe(false);
  });
});

describe('Select list size and create option (UMK-1122, UMK-1119)', () => {
  const OPTIONS = [
    { label: 'Makanan', value: 'makanan' },
    { label: 'Minuman', value: 'minuman' },
  ];
  const openList = (container: HTMLElement) => fireEvent.click(container.querySelector('[role="combobox"]')!);
  const search = (text: string) => fireEvent.change(screen.getByRole('combobox'), { target: { value: text } });

  it.each([
    ['small', 'text-ds-paragraph-mobile', 'rounded-ds-md'],
    ['large', 'text-ds-paragraph-desktop', 'rounded-ds-lg'],
  ] as const)('opens a %s list at the trigger size', (size, text, radius) => {
    const { container } = render(<Select label="Kategori" size={size} options={OPTIONS} />);
    openList(container);
    expect(screen.getAllByRole('option')[0].className).toContain(text);
    expect(screen.getByRole('listbox').parentElement!.className).toContain(radius);
  });

  /* EVERY row kind, not only an option: each composes the size table separately, so a row
     that drops it reintroduces UMK-1122 while an option-only check stays green. */
  it.each([
    ['small', 'text-ds-paragraph-mobile'],
    ['large', 'text-ds-paragraph-desktop'],
  ] as const)('sizes the search, empty and create rows of a %s list', (size, text) => {
    const { container, unmount } = render(
      <Select label="Kategori" size={size} options={OPTIONS} showSearch emptyMessage="Kosong" />,
    );
    openList(container);
    search('zz');
    expect(screen.getByRole('combobox').parentElement!.className).toContain(text);
    expect(screen.getByRole('combobox').parentElement!.querySelector('svg')).toBeTruthy();
    expect(screen.getByText('Kosong').className).toContain(text);
    unmount();
    const created = render(<Select label="Kategori" size={size} options={OPTIONS} showSearch onCreate={vi.fn()} />);
    openList(created.container);
    search('Kerajinan');
    expect(screen.getByRole('option', { name: /Tambah/ }).className).toContain(text);
  });

  it.each([
    ['large', ['px-ds-md', 'py-ds-sm', 'text-ds-paragraph-desktop']],
    ['small', ['px-ds-md', 'py-ds-xs', 'text-ds-paragraph-mobile']],
  ] as const)('a %s option row is padded and typed like its box (UMK-955)', (size, classes) => {
    const { container } = render(<Select label="Kategori" size={size} options={OPTIONS} />);
    openList(container);
    for (const cls of classes) expect(screen.getAllByRole('option')[0].className).toContain(cls);
  });

  it('a field caption at labelSize large is 14/20 regular (the review dialog, UMK-955)', () => {
    const { container } = render(<TextField label="Ulasan" size="small" labelSize="large" />);
    const cls = container.querySelector('label')!.className;
    for (const c of ['text-ds-paragraph-mobile', 'font-normal']) expect(cls).toContain(c);
  });

  it('shows no create row below the minimum length or when a match exists', () => {
    const { container } = render(<Select label="Kategori" options={OPTIONS} showSearch onCreate={vi.fn()} />);
    openList(container);
    search('Ke');
    expect(screen.queryByRole('option', { name: /Tambah/ })).toBeNull();
    search('Makan');
    expect(screen.queryByRole('option', { name: /Tambah/ })).toBeNull();
    search('Kerajinan');
    expect(screen.getByRole('option', { name: 'Tambah "Kerajinan"' })).toBeTruthy();
    expect(screen.queryByText('Tidak ada pilihan')).toBeNull();
  });

  it('creates on click and selects the returned option', async () => {
    const onCreate = vi.fn((q: string) => ({ label: q, value: 'kerajinan' }));
    const seen: string[] = [];
    const { container } = render(
      <Select label="Kategori" options={OPTIONS} showSearch onCreate={onCreate} onValueChange={(v) => seen.push(v)} />,
    );
    openList(container);
    search('  Kerajinan ');
    fireEvent.click(screen.getByRole('option', { name: 'Tambah "Kerajinan"' }));
    await waitFor(() => expect(seen).toEqual(['kerajinan']));
    expect(onCreate).toHaveBeenCalledWith('Kerajinan');
  });

  it('shows the created label before the caller options update', async () => {
    const Harness = () => {
      const [value, setValue] = React.useState<string>();
      /* Options deliberately never gain the created row. */
      return (
        <Select label="Kategori" options={OPTIONS} value={value} onValueChange={setValue} showSearch
          onCreate={(q) => ({ label: q, value: 'kerajinan' })} />
      );
    };
    const { container } = render(<Harness />);
    openList(container);
    search('Kerajinan');
    fireEvent.click(screen.getByRole('option', { name: 'Tambah "Kerajinan"' }));
    await waitFor(() => expect(container.querySelector('button#' + CSS.escape(container.querySelector('label')!.htmlFor))!.textContent).toBe('Kerajinan'));
  });

  it('creates with Enter on the create row', async () => {
    const onCreate = vi.fn((q: string) => ({ label: q, value: 'kerajinan' }));
    const { container } = render(<Select label="Kategori" options={OPTIONS} showSearch onCreate={onCreate} />);
    openList(container);
    search('Kerajinan');
    fireEvent.keyDown(container.querySelector('.relative')!, { key: 'Enter' });
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith('Kerajinan'));
  });

  it('keeps the list open and selects nothing when onCreate rejects', async () => {
    let reject!: (e: Error) => void;
    const onCreate = vi.fn(() => new Promise<never>((_, rj) => (reject = rj)));
    const onValueChange = vi.fn();
    const { container } = render(
      <Select label="Kategori" options={OPTIONS} showSearch onCreate={onCreate} onValueChange={onValueChange} />,
    );
    openList(container);
    search('Kerajinan');
    fireEvent.click(screen.getByRole('option', { name: 'Tambah "Kerajinan"' }));
    const row = () => screen.getByRole('option', { name: 'Tambah "Kerajinan"' });
    await waitFor(() => expect(row().getAttribute('aria-disabled')).toBe('true'));
    reject(new Error('gagal'));
    await waitFor(() => expect(screen.getByRole('option', { name: 'Tambah "Kerajinan"' }).getAttribute('aria-disabled')).toBeNull());
    expect(onValueChange).not.toHaveBeenCalled();
    expect(screen.getByRole('listbox')).toBeTruthy();
  });
});

describe('TextField follows Figma Field Input (UMK-955 L1)', () => {
  const boxOf = (container: HTMLElement) => container.querySelector<HTMLElement>('[data-filled], div.border')!;

  it('large is 16/24 with padding 12/16, small is 14/20 with padding 10/16', () => {
    const large = render(<TextField label="Nama" size="large" />).container.querySelector('div.border')!;
    expect(large.className).toContain('text-ds-paragraph-desktop');
    expect(large.className).toContain('py-ds-sm');
    expect(large.className).toContain('px-ds-md');
    const small = render(<TextField label="Nama" size="small" />).container.querySelector('div.border')!;
    expect(small.className).toContain('text-ds-paragraph-mobile');
    expect(small.className).toContain('py-ds-xs');
    expect(small.className).toContain('px-ds-md');
  });

  it('a filled box keeps the #f0f0f0 border and the value is medium weight, the placeholder regular', () => {
    const { container } = render(<TextField label="Nama" defaultValue="Andi" />);
    expect(boxOf(container).className).toContain('border-default-primary');
    expect(boxOf(container).className).not.toContain('border-default-invert');
    const control = container.querySelector('input')!;
    expect(control.className).toContain('font-medium');
    expect(control.className).toContain('placeholder:font-normal');
  });

  it('disabled is Disable Filled: the value keeps full ink, only the placeholder dims', () => {
    const { container } = render(<TextField label="Nama" disabled defaultValue="Terkunci" />);
    expect(boxOf(container).className).toContain('bg-default-secondary');
    expect(boxOf(container).className).not.toContain('text-disable-primary');
    const control = container.querySelector('input')!;
    expect(control.className).not.toMatch(/(?:^|\s)disabled:text-disable-primary/);
    expect(control.className).toContain('disabled:placeholder:text-disable-primary');
  });

  it('the error under a large field is 12/18 and under a small field 10/16', () => {
    const large = render(<TextField label="Nama" size="large" error="Wajib" />).container.querySelector('[role="alert"]')!;
    expect(large.className).toContain('text-ds-body-lg-mobile');
    const small = render(<TextField label="Nama" size="small" error="Wajib" />).container.querySelector('[role="alert"]')!;
    expect(small.className).toContain('text-ds-body-md-mobile');
  });
});

describe('TextField appearance="bare" (UMK-955 L2)', () => {
  it('draws no chrome: no border, fill, padding, radius or ring, and the caller owns the type', () => {
    const { container } = render(
      <TextField aria-label="Pesan" appearance="bare" multiline className="text-ds-paragraph-desktop min-h-[100px]" />,
    );
    const box = container.querySelector('textarea')!.parentElement!;
    expect(box.className).toContain('text-ds-paragraph-desktop');
    expect(box.className).toContain('min-h-[100px]');
    expect(box.className).not.toMatch(/(?:^|\s)(?:border|px-|py-|rounded-|bg-|ring)/);
    expect(box.className).not.toContain('focus-within');
    expect(container.querySelector('textarea')!.className).toContain('resize-none');
  });

  it('autoResize still works', () => {
    render(<TextField aria-label="Pesan" appearance="bare" multiline autoResize rows={1} />);
    expect(screen.getByLabelText('Pesan').tagName).toBe('TEXTAREA');
  });
});

describe('TextField valid (UMK-955 L3)', () => {
  it('draws the success border and a trailing tick', () => {
    const { container } = render(<TextField label="Email" defaultValue="a@b.id" valid />);
    expect(container.querySelector('div.border')!.className).toContain('border-default-success');
    expect(container.querySelector('.text-default-success svg, .text-default-success')).toBeTruthy();
  });

  it('yields the tick to a trailing adornment, and error and disabled win over it', () => {
    const { container: a } = render(<TextField label="Email" valid trailingAdornment={<i data-testid="own" />} />);
    expect(a.querySelector('.text-default-success')).toBeNull();
    expect(screen.getByTestId('own')).toBeInTheDocument();
    const { container: b } = render(<TextField label="Email" valid error="Salah" />);
    expect(b.querySelector('div.border')!.className).toContain('border-default-error');
    expect(b.querySelector('.text-default-success')).toBeNull();
    const { container: c } = render(<TextField label="Email" valid disabled />);
    expect(c.querySelector('div.border')!.className).not.toContain('border-default-success');
  });
});

describe('TextField disabled vs readOnly (UMK-955 L4)', () => {
  it('disabled is not focusable and not submitted; readOnly stays selectable with the plain filled look', () => {
    const { container } = render(
      <form>
        <TextField label="A" name="a" disabled defaultValue="x" />
        <TextField label="B" name="b" readOnly defaultValue="y" />
      </form>,
    );
    const [a, b] = Array.from(container.querySelectorAll('input'));
    expect(a).toBeDisabled();
    expect(new FormData(container.querySelector('form')!).has('a')).toBe(false);
    expect(b).not.toBeDisabled();
    expect(b.readOnly).toBe(true);
    expect(b.closest('div.border')!.className).not.toContain('bg-default-secondary');
  });
});

describe('TextField size="xsmall" (UMK-955 L5)', () => {
  it('is padding 4/8, 12/18 type and an 8px radius', () => {
    const box = render(<TextField aria-label="Alasan" size="xsmall" />).container.querySelector('div.border')!;
    for (const cls of ['px-ds-2xs', 'py-ds-4xs', 'text-ds-body-lg-mobile', 'rounded-ds-md']) {
      expect(box.className).toContain(cls);
    }
  });
});

describe('CheckBox and Radio sit in the first line of their label (UMK-955 L6)', () => {
  const margin = { xlarge: 'mt-0', large: 'mt-px', medium: 'mt-ds-5xs', small: 'mt-[3px]' } as const;

  it.each(Object.entries(margin))('CheckBox %s drops %s', (size, cls) => {
    const { container } = render(<CheckBox label="Setuju" size={size as keyof typeof margin} />);
    expect(container.querySelector('input')!.parentElement!.className).toContain(cls);
  });

  it('a CheckBox with no visible label takes no margin', () => {
    const { container } = render(<CheckBox aria-label="Pilih" />);
    expect(container.querySelector('input')!.parentElement!.className).not.toMatch(/(?:^|\s)mt-/);
  });

  it.each(['large', 'medium', 'small'] as const)('Radio %s drops the same margin', (size) => {
    const { container } = render(<Radio label="Ya" size={size} />);
    expect(container.querySelector('input')!.parentElement!.className).toContain(margin[size]);
  });
});

describe('TextField resize (UMK-955 L7)', () => {
  it('defaults to resize-y and resize={false} gives resize-none; autoResize implies none', () => {
    expect(render(<TextField label="A" multiline />).container.querySelector('textarea')!.className).toContain('resize-y');
    expect(render(<TextField label="B" multiline resize={false} />).container.querySelector('textarea')!.className).toContain('resize-none');
    expect(render(<TextField label="C" multiline autoResize />).container.querySelector('textarea')!.className).toContain('resize-none');
  });
});

describe('TextField counterPlacement (UMK-955 L8)', () => {
  it('below (default) renders the counter outside the box', () => {
    const { container } = render(<TextField label="A" maxLength={10} showCounter defaultValue="abc" />);
    const counter = screen.getByText('3/10');
    expect(counter.closest('div.border')).toBeNull();
    expect(container).toContainElement(counter);
  });

  it('inside renders it in a row of the box, 10px, and turns error-coloured at the limit', () => {
    const { container, rerender } = render(
      <TextField label="A" maxLength={5} showCounter counterPlacement="inside" defaultValue="abc" />,
    );
    const counter = screen.getByText('3/5');
    expect(counter.closest('div.border')).toBe(container.querySelector('div.border'));
    expect(counter.className).toContain('text-ds-body-md-mobile');
    expect(counter.className).toContain('text-default-secondary');
    rerender(<TextField label="A" maxLength={5} showCounter counterPlacement="inside" value="abcde" onChange={() => {}} />);
    expect(screen.getByText('5/5').className).toContain('text-default-error');
    expect(screen.getByLabelText('A').getAttribute('aria-describedby')).toContain(counter.id);
  });
});

describe('TextField prefixPlacement (UMK-955 L9)', () => {
  it('outside puts the prefix in its own bordered box beside the field and mirrors its state', () => {
    const { container } = render(<TextField label="WA" prefix="+62" prefixPlacement="outside" error="Salah" />);
    const prefix = container.querySelector<HTMLElement>('[data-field-prefix]')!;
    expect(prefix.textContent).toBe('+62');
    expect(prefix.className).toContain('border');
    expect(prefix.className).toContain('border-default-error');
    expect(prefix.className).toContain('shrink-0');
    expect(prefix.contains(screen.getByLabelText('WA'))).toBe(false);
    expect(prefix.parentElement).toBe(screen.getByLabelText('WA').closest('div.border')!.parentElement);
  });

  it('inside (default) keeps the prefix in the field box', () => {
    const { container } = render(<TextField label="WA" prefix="+62" />);
    expect(container.querySelector('[data-field-prefix]')!.closest('div.border')).toBe(
      screen.getByLabelText('WA').closest('div.border'),
    );
  });
});

describe('TextField rings only for user focus (UMK-955 L10)', () => {
  const quiet = (label: string) => screen.getByLabelText(label).closest('div.border')!.hasAttribute('data-quiet-focus');
  const settle = () => new Promise((r) => setTimeout(r, 150));

  it('focus from code is quiet', async () => {
    render(<TextField label="A" />);
    await settle();
    act(() => screen.getByLabelText('A').focus());
    expect(quiet('A')).toBe(true);
  });

  it('a click on ANOTHER element, then .focus() from code, stays quiet', async () => {
    render(
      <>
        <button>Lain</button>
        <TextField label="A" />
      </>,
    );
    await settle();
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Lain' }));
    act(() => screen.getByLabelText('A').focus());
    expect(quiet('A')).toBe(true);
  });

  it('a pointerdown inside the field box paints the ring', async () => {
    render(<TextField label="A" />);
    await settle();
    await userEvent.click(screen.getByLabelText('A'));
    expect(quiet('A')).toBe(false);
  });

  it('Tab and arrow keys paint the ring, a letter typed elsewhere does not', async () => {
    render(
      <>
        <input aria-label="other" />
        <TextField label="A" />
      </>,
    );
    await settle();
    fireEvent.keyDown(document.body, { key: 'a' });
    act(() => screen.getByLabelText('A').focus());
    expect(quiet('A')).toBe(true);
    act(() => screen.getByLabelText('A').blur());
    await settle();
    await userEvent.tab();
    await userEvent.tab();
    expect(document.activeElement).toBe(screen.getByLabelText('A'));
    expect(quiet('A')).toBe(false);
    act(() => screen.getByLabelText('A').blur());
    await settle();
    fireEvent.keyDown(document.body, { key: 'ArrowDown' });
    act(() => screen.getByLabelText('A').focus());
    expect(quiet('A')).toBe(false);
  });

  it('a click on the caption paints the ring (label for -> control)', async () => {
    render(<TextField label="A" />);
    await settle();
    await userEvent.click(screen.getByText('A'));
    expect(document.activeElement).toBe(screen.getByLabelText('A'));
    expect(quiet('A')).toBe(false);
  });

  it('a Select closed from the keyboard returns the ring to its trigger', async () => {
    render(<Select label="S" options={[{ value: 'a', label: 'Aaa' }]} searchable />);
    await settle();
    const trigger = screen.getByRole('combobox', { name: 'S' });
    await userEvent.click(trigger);
    await userEvent.keyboard('{Escape}');
    expect(document.activeElement).toBe(trigger);
    expect(trigger.hasAttribute('data-quiet-focus')).toBe(false);
  });

  it('a touch tap whose focus lands after pointerup paints the ring', async () => {
    render(<TextField label="A" />);
    await settle();
    const input = screen.getByLabelText('A');
    fireEvent.pointerDown(input);
    await settle(); // the synthesized click (and so the focus) arrives > 100ms after pointerdown
    fireEvent.pointerUp(input);
    act(() => input.focus());
    expect(quiet('A')).toBe(false);
  });

  it('a dialog opened from the keyboard rings its autofocused field, a mouse-opened one stays quiet', async () => {
    const Host = () => {
      const [open, setOpen] = React.useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>Buka</button>
          {open && <TextField label="A" autoFocus />}
        </>
      );
    };
    const { unmount } = render(<Host />);
    await settle();
    const opener = screen.getByRole('button', { name: 'Buka' });
    opener.focus();
    await userEvent.keyboard('{Enter}');
    expect(quiet('A')).toBe(false);
    unmount();

    render(<Host />);
    await settle();
    await userEvent.click(screen.getByRole('button', { name: 'Buka' }));
    expect(quiet('A')).toBe(true);
  });

  it('Enter typed inside a text control does not vouch for the next focus', async () => {
    render(
      <>
        <input aria-label="other" />
        <TextField label="A" />
      </>,
    );
    await settle();
    fireEvent.keyDown(screen.getByLabelText('other'), { key: 'Enter' });
    act(() => screen.getByLabelText('A').focus());
    expect(quiet('A')).toBe(true);
  });

  it('a key pressed after an autofocus clears it', async () => {
    render(<TextField label="A" />);
    await settle();
    act(() => screen.getByLabelText('A').focus());
    expect(quiet('A')).toBe(true);
    fireEvent.keyDown(screen.getByLabelText('A'), { key: 'a' });
    expect(quiet('A')).toBe(false);
  });

  it('the same rule holds for DateTimeInput and Select', async () => {
    render(
      <>
        <DateTimeInput label="D" />
        <Select label="S" options={[]} />
      </>,
    );
    await settle();
    act(() => screen.getByLabelText('D').focus());
    expect(quiet('D')).toBe(true);
    act(() => screen.getByRole('combobox', { name: 'S' }).focus());
    expect(screen.getByRole('combobox', { name: 'S' }).hasAttribute('data-quiet-focus')).toBe(true);
  });
});

describe('a filled controlled TextField takes a replacement, not an append (UMK-955)', () => {
  it('select-all then type leaves only the new text', async () => {
    const Controlled = () => {
      const [v, setV] = React.useState('Budi Santoso');
      return <TextField label="Nama" value={v} onChange={(e) => setV(e.target.value)} />;
    };
    render(<Controlled />);
    const input = screen.getByLabelText('Nama') as HTMLInputElement;
    await userEvent.click(input);
    await userEvent.keyboard('{Control>}a{/Control}Budi Santoso');
    expect(input.value).toBe('Budi Santoso');
    await userEvent.keyboard('{Control>}a{/Control}Siti');
    expect(input.value).toBe('Siti');
  });
});

describe('TextField valid draws ONE border colour (UMK-955)', () => {
  it('has border-default-success and no other border-colour class', () => {
    const box = render(<TextField label="Email" defaultValue="a@b.id" valid />).container.querySelector('div.border')!;
    expect(box.className).toContain('border-default-success');
    expect(box.className).not.toContain('border-default-error');
    expect(box.className).not.toContain('border-default-brand');
    expect(box.className).not.toContain('border-default-primary');
    expect(box.className).not.toContain('border-default-invert');
  });
});

describe('review fixes (UMK-955)', () => {
  it('a day-first DateTimeInput posts the ISO value under its name, not the display text', () => {
    const { container } = render(
      <form>
        <DateTimeInput label="Tanggal" name="tgl" defaultValue="2026-10-09" />
      </form>,
    );
    expect(screen.getByLabelText('Tanggal')).toHaveValue('09/10/2026');
    expect(screen.getByLabelText('Tanggal')).not.toHaveAttribute('name');
    expect(Object.fromEntries(new FormData(container.querySelector('form')!))).toEqual({ tgl: '2026-10-09' });
  });

  it('a searchable Select tells a caller-owned search the query is gone when it closes', async () => {
    const seen: string[] = [];
    render(<Select label="S" options={[{ value: 'a', label: 'Aaa' }]} showSearch onSearch={(q) => seen.push(q)} />);
    await userEvent.click(screen.getByRole('combobox', { name: 'S' }));
    await userEvent.type(screen.getByPlaceholderText(/cari/i), 'zz');
    await userEvent.keyboard('{Escape}');
    expect(seen.at(-1)).toBe('');
  });
});

describe('SelectionCard keeps its hidden input inside the card', () => {
  // The input is `sr-only` (position: absolute). Without a positioned label, it sits against a far ancestor,
  // and a click focuses it there: the browser scrolls that spot into view and the cards jump away (UMK-1884).
  it.each(['card', 'choice'] as const)('positions the %s label', (appearance) => {
    render(
      <SelectionCard
        label="Strategi"
        appearance={appearance}
        options={[
          { value: 'a', label: 'A' },
          { value: 'b', label: 'B' },
        ]}
        value={[]}
        onValueChange={() => {}}
      />,
    );
    for (const input of screen.getAllByRole('radio')) {
      expect(input.closest('label')?.className).toMatch(/(^|\s)relative(\s|$)/);
    }
  });
});
