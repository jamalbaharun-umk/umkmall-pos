/**
 * Charts (UMK-2074). The one LOCAL ADDITION to this vendored package, by the owner's exception
 * of 2026-11-26: see `POS-COPY.md`. Pure SVG, no charting library, safe to render on the server.
 */
export * from './format';
export {
  CATEGORICAL_SLOTS,
  CHART_CSS,
  CHART_TOKEN_NAMES,
  CHART_TOKENS_DARK,
  CHART_TOKENS_LIGHT,
  ChartStyles,
  seqColor,
  slotColor,
  type ChartSlot,
} from './theme';
export { ChartFrame, ChartLegend, ChartTableView } from './ChartFrame';
export type { ChartFrameProps, ChartState, ChartTable, LegendItem } from './ChartFrame';
export type { ChartCommonProps } from './types';
export { BarChart } from './BarChart';
export type { BarChartProps, BarSeries } from './BarChart';
export { AreaChart, LineChart, LINE_DASH } from './LineChart';
export type { AreaChartProps, LineChartProps, LineSeries } from './LineChart';
export { DonutChart } from './DonutChart';
export type { DonutChartProps, DonutPart } from './DonutChart';
export { SegmentedBar } from './SegmentedBar';
export type { SegmentedBarProps, SegmentPart } from './SegmentedBar';
export { Sparkline } from './Sparkline';
export type { SparklineProps } from './Sparkline';
export { MarginTile, StatTile } from './StatTile';
export type { MarginTileProps, StatDelta, StatTileProps } from './StatTile';
export { HeatStrip } from './HeatStrip';
export type { HeatStripProps } from './HeatStrip';
export { Meter, MeterList, meterStatus } from './Meter';
export type { MeterListProps, MeterProps, MeterStatus } from './Meter';
