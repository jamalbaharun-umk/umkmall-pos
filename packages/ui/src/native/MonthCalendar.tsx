import { View, type StyleProp, type ViewStyle } from 'react-native';
import { Icon } from './Icon';
import { countLabel, dayLabel, monthGrid, monthTitle, shiftMonth, WEEKDAYS } from './month-calendar-support';
import { PressableScale, PressableScaleHost } from './motion';
import { Text } from './Text';
import { measure, tokens } from './theme';

/**
 * The day square, as Figma draws it (`Mobile/Jadwal` 15288:83616, UMK-1740): 40 wide, the date 24 high over a count chip 16 high, with 2 clear
 * at the top and sides and 8 clear UNDER the chip, so the chip never sits on the square's edge. 50 high in all, and the 4 between two
 * weeks is 2 above and 2 below the square.
 */
const DATE_HEIGHT = measure['1-5'];
const CHIP_HEIGHT = measure['1'];
const SQUARE = {
  width: measure['2-5'],
  height: DATE_HEIGHT + CHIP_HEIGHT + tokens.spacing['5xs'] + tokens.spacing['2xs'],
  borderRadius: tokens.radius.md,
  paddingTop: tokens.spacing['5xs'],
  paddingBottom: tokens.spacing['2xs'],
} as const;
/** A day cell: 7 equal columns, the square and the 2 above and below it that make the 4 between two weeks. */
const CELL_HEIGHT = SQUARE.height + tokens.spacing['5xs'] * 2;
/** The control row's buttons, 44 pt to press. */
const ARROW = measure['2-75'];

export interface MonthCalendarProps {
  /** The month the grid shows, `YYYY-MM`. A string that is not a month draws the header only. */
  month: string;
  /** The selected day, `YYYY-MM-DD`, or none. It is drawn only while it is inside `month`. */
  selected?: string;
  /** How many posts each day holds, keyed `YYYY-MM-DD`. A day with none, or `0`, draws no chip. */
  counts?: Readonly<Record<string, number>>;
  /** A day was pressed (always a day inside `month`). Pressing the selected day again reports it again. */
  onSelect: (day: string) => void;
  /** The arrows (or a host-driven change) ask for another month, `YYYY-MM`. The host owns `month`. */
  onMonthChange: (month: string) => void;
  style?: StyleProp<ViewStyle>;
  /** Prefix of every testID inside: `<id>-prev`, `<id>-next`, `<id>-title`, `<id>-day-YYYY-MM-DD`. */
  testID?: string;
}

/**
 * The month calendar of the Jadwal screen (UMK-1358, Figma `Mobile/Jadwal` 15198:103890; NATIVE-ONLY, drawn in the app design
 * file, not the Ensyra library): the month and year between `‹` and `›`, the weekday row (Sen to Min, Monday first), and the
 * grid of days. A day that holds posts shows its count in a small chip under the number; the selected day is a filled brand
 * square with the count in a white chip.
 *
 * THE HOST OWNS THE STATE. `month` and `selected` are props and `onSelect` / `onMonthChange` are the only outputs, so the
 * component holds nothing and has no clock: "today" is the host's to mark, and it marks nothing here because the design does not.
 *
 * Dates and names are `YYYY-MM` and `YYYY-MM-DD` strings through `month-calendar-support.ts` (UTC arithmetic, never the device
 * zone, and hand-written Indonesian month names). Every day is one `button` that says "19 Januari 2026, 2 jadwal" and is
 * `selected` to a screen reader; the title is a polite live region, so changing month is announced. The empty cells before the
 * 1st and after the last day are hidden from a screen reader.
 */
