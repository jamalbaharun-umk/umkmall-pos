import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpException,
  HttpStatus,
  Post,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { Response } from 'express';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { recordAudit } from '../audit/record';
import { loadEnv } from '../config';
import type { Db } from '../db/db.module';
import { InjectDb } from '../db/db.module';
import { pinAttempts, staff, staffSessions } from '../db/schema';
import { Public } from '../tenancy/decorators';
import { signSession } from '../tenancy/session';
import { parseBody } from './http';
import { verifyPin } from './secrets';
import { StaffAccess } from './staff-access';

const PinSignIn = z.object({
  staffId: z.string().uuid(),
  pin: z.string().min(1).max(32),
});

export const CASHIER_SESSION_SECONDS = 12 * 60 * 60; // one shift; cashiers do not refresh
export const MAX_FAILURES = 5;
const BASE_LOCK_SECONDS = 30;
const MAX_LOCK_SECONDS = 15 * 60;

/** Lock length after `failures` consecutive wrong PINs: none below 5, then 30 s doubling, max 15 min. */
export function lockSeconds(failures: number): number {
  if (failures < MAX_FAILURES) return 0;
  return Math.min(
    BASE_LOCK_SECONDS * 2 ** (failures - MAX_FAILURES),
    MAX_LOCK_SECONDS,
  );
}

type Outcome =
  { ok: true; sessionId: string } | { ok: false; retryAfter?: number };

// Device routes: authenticated by the bound device's `X-Pos-Device` token, not by a session.
@Controller('auth')
export class PinAuthController {
  private readonly secret = loadEnv().POS_SESSION_SECRET;

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly access: StaffAccess,
  ) {}

  /** The name picker on a bound device: active cashiers of that store. */
  @Public()
  @Get('device/staff')
  async staffForDevice(@Headers('x-pos-device') header?: string) {
    const device = await this.access.device(header);
    if (!device) throw new UnauthorizedException();
    return this.db
      .select({ id: staff.id, name: staff.name })
      .from(staff)
      .where(
        and(
          eq(staff.tenantId, device.tenantId),
          eq(staff.active, true),
          isNull(staff.deletedAt),
        ),
      )
      .orderBy(asc(staff.name));
  }

  @Public()
  @Post('pin')
  @HttpCode(200)
  async signIn(
    @Headers('x-pos-device') header: string | undefined,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const device = await this.access.device(header);
    if (!device) throw new UnauthorizedException();
    const { staffId, pin } = parseBody(PinSignIn, body);
    const tenantId = device.tenantId;

    // The row lock serializes guesses for this store + cashier, so parallel requests cannot beat the count.
    const outcome = await this.db.transaction(async (tx): Promise<Outcome> => {
      const [member] = await tx
        .select({ pinHash: staff.pinHash })
        .from(staff)
        .where(
          and(
            eq(staff.tenantId, tenantId),
            eq(staff.id, staffId),
            eq(staff.active, true),
            isNull(staff.deletedAt),
          ),
        );
      if (!member) return { ok: false };

      await tx
        .insert(pinAttempts)
        .values({ tenantId, staffId })
        .onConflictDoNothing();
      const where = and(
        eq(pinAttempts.tenantId, tenantId),
        eq(pinAttempts.staffId, staffId),
      );
      const [attempt] = await tx
        .select()
        .from(pinAttempts)
        .where(where)
        .for('update');

      const now = Date.now();
      if (attempt.lockedUntil && attempt.lockedUntil.getTime() > now) {
        return {
          ok: false,
          retryAfter: Math.ceil((attempt.lockedUntil.getTime() - now) / 1000),
        };
      }

      if (!(await verifyPin(pin, member.pinHash))) {
        const failures = attempt.failures + 1;
        const lock = lockSeconds(failures);
        await tx
          .update(pinAttempts)
          .set({
            failures,
            lockedUntil: lock ? new Date(now + lock * 1000) : null,
          })
          .where(where);
        return lock ? { ok: false, retryAfter: lock } : { ok: false };
      }

      await tx
        .update(pinAttempts)
        .set({ failures: 0, lockedUntil: null })
        .where(where);
      const [session] = await tx
        .insert(staffSessions)
        .values({
          tenantId,
          staffId,
          deviceId: device.id,
          expiresAt: sql`now() + make_interval(secs => ${CASHIER_SESSION_SECONDS})`,
        })
        .returning({ id: staffSessions.id });
      await recordAudit(
        tx,
        { tenantId, actorId: staffId, kind: 'cashier' },
        'sign_in',
        { details: { deviceId: device.id } },
      );
      return { ok: true, sessionId: session.id };
    });

    if (!outcome.ok) {
      if (outcome.retryAfter) {
        res.setHeader('Retry-After', String(outcome.retryAfter));
        throw new HttpException(
          {
            message: 'Terlalu banyak PIN salah, coba lagi nanti',
            retryAfter: outcome.retryAfter,
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      throw new UnauthorizedException(); // same answer for unknown staff and wrong PIN
    }

    const sessionToken = await signSession(
      {
        tenantId,
        actorId: staffId,
        kind: 'cashier',
        cashierSessionId: outcome.sessionId,
      },
      this.secret,
      CASHIER_SESSION_SECONDS,
    );
    const [member] = await this.db
      .select({ id: staff.id, name: staff.name })
      .from(staff)
      .where(and(eq(staff.tenantId, tenantId), eq(staff.id, staffId)));
    return {
      sessionToken,
      expiresIn: CASHIER_SESSION_SECONDS,
      staff: member,
      permissions: await this.access.permissionsOf(tenantId, staffId),
    };
  }
}
