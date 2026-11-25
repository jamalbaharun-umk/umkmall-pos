import { Global, Module } from '@nestjs/common';
import { StockModule } from '../stock/stock.module';
import { PaymentSyncController } from './payment-sync.controller';
import { PaymentSync } from './payment-sync.service';
import {
  PAYMENT_FETCH,
  type PaymentFetch,
  PaymentsClient,
} from './payments.client';

/** pos-api's side of payment-api (UMK-1991). Global: sales, receivables, void and purge all use it. */
@Global()
@Module({
  imports: [StockModule],
  controllers: [PaymentSyncController],
  providers: [
    {
      provide: PAYMENT_FETCH,
      useValue: ((url, init) => fetch(url, init)) satisfies PaymentFetch,
    },
    PaymentsClient,
    PaymentSync,
  ],
  exports: [PaymentsClient, PaymentSync],
})
export class PaymentsModule {}
