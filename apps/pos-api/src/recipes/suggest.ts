// UMK-2126 recipe figures for the cost-rise alert and the suggested price: integer only (BigInt inside), no floats.

export const DEFAULT_TARGET_MARGIN = 60;
export const MIN_TARGET_MARGIN = 1;
export const MAX_TARGET_MARGIN = 90;
/** Design 43 and UMK-2126: a recipe is flagged when its cost per portion rose this many percent or more. */
export const COST_RISE_PERCENT = 5;
/** Suggested prices are rounded up to this many rupiah. */
export const PRICE_STEP = 100;

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

/**
 * Selling price that gives `targetMargin` percent margin over `cost`: cost / (1 - margin / 100), rounded UP to the
 * next Rp100. `ceil(cost / (100 - m)) * 100` is the same figure in integers. Null for a cost of 0 (nothing to price).
 */
export function suggestedPrice(
  cost: number,
  targetMargin: number,
): number | null {
  if (!Number.isInteger(cost) || cost <= 0) return null;
  if (
    !Number.isInteger(targetMargin) ||
    targetMargin < MIN_TARGET_MARGIN ||
    targetMargin > MAX_TARGET_MARGIN
  )
    return null;
  const d = BigInt(100 - targetMargin);
  const steps = (BigInt(cost) + d - 1n) / d;
  const price = steps * BigInt(PRICE_STEP);
  return price > MAX_SAFE ? null : Number(price);
}

/** Percent of `part` in `whole` in tenths (margin 56,3% is 563), rounded half up; null without a positive `whole`. */
export function permille(part: number, whole: number): number | null {
  if (!(whole > 0)) return null;
  const n = BigInt(part) * 1000n;
  const d = BigInt(whole);
  const sign = n < 0n ? -1n : 1n;
  return Number(sign * ((sign * n * 2n + d) / (d * 2n)));
}

/** Margin in tenths of a percent of `sellingPrice` over `cost`; null without a selling price. */
export const marginPermille = (sellingPrice: number, cost: number) =>
  permille(sellingPrice - cost, sellingPrice);

/** True when `cost` is at least `COST_RISE_PERCENT` above `base` (a positive baseline). */
export const roseEnough = (cost: number, base: number) =>
  base > 0 &&
  BigInt(cost) * 100n >= BigInt(base) * BigInt(100 + COST_RISE_PERCENT);

/** The rise from `base` to `cost` in tenths of a percent (8,7% is 87). */
export const risePermille = (cost: number, base: number) =>
  permille(cost - base, base);
