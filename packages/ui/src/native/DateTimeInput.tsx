import React from 'react';
import { Platform, Pressable, View, type StyleProp, type ViewStyle } from 'react-native';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { contract } from '../contract';
import { formatDisplayDate, formatIsoDate, formatIsoTime, isDateInRange, parseIsoDate, parseIsoTime } from '../shared/date-input';
import { BOX_INK, BOX_SIZE, BOX_STATE, FIELD_STACK } from './field-styles';
import { FieldError, FieldLabel, labelText, resolveLabelling, useFieldIds, type LabelledProps } from './field-support';
import { Icon } from './Icon';
import { Text } from './Text';
import { resolveTextStyle, tokens } from './theme';

type Axes = typeof contract.DateTimeInput.axes;
type Of<K extends keyof Axes> = Axes[K][number];

/** Re-tied to THIS component's own size axis, so a size added to the entry reddens the table. */
const SIZE = BOX_SIZE satisfies Record<Of<'size'>, unknown>;

/**
 * The web sibling's props, in the native spelling. `value`/`defaultValue`/`onValueChange` speak
 * the SAME `YYYY-MM-DD` strings the web's do, through the same `shared/date-input.ts` — the two
 * screens that use this send the value into a server-side template, byte for byte what the web's
 * `<input type="date">` sends.
 */
export type DateTimeInputProps = LabelledProps & {
  size?: Of<'size'>;
  /** The message itself, not a flag. The region is always mounted — see `FieldError`. */
  error?: string;
  disabled?: boolean;
  required?: boolean;
  /** `YYYY-MM-DD`, or `''` for empty; `HH:mm` with `timeOnly`. */
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  /** `YYYY-MM-DD` bounds, inclusive — the web's `min`/`max`. They do not apply with `timeOnly`, as on the web. */
  min?: string;
  max?: string;
  /**
   * UMK-1358, the web's UMK-1383. A time-of-day field: the platform TIME picker (a wheel on iOS, the system dialog
   * on Android, both on a 24-hour clock), value `HH:mm`. No calendar, no `min`/`max`.
   */
  timeOnly?: boolean;
  /** Shown while empty ("Pilih tanggal", or "Pilih waktu" with `timeOnly`). The web's box reads `YYYY-MM-DD` because it is TYPED into; this one is not. */
  placeholder?: string;
  nativeID?: string;
  style?: StyleProp<ViewStyle>;
};

/**
 * The picker opens on the chosen day, or on TODAY clamped into range: an empty field whose
 * `min` is next month should not open on a month where every day is refused.
 */
const openingDate = (selected: Date | undefined, min?: string, max?: string): Date => {
  if (selected) return selected;
  const today = new Date();
  const midnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const lower = min ? parseIsoDate(min) : undefined;
  const upper = max ? parseIsoDate(max) : undefined;
  if (lower && midnight < lower) return lower;
  if (upper && midnight > upper) return upper;
  return midnight;
};

/**
 * The web `DateTimeInput`, on the PLATFORM picker (UMK-1128).
 *
 * The web is a text box you can type into plus a popover calendar. Neither travels: a phone has
 * no reason to type a date, and a hand-drawn calendar would be a worse copy of the one the OS
 * already ships and every user already knows. So the box is a BUTTON that opens the platform's
 * own picker — the decision the contract entry recorded when it was `absent`, now built:
 *
 * - **Android**: the system date dialog (`DateTimePickerAndroid.open`). Its OK/Cancel are the
 *   system's, in the phone's language. Cancel changes nothing.
 * - **iOS**: the system INLINE calendar, drawn under the box when the box is pressed and closed
 *   again by picking a day or pressing the box. Inline rather than in a sheet on purpose: both
 *   screens that use this already live INSIDE a bottom sheet, and a sheet stacked on a sheet is
 *   the shape native onboarding and the template form already refuse for `Select`.
 *
 * WHAT IS THE SAME AS THE WEB: the size axis, the label (visible, or an accessible name only),
 * the required mark, the error region, `disabled`, the `min`/`max` bounds enforced on the value
 * path as well as by the picker, the clear control ("Kosongkan tanggal") and — the part that
 * matters most — the value, which is the web's `YYYY-MM-DD` string, `''` when cleared.
 *
 * WHAT THE READER SEES is `DD/MM/YYYY`, the day-first date an Indonesian browser shows in the
 * same field; see `formatDisplayDate`.
 *
 * NO PRESSED OR FOCUS TREATMENT, the same call `Select` makes: the box is a trigger, and its
 * feedback is the picker opening, not a style.
 */
