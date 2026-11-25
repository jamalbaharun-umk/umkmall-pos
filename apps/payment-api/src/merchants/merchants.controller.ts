import {
  Body,
  Controller,
  Get,
  HttpCode,
  Module,
  Param,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { AdaptersModule } from '../adapters/adapters.module';
import { Public, TenantId } from '../auth/service.guard';
import { validate } from '../common/validation';
import { Clock, PaymentSettings } from '../config';
import { MerchantWebhooksService } from './merchant-webhooks.service';
import { DraftBody, SubmitBody, ToggleBody } from './merchants.schemas';
import { MerchantsService } from './merchants.service';

/**
 * A store's account at a payment gateway (UMK-2019). Behind the global ServiceGuard: the tenant is the
 * `X-Tenant-Id` header's, so a store reaches only its own account; `:provider` names a gateway, never a store.
 */
@Controller('merchant-accounts')
export class MerchantsController {
  constructor(private readonly merchants: MerchantsService) {}

  @Get()
  list(@TenantId() tenantId: string) {
    return this.merchants.list(tenantId);
  }

  @Put(':provider')
  saveDraft(
    @TenantId() tenantId: string,
    @Param('provider') provider: string,
    @Body() body: unknown,
  ) {
    return this.merchants.saveDraft(
      tenantId,
      provider,
      validate(DraftBody, body ?? {}),
    );
  }

  @Post(':provider/submit')
  @HttpCode(200)
  submit(
    @TenantId() tenantId: string,
    @Param('provider') provider: string,
    @Body() body: unknown,
  ) {
    return this.merchants.submit(
      tenantId,
      provider,
      validate(SubmitBody, body ?? {}),
    );
  }

  @Post(':provider/verification-link')
  @HttpCode(200)
  verificationLink(
    @TenantId() tenantId: string,
    @Param('provider') provider: string,
  ) {
    return this.merchants.verificationLink(tenantId, provider);
  }

  @Post(':provider/sync')
  @HttpCode(200)
  sync(@TenantId() tenantId: string, @Param('provider') provider: string) {
    return this.merchants.sync(tenantId, provider);
  }

  @Put(':provider/methods/:method')
  setMethod(
    @TenantId() tenantId: string,
    @Param('provider') provider: string,
    @Param('method') method: string,
    @Body() body: unknown,
  ) {
    return this.merchants.setMethod(
      tenantId,
      provider,
      method,
      validate(ToggleBody, body ?? {}),
    );
  }
}

/**
 * PG → payment-api, about an account. No service key and no tenant header: the PG has neither. The adapter
 * verifies the PG's signature (401 otherwise), and the tenant is the one on our own account row.
 */
@Controller('webhooks')
export class MerchantWebhooksController {
  constructor(private readonly webhooks: MerchantWebhooksService) {}

  @Public()
  @Post(':provider/accounts')
  @HttpCode(200)
  receive(
    @Param('provider') provider: string,
    @Req() req: RawBodyRequest<Request>,
  ) {
    return this.webhooks.receive(provider, {
      headers: req.headers,
      rawBody: req.rawBody ?? Buffer.alloc(0),
    });
  }
}

/** Also the home of the settings and the clock, so that payments and merchants share one of each. */
@Module({
  imports: [AdaptersModule],
  controllers: [MerchantsController, MerchantWebhooksController],
  providers: [
    PaymentSettings,
    Clock,
    MerchantsService,
    MerchantWebhooksService,
  ],
  exports: [PaymentSettings, Clock, MerchantsService, MerchantWebhooksService],
})
export class MerchantsModule {}
