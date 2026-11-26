import {
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Post,
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import { validate } from '../common/validation';
import { RequirePermission } from '../staff/require-permission';
import { AgentRoute, CurrentSession } from '../tenancy/decorators';
import type { PosSession } from '../tenancy/session';
import { AgentUsage } from './usage';

const DAY_MS = 24 * 60 * 60 * 1000;
const ActivityQuery = z
  .object({
    days: z.coerce
      .number({ invalid_type_error: 'Jumlah hari harus berupa angka' })
      .int('Jumlah hari harus bilangan bulat')
      .min(1, 'Minimal 1 hari')
      .max(90, 'Maksimal 90 hari')
      .default(7),
    limit: z.coerce.number().int().min(1).max(500).default(100),
  })
  .strict();

/** What UMKMall's agent did in this store, and the owner's switch to cut it off (New Teman AI consent). */
@Controller('agent')
export class AgentAccessController {
  constructor(private readonly usage: AgentUsage) {}

  @AgentRoute()
  @Get('activity')
  @RequirePermission('reports.view')
  async activity(@CurrentSession() s: PosSession, @Query() query: unknown) {
    const { days, limit } = validate(ActivityQuery, query);
    const to = new Date();
    return {
      data: await this.usage.list(
        s.tenantId,
        new Date(to.getTime() - days * DAY_MS),
        to,
        limit,
      ),
    };
  }

  /**
   * The owner turns UMKMall's agent off: every session issued so far is refused now, and no new one is issued until
   * the owner turns it on again (`POST /agent/access/enable`).
   */
  @Post('access/revoke')
  @HttpCode(200)
  async revoke(@CurrentSession() s: PosSession) {
    if (s.kind !== 'owner') throw new ForbiddenException();
    return {
      enabled: false,
      revokedBefore: await this.usage.revokeAll(s.tenantId),
    };
  }

  @Post('access/enable')
  @HttpCode(200)
  async enable(@CurrentSession() s: PosSession) {
    if (s.kind !== 'owner') throw new ForbiddenException();
    await this.usage.enable(s.tenantId);
    return { enabled: true };
  }

  @Get('access')
  async access(@CurrentSession() s: PosSession) {
    if (s.kind !== 'owner') throw new ForbiddenException();
    return { enabled: await this.usage.isEnabled(s.tenantId) };
  }
}
