import { Controller, Get, NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/db.module';
import { InjectDb } from '../db/db.module';
import { staff, storeProfiles, tenants } from '../db/schema';
import { isSoloOwner } from '../shifts/cash-ledger';
import { storeCashAvailable } from '../store-cash/store-cash-ledger';
import { VoidPins } from '../void/void-pin';
import { CurrentSession } from './decorators';
import { freshSignIn, type PosSession } from './session';

@Controller('tenant')
export class TenancyController {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly pins: VoidPins,
  ) {}

  /**
   * UMK-2121 solo-owner mode, for the owner's shell only: `active` while the store has no active staff member
   * (computed from the staff rows, never a switch), `storeCash` while the store still holds cash outside the drawer
   * (Kas toko stays in the menu until it is spent or moved), `ownerPin` whether the owner has made a PIN, and
   * `freshSignIn` whether this session can still make the first one (UMK-2054).
   */
  private async solo(s: PosSession) {
    if (s.kind !== 'owner') return null;
    const [active, cash, ownerPin] = await Promise.all([
      isSoloOwner(this.db, s),
      storeCashAvailable(this.db, s.tenantId),
      this.pins.ownerHasPin(s.tenantId),
    ]);
    return {
      active,
      storeCash: cash > 0,
      ownerPin,
      freshSignIn: freshSignIn(s),
    };
  }

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
      solo: await this.solo(session),
      actor: {
        id: session.actorId,
        kind: session.kind,
        name: cashier?.name ?? null,
        permissions: session.permissions ?? [],
      },
    };
  }
}
