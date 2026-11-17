import { Controller, Get, NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/db.module';
import { InjectDb } from '../db/db.module';
import { staff, storeProfiles, tenants } from '../db/schema';
import { CurrentSession } from './decorators';
import type { PosSession } from './session';

@Controller('tenant')
export class TenancyController {
  constructor(@InjectDb() private readonly db: Db) {}

  /**
   * The signed-in store and actor (the app shell shows who is signed in and hides what they may not open).
   * A cashier's name is read within the session's tenant only; an owner has no POS name (null).
   */
  @Get('me')
  async me(@CurrentSession() session: PosSession) {
    const [tenant] = await this.db
      .select({
        id: tenants.id,
        createdAt: tenants.createdAt,
        name: storeProfiles.name,
      })
      .from(tenants)
      .leftJoin(storeProfiles, eq(storeProfiles.tenantId, tenants.id))
      .where(eq(tenants.id, session.tenantId));
    if (!tenant) throw new NotFoundException();
    const [cashier] =
      session.kind === 'cashier'
        ? await this.db
            .select({ name: staff.name })
            .from(staff)
            .where(
              and(
                eq(staff.id, session.actorId),
                eq(staff.tenantId, session.tenantId),
              ),
            )
        : [];
    return {
      tenant,
      actor: {
        id: session.actorId,
        kind: session.kind,
        name: cashier?.name ?? null,
        permissions: session.permissions ?? [],
      },
    };
  }
}
