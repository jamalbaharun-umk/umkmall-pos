/**
 * The one contract every payment method implements. payment-api's routes and its callers know only this:
 * adding a payment gateway (PG) means adding one adapter to PAYMENT_ADAPTERS, nothing else.
 *
 * - `cashac`: the payment was taken at the cashier (cash, EDC debit, the store's static QRIS). The adapter
 *   never calls out. Cancelled by VOID: the store returns the money itself.
 * - `online`: the payment goes through a PG (dynamic QRIS, VA). Cancelled by REFUND: the adapter calls the PG.
 *
 * Only adapters may talk to a PG. `payment.id` is the reference AND the idempotency key an adapter gives the PG
 * for the charge; a refund carries its own key. payment-api repeats a call whose answer it never stored, and
 * that must never create a second bill or a second refund.
 */
export type AdapterKind = 'cashac' | 'online';
/** How long a bill is payable: a QR at the till is short-lived, a virtual account is paid from a bank app. */
export type BillValidity = 'qr' | 'va';

/** What an adapter is told about a payment. Amount is integer rupiah, always the full amount. */
export interface PaymentRef {
  id: string;
  tenantId: string;
  orderRef: string;
  method: string;
  amount: number;
  providerRef: string | null;
  /** The bank the payer chose: one of the adapter's `banks` codes, null for a method that declares none. */
  bank: string | null;
  /** When the bill should stop accepting payment (the configured validity of the method). */
  expiresAt: Date | null;
}

/**
 * What the payer needs, as plain strings. The well-known keys every caller may rely on:
 * - `qrString`: a QR to draw at the till (dynamic QRIS);
 * - `paymentUrl`: the PG's own payment page to open or show as a link (a PG that offers a method for a
 *   sub-account only through its hosted checkout);
 * - `vaNumber` and `bank`: a virtual account;
 * - `accountName`: the name the payer's bank shows for that virtual account ("a.n. …"), so the payer can check
 *   it before sending. It is the gateway's label for the account, as the gateway answers it: never a bank
 *   account or identity data of the store that payment-api holds (it holds none).
 * A charge answers at least one of `qrString`, `paymentUrl` or `vaNumber`; a caller shows what it finds.
 */
export type Checkout = Record<string, string>;

/**
 * A bank a method can make a bill at (UMK-2037). `code` is what a charge carries and what `checkout.bank`
 * answers; `name` is what the payer is shown. The gateway's list, never a bank account.
 */
export interface Bank {
  code: string;
  name: string;
}

export interface ChargeResult {
  /** `pending`: the bill exists and the payer has not paid yet. `failed`: the PG refused it. */
  status: 'paid' | 'pending' | 'failed';
  providerRef?: string;
  expiresAt?: Date;
  checkout?: Checkout;
}

/**
 * One receipt of money at the PG for a bill. The adapter normalises to the GROSS amount charged to the payer
 * and reports the PG's fee apart from it, whatever the PG's own convention (net of fee, fee added).
 */
export interface Receipt {
  /** The PG's id for this receipt. Stable: the same money is always reported under the same id. */
  id: string;
  grossAmount: number;
  feeAmount: number;
}

export interface StatusResult {
  /**
   * `not_found`: the PG has no bill for this reference. One such answer proves nothing (PGs lag);
   * payment-api fails a payment only on a second one later.
   */
  status: 'not_found' | 'pending' | 'paid' | 'failed' | 'expired' | 'cancelled';
  providerRef?: string;
  expiresAt?: Date;
  checkout?: Record<string, string>;
  /**
   * ALL money received on this bill: also after it expired or was cancelled, also a second payment.
   * A payment counts as paid only by a receipt whose gross amount equals its amount exactly; every other
   * receipt is recorded as unmatched money and refunded.
   */
  receipts?: Receipt[];
  /** Where each refund asked on this bill stands, by the `key` of its RefundRequest. */
  refunds?: Record<string, 'pending' | 'succeeded' | 'failed'>;
}

