import { Controller, HttpCode, Module, Post } from '@nestjs/common';
import { TenantId } from '../auth/service.guard';
import { PaymentsModule } from '../payments/payments.controller';
import { PurgeService } from './purge.service';

/**
 * Caller → payment-api when a store is erased. Same door as every other route: the service key, and the
 * tenant from the trusted tenant header (no body). Idempotent: a retry answers `purged: false`.
 */
@Controller('internal/tenants')
export class PurgeController {
  constructor(private readonly purge: PurgeService) {}

  @Post('purge')
  @HttpCode(200)
  async purgeTenant(@TenantId() tenantId: string) {
    return { purged: await this.purge.purge(tenantId) };
  }
}

@Module({
  imports: [PaymentsModule],
  controllers: [PurgeController],
  providers: [PurgeService],
})
export class PurgeModule {}
