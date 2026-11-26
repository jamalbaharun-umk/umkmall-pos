import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Res,
} from '@nestjs/common';
import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/db.module';
import { InjectDb } from '../db/db.module';
import { devices, staff, staffSessions } from '../db/schema';
import type { Response } from 'express';
import { recordAudit } from '../audit/record';
import { fieldError } from '../common/validation';
import { CurrentSession } from '../tenancy/decorators';
import type { PosSession } from '../tenancy/session';
import { parseBody, parseId } from './http';
import { RequirePermission } from './require-permission';
import { hashSecret, newDeviceSecret } from './secrets';
import { StaffAccess } from './staff-access';
import { DevicePairing } from './device-pairing';

const deviceName = z
  .string({ required_error: 'Nama perangkat wajib diisi' })
  .trim()
  .min(1, 'Nama perangkat wajib diisi')
  .max(60, 'Maksimal 60 karakter');

const BindDevice = z.object({ name: deviceName });

const PairDevice = z.object({
  code: z
    .string({ required_error: 'Kode pasang wajib diisi' })
    .regex(/^[0-9]{6}$/, 'Kode pasang harus 6 angka'),
  name: deviceName,
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
    private readonly pairing: DevicePairing,
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
    const device = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(devices)
        .values({ tenantId: s.tenantId, name, secretHash: hashSecret(secret) })
        .returning(deviceView);
      await recordAudit(tx, s, 'device_bind', {
        target: { type: 'device', id: row.id, label: name },
        details: { deviceId: row.id },
      });
      return row;
    });
    return { device, deviceToken: `${device.id}.${secret}` };
  }

  /**
   * Binds the device that shows this pairing code (UMK-2022) to the store of THIS session. Only here, inside
   * a signed-in session with `staff.manage`, is a code ever accepted. The device token is not answered: the
   * device fetches it itself, so it never passes through the owner's device.
   */
  @Post('pair')
  @HttpCode(201)
  async pair(
    @CurrentSession() s: PosSession,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { code, name } = parseBody(PairDevice, body);
    const outcome = await this.pairing.claim(s.tenantId, code, name, s);
    if (outcome.ok) return { device: outcome.device };
    if (outcome.retryAfter) {
      res.setHeader('Retry-After', String(outcome.retryAfter));
      throw new HttpException(
        {
          message: 'Terlalu banyak kode salah, coba lagi nanti',
          retryAfter: outcome.retryAfter,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    // One answer for a wrong, a used and an expired code.
    throw fieldError('code', 'Kode pasang salah atau sudah tidak berlaku');
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
        .returning({ id: devices.id, name: devices.name });
      if (!row) throw new NotFoundException();
      await recordAudit(tx, s, 'device_revoke', {
        target: { type: 'device', id, label: row.name },
        details: { deviceId: id },
      });
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
    await this.db.transaction(async (tx) => {
      const [row] = await tx
        .select({
          id: staffSessions.id,
          staffId: staffSessions.staffId,
          name: staff.name,
        })
        .from(staffSessions)
        .innerJoin(staff, eq(staff.id, staffSessions.staffId))
        .where(
          and(eq(staffSessions.tenantId, s.tenantId), eq(staffSessions.id, id)),
        );
      if (!row) throw new NotFoundException();
      await recordAudit(tx, s, 'session_revoke', {
        target: { type: 'staff', id: row.staffId, label: row.name },
        details: { staffId: row.staffId, sessionId: id },
      });
      await this.access.revokeSessions(tx, s.tenantId, { id });
    });
  }
}
