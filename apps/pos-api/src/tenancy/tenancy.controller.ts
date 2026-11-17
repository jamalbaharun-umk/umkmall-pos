import { Controller, Get, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/db.module';
import { InjectDb } from '../db/db.module';
import { tenants } from '../db/schema';
import { CurrentSession } from './decorators';
import type { PosSession } from './session';

@Controller('tenant')
export class TenancyController {
  constructor(@InjectDb() private readonly db: Db) {}

  /** The signed-in store. Proves the guard and the tenant filter end to end. */
  @Get('me')
  async me(@CurrentSession() session: PosSession) {
    const [tenant] = await this.db
      .select({ id: tenants.id, createdAt: tenants.createdAt })
      .from(tenants)
      .where(eq(tenants.id, session.tenantId));
    if (!tenant) throw new NotFoundException();
    return { tenant, actor: { id: session.actorId, kind: session.kind } };
  }
}