export const DateTimeInput = ({
  label,
  accessibilityLabel,
  size = 'large',
  error,
  disabled,
  required,
  value,
  defaultValue = '',
  onValueChange,
  min,
  max,
  timeOnly = false,
  placeholder = timeOnly ? 'Pilih waktu' : 'Pilih tanggal',
  nativeID,
  style,
}: DateTimeInputProps) => {
  const { fieldId, labelId, errorId } = useFieldIds(nativeID);
  const labelling = resolveLabelling(label, accessibilityLabel);
  /* The picker's mode, and the one rule that changes with it: how a string becomes a `Date` and back. */
  const mode = timeOnly ? 'time' : 'date';
  const parse = timeOnly ? parseIsoTime : parseIsoDate;
  /* Controlled when the owner passes `value`; otherwise the last accepted value is ours. */
  const [committed, setCommitted] = React.useState(defaultValue);
  const accepted = value ?? committed;
  const selected = parse(accepted);
  const shown = (date: Date) => (timeOnly ? formatIsoTime(date) : formatDisplayDate(date));
  const [open, setOpen] = React.useState(false);

  /* A lock closes an open calendar — a disabled field must not keep accepting days. On iOS the
     calendar is React state; on Android it is a system dialog outside React, so it is dismissed
     explicitly (a form that disables its fields on submit would otherwise leave it open). */
  React.useEffect(() => {
    if (!disabled) return;
    setOpen(false);
    if (Platform.OS === 'android') DateTimePickerAndroid.dismiss(mode);
  }, [disabled, mode]);

  /* READ THROUGH A REF, not the render's `disabled`: the Android dialog keeps the `onValueChange`
     it was opened with, so a closure check would still see the field as enabled. */
  const disabledRef = React.useRef(disabled);
  disabledRef.current = disabled;

  const commit = (next: string) => {
    /* And refused here too: a dialog can still report a day tapped in the instant before the
       dismiss lands, and a disabled field must not take it. */
    if (disabledRef.current) return;
    const parsed = next === '' ? undefined : parse(next);
    /* Out of range or unparseable is REFUSED, never stored — the web's rule, on the value path
       rather than only in the picker, which the platforms do not all enforce identically.
       A time has no range (the web's `timeOnly` has none either): only its shape is checked. */
    if (next !== '' && !(parsed && (timeOnly || isDateInRange(parsed, min, max)))) return;
    if (value === undefined) setCommitted(next);
    onValueChange?.(next);
  };

  const pick = (date: Date | undefined) => {
    if (date) commit(timeOnly ? formatIsoTime(date) : formatIsoDate(date));
  };

  const lower = !timeOnly && min ? parseIsoDate(min) : undefined;
  const upper = !timeOnly && max ? parseIsoDate(max) : undefined;
  /* The time wheel opens on the chosen time, or on now. */
  const opening = timeOnly ? (selected ?? new Date()) : openingDate(selected, min, max);

  const openPicker = () => {
    if (disabled) return;
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        mode,
        value: opening,
        ...(timeOnly ? { is24Hour: true } : { minimumDate: lower, maximumDate: upper }),
        onValueChange: (_event, date) => pick(date),
      });
      return;
    }
    setOpen((was) => !was);
  };

  const state = disabled ? 'disabled' : error ? 'error' : selected ? 'filled' : 'default';
  const { role, ...box } = SIZE[size];
  /* Spread into the design-system `Text`, which applies the reader's size itself (UMK-1832): no scale here. */
  const text = resolveTextStyle(role, 'regular');
  const name = labelling.accessibilityLabel ?? labelText(label);

  return (
    <View style={[FIELD_STACK, style]}>
      {labelling.visible !== undefined && <FieldLabel id={labelId} label={labelling.visible} required={required} />}

      <View
        style={[
          {
            flexDirection: 'row',
            alignItems: 'center',
            borderWidth: tokens.borderWidth.sm,
            gap: box.gap,
            paddingHorizontal: box.paddingHorizontal,
            paddingVertical: box.paddingVertical,
            borderRadius: box.borderRadius,
          },
          BOX_STATE[state],
        ]}
      >
        <Pressable
          nativeID={fieldId}
          accessibilityRole="button"
          accessibilityLabel={name}
          accessibilityLabelledBy={labelling.visible !== undefined ? labelId : undefined}
          /* The value is read out as what the reader sees; the error is announced by `FieldError`. */
          accessibilityValue={{ text: selected ? shown(selected) : placeholder }}
          accessibilityHint={error}
          accessibilityState={{ disabled: Boolean(disabled), expanded: Platform.OS === 'ios' ? open : undefined }}
          disabled={disabled}
          onPress={openPicker}
          style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: box.gap }}
          testID={nativeID ? `${nativeID}-trigger` : undefined}
        >
          <Text
            variant={role}
            numberOfLines={1}
            style={{ ...text, flex: 1, color: disabled ? BOX_INK.disabled : selected ? BOX_INK.default : BOX_INK.placeholder }}
          >
            {selected ? shown(selected) : placeholder}
          </Text>
          <Icon name={timeOnly ? 'clock' : 'calendar'} size="md" color={disabled ? 'disable' : 'secondary'} />
        </Pressable>

        {accepted !== '' && !disabled && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={timeOnly ? 'Kosongkan waktu' : 'Kosongkan tanggal'}
            onPress={() => {
              setOpen(false);
              commit('');
            }}
            hitSlop={tokens.spacing['2xs']}
          >
            <Icon name="x" size="sm" color="secondary" />
          </Pressable>
        )}
      </View>

      {open && Platform.OS === 'ios' && !disabled ? (
        <DateTimePicker
          testID={nativeID ? `${nativeID}-picker` : undefined}
          mode={mode}
          display={timeOnly ? 'spinner' : 'inline'}
          locale="id-ID"
          accentColor={tokens.surface.default.brand}
          value={opening}
          minimumDate={lower}
          maximumDate={upper}
          {...(timeOnly ? { is24Hour: true } : {})}
          onValueChange={(_event, date) => {
            pick(date);
            /* A day is one tap; a wheel turns many times, so only the box closes it. */
            if (!timeOnly) setOpen(false);
          }}
        />
      ) : null}

      <FieldError id={errorId} message={error} />
    </View>
  );
};

DateTimeInput.displayName = 'DateTimeInput';
