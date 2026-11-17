import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ChatAttachment } from './ChatAttachment';

describe('ChatAttachment', () => {
  it('draws the compressing overlay with the host-supplied words', () => {
    cleanup();
    const { container } = render(
      <ChatAttachment name="a.jpg" previewUrl="blob:x" status="compressing" statusLabel="Menyiapkan…" />,
    );
    expect(screen.getByText('Menyiapkan…')).toBeTruthy();
    expect(container.querySelector('[data-status="compressing"]')).toBeTruthy();
  });

  it('makes the image a button only when onPreview is given, and fires it', () => {
    cleanup();
    const { rerender } = render(<ChatAttachment name="a.jpg" previewUrl="blob:x" />);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    const onPreview = vi.fn();
    rerender(<ChatAttachment name="a.jpg" previewUrl="blob:x" onPreview={onPreview} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onPreview).toHaveBeenCalledOnce();
  });

  it('prints the caption under the image, and the large box is 96px', () => {
    cleanup();
    const { container } = render(<ChatAttachment name="a.jpg" previewUrl="blob:x" caption="a.jpg" size="large" />);
    expect(screen.getByText('a.jpg')).toBeTruthy();
    expect(container.querySelector('.h-24.w-24')).toBeTruthy();
  });

  it('keeps the caption outside the box the status veil covers', () => {
    cleanup();
    const { container } = render(
      <ChatAttachment name="a.jpg" previewUrl="blob:x" caption="a.jpg" status="uploading" />,
    );
    const veil = container.querySelector('[data-status="uploading"]')!;
    const anchor = veil.parentElement!;
    expect(anchor.textContent).not.toContain('a.jpg');
    expect(screen.getByText('a.jpg').closest('[data-attachment-name]')).toBe(anchor.parentElement);
  });

  it('keeps the default box at 80px', () => {
    cleanup();
    const { container } = render(<ChatAttachment name="a.jpg" previewUrl="blob:x" />);
    expect(container.querySelector('.h-20.w-20')).toBeTruthy();
  });

  it('labels the remove control "Hapus {name}"', () => {
    cleanup();
    render(<ChatAttachment name="a.jpg" previewUrl="blob:x" onRemove={() => {}} />);
    expect(screen.getByRole('button', { name: 'Hapus a.jpg' })).toBeTruthy();
  });

  it('draws a non-image as the square tile: icon, uppercase extension, caption, remove, veil', () => {
    cleanup();
    const { container } = render(
      <ChatAttachment
        variant="tile"
        size="large"
        name="brief.pdf"
        icon="file-pdf"
        caption="brief.pdf"
        status="compressing"
        statusLabel="Menyiapkan…"
        onRemove={() => {}}
      />,
    );
    expect(container.querySelector('.h-24.w-24.border-2')).toBeTruthy();
    expect(container.querySelector('svg')).toBeTruthy();
    expect(screen.getByText('pdf')).toBeTruthy();
    expect(container.querySelector('.uppercase')?.textContent).toBe('pdf');
    expect(screen.getAllByText('brief.pdf')).toHaveLength(1);
    expect(screen.getByText('Menyiapkan…')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Hapus brief.pdf' })).toBeTruthy();
  });
});
