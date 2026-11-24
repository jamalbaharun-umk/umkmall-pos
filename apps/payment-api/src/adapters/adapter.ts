/**
 * The one contract every payment method implements. payment-api's routes and its callers know only this:
 * adding a payment gateway (PG) means adding one adapter to PAYMENT_ADAPTERS, nothing else.
 *
 * - `cashac`: the payment was taken at the cashier (cash, EDC debit, the store's static QRIS, kasbon). The
 *   adapter never calls out. Cancelled by VOID: the store returns the money itself.
 * - `online`: the payment goes through a PG (dynamic QRIS, VA). Cancelled by REFUND: the adapter calls the PG.
 *
 * Only adapters may talk to a PG. An adapter must make `charge`, `void` and `refund` idempotent on
 * `payment.id` at the PG: payment-api may repeat a call whose answer it never stored.
 */
export type AdapterKind = 'cashac' | 'online';

/** What an adapter is told about a payment. Amount is integer rupiah, always the full amount. */
export interface PaymentRef {
  id: string;
  tenantId: string;
  orderRef: string;
  method: string;
  amount: number;
  providerRef: string | null;
}

export interface ChargeResult {
  /** `pending`: the payer has not paid yet (ask again with getStatus, or wait for the webhook). */
  status: 'paid' | 'pending' | 'failed';
  providerRef?: string;
}

export interface StatusResult {
  status: 'pending' | 'paid' | 'failed' | 'expired';
  providerRef?: string;
}

/** Who cancels and why. `approvedBy` is the supervisor the caller verified. */
export interface CancelContext {
  reason: string;
  actorRef: string;
  approvedBy: string;
}

export interface WebhookInput {
  headers: Record<string, string | undefined>;
  rawBody: Buffer;
}

export interface WebhookResult {
  providerRef: string;
  status: StatusResult['status'] | 'refunded';
}

export interface PaymentAdapter {
  /** The method name callers charge with. Unique across adapters. */
  readonly method: string;
  readonly kind: AdapterKind;
  readonly supportsVoid: boolean;
  readonly supportsRefund: boolean;

  charge(payment: PaymentRef): Promise<ChargeResult>;
  getStatus(payment: PaymentRef): Promise<StatusResult>;
  /** Called only when `supportsVoid`. */
  void(payment: PaymentRef, context: CancelContext): Promise<void>;
  /** Called only when `supportsRefund`. */
  refund(payment: PaymentRef, context: CancelContext): Promise<void>;
  /** Verifies and reads a PG notification. No route delivers one yet (it ships with the first PG adapter). */
  handleWebhook(input: WebhookInput): Promise<WebhookResult>;
}

/** An adapter was asked for something it declared it cannot do. A bug in the caller, never a client error. */
export class UnsupportedOperationError extends Error {
  constructor(method: string, operation: string) {
    super(`${method} does not support ${operation}`);
    this.name = 'UnsupportedOperationError';
  }
}

export const PAYMENT_ADAPTERS = Symbol('PAYMENT_ADAPTERS');
