'use client';

import React from 'react';
import { formatFileSize } from '../../utils';
import { contract } from '../../contract';
import { Icon, type IconName } from '../Icon';
import {
  COMPOSER_ATTACHMENT,
  COMPOSER_CAPTION,
  COMPOSER_CAPTION_WIDTH,
  COMPOSER_CLOSE,
  COMPOSER_FILE_BADGE,
  COMPOSER_FILE_CHIP,
  COMPOSER_FILE_META,
  COMPOSER_FILE_NAME,
  COMPOSER_FILE_TILE,
  COMPOSER_FILE_TILE_EXT,
  COMPOSER_FILE_TEXT,
  COMPOSER_PREVIEW,
  COMPOSER_PREVIEW_BUTTON,
  COMPOSER_PREVIEW_IMAGE,
  COMPOSER_PREVIEW_SIZE,
  COMPOSER_STATUS,
  COMPOSER_STATUS_LABEL,
} from '../composer-classes';

type Axes = typeof contract.ChatAttachment.axes;
export type ChatAttachmentVariant = Axes['variant'][number];

/** Per-attachment upload state. The host owns it; the component only places its treatment. */
export type ChatAttachmentStatus = 'idle' | 'compressing' | 'uploading' | 'error' | 'done';
export type ChatAttachmentSize = Axes['size'][number];

export interface ChatAttachmentProps {
  /** Which published treatment this attachment takes. Figma's `State` on the bar. */
  variant?: ChatAttachmentVariant;
  /** What the user sees. For a file this is the name; for an image it is also the alt text. */
  name: string;
  /**
   * The image treatment's source. A LOCAL blob or data URL is expected and must work — which is
   * why this renders through a plain element and NOT the library `Image` (see the note below).
   */
  previewUrl?: string;
  /** The file treatment's caption — "XLSX", "PDF", or whatever the host decides to call it. */
  typeLabel?: string;
  /** The badge's letters. Falls back to the extension in `name`. */
  extension?: string;
  /** Rendered only when `showSize` is on, in the same shape a sent message's card uses. */
  sizeBytes?: number;
  showSize?: boolean;
  status?: ChatAttachmentStatus;
  /** The `tile` treatment's glyph. Falls back to the generic file glyph. */
  icon?: IconName;
  /** Words under the status glyph (not `done`). The host's copy, in its language. */
  statusLabel?: string;
  /** The image treatment's box: the published 80px, or the 96px `large`. */
  size?: ChatAttachmentSize;
  /** Makes the image a button, so a host can open it in a lightbox. Image treatment only. */
  onPreview?: () => void;
  /** A filename under the image treatment. The file chip already prints its own name. */
  caption?: string;
  onRemove?: () => void;
  /**
   * Anything the host must place INSIDE this attachment — a retry panel, a progress readout, a
   * per-file error.
   *
   * CHILDREN RATHER THAN A RENDER PROP, now that the attachment is its own component. The drawer
   * used to take a `renderOverlay` callback because it owned the whole list and a host had no
   * handle on an individual chip; with the chip exported, the host holds it directly and the
   * ordinary composition mechanism does the job. The reason it cannot be a sibling is unchanged:
   * these overlays are positioned against THIS box, and a host cannot place them from outside it.
   */
  children?: React.ReactNode;
  className?: string;
}

const extensionOf = (name: string, explicit?: string): string =>
  explicit ?? (name.includes('.') ? (name.split('.').pop() as string) : '?');

/**
 * One attachment in the composer's drawer.
 *
 * ITS OWN COMPONENT, not a shape the drawer knows about. A drawer is a container; what it holds is
 * the caller's business, and an attachment is useful on its own — a sent-message card and a
 * file-picker list want the same chip without wanting a drawer around it.
 *
 * THE PREVIEW IS A PLAIN ELEMENT, NEVER THE LIBRARY `Image`. That component refuses any source
 * which is not remote https — an SSRF control that is right there and would blank every local blob
 * and base64 preview here, since a composer's previews are all local by definition. It is the trap
 * `Lightbox` already hit, and the guard pins the blob case directly.
 */
