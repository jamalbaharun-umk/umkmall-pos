import { View, type StyleProp, type ViewStyle } from 'react-native';
import { contract } from '../contract';
import { pageItems } from '../shared/page-items';
import { Icon } from './Icon';
import { PressableScale } from './motion';
import { Select } from './Select';
import { Text } from './Text';
import { measure, tokens, type TextRole } from './theme';

type Axes = typeof contract.Pagination.axes;
type Of<K extends keyof Axes> = Axes[K][number];

export type PaginationSize = Of<'size'>;

/**
 * Figma `Size`, as the web draws it: 36 pt squares at radius 8, or 32 pt at radius 6, each with the
 * number one type step apart. Geometry and type both live here — native has no `density` axis
 * (see the contract's native record).
 */
const SQUARE = {
  large: { width: measure['2-25'], height: measure['2-25'], borderRadius: tokens.radius.md, role: 'bodyLg' as TextRole },
  small: { width: measure['2'], height: measure['2'], borderRadius: tokens.radius.sm, role: 'bodyMd' as TextRole },
} satisfies Record<PaginationSize, unknown>;

/** The page-size field's width: Figma's 120 pt box, off the measurement ladder. */
const PAGE_SIZE_WIDTH = measure['7-5'];

/** The sizes a reader can pick when the host names none (UMK-1601's "Item per page": 10/20/50). */
const DEFAULT_PAGE_SIZES: readonly number[] = [10, 20, 50];

export interface PaginationProps {
  /** The current page, 1-based. Clamped into `1..pageCount`. */
  page: number;
  /** How many pages exist. `0` renders as one empty page rather than a negative range. */
  pageCount: number;
  onPageChange: (page: number) => void;
  /** Every control inert, e.g. while the next page is being fetched. */
  disabled?: boolean;
  /** Omit together with `onPageSizeChange` to hide the page-size control. */
  pageSize?: number;
  onPageSizeChange?: (pageSize: number) => void;
  pageSizeOptions?: readonly number[];
  /** The page-size field's label. The library has no i18n, so a host passes its own. */
  pageSizeLabel?: string;
  size?: PaginationSize;
  /** Lifts the page-size sheet clear of the home indicator; the host passes its safe-area inset. */
  bottomInset?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * The numbered pager on native (UMK-1601 / UMK-1614, Ensyra `Pagination` 165:443; the Paket Teman AI
 * page's Riwayat Pembelian, Figma `Mobile/Package` 14987:94832): the page-size field under its
 * label on the left, and on the right the page squares — first, last, the current page and its
 * neighbours, an ellipsis over every gap (`pageItems`, the web's own rule) — then `›`.
 *
 * - **The current page is the brand square**, white number, `selected` to a screen reader; pressing
 *   it does nothing, as on the web.
 * - **No `‹`.** Figma's phone strip draws none, and the strip always holds the page before the
 *   current one (`pageItems` keeps both neighbours), so going back is one tap on a number.
 * - **`›` is disabled on the last page**, derived from `page` rather than passed.
 * - **The page-size field is the library `Select`** — on a phone that is a bottom sheet — and the
 *   size in force is always one of its options, even when the host's list omits it.
 *
 * Presses through `PressableScale` at the `icon` depth, like every small control in the identity. The
 * row WRAPS: on a narrow phone with a long strip, the squares drop under the field rather than
 * running off the edge.
 */
export const Pagination = ({
  page,
  pageCount,
  onPageChange,
  disabled = false,
  pageSize,
  onPageSizeChange,
  pageSizeOptions = DEFAULT_PAGE_SIZES,
  pageSizeLabel = 'Item per halaman',
  size = 'large',
  bottomInset,
  style,
  testID,
}: PaginationProps) => {
  const total = Math.max(Math.floor(pageCount) || 0, 1);
  const current = Math.min(Math.max(Math.floor(page) || 1, 1), total);
  const canNext = current < total;
  const { role, ...square } = SQUARE[size];
  const showPageSize = onPageSizeChange !== undefined && pageSize !== undefined;

  return (
    <View testID={testID} style={[{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: showPageSize ? 'space-between' : 'flex-end', gap: tokens.spacing.sm }, style]}>
      {showPageSize && (
        <Select
          label={pageSizeLabel}
          accessibilityLabel={pageSizeLabel}
          size="small"
          disabled={disabled}
          value={String(pageSize)}
          options={[...new Set([...pageSizeOptions, pageSize])]
            .sort((a, b) => a - b)
            .map((n) => ({ label: String(n), value: String(n) }))}
          onValueChange={(v) => onPageSizeChange(Number(v))}
          bottomInset={bottomInset}
          style={{ width: PAGE_SIZE_WIDTH }}
        />
      )}
      <View accessibilityLabel="Navigasi halaman" style={{ flexDirection: 'row', alignItems: 'center', gap: tokens.spacing['4xs'] }}>
        {pageItems(current, total).map((p, i) =>
          p === 'ellipsis' ? (
            <View key={`ellipsis-${i}`} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[square, { alignItems: 'center', justifyContent: 'center' }]}>
              <Text variant={role} color="secondary">
                …
              </Text>
            </View>
          ) : (
            <PressableScale
              key={p}
              scale="icon"
              accessibilityRole="button"
              accessibilityLabel={`Halaman ${p}`}
              accessibilityState={{ selected: p === current, disabled }}
              disabled={disabled}
              onPress={() => p !== current && onPageChange(p)}
              testID={p === current ? 'pagination-current' : undefined}
              style={[
                square,
                { alignItems: 'center', justifyContent: 'center' },
                p === current && { backgroundColor: tokens.surface.default.brand },
              ]}
            >
              <Text variant={role} weight={p === current ? 'semibold' : 'regular'} color={p === current ? 'invert' : 'primary'}>
                {p}
              </Text>
            </PressableScale>
          ),
        )}
        <PressableScale
          scale="icon"
          accessibilityRole="button"
          accessibilityLabel="Halaman berikutnya"
          accessibilityState={{ disabled: disabled || !canNext }}
          disabled={disabled || !canNext}
          onPress={() => onPageChange(current + 1)}
          style={[square, { alignItems: 'center', justifyContent: 'center' }]}
        >
          <Icon name="chevron-right" size="md" color={disabled || !canNext ? 'disable' : 'primary'} />
        </PressableScale>
      </View>
    </View>
  );
};

Pagination.displayName = 'Pagination';
