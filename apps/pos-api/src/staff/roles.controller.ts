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
import { and, asc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/db.module';
import { fieldError } from '../common/validation';
import { InjectDb } from '../db/db.module';
import { rolePermissions, roles } from '../db/schema';
import { CurrentSession } from '../tenancy/decorators';
import type { PosSession } from '../tenancy/session';
import { isUniqueViolation, parseBody, parseId } from './http';
import { PERMISSIONS } from './permissions';
import { RequirePermission } from './require-permission';
import { StaffAccess, type Tx } from './staff-access';

const Role = z.object({
  name: z.string().trim().min(1).max(60),
  permissions: z.array(z.enum(PERMISSIONS)).default([]),
});

@Controller('roles')
@RequirePermission('staff.manage')
export class RolesController {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly access: StaffAccess,
  ) {}

  // Declared before ':id' so the static path wins.
  @Get('permissions')
  permissions() {
    return PERMISSIONS;
  }

  @Get()
  async list(@CurrentSession() s: PosSession) {
    await this.access.ensureRoles(s.tenantId);
    const rows = await this.db
      .select({ id: roles.id, name: roles.name })
      .from(roles)
      .where(eq(roles.tenantId, s.tenantId))
      .orderBy(asc(roles.name));
    return this.withPermissions(s.tenantId, rows);
  }

  @Post()
  async create(@CurrentSession() s: PosSession, @Body() body: unknown) {
    const input = parseBody(Role, body);
    await this.access.ensureRoles(s.tenantId);
    const id = await this.unique(() =>
      this.db.transaction(async (tx) => {
        const [row] = await tx
          .insert(roles)
          .values({ tenantId: s.tenantId, name: input.name })
          .returning({ id: roles.id });
        await this.setPermissions(tx, s.tenantId, row.id, input.permissions);
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
    const input = parseBody(Role.partial(), body);
    await this.unique(() =>
      this.db.transaction(async (tx) => {
        const where = and(eq(roles.tenantId, s.tenantId), eq(roles.id, id));
        const [row] = input.name
          ? await tx
              .update(roles)
              .set({ name: input.name })
              .where(where)
              .returning({ id: roles.id })
          : await tx.select({ id: roles.id }).from(roles).where(where);
        if (!row) throw new NotFoundException();
        if (input.permissions)
          await this.setPermissions(tx, s.tenantId, id, input.permissions);
      }),
    );
    return this.one(s.tenantId, id);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@CurrentSession() s: PosSession, @Param('id') rawId: string) {
    const id = parseId(rawId);
    // role_permissions and staff_roles cascade.
    const [row] = await this.db
      .delete(roles)
      .where(and(eq(roles.tenantId, s.tenantId), eq(roles.id, id)))
      .returning({ id: roles.id });
    if (!row) throw new NotFoundException();
  }

  private async unique<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (isUniqueViolation(err))
        throw fieldError('name', 'Nama peran sudah dipakai', 409);
      throw err;
    }
  }

  private async one(tenantId: string, id: string) {
    const rows = await this.db
      .select({ id: roles.id, name: roles.name })
      .from(roles)
      .where(and(eq(roles.tenantId, tenantId), eq(roles.id, id)));
    if (!rows[0]) throw new NotFoundException();
    return (await this.withPermissions(tenantId, rows))[0];
  }

  private async withPermissions<T extends { id: string }>(
    tenantId: string,
    rows: T[],
  ) {
    const perms = rows.length
      ? await this.db
          .select({
            roleId: rolePermissions.roleId,
            p: rolePermissions.permission,
          })
          .from(rolePermissions)
          .where(
            and(
              eq(rolePermissions.tenantId, tenantId),
              inArray(
                rolePermissions.roleId,
                rows.map((r) => r.id),
              ),
            ),
          )
      : [];
    return rows.map((r) => ({
      ...r,
      permissions: perms
        .filter((x) => x.roleId === r.id)
        .map((x) => x.p)
        .sort(),
    }));
  }

  private async setPermissions(
    tx: Tx,
    tenantId: string,
    roleId: string,
    permissions: string[],
  ) {
    await tx
      .delete(rolePermissions)
      .where(
        and(
          eq(rolePermissions.tenantId, tenantId),
          eq(rolePermissions.roleId, roleId),
        ),
      );
    const unique = [...new Set(permissions)];
    if (unique.length)
      await tx
        .insert(rolePermissions)
        .values(unique.map((permission) => ({ tenantId, roleId, permission })));
  }
}