export const ChatAttachment = React.forwardRef<HTMLDivElement, ChatAttachmentProps>(
  function ChatAttachment(
    {
      variant = 'image',
      name,
      previewUrl,
      typeLabel,
      extension,
      sizeBytes,
      showSize = false,
      status = 'idle',
      icon,
      statusLabel,
      size = 'default',
      onPreview,
      caption,
      onRemove,
      children,
      className,
    },
    ref,
  ) {
    return (
      <div ref={ref} className={className ? `shrink-0 ${className}` : 'shrink-0'} data-attachment-name={name}>
        {/* The anchor its overlays position against: the tile, NOT the caption under it, or the
            upload veil would dim the filename too. */}
        <div className={COMPOSER_ATTACHMENT}>
          {variant === 'tile' ? (
            <div className={`${COMPOSER_FILE_TILE} ${COMPOSER_PREVIEW_SIZE[size]}`}>
              <Icon name={icon ?? 'file-generic'} className="mb-1 h-10 w-10" />
              <span className={COMPOSER_FILE_TILE_EXT}>{extensionOf(name, extension)}</span>
            </div>
          ) : variant === 'file' ? (
            <div className={COMPOSER_FILE_CHIP}>
              <span className={COMPOSER_FILE_BADGE} aria-hidden>
                {extensionOf(name, extension).slice(0, 4)}
              </span>
              <span className={COMPOSER_FILE_TEXT}>
                <span className={COMPOSER_FILE_NAME}>{name}</span>
                <span className={COMPOSER_FILE_META}>
                  {[
                    typeLabel ?? extensionOf(name, extension),
                    showSize && sizeBytes !== undefined ? formatFileSize(sizeBytes) : null,
                  ]
                    .filter(Boolean)
                    .join(' • ')}
                </span>
              </span>
            </div>
          ) : (
            (() => {
              const preview = (
                <div className={`${COMPOSER_PREVIEW} ${COMPOSER_PREVIEW_SIZE[size]}`}>
                  {previewUrl && (
                    /* A PLAIN ELEMENT, DELIBERATELY — see the component docblock. No Next-specific lint
                       directive here: this package has no Next plugin, and a disable for a rule ESLint
                       cannot resolve is itself an error. */
                    <img src={previewUrl} alt={name} className={COMPOSER_PREVIEW_IMAGE} />
                  )}
                </div>
              );
              return onPreview ? (
                <button type="button" className={COMPOSER_PREVIEW_BUTTON} onClick={onPreview}>
                  {preview}
                </button>
              ) : (
                preview
              );
            })()
          )}

          {status !== 'idle' && (
            <span className={COMPOSER_STATUS[status]} data-status={status}>
              <Icon
                name={status === 'done' ? 'check' : status === 'error' ? 'alert-triangle' : 'loader'}
                className={status === 'compressing' || status === 'uploading' ? 'h-5 w-5 animate-spin' : 'h-4 w-4'}
              />
              {statusLabel && status !== 'done' && (
                <span className={COMPOSER_STATUS_LABEL}>{statusLabel}</span>
              )}
            </span>
          )}

          {children}

          {onRemove && (
            <button
              type="button"
              className={COMPOSER_CLOSE}
              aria-label={`Hapus ${name}`}
              onClick={onRemove}
            >
              <Icon name="x" className="h-full w-full" />
            </button>
          )}

          {/* `Show Size` on the image treatment, where there is no meta row to carry it. */}
          {showSize && variant !== 'file' && sizeBytes !== undefined && (
            <span className={COMPOSER_FILE_META}>{formatFileSize(sizeBytes)}</span>
          )}
        </div>

        {caption && variant !== 'file' && (
          <div className={`${COMPOSER_CAPTION} ${COMPOSER_CAPTION_WIDTH[size]}`} title={caption}>
            {caption}
          </div>
        )}
      </div>
    );
  },
);
