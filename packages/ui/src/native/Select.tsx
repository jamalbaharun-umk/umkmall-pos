import React from 'react';
import { Pressable, ScrollView, View, type StyleProp, type ViewStyle } from 'react-native';
import { contract } from '../contract';
import { canCreateOption, filterSelectOptions } from '../shared/select';
import { Dialog } from './Dialog';
import { BOX_INK, BOX_SIZE, BOX_STATE, FIELD_STACK, SELECT_MESSAGE, SELECT_OPTION, SELECT_OPTION_ROW } from './field-styles';
import { FieldError, FieldLabel, useFieldIds } from './field-support';
import { Icon } from './Icon';
import { Spinner } from './Spinner';
import { Text } from './Text';
import { TextField } from './TextField';
import { resolveTextStyle, tokens } from './theme';

type Axes = typeof contract.Select.axes;
type Of<K extends keyof Axes> = Axes[K][number];

const SIZE = BOX_SIZE satisfies Record<Of<'size'>, unknown>;
const STATE = BOX_STATE satisfies Record<Of<'status'>, unknown>;

export interface SelectOption {
  label: string;
  value: string;
  disabled?: boolean;
  /**
   * Secondary text rendered muted after the label — a city's province, a plan's price.
   *
   * SEARCHED ALONGSIDE THE LABEL. A hint the user can see but not type is a trap: two cities
   * of the same name are told apart only by their province.
   */
  hint?: string;
}

export interface SelectProps {
  label?: React.ReactNode;
  /** The accessible name when there is no visible label. */
  accessibilityLabel?: string;
  options: readonly SelectOption[];
  value?: string;
  onValueChange?: (value: string) => void;
  size?: Of<'size'>;
  error?: string;
  disabled?: boolean;
  placeholder?: string;
  /** Type-to-search, as an affordance rather than a second component. */
  showSearch?: boolean;
  /**
   * Hand filtering to the caller. Passing it means "I own the filtering", and `options` is
   * then rendered verbatim — see `shared/select.ts` for why one flag decides both halves.
   */
  onSearch?: (query: string) => void;
  /** Replaces the list body while options are in flight. Never a blank box. */
  loading?: boolean;
  loadingMessage?: string;
  /**
   * Shown under a DISABLED field to say why — "pick a province first". Not an error: it is
   * not announced as an alert and it goes away when the field becomes usable.
   */
  disabledHint?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  /**
   * Offer `Tambah "<query>"` when a search matches nothing (UMK-1119) — same rule and same
   * contract as the web: the caller creates and returns the option (and adds it to `options`
   * itself), the component selects it; a rejection keeps the sheet open and selects nothing.
   */
  onCreate?: (query: string) => SelectOption | Promise<SelectOption>;
  createMinLength?: number;
  createLabel?: (query: string) => string;
  nativeID?: string;
  style?: StyleProp<ViewStyle>;
  /** Lifts the sheet clear of the home indicator; the host passes its safe-area inset. */
  bottomInset?: number;
}

/**
 * A value-bearing listbox.
 *
 * THE LIST IS A BOTTOM SHEET, not a popover, and it is the same call UMK-913 made for `Menu`:
 * native never builds a dropdown. The web's own reason for rendering its list in place — that
 * a portalled list runs into the standing conflict between the dialog guidance and the overlay
 * guard — has no counterpart here, because a sheet IS the platform's modal layer.
 *
 * THE TRIGGER IS THE FIELD BOX. A select and a text field are the same control on this
 * platform right up to the moment they open, so the trigger reads `BOX_SIZE` and `BOX_STATE`
 * rather than a table of its own. `filled` is DERIVED from `value`, never passed — a
 * caller-supplied status is a second source of truth for something the component can see.
 *
 * SEARCH IS A `TextField`, not a bare `TextInput`, so the sheet's one input carries the same
 * focus ring, ink and keyboard handling as every other field in the system.
 */
