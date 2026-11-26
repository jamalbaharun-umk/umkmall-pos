import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/db.module';
import { fieldError } from '../common/validation';
import { InjectDb } from '../db/db.module';
import { pinAttempts, roles, staff, staffRoles } from '../db/schema';
import { recordAudit } from '../audit/record';
import { CurrentSession } from '../tenancy/decorators';
import type { PosSession } from '../tenancy/session';
import { isUniqueViolation, parseBody, parseId } from './http';
import { RequirePermission } from './require-permission';
import { hashPin } from './secrets';
import { StaffAccess, type Tx } from './staff-access';

const Name = z
  .string({ required_error: 'Nama wajib diisi' })
  .trim()
  .min(1, 'Nama wajib diisi')
  .max(100, 'Maksimal 100 karakter');
const Pin = z
  .string({ required_error: 'PIN wajib diisi' })
  .regex(/^\d{4,8}$/, 'PIN harus 4 sampai 8 angka');
const RoleIds = z
  .array(z.string().uuid('Peran tidak ditemukan'))
  .max(20, 'Maksimal 20 peran');

const CreateStaff = z.object({
  name: Name,
  pin: Pin,
  roleIds: RoleIds.default([]),
  active: z.boolean().default(true),
});
const UpdateStaff = z
  .object({
    name: Name,
    pin: Pin,
    roleIds: RoleIds,
    active: z.boolean(),
  })
  .partial();

// Never selects pin_hash: responses cannot leak it.
const view = {
  id: staff.id,
  name: staff.name,
  active: staff.active,
  createdAt: staff.createdAt,
};

