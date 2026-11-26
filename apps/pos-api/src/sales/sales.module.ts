import { Module } from '@nestjs/common';
import { StockModule } from '../stock/stock.module';
import { VoidPins } from '../void/void-pin';
import { SalesController } from './sales.controller';
import { SalesService } from './sales.service';

@Module({
  imports: [StockModule],
  controllers: [SalesController],
  providers: [SalesService, VoidPins],
})
export class SalesModule {}
