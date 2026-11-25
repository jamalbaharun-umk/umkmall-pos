import { Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { parseId } from '../staff/http';
import { RequirePermission } from '../staff/require-permission';
import { CurrentSession } from '../tenancy/decorators';
import type { PosSession } from '../tenancy/session';
import { PaymentSync } from './payment-sync.service';

/**
 * What payment-api keeps refusing for this store (UMK-1991): a sale, a kasbon payment or a void whose record
 * there failed repeatedly and is parked. Read-only, plus a release that lets the job try again.
 */
@Controller('payment-sync/issues')
export class PaymentSyncController {
  constructor(private readonly sync: PaymentSync) {}

  @Get()
  @RequirePermission('reports.view')
  async list(@CurrentSession() s: PosSession) {
    return { data: await this.sync.issues(s.tenantId) };
  }

  @Post(':id/retry')
  @HttpCode(200)
  @RequirePermission('sales.void')
  retry(@CurrentSession() s: PosSession, @Param('id') id: string) {
    return this.sync.retryIssue(s.tenantId, parseId(id));
  }
}
