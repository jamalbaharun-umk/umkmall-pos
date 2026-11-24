import {
  ChargeResult,
  PaymentAdapter,
  StatusResult,
  UnsupportedOperationError,
  WebhookResult,
} from './adapter';

/** Every method that exists today. All are taken at the cashier (CASHAC). */
export const CASHAC_METHODS = [
  'cash',
  'edc_debit',
  'static_qris',
  'kasbon',
] as const;
export type CashacMethod = (typeof CASHAC_METHODS)[number];

/**
 * Payment taken at the cashier. The cashier already holds the money (or, for kasbon, the debt is recorded
 * by the caller) when the charge is asked, so it is `paid` at once and nothing here ever calls out.
 * Void only: the store hands the money back itself. There is no PG to refund through.
 */
export class CashacAdapter implements PaymentAdapter {
  readonly kind = 'cashac' as const;
  readonly supportsVoid = true;
  readonly supportsRefund = false;

  constructor(readonly method: CashacMethod) {}

  charge(): Promise<ChargeResult> {
    return Promise.resolve({ status: 'paid' });
  }

  getStatus(): Promise<StatusResult> {
    return Promise.resolve({ status: 'paid' });
  }

  void(): Promise<void> {
    return Promise.resolve();
  }

  refund(): Promise<void> {
    return Promise.reject(new UnsupportedOperationError(this.method, 'refund'));
  }

  handleWebhook(): Promise<WebhookResult> {
    return Promise.reject(
      new UnsupportedOperationError(this.method, 'webhooks'),
    );
  }
}

export const cashacAdapters = (): PaymentAdapter[] =>
  CASHAC_METHODS.map((method) => new CashacAdapter(method));
