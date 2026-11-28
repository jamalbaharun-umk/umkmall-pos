import { Injectable } from '@nestjs/common';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import type { Db } from '../db/db.module';
import { InjectDb } from '../db/db.module';
import {
  agentAccess,
  devices,
  helperSessions,
  rolePermissions,
  roles,
  staff,
  staffRoles,
  staffSessions,
} from '../db/schema';
import type { PosSession } from '../tenancy/session';
import {
  agentPermissions,
  DEFAULT_ROLES,
  HELPER_PERMISSIONS,
  PERMISSIONS,
} from './permissions';
import { secretMatches } from './secrets';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

@Injectable()
export class StaffAccess {
  constructor(@InjectDb() private readonly db: Db) {}

  /**
   * Called by the session guard on every request. Owners get every permission. A cashier session must
   * still be live (row unrevoked and unexpired, device unrevoked, staff active) and gets its staff's
   * current permissions, so a revoke or a role change applies on the next request. Null = refuse.
   */
  async resolve(session: PosSession): Promise<PosSession | null> {
    if (session.kind === 'owner')
      return { ...session, permissions: PERMISSIONS };
    if (session.kind === 'agent') {
      // The owner can cut every agent session at once from the POS (consent is revocable at any time).
      const [cut] = await this.db
        .select({
          enabled: agentAccess.enabled,
          before: agentAccess.revokedBefore,
        })
        .from(agentAccess)
        .where(eq(agentAccess.tenantId, session.tenantId));
      // Off means off for every session, whenever it was issued.
      if (cut && !cut.enabled) return null;
      if (cut?.before && (session.issuedAt ?? 0) * 1000 <= cut.before.getTime())
        return null;
      return {
        ...session,
        permissions: agentPermissions(session.agentScopes ?? ['pos.read']),
      };
    }
    if (session.kind === 'helper') {
      // UMK-2124: the handover must still be live (not ended by the owner's PIN, not past its 12 hours), in this
      // store and for this owner. A helper may only sell.
      if (!session.helperSessionId) return null;
      const [live] = await this.db
        .select({ id: helperSessions.id })
        .from(helperSessions)
        .where(
          and(
            eq(helperSessions.id, session.helperSessionId),
            eq(helperSessions.tenantId, session.tenantId),
            eq(helperSessions.ownerId, session.actorId),
            isNull(helperSessions.endedAt),
            gt(helperSessions.expiresAt, sql`now()`),
          ),
        );
      return live ? { ...session, permissions: HELPER_PERMISSIONS } : null;
    }
    if (!session.cashierSessionId) return null;
    const [live] = await this.db
      .select({ id: staffSessions.id })
      .from(staffSessions)
      .innerJoin(
        staff,
        and(
          eq(staff.tenantId, staffSessions.tenantId),
          eq(staff.id, staffSessions.staffId),
        ),
      )
      .innerJoin(
        devices,
        and(
          eq(devices.tenantId, staffSessions.tenantId),
          eq(devices.id, staffSessions.deviceId),
        ),
      )
      .where(
        and(
          eq(staffSessions.id, session.cashierSessionId),
          eq(staffSessions.tenantId, session.tenantId),
          eq(staffSessions.staffId, session.actorId),
          isNull(staffSessions.revokedAt),
          gt(staffSessions.expiresAt, sql`now()`),
          isNull(devices.revokedAt),
          eq(staff.active, true),
          isNull(staff.deletedAt),
        ),
      );
    if (!live) return null;
    return {
      ...session,
      permissions: await this.permissionsOf(session.tenantId, session.actorId),
    };
  }

  async permissionsOf(tenantId: string, staffId: string): Promise<string[]> {
    const rows = await this.db
      .selectDistinct({ p: rolePermissions.permission })
      .from(staffRoles)
      .innerJoin(
        rolePermissions,
        and(
          eq(rolePermissions.tenantId, staffRoles.tenantId),
          eq(rolePermissions.roleId, staffRoles.roleId),
        ),
      )
      .where(
        and(eq(staffRoles.tenantId, tenantId), eq(staffRoles.staffId, staffId)),
      );
    return rows.map((r) => r.p).sort();
  }

  /** The bound, unrevoked device behind an `X-Pos-Device: <id>.<secret>` header, or null. */
  async device(
    header: string | undefined,
  ): Promise<{ id: string; tenantId: string } | null> {
    const m =
      /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.([A-Za-z0-9_-]{43})$/.exec(
        header ?? '',
      );
    if (!m) return null;
    const [row] = await this.db
      .select({
        id: devices.id,
        tenantId: devices.tenantId,
        secretHash: devices.secretHash,
      })
      .from(devices)
      .where(and(eq(devices.id, m[1]), isNull(devices.revokedAt)));
    if (!row || !secretMatches(m[2], row.secretHash)) return null;
    return { id: row.id, tenantId: row.tenantId };
  }

  /** A store with no roles gets the defaults (on conflict: a concurrent first use already seeded). */
  async ensureRoles(tenantId: string): Promise<void> {
    const [any] = await this.db
      .select({ id: roles.id })
      .from(roles)
      .where(eq(roles.tenantId, tenantId))
      .limit(1);
    if (any) return;
    await this.db.transaction(async (tx) => {
      for (const r of DEFAULT_ROLES) {
        const [role] = await tx
          .insert(roles)
          .values({ tenantId, name: r.name })
          .onConflictDoNothing()
          .returning({ id: roles.id });
        if (!role) continue;
        await tx.insert(rolePermissions).values(
          r.permissions.map((permission) => ({
            tenantId,
            roleId: role.id,
            permission,
          })),
        );
      }
    });
  }

  /** Revoke every live session matching `where` inside this store. */
  async revokeSessions(
    tx: Tx | Db,
    tenantId: string,
    by: { staffId?: string; deviceId?: string; id?: string },
  ) {
    return tx
      .update(staffSessions)
      .set({ revokedAt: sql`now()` })
      .where(
        and(
          eq(staffSessions.tenantId, tenantId),
          isNull(staffSessions.revokedAt),
          by.staffId ? eq(staffSessions.staffId, by.staffId) : undefined,
          by.deviceId ? eq(staffSessions.deviceId, by.deviceId) : undefined,
          by.id ? eq(staffSessions.id, by.id) : undefined,
        ),
      )
      .returning({ id: staffSessions.id });
  }
}

export type { Tx };
