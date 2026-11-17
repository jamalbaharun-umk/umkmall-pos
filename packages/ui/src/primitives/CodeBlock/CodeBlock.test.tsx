import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CodeBlock } from './CodeBlock';

const stubClipboard = (writeText: (t: string) => Promise<void>) =>
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

describe('CodeBlock onCopied', () => {
  afterEach(() => vi.restoreAllMocks());

  it('fires once after the write resolves', async () => {
    stubClipboard(vi.fn().mockResolvedValue(undefined));
    const onCopied = vi.fn();
    render(<CodeBlock onCopied={onCopied}>hello</CodeBlock>);
    fireEvent.click(screen.getByRole('button'));
    await waitFor(() => expect(screen.getByText('Tersalin')).toBeTruthy());
    expect(onCopied).toHaveBeenCalledTimes(1);
  });

  it('does not fire when the write rejects', async () => {
    stubClipboard(vi.fn().mockRejectedValue(new Error('denied')));
    const onCopied = vi.fn();
    render(<CodeBlock onCopied={onCopied}>hello</CodeBlock>);
    fireEvent.click(screen.getByRole('button'));
    await waitFor(() => expect(screen.getByText('Gagal menyalin')).toBeTruthy());
    expect(onCopied).not.toHaveBeenCalled();
  });

  it('does not fire when there is nothing to copy', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);
    const onCopied = vi.fn();
    render(<CodeBlock onCopied={onCopied}>{<b>x</b>}</CodeBlock>);
    fireEvent.click(screen.getByRole('button'));
    await waitFor(() => expect(screen.getByText('Gagal menyalin')).toBeTruthy());
    expect(writeText).not.toHaveBeenCalled();
    expect(onCopied).not.toHaveBeenCalled();
  });

  it('a throwing callback does not turn a successful copy into a failure', async () => {
    stubClipboard(vi.fn().mockResolvedValue(undefined));
    const onCopied = vi.fn(() => {
      throw new Error('boom');
    });
    // the rejection surfaces as an unhandled promise rejection from the click handler; swallow it here
    const swallow = () => {};
    process.on('unhandledRejection', swallow);
    render(<CodeBlock onCopied={onCopied}>hello</CodeBlock>);
    fireEvent.click(screen.getByRole('button'));
    await waitFor(() => expect(onCopied).toHaveBeenCalled());
    expect(screen.getByText('Tersalin')).toBeTruthy();
    process.off('unhandledRejection', swallow);
  });
});

describe('CodeBlock web-only props (UMK-1041)', () => {
  it('renders actions in the bar, beside the copy control', () => {
    render(<CodeBlock label="Diagram" actions={<button type="button">Unduh</button>}>x</CodeBlock>);
    expect(screen.getByRole('button', { name: 'Unduh' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /salin/i })).toBeTruthy();
  });

  it('copyable={false} removes the copy control', () => {
    render(<CodeBlock label="Diagram" copyable={false}>x</CodeBlock>);
    expect(screen.queryByRole('button', { name: /salin/i })).toBeNull();
  });

  it('diagram renders the body as a div, not code', () => {
    const { container, rerender } = render(<CodeBlock>x</CodeBlock>);
    expect(container.querySelector('code')).not.toBeNull();
    rerender(<CodeBlock diagram>x</CodeBlock>);
    expect(container.querySelector('code')).toBeNull();
  });

  it('defaults render the same tree as before: one copy button, a code body, no actions slot', () => {
    const { container } = render(<CodeBlock label="js">x</CodeBlock>);
    expect(container.querySelectorAll('button')).toHaveLength(1);
    expect(container.querySelector('code')?.textContent).toBe('x');
    expect(container.querySelector('.ml-auto')).toBeNull();
  });

  it('applies to the a2ui appearance too', () => {
    const { container } = render(
      <CodeBlock appearance="a2ui" copyable={false} diagram actions={<i>a</i>}>x</CodeBlock>,
    );
    expect(container.querySelector('code')).toBeNull();
    expect(container.querySelectorAll('button')).toHaveLength(0);
    expect(container.querySelector('i')).not.toBeNull();
  });
});
