/**
 * UMK-1990: the arithmetic of a line discount ("Diskon baris", design feature 30). Integer rupiah only.
 *
 * A discount is given on the line's total (qty × unit price, the wholesale tier already applied), never per
 * unit, so the line amounts always add up to the sale's line discount. It comes off before the voucher, the
 * voucher before tax, tax before cash rounding (`saleAmounts`).
 */

/** Above this share of the line (30%, owner ruling 24 Nov) a discount needs a PIN approval. */
export const DISCOUNT_APPROVAL_BPS = 3000;

/** How long a PIN approval may wait for its sale. */
export const DISCOUNT_APPROVAL_TTL_SECONDS = 30 * 60;

/** The `code` of every refusal of a line discount the screen shows in its error dialog. */
export const DISCOUNT_INVALID = 'DISCOUNT_INVALID';
export const DISCOUNT_APPROVAL_REQUIRED = 'DISCOUNT_APPROVAL_REQUIRED';
/** A cashier named themself as the approver: the gate needs a second person (only the owner may confirm their own). */
export const DISCOUNT_SELF_APPROVAL = 'DISCOUNT_SELF_APPROVAL';

/**
 * The approver named is the asking actor, unless that actor is the owner (who may confirm their own). A PIN gate
 * (a line discount UMK-1990, a kasbon correction UMK-1971) needs a second person.
 */
export const isSelfApproval = (
  s: { kind: string; actorId: string },
  approverId: string,
) => s.kind !== 'owner' && approverId.toLowerCase() === s.actorId.toLowerCase();

export type LineDiscountInput = {
  discountPercent?: number;
  discountAmount?: number;
};

/**
 * The rupiah a line's discount takes off `lineTotal`: an amount as given, a percent rounded half up to whole
 * rupiah (Rp9.999 at 15% = 1.499,85 → Rp1.500). 0 without a discount.
 */
export function lineDiscountOf(lineTotal: number, d: LineDiscountInput) {
  if (d.discountPercent !== undefined)
    return Number((BigInt(lineTotal) * BigInt(d.discountPercent) + 50n) / 100n);
  return d.discountAmount ?? 0;
}

/** A discount must leave at least Rp1 on the line: 100% (or more) is refused. */
export const leavesSomething = (discount: number, lineTotal: number) =>
  discount < lineTotal;

/** More than 30% of the line: percent > 30, or amount × 10000 > lineTotal × 3000. */
export const needsApproval = (discount: number, lineTotal: number) =>
  BigInt(discount) * 10000n > BigInt(lineTotal) * BigInt(DISCOUNT_APPROVAL_BPS);

/**
 * Owner ruling 2026-11-26: a manual price below the server's price is a reduction of the line like a discount,
 * measured on the line at the server's price (`listPrice × qty`, the wholesale tier applied). 0 for a price at or
 * above the server's.
 */
export const priceCutOf = (listPrice: number, price: number, qty: number) =>
  Math.max(listPrice - price, 0) * qty;

/** Whether an approval of at most `maxBps` of the line covers this discount. */
export const withinApproval = (
  discount: number,
  lineTotal: number,
  maxBps: number,
) => BigInt(discount) * 10000n <= BigInt(lineTotal) * BigInt(maxBps);

/**
 * Owner ruling on PR 72 (major 1): ONE combined test over the whole sale. Every manual reduction (manual-price cuts,
 * line discounts, the order discount) is added up. The reductions of lines that carry their own line approval (each
 * above 30% of its line) are covered by those approvals; what is left (`uncovered`: the other lines' cuts and the
 * order discount) is measured against the list subtotal of the UNCOVERED lines only (Σ list price × qty of the lines
 * without a line approval, the wholesale tier applied), never the whole list subtotal: a covered line's list total in
 * the denominator would let the order discount escape the gate (re-review of 6d5a185: line A list 100.000 sold at
 * 1.000 with its approval, line B 10.000, an order discount of 10.900 would pass and the sale be Rp100). With every
 * line covered the base is 0, so any order discount needs the approval. Above 30% the sale must name an `order`
 * approval, which then covers the WHOLE reduction (`max_bps` of the whole list subtotal, `max_amount`). So 30% off
 * a line plus 30% off the order (51% in all) needs a PIN, while one line above 30% with its own approval (UMK-1990,
 * PR 63) and no order discount needs nothing more.
 */
export function combinedOf(a: {
  listSubtotal: number;
  uncoveredListSubtotal: number;
  reduction: number;
  coveredByLines: number;
}) {
  return {
    listSubtotal: a.listSubtotal,
    uncoveredListSubtotal: a.uncoveredListSubtotal,
    reduction: a.reduction,
    needsApproval: needsApproval(
      a.reduction - a.coveredByLines,
      a.uncoveredListSubtotal,
    ),
  };
}
