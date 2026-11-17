import {
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/db.module';
import { InjectDb } from '../db/db.module';
import { devices, staff, staffSessions } from '../db/schema';
import { CurrentSession } from '../tenancy/decorators';
import type { PosSession } from '../tenancy/session';
import { parseBody, parseId } from './http';
import { RequirePermission } from './require-permission';
import { hashSecret, newDeviceSecret } from './secrets';
import { StaffAccess } from './staff-access';

const BindDevice = z.object({
  name: z
    .string({ required_error: 'Nama perangkat wajib diisi' })
    .trim()
    .min(1, 'Nama perangkat wajib diisi')
    .max(60, 'Maksimal 60 karakter'),
});

const deviceView = {
  id: devices.id,
  name: devices.name,
  revokedAt: devices.revokedAt,
  createdAt: devices.createdAt,
};

// Registered before StaffController so `/staff/devices` is not taken for `/staff/:id`.
@Controller('staff/devices')
@RequirePermission('staff.manage')
export class DevicesController {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly access: StaffAccess,
  ) {}

  @Get()
  list(@CurrentSession() s: PosSession) {
    return this.db
      .select(deviceView)
      .from(devices)
      .where(eq(devices.tenantId, s.tenantId))
      .orderBy(desc(devices.createdAt));
  }

  /** Binds a cashier device. The device token is returned here once and never stored in clear. */
  @Post()
  async bind(@CurrentSession() s: PosSession, @Body() body: unknown) {
    const { name } = parseBody(BindDevice, body);
    const secret = newDeviceSecret();
    const [device] = await this.db
      .insert(devices)
      .values({ tenantId: s.tenantId, name, secretHash: hashSecret(secret) })
      .returning(deviceView);
    return { device, deviceToken: `${device.id}.${secret}` };
  }

  @Post(':id/revoke')
  @HttpCode(204)
  async revoke(@CurrentSession() s: PosSession, @Param('id') rawId: string) {
    const id = parseId(rawId);
    await this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(devices)
        .set({ revokedAt: sql`coalesce(${devices.revokedAt}, now())` })
        .where(and(eq(devices.tenantId, s.tenantId), eq(devices.id, id)))
        .returning({ id: devices.id });
      if (!row) throw new NotFoundException();
      await this.access.revokeSessions(tx, s.tenantId, { deviceId: id });
    });
  }
}

@Controller('staff/sessions')
@RequirePermission('staff.manage')
export class StaffSessionsController {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly access: StaffAccess,
  ) {}

  /** Live cashier sessions, newest first. */
  @Get()
  list(@CurrentSession() s: PosSession) {
    return this.db
      .select({
        id: staffSessions.id,
        staff: { id: staff.id, name: staff.name },
        device: { id: devices.id, name: devices.name },
        createdAt: staffSessions.createdAt,
        expiresAt: staffSessions.expiresAt,
      })
      .from(staffSessions)
      .innerJoin(staff, eq(staff.id, staffSessions.staffId))
      .innerJoin(devices, eq(devices.id, staffSessions.deviceId))
      .where(
        and(
          eq(staffSessions.tenantId, s.tenantId),
          isNull(staffSessions.revokedAt),
          gt(staffSessions.expiresAt, sql`now()`),
        ),
      )
      .orderBy(desc(staffSessions.createdAt));
  }

  @Post(':id/revoke')
  @HttpCode(204)
  async revoke(@CurrentSession() s: PosSession, @Param('id') rawId: string) {
    const id = parseId(rawId);
    const [row] = await this.db
      .select({ id: staffSessions.id })
      .from(staffSessions)
      .where(
        and(eq(staffSessions.tenantId, s.tenantId), eq(staffSessions.id, id)),
      );
    if (!row) throw new NotFoundException();
    await this.access.revokeSessions(this.db, s.tenantId, { id });
  }
}
