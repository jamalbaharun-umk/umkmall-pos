import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Badge } from './Badge';
import { Button } from './Button';
import { Text } from './Text';
import { TextField } from './TextField';

afterEach(cleanup);

const words = (el: HTMLElement) => el.className.split(/\s+/);

describe('Text color="muted" (UMK-1548 U11)', () => {
  it('renders the muted text token, not secondary', () => {
    render(<Text color="muted">m</Text>);
    expect(words(screen.getByText('m'))).toContain('text-default-muted');
    expect(words(screen.getByText('m'))).not.toContain('text-default-secondary');
  });
});

describe('TextField size="compact" (UMK-1548 U11)', () => {
  it('draws 14px, 10/12 padding and r12 from existing tokens', () => {
    render(<TextField label="Pesan" size="compact" />);
    const box = screen.getByLabelText('Pesan').parentElement as HTMLElement;
    for (const c of ['text-ds-paragraph-mobile', 'py-ds-xs', 'px-ds-sm', 'rounded-ds-lg']) {
      expect(words(box), c).toContain(c);
    }
  });

  it('owns its caption: 12px, muted, a 4px gap to the box', () => {
    render(<TextField label="Pesan" size="compact" />);
    const label = screen.getByText('Pesan');
    expect(words(label)).toContain('text-ds-body-lg-mobile');
    expect(words(label)).toContain('text-default-muted');
    expect(words(label)).not.toContain('text-default-primary');
    expect(words(label.parentElement as HTMLElement)).toContain('gap-ds-4xs');
  });

  it('gives multiline the same box', () => {
    render(<TextField label="Isi" size="compact" multiline />);
    const box = screen.getByLabelText('Isi').parentElement as HTMLElement;
    expect(words(box)).toContain('rounded-ds-lg');
    expect(words(box)).toContain('px-ds-sm');
  });

  it('rests on the n40 border, and only at rest', () => {
    render(
      <>
        <TextField label="A" size="compact" />
        <TextField label="B" size="compact" error="x" />
        <TextField label="C" size="small" />
      </>,
    );
    const box = (l: string) => words(screen.getByLabelText(l).parentElement as HTMLElement);
    expect(box('A')).toContain('border-default-invert');
    expect(box('A')).not.toContain('border-default-primary');
    expect(box('B')).toContain('border-default-error');
    expect(box('B')).not.toContain('border-default-invert');
    expect(box('C')).not.toContain('border-default-invert');
  });

  it('is 44 on one line (a floor) and a 24 line on several; other sizes have neither', () => {
    render(
      <>
        <TextField label="One" size="compact" />
        <TextField label="Many" size="compact" multiline />
        <TextField label="Small" size="small" />
      </>,
    );
    const box = (l: string) => words(screen.getByLabelText(l).parentElement as HTMLElement);
    expect(box('One')).toContain('min-h-11');
    expect(box('One')).not.toContain('leading-6');
    expect(box('Many')).toContain('leading-6');
    expect(box('Many')).not.toContain('min-h-11');
    expect(box('Small')).not.toContain('min-h-11');
    expect(box('Small')).not.toContain('leading-6');
  });

  it('leaves the other sizes alone', () => {
    render(<TextField label="Kecil" size="small" />);
    const label = screen.getByText('Kecil');
    expect(words(label)).toContain('text-default-primary');
    expect(words(label.parentElement as HTMLElement)).toContain('gap-ds-3xs');
    expect(words(screen.getByLabelText('Kecil').parentElement as HTMLElement)).toContain('rounded-ds-md');
  });
});

describe('Button size="compact" (UMK-1548 U11)', () => {
  it('is 12px semibold with 6/12 padding, and bold only elsewhere', () => {
    render(
      <>
        <Button size="compact">c</Button>
        <Button size="small">s</Button>
      </>,
    );
    const c = words(screen.getByText('c'));
    for (const w of ['text-ds-body-lg-mobile', 'font-semibold', 'py-ds-3xs', 'px-ds-sm']) expect(c, w).toContain(w);
    expect(c).not.toContain('font-bold');
    expect(words(screen.getByText('s'))).toContain('font-bold');
  });
});

describe('Badge compact sizes (UMK-1548)', () => {
  it('compact is 14px bold with 6/10 padding', () => {
    render(<Badge size="compact">c</Badge>);
    const c = words(screen.getByText('c'));
    for (const w of ['px-ds-xs', 'py-ds-3xs', 'text-ds-paragraph-mobile', 'font-bold']) expect(c, w).toContain(w);
    expect(c).not.toContain('font-medium');
  });

  it('compactTight is 14px bold with 4/12 padding', () => {
    render(<Badge size="compactTight">t</Badge>);
    const c = words(screen.getByText('t'));
    for (const w of ['px-ds-sm', 'py-ds-4xs', 'text-ds-paragraph-mobile', 'font-bold']) expect(c, w).toContain(w);
    expect(c).not.toContain('font-medium');
  });

  it('every existing size stays medium weight', () => {
    render(<Badge size="medium">m</Badge>);
    expect(words(screen.getByText('m'))).toContain('font-medium');
  });
});
