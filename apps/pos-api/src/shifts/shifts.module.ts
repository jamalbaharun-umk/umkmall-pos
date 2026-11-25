import { Module } from '@nestjs/common';
import { CashEntriesService } from './cash-entries.service';
import { ShiftsController } from './shifts.controller';
import { ShiftsService } from './shifts.service';

@Module({
  controllers: [ShiftsController],
  providers: [ShiftsService, CashEntriesService],
  exports: [ShiftsService],
})
export class ShiftsModule {}