@Controller('staff')
@RequirePermission('staff.manage')
export class StaffController {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly access: StaffAccess,
  ) {}

  /** The live-name unique index (case-insensitive) answers a duplicate: 409 on the field. */
  private async uniqueName<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (isUniqueViolation(err))
        throw fieldError('name', 'Nama staf sudah dipakai', 409);
      throw err;
    }
  }

  @Get()
  async list(@CurrentSession() s: PosSession) {
    const rows = await this.db
      .select(view)
      .from(staff)
      .where(and(eq(staff.tenantId, s.tenantId), isNull(staff.deletedAt)))
      .orderBy(asc(staff.name));
    return this.withRoles(s.tenantId, rows);
  }

  @Post()
  async create(@CurrentSession() s: PosSession, @Body() body: unknown) {
    const input = parseBody(CreateStaff, body);
    const pinHash = await hashPin(input.pin);
    const id = await this.uniqueName(() =>
      this.db.transaction(async (tx) => {
        const [row] = await tx
          .insert(staff)
          .values({
            tenantId: s.tenantId,
            name: input.name,
            pinHash,
            active: input.active,
          })
          .returning({ id: staff.id });
        await this.setRoles(tx, s.tenantId, row.id, input.roleIds);
        await recordAudit(tx, s, 'staff_create', {
          target: { type: 'staff', id: row.id, label: input.name },
          details: {
            staffId: row.id,
            active: input.active,
            roleIds: input.roleIds,
          },
        });
        return row.id;
      }),
    );
    return this.one(s.tenantId, id);
  }

  @Get(':id')
  get(@CurrentSession() s: PosSession, @Param('id') id: string) {
    return this.one(s.tenantId, parseId(id));
  }

  @Patch(':id')
  async update(
    @CurrentSession() s: PosSession,
    @Param('id') rawId: string,
    @Body() body: unknown,
  ) {
    const id = parseId(rawId);
    const input = parseBody(UpdateStaff, body);
    const pinHash = input.pin ? await hashPin(input.pin) : undefined;
    await this.uniqueName(() =>
      this.db.transaction(async (tx) => {
        const [row] = await tx
          .update(staff)
          .set({
            name: input.name,
            active: input.active,
            pinHash,
            updatedAt: sql`now()`,
          })
          .where(this.mine(s.tenantId, id))
          .returning({ id: staff.id, name: staff.name });
        if (!row) throw new NotFoundException();
        // What changed, by field name: never the new PIN, which is also not a value of this log.
        await recordAudit(tx, s, 'staff_update', {
          target: { type: 'staff', id, label: row.name },
          details: {
            staffId: id,
            changed: (
              [
                ['name', input.name !== undefined],
                ['active', input.active !== undefined],
                ['credential', pinHash !== undefined],
                ['roles', input.roleIds !== undefined],
              ] as const
            )
              .filter(([, on]) => on)
              .map(([field]) => field),
            ...(input.active !== undefined && { active: input.active }),
            ...(input.roleIds && { roleIds: input.roleIds }),
          },
        });
        if (input.roleIds)
          await this.setRoles(tx, s.tenantId, id, input.roleIds);
        // A new PIN clears the lockout; deactivation ends live sessions.
        if (pinHash)
          await tx
            .delete(pinAttempts)
            .where(
              and(
                eq(pinAttempts.tenantId, s.tenantId),
                eq(pinAttempts.staffId, id),
              ),
            );
        if (input.active === false)
          await this.access.revokeSessions(tx, s.tenantId, { staffId: id });
      }),
    );
    return this.one(s.tenantId, id);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@CurrentSession() s: PosSession, @Param('id') rawId: string) {
    const id = parseId(rawId);
    await this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(staff)
        .set({ deletedAt: sql`now()`, active: false })
        .where(this.mine(s.tenantId, id))
        .returning({ id: staff.id, name: staff.name });
      if (!row) throw new NotFoundException();
      await recordAudit(tx, s, 'staff_delete', {
        target: { type: 'staff', id, label: row.name },
        details: { staffId: id },
      });
      await this.access.revokeSessions(tx, s.tenantId, { staffId: id });
    });
  }

  private mine(tenantId: string, id: string) {
    return and(
      eq(staff.tenantId, tenantId),
      eq(staff.id, id),
      isNull(staff.deletedAt),
    );
  }

  private async one(tenantId: string, id: string) {
    const rows = await this.db
      .select(view)
      .from(staff)
      .where(this.mine(tenantId, id));
    if (!rows[0]) throw new NotFoundException();
    return (await this.withRoles(tenantId, rows))[0];
  }

  private async withRoles<T extends { id: string }>(
    tenantId: string,
    rows: T[],
  ) {
    const links = rows.length
      ? await this.db
          .select({
            staffId: staffRoles.staffId,
            id: roles.id,
            name: roles.name,
          })
          .from(staffRoles)
          .innerJoin(roles, eq(roles.id, staffRoles.roleId))
          .where(
            and(
              eq(staffRoles.tenantId, tenantId),
              inArray(
                staffRoles.staffId,
                rows.map((r) => r.id),
              ),
            ),
          )
          .orderBy(asc(roles.name))
      : [];
    return rows.map((r) => ({
      ...r,
      roles: links
        .filter((l) => l.staffId === r.id)
        .map(({ id, name }) => ({ id, name })),
    }));
  }

  /** Replace the staff's roles; every role must belong to this store (422 otherwise). */
  private async setRoles(
    tx: Tx,
    tenantId: string,
    staffId: string,
    roleIds: string[],
  ) {
    const ids = [...new Set(roleIds)];
    if (ids.length) {
      const found = await tx
        .select({ id: roles.id })
        .from(roles)
        .where(and(eq(roles.tenantId, tenantId), inArray(roles.id, ids)));
      if (found.length !== ids.length)
        throw fieldError('roleIds', 'Peran tidak ditemukan');
    }
    await tx
      .delete(staffRoles)
      .where(
        and(eq(staffRoles.tenantId, tenantId), eq(staffRoles.staffId, staffId)),
      );
    if (ids.length)
      await tx
        .insert(staffRoles)
        .values(ids.map((roleId) => ({ tenantId, staffId, roleId })));
  }
}