export const MonthCalendar = ({ month, selected, counts, onSelect, onMonthChange, style, testID = 'month-calendar' }: MonthCalendarProps) => {
  const weeks = monthGrid(month);
  const title = monthTitle(month);

  return (
    <View testID={testID} style={style}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: tokens.spacing.sm }}>
        <PressableScale
          scale="icon"
          accessibilityRole="button"
          accessibilityLabel="Bulan sebelumnya"
          disabled={title === ''}
          onPress={() => onMonthChange(shiftMonth(month, -1))}
          testID={`${testID}-prev`}
          style={{ width: ARROW, height: ARROW, alignItems: 'center', justifyContent: 'center' }}
        >
          <Icon name="chevron-left" size="md" color="primary" />
        </PressableScale>
        <Text variant="h6" weight="bold" accessibilityRole="header" accessibilityLiveRegion="polite" testID={`${testID}-title`}>
          {title}
        </Text>
        <PressableScale
          scale="icon"
          accessibilityRole="button"
          accessibilityLabel="Bulan berikutnya"
          disabled={title === ''}
          onPress={() => onMonthChange(shiftMonth(month, 1))}
          testID={`${testID}-next`}
          style={{ width: ARROW, height: ARROW, alignItems: 'center', justifyContent: 'center' }}
        >
          <Icon name="chevron-right" size="md" color="primary" />
        </PressableScale>
      </View>

      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ flexDirection: 'row', marginBottom: tokens.spacing['2xs'] }}>
        {WEEKDAYS.map((name) => (
          <View key={name} style={{ flex: 1, alignItems: 'center' }}>
            <Text variant="bodyMd" color="secondary">
              {name}
            </Text>
          </View>
        ))}
      </View>

      {weeks.map((week, row) => (
        <View key={row} style={{ flexDirection: 'row' }}>
          {week.map((day, column) =>
            day === null ? (
              <View key={`blank-${column}`} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ flex: 1, height: CELL_HEIGHT }} />
            ) : (
              <Day key={day} day={day} count={counts?.[day] ?? 0} isSelected={day === selected} onSelect={onSelect} testID={`${testID}-day-${day}`} />
            ),
          )}
        </View>
      ))}
    </View>
  );
};

MonthCalendar.displayName = 'MonthCalendar';

/* `PressableScaleHost`, not `PressableScale`: the cell is a flex item of its week, and `PressableScale` puts its style on an INNER view and
   leaves the `Pressable` itself auto-sized, so the seven cells collapsed to their content and sat left of the weekday row (found on a
   simulator; jest has no layout). The host takes the style on the `Pressable`. */
const Day = ({ day, count, isSelected, onSelect, testID }: { day: string; count: number; isSelected: boolean; onSelect: (day: string) => void; testID: string }) => (
  <PressableScaleHost
    scale="icon"
    accessibilityRole="button"
    accessibilityLabel={dayLabel(day, count)}
    accessibilityState={{ selected: isSelected }}
    onPress={() => onSelect(day)}
    testID={testID}
    style={{ flex: 1, height: CELL_HEIGHT, alignItems: 'center', justifyContent: 'center' }}
  >
    <View style={[SQUARE, { alignItems: 'center', justifyContent: 'center' }, isSelected && { backgroundColor: tokens.surface.default.brand }]}>
      <Text variant="paragraph" weight={isSelected ? 'semibold' : 'regular'} color={isSelected ? 'invert' : 'primary'} style={{ height: DATE_HEIGHT, lineHeight: DATE_HEIGHT }}>
        {Number(day.slice(8))}
      </Text>
      {/* The chip's height is reserved when there is none, so a day with posts never makes its row taller than another's. */}
      <View
        style={{
          height: CHIP_HEIGHT,
          paddingHorizontal: tokens.spacing['4xs'],
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: tokens.radius.sm,
          backgroundColor: count > 0 ? (isSelected ? tokens.surface.default.primary : tokens.surface.weak.brand) : 'transparent',
        }}
      >
        {count > 0 && (
          <Text variant="bodyMd" weight="semibold" style={{ color: tokens.text.default.brand }}>
            {countLabel(count)}
          </Text>
        )}
      </View>
    </View>
  </PressableScaleHost>
);