/** What to refund. Always a whole receipt. */
export interface RefundRequest {
  /** Idempotency key at the PG: the payment id, or the unmatched receipt's id. */
  key: string;
  receiptId: string | null;
  amount: number;
}

/** Who cancels and why. `approvedBy` is the supervisor the caller verified; `system` for an automatic refund. */
export interface CancelContext {
  reasonCode: string;
  note: string | null;
  actorRef: string;
  approvedBy: string;
}

export interface RefundResult {
  /** `pending`: the PG accepted the refund and the money is on its way. `failed`: the PG refused it. */
  status: 'pending' | 'succeeded' | 'failed';
}

export interface WebhookInput {
  headers: Record<string, string | string[] | undefined>;
  rawBody: Buffer;
}

/**
 * A verified notification. It carries no status on purpose: a webhook only says "look at this payment";
 * payment-api then asks `getStatus` for the status and the exact amount.
 */
export interface WebhookNotice {
  /** The PG's id for this delivery: the same event delivered twice has the same id. */
  eventId: string;
  /** Our payment id as the PG sent it back; null when the notification names none. */
  reference: string | null;
}

export interface PaymentAdapter {
  /** The method name callers charge with. Unique across adapters. */
  readonly method: string;
  readonly kind: AdapterKind;
  /** The PG behind an online adapter: the `<provider>` of `POST /webhooks/<provider>`. */
  readonly provider?: string;
  readonly supportsVoid: boolean;
  readonly supportsRefund: boolean;
  /** The PG can close an unpaid bill (`cancelPending`). Many cannot close a dynamic QR. */
  readonly canCancel: boolean;
  /** The PG rejects a second payment on the same QR. When false, a duplicate receipt is possible. */
  readonly singleUseQr: boolean;
  /**
   * Which configured validity a bill of this method gets (UMK-2039): `va` is PAYMENT_VA_TTL_SECONDS, `qr`
   * (the default) PAYMENT_QR_TTL_SECONDS. Only the bill's lifetime: every window after it counts from the
   * bill's own expiry.
   */
  readonly validity?: BillValidity;
  /**
   * The banks the payer chooses from BEFORE the bill is made (a virtual account). A method that declares
   * banks is charged with one of their codes (`PaymentRef.bank`); a method that declares none takes none.
   */
  readonly banks?: readonly Bank[];

  /**
   * Throws GatewayUnreachableError when the request certainly never reached the PG; any other error means
   * the outcome is unknown and the bill may exist.
   */
  charge(payment: PaymentRef): Promise<ChargeResult>;
  getStatus(payment: PaymentRef): Promise<StatusResult>;
  /** Called only when `supportsVoid`. */
  void(payment: PaymentRef, context: CancelContext): Promise<void>;
  /** Called only when `supportsRefund`. A whole receipt, idempotent on `request.key`. */
  refund(
    payment: PaymentRef,
    request: RefundRequest,
    context: CancelContext,
  ): Promise<RefundResult>;
  /**
   * Checks the signature or token in constant time and reads the notification.
   * Throws WebhookSignatureError when it does not verify.
   */
  handleWebhook(input: WebhookInput): Promise<WebhookNotice>;
  /**
   * Only when `canCancel`: closes an unpaid bill so it can no longer be paid. payment-api asks `getStatus`
   * afterwards and trusts only that answer (the payer may have paid a moment earlier).
   */
  cancelPending?(payment: PaymentRef): Promise<void>;
}

/** An adapter was asked for something it declared it cannot do. A bug in the caller, never a client error. */
export class UnsupportedOperationError extends Error {
  constructor(method: string, operation: string) {
    super(`${method} does not support ${operation}`);
    this.name = 'UnsupportedOperationError';
  }
}

export class GatewayUnreachableError extends Error {
  constructor() {
    super('gateway unreachable');
    this.name = 'GatewayUnreachableError';
  }
}

export class WebhookSignatureError extends Error {
  constructor() {
    super('webhook signature does not verify');
    this.name = 'WebhookSignatureError';
  }
}

export const PAYMENT_ADAPTERS = Symbol('PAYMENT_ADAPTERS');
