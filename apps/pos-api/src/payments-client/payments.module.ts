import { Global, Module } from '@nestjs/common';
import { StockModule } from '../stock/stock.module';
import { OnlinePaymentsController } from './online-payments.controller';
import { PaymentReviewController } from './payment-review.controller';
import { PaymentReview } from './payment-review.service';
import { PaymentSyncController } from './payment-sync.controller';
import { PaymentSync } from './payment-sync.service';
import { SalePaymentController } from './sale-payment.controller';
import { SalePayments } from './sale-payment.service';
import {
  PAYMENT_FETCH,
  type PaymentFetch,
  PaymentsClient,
} from './payments.client';

/** pos-api's side of payment-api (UMK-1991). Global: sales, receivables, void and purge all use it. */
@Global()
@Module({
  imports: [StockModule],
  controllers: [
    PaymentSyncController,
    OnlinePaymentsController,
    SalePaymentController,
    PaymentReviewController,
  ],
  providers: [
    {
      provide: PAYMENT_FETCH,
      useValue: ((url, init) => fetch(url, init)) satisfies PaymentFetch,
    },
    PaymentsClient,
    PaymentSync,
    SalePayments,
    PaymentReview,
  ],
  exports: [PaymentsClient, PaymentSync, SalePayments],
})
export class PaymentsModule {}
