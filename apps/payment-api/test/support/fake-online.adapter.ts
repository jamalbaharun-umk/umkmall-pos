import {
  ChargeResult,
  PaymentAdapter,
  PaymentRef,
  StatusResult,
  UnsupportedOperationError,
  WebhookResult,
} from '../../src/adapters/adapter';

/**
 * TEST ONLY. Stands in for a PG adapter (no real one ships before the legal gate, UMK-1977): the charge is
 * `pending` until the "payer pays" (`settle`), it can be refunded and never voided. It records every call so a
 * test can assert what reached the "gateway".
 */
export class FakeOnlineAdapter implements PaymentAdapter {
  readonly method = 'fake_online';
  readonly kind = 'online' as const;
  readonly supportsVoid = false;
  readonly supportsRefund = true;

  readonly calls: { op: string; paymentId: string }[] = [];
  private readonly statuses = new Map<string, StatusResult['status']>();
  /** Set to make the next gateway call fail like a PG that is down. */
  failNext = false;

  private record(op: string, payment: PaymentRef) {
    this.calls.push({ op, paymentId: payment.id });
    if (this.failNext) {
      this.failNext = false;
      throw new Error('fake gateway down: secret-internal-detail');
    }
  }

  /** The payer paid (or the QR expired): what the next getStatus answers. */
  settle(paymentId: string, status: StatusResult['status']) {
    this.statuses.set(paymentId, status);
  }

  charge(payment: PaymentRef): Promise<ChargeResult> {
    this.record('charge', payment);
    this.statuses.set(payment.id, 'pending');
    return Promise.resolve({
      status: 'pending',
      providerRef: `fake-${payment.id}`,
    });
  }

  getStatus(payment: PaymentRef): Promise<StatusResult> {
    this.record('getStatus', payment);
    return Promise.resolve({
      status: this.statuses.get(payment.id) ?? 'failed',
    });
  }

  void(): Promise<void> {
    return Promise.reject(new UnsupportedOperationError(this.method, 'void'));
  }

  refund(payment: PaymentRef): Promise<void> {
    this.record('refund', payment);
    return Promise.resolve();
  }

  handleWebhook(): Promise<WebhookResult> {
    return Promise.reject(
      new UnsupportedOperationError(this.method, 'webhooks'),
    );
  }
}
