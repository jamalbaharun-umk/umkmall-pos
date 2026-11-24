import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Module,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { AdaptersModule } from '../adapters/adapters.module';
import { TenantId } from '../auth/service.guard';
import { fieldError, validate } from '../common/validation';
import {
  CancelBody,
  ChargeBody,
  IdempotencyKey,
  ListQuery,
} from './payments.schemas';
import { PaymentsService } from './payments.service';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  /** 201 for a new payment, 200 when the idempotency key replays the first one. */
  @Post()
  async charge(
    @TenantId() tenantId: string,
    @Headers('idempotency-key') key: unknown,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const parsedKey = IdempotencyKey.safeParse(key);
    if (!parsedKey.success)
      throw fieldError('Idempotency-Key', parsedKey.error.issues[0].message);
    const { created, payment } = await this.payments.charge(
      tenantId,
      parsedKey.data,
      validate(ChargeBody, body),
    );
    res.status(created ? 201 : 200);
    return payment;
  }

  @Get()
  list(@TenantId() tenantId: string, @Query() query: unknown) {
    return this.payments.list(tenantId, validate(ListQuery, query));
  }

  @Get(':id')
  get(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.payments.get(tenantId, id);
  }

  @Post(':id/sync')
  @HttpCode(200)
  sync(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.payments.sync(tenantId, id);
  }

  /** payment-api picks void or refund by what the payment's adapter supports. */
  @Post(':id/cancel')
  @HttpCode(200)
  cancel(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.payments.cancel(
      tenantId,
      id,
      'cancel',
      validate(CancelBody, body),
    );
  }

  @Post(':id/void')
  @HttpCode(200)
  void(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.payments.cancel(
      tenantId,
      id,
      'void',
      validate(CancelBody, body),
    );
  }

  @Post(':id/refund')
  @HttpCode(200)
  refund(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.payments.cancel(
      tenantId,
      id,
      'refund',
      validate(CancelBody, body),
    );
  }
}

@Module({
  imports: [AdaptersModule],
  controllers: [PaymentsController],
  providers: [PaymentsService],
})
export class PaymentsModule {}
