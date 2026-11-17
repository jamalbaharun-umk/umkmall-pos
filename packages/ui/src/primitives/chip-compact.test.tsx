import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Chip } from './Chip';

afterEach(cleanup);

describe('Chip size compact (UMK-1548 U10)', () => {
  it('is regular idle and semibold selected, never bold', () => {
    render(
      <>
        <Chip size="compact" state="default">idle</Chip>
        <Chip size="compact" state="active">picked</Chip>
      </>,
    );
    const idle = screen.getByText('idle').className;
    const picked = screen.getByText('picked').className;
    expect(idle).toContain('font-normal');
    expect(idle).not.toContain('font-bold');
    expect(picked).toContain('font-semibold');
    expect(picked).not.toContain('font-bold');
  });

  it('leaves every other size bold', () => {
    render(<Chip size="medium" state="active">x</Chip>);
    expect(screen.getByText('x').className).toContain('font-bold');
  });

  it('draws the idle border in n40 and leaves the selected border brand', () => {
    render(
      <>
        <Chip size="compact" state="default">idle</Chip>
        <Chip size="compact" state="active">picked</Chip>
        <Chip size="medium" state="default">other</Chip>
      </>,
    );
    const w = (t: string) => screen.getByText(t).className.split(/\s+/);
    expect(w('idle')).toContain('border-default-invert');
    expect(w('idle')).not.toContain('border-default-primary');
    expect(w('picked')).toContain('border-default-brand');
    expect(w('picked')).not.toContain('border-default-invert');
    expect(w('other')).toContain('border-default-primary');
  });
});
