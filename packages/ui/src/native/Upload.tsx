import React from 'react';
import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';
import { contract } from '../contract';
import { FIELD_STACK, UPLOAD_BASE, UPLOAD_BORDER, UPLOAD_SIZE, UPLOAD_STATUS } from './field-styles';
import { FieldError, FieldLabel, RequiredMark, useFieldIds } from './field-support';
import { Spinner } from './Spinner';
import { Text } from './Text';

type Axes = typeof contract.Upload.axes;
type Of<K extends keyof Axes> = Axes[K][number];

const SIZE = UPLOAD_SIZE satisfies Record<Of<'size'>, unknown>;
const STATUS = UPLOAD_STATUS satisfies Record<Of<'status'>, unknown>;
const BORDER = UPLOAD_BORDER satisfies Record<Of<'border'>, unknown>;

export interface UploadProps {
  label?: React.ReactNode;
  accessibilityLabel?: string;
  size?: Of<'size'>;
  error?: string;
  disabled?: boolean;
  required?: boolean;
  /**
   * THE PICKER IS THE HOST'S, and that is the whole reason this replaces the web's
   * `onFilesChange`.
   *
   * `packages/ui` carries no Expo dependency, so it cannot open `expo-image-picker` or
   * `expo-document-picker` — and the web's signature is `(files: File[])`, where `File` is a
   * DOM type that does not exist here. There is nothing to port; the capability belongs to the
   * app, exactly as `CodeBlock` takes its clipboard and the web `Menu` takes a `linkComponent`.
   *
   * WITHOUT IT THE ZONE IS INERT — not pressable, and not announced as a button. A tappable
   * drop zone that opens nothing is worse than a flat one.
   *
   * `accept` and `multiple` do not appear for the same reason: those constrain a file input
   * this component does not own. The host's picker takes them.
   */
  onBrowse?: () => void;
  /** Whether a file has been chosen. Presentation only — this component holds no file state. */
  filled?: boolean;
  /**
   * An upload is in flight. GIVEN, never derived — this component reads no files and starts no
   * requests. It refuses the picker while set, exactly as `disabled` does: the caller owns file
   * handling, so one mid-upload has no safe way to take a second file without its own queueing.
   */
  busy?: boolean;
  /**
   * What was chosen, rendered in place of the placeholder and the glyph. A SLOT, not a status:
   * the component creates no URI and holds no file, so the caller supplies the element.
   * Normally paired with `filled`.
   */
  preview?: React.ReactNode;
  /** The instruction inside the zone, and an optional glyph beside it. */
  children?: React.ReactNode;
  icon?: React.ReactNode;
  helperText?: React.ReactNode;
  browseLabel?: React.ReactNode;
  border?: Of<'border'>;
  nativeID?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * A file-drop zone, minus the drop.
 *
 * THERE IS NO DRAG-AND-DROP HERE and there is nothing to record as missing: a phone has no
 * pointer to drag with and no file system to drag from. The web component's drag-over state,
 * its `dragCounter` and its `onDrop` are answers to a problem this platform does not have. What
 * survives is the zone, its five statuses and the browse affordance — which on the web is the
 * fallback and here is the whole interaction.
 *
 * `busy` REFUSES THE PRESS as well as dimming the zone, matching the web. A spinner that still
 * opens a picker invites the second file the caller has no queue for.
 */
export const Upload = ({
  label,
  accessibilityLabel,
  size = 'large',
  error,
  disabled,
  required,
  onBrowse,
  filled,
  busy,
  preview,
  children,
  icon,
  helperText,
  browseLabel = 'Pilih berkas',
  border = 'dashed',
  nativeID,
  style,
}: UploadProps) => {
  const { fieldId, labelId, errorId } = useFieldIds(nativeID);
  /* Same order as the web: `disabled` outranks `busy` outranks `error` outranks `filled`. */
  const status: Of<'status'> = disabled ? 'disabled' : busy ? 'busy' : error ? 'error' : filled ? 'filled' : 'default';
  const { ink, ...zone } = STATUS[status];
  const { role, ...box } = SIZE[size];
  const inert = disabled || busy || onBrowse === undefined;

  return (
    <View style={[FIELD_STACK, style]}>
      {label !== undefined && (
        <View style={{ flexDirection: 'row' }}>
          <FieldLabel id={labelId} label={label} />
          {required && <RequiredMark />}
        </View>
      )}

      <Pressable
        accessibilityRole={inert ? undefined : 'button'}
        accessibilityLabel={accessibilityLabel}
        accessibilityLabelledBy={labelId}
        accessibilityState={{ disabled: Boolean(disabled), busy: Boolean(busy) }}
        accessibilityHint={error}
        nativeID={fieldId}
        disabled={inert}
        onPress={onBrowse}
        style={[UPLOAD_BASE, box, BORDER[border], zone]}
      >
        {preview ?? (
          <>
            {/* NO DEFAULT GLYPH. The web's `icon` is a caller-supplied slot and it renders
                nothing when absent — an upload glyph invented here would be an affordance the
                other platform does not draw. `busy` replaces whatever the slot holds. */}
            {busy ? <Spinner size="md" label="" /> : icon}
            {typeof children === 'string' ? (
              <Text variant={role} color={ink}>
                {children}
              </Text>
            ) : (
              children
            )}
            {onBrowse !== undefined && typeof browseLabel === 'string' && (
              <Text variant={role} weight="bold" color={disabled ? 'disable' : 'brand'}>
                {browseLabel}
              </Text>
            )}
          </>
        )}
      </Pressable>

      {helperText !== undefined &&
        (typeof helperText === 'string' ? (
          <Text variant="bodyMd" color="secondary">
            {helperText}
          </Text>
        ) : (
          helperText
        ))}

      <FieldError id={errorId} message={error} />
    </View>
  );
};

Upload.displayName = 'Upload';