export const Select = ({
  label,
  accessibilityLabel,
  options,
  value,
  onValueChange,
  size = 'large',
  error,
  disabled,
  placeholder = 'Pilih',
  showSearch,
  onSearch,
  loading,
  loadingMessage = 'Memuat...',
  disabledHint,
  searchPlaceholder = 'Cari',
  emptyMessage = 'Tidak ada pilihan',
  onCreate,
  createMinLength,
  createLabel = (q) => `Tambah "${q}"`,
  nativeID,
  style,
  bottomInset,
}: SelectProps) => {
  const { fieldId, labelId, errorId } = useFieldIds(nativeID);
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');

  const [creating, setCreating] = React.useState(false);
  /* The label bridge: the caller's `options` may not hold the created row yet. */
  const [created, setCreated] = React.useState<SelectOption>();

  const selected = options.find((o) => o.value === value) ?? (created && created.value === value ? created : undefined);
  const status: Of<'status'> = disabled ? 'disabled' : error ? 'error' : selected ? 'filled' : 'default';
  const { role, ...box } = SIZE[size];
  /* Spread into the design-system `Text`, which applies the reader's size itself (UMK-1832): no scale here. */
  const text = resolveTextStyle(role, 'regular');

  const visible = filterSelectOptions(options, query, { showSearch, callerFilters: Boolean(onSearch) });
  const showCreate = canCreateOption(visible.length, query, {
    enabled: Boolean(onCreate),
    showSearch,
    loading,
    minLength: createMinLength,
  });

  /* Reset on close, never on open: a sheet reopened after a cancel should not still be
     showing the last search, and clearing on open would flash the full list first. */
  const close = () => {
    setOpen(false);
    setQuery('');
  };

  const create = async () => {
    if (!onCreate || creating) return;
    setCreating(true);
    try {
      const option = await onCreate(query.trim());
      setCreated(option);
      onValueChange?.(option.value);
      close();
    } catch {
      /* Swallowed on purpose: the sheet stays open and the caller that rejected surfaces it. */
    } finally {
      setCreating(false);
    }
  };

  return (
    <View style={[FIELD_STACK, style]}>
      {label !== undefined && <FieldLabel id={labelId} label={label} />}

      <Pressable
        accessibilityRole="combobox"
        accessibilityLabel={accessibilityLabel}
        accessibilityLabelledBy={labelId}
        accessibilityState={{ disabled: Boolean(disabled), expanded: open }}
        /* The error is announced by `FieldError`; the hint says why a disabled field is shut. */
        accessibilityHint={error ?? disabledHint}
        nativeID={fieldId}
        disabled={disabled}
        onPress={() => setOpen(true)}
        style={[
          box,
          STATE[status],
          { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: tokens.spacing['2xs'] },
        ]}
      >
        <Text
          variant={role}
          numberOfLines={1}
          style={{ ...text, flex: 1, color: disabled ? BOX_INK.disabled : selected ? BOX_INK.default : BOX_INK.placeholder }}
        >
          {selected?.label ?? placeholder}
        </Text>
        <Icon name="chevron-down" size="md" color={disabled ? 'disable' : 'secondary'} />
      </Pressable>

      {/* Not an error, and not announced as one — it goes away when the field becomes usable. */}
      {disabled && disabledHint !== undefined && (
        <Text variant="bodyMd" color="secondary">
          {disabledHint}
        </Text>
      )}

      <FieldError id={errorId} message={error} />

      <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : close())} label={accessibilityLabel} bottomInset={bottomInset}>
        {showSearch && (
          <TextField
            label={searchPlaceholder}
            placeholder={searchPlaceholder}
            leadingAdornment={<Icon name="search" size="md" color="secondary" />}
            value={query}
            onChangeText={(next) => {
              setQuery(next);
              onSearch?.(next);
            }}
          />
        )}

        {loading ? (
          <View style={SELECT_MESSAGE}>
            <Spinner size="md" label={loadingMessage} />
          </View>
        ) : showCreate ? (
          <Pressable
            accessibilityRole="menuitem"
            accessibilityState={{ disabled: creating }}
            disabled={creating}
            onPress={() => void create()}
            style={[SELECT_OPTION_ROW, SELECT_OPTION.active]}
          >
            <Text variant="paragraph" color="brand" style={{ flex: 1 }}>
              {createLabel(query.trim())}
            </Text>
          </Pressable>
        ) : visible.length === 0 ? (
          <View style={SELECT_MESSAGE}>
            <Text variant="bodyLg" color="secondary">
              {emptyMessage}
            </Text>
          </View>
        ) : (
          <ScrollView accessibilityRole="list" style={{ maxHeight: 320 }}>
            {visible.map((option) => {
              const isSelected = option.value === value;
              return (
                <Pressable
                  key={option.value}
                  accessibilityRole="menuitem"
                  accessibilityState={{ selected: isSelected, disabled: Boolean(option.disabled) }}
                  disabled={option.disabled}
                  onPress={() => {
                    onValueChange?.(option.value);
                    close();
                  }}
                  style={[SELECT_OPTION_ROW, isSelected ? SELECT_OPTION.active : SELECT_OPTION.default, option.disabled && { opacity: 0.5 }]}
                >
                  <Text variant="paragraph" color={isSelected ? 'brand' : 'primary'} style={{ flex: 1 }}>
                    {option.label}
                  </Text>
                  {option.hint !== undefined && (
                    <Text variant="bodyLg" color="secondary">
                      {option.hint}
                    </Text>
                  )}
                  {isSelected && <Icon name="check" size="md" color="brand" />}
                </Pressable>
              );
            })}
          </ScrollView>
        )}
      </Dialog>
    </View>
  );
};

Select.displayName = 'Select';
