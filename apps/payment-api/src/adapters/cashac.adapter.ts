import {
  ChargeResult,
  PaymentAdapter,
  RefundResult,
  StatusResult,
  UnsupportedOperationError,
  WebhookNotice,
} from './adapter';

/**
 * Every method that exists today. All are taken at the cashier (CASHAC).
 * Kasbon is NOT a payment method: a kasbon sale creates a receivable at the caller, and each instalment is its
 * own payment (by one of these methods) whose order reference names the receivable.
 */
export const CASHAC_METHODS = ['cash', 'edc_debit', 'static_qris'] as const;
export type CashacMethod = (typeof CASHAC_METHODS)[number];

/**
 * Payment taken at the cashier. The cashier already holds the money when the charge is asked, so it is `paid`
 * at once and nothing here ever calls out. Void only: the store hands the money back itself, there is no PG to
 * refund through. It is never voided automatically: only a person's void undoes it.
 */
export class CashacAdapter implements PaymentAdapter {
  readonly kind = 'cashac' as const;
  readonly supportsVoid = true;
  readonly supportsRefund = false;
  readonly canCancel = false;
  readonly singleUseQr = false;

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

  refund(): Promise<RefundResult> {
    return Promise.reject(new UnsupportedOperationError(this.method, 'refund'));
  }

  handleWebhook(): Promise<WebhookNotice> {
    return Promise.reject(
      new UnsupportedOperationError(this.method, 'webhooks'),
    );
  }
}

export const cashacAdapters = (): PaymentAdapter[] =>
  CASHAC_METHODS.map((method) => new CashacAdapter(method));
