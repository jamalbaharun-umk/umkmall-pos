import {
  Body,
  Controller,
  HttpCode,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  Post,
} from '@nestjs/common';
import { and, count, eq, gt, isNull, lt, lte, sql } from 'drizzle-orm';
import { randomInt } from 'node:crypto';
import { z } from 'zod';
import type { Db } from '../db/db.module';
import { InjectDb } from '../db/db.module';
import { devicePairingAttempts, devicePairings, devices } from '../db/schema';
import { Public } from '../tenancy/decorators';
import { isUniqueViolation, parseBody } from './http';
import { lockSeconds } from './pin-auth.controller';
import { hashSecret, newDeviceSecret, secretMatches } from './secrets';

/** How long a pairing code works (UMK-2022, owner decision 2026-11-25: 10 minutes). THE one place. */
export const PAIRING_CODE_TTL_SECONDS = 10 * 60;
/**
 * Codes open at once, across all stores. A code is 6 digits, so the share of the code space that is live
 * bounds what one guess can hit: at most 0.1 % here. Asking for a code needs no session, and this cap is what
 * limits it.
 */
export const MAX_LIVE_PAIRINGS = 1000;
const CODE_DIGITS = 6;

const TOKEN =
  /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.([A-Za-z0-9_-]{43})$/;

const PairingStatus = z.object({
  pairingToken: z
    .string({ required_error: 'Wajib diisi' })
    .max(120, 'Format tidak valid'),
});

type Claim =
  | { ok: true; device: { id: string; name: string; createdAt: Date } }
  | { ok: false; retryAfter?: number };

/**
 * Pairing a cashier device by code (UMK-2022). The device is signed out and belongs to no store: it asks
 * for a code and shows it. The owner (or staff with `staff.manage`) enters the code on their own signed-in
 * device, and that session's store takes the device. A code is never accepted from a signed-out caller, so
 * nobody outside a store can put a device into it.
 *
 * Only hashes are stored: of the code, and of the secret the asking device keeps. That secret becomes the
 * bound device's, so the `X-Pos-Device` token is known to the device alone.
 */
@Injectable()
export class DevicePairing {
  constructor(@InjectDb() private readonly db: Db) {}

  /** The signed-out device asks for a code. */
  async start() {
    // Housekeeping: pairings long past their end (also the used ones; the device row is what stays).
    await this.db
      .delete(devicePairings)
      .where(lt(devicePairings.expiresAt, sql`now() - interval '1 day'`));
    const [{ open }] = await this.db
      .select({ open: count() })
      .from(devicePairings)
      .where(
        and(
          isNull(devicePairings.claimedAt),
          gt(devicePairings.expiresAt, sql`now()`),
        ),
      );
    if (open >= MAX_LIVE_PAIRINGS)
      throw new HttpException(
        { message: 'Terlalu banyak permintaan kode, coba lagi nanti' },
        HttpStatus.TOO_MANY_REQUESTS,
      );

    const secret = newDeviceSecret();
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = randomInt(0, 10 ** CODE_DIGITS)
        .toString()
        .padStart(CODE_DIGITS, '0');
      const codeHash = hashSecret(code);
      // An expired, unused pairing still holds its code's hash: free it.
      await this.db
        .delete(devicePairings)
        .where(
          and(
            eq(devicePairings.codeHash, codeHash),
            lte(devicePairings.expiresAt, sql`now()`),
          ),
        );
      try {
        const [row] = await this.db
          .insert(devicePairings)
          .values({
            codeHash,
            secretHash: hashSecret(secret),
            expiresAt: sql`now() + make_interval(secs => ${PAIRING_CODE_TTL_SECONDS})`,
          })
          .returning({ id: devicePairings.id });
        return {
          pairingToken: `${row.id}.${secret}`,
          code,
          expiresIn: PAIRING_CODE_TTL_SECONDS,
        };
      } catch (err) {
        // Another open pairing drew the same code: draw again.
        if (!isUniqueViolation(err)) throw err;
      }
    }
    throw new HttpException(
      { message: 'Terlalu banyak permintaan kode, coba lagi nanti' },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  /**
   * The owner entered a code. `tenantId` is the session's. Wrong codes are counted per store under a row
   * lock and lock the store's pairing exactly as wrong PINs lock a cashier (5, then 30 s doubling to 15 min).
   * A code is used up by the claim: the second use of it is a wrong code.
   */
  async claim(tenantId: string, code: string, name: string): Promise<Claim> {
    return this.db.transaction(async (tx): Promise<Claim> => {
      await tx
        .insert(devicePairingAttempts)
        .values({ tenantId })
        .onConflictDoNothing();
      const mine = eq(devicePairingAttempts.tenantId, tenantId);
      const [attempt] = await tx
        .select()
        .from(devicePairingAttempts)
        .where(mine)
        .for('update');
      const now = Date.now();
      if (attempt.lockedUntil && attempt.lockedUntil.getTime() > now)
        return {
          ok: false,
          retryAfter: Math.ceil((attempt.lockedUntil.getTime() - now) / 1000),
        };

      // The row lock makes the claim single: a second claimer waits here and then finds the code gone.
      const [pairing] = await tx
        .select({
          id: devicePairings.id,
          secretHash: devicePairings.secretHash,
        })
        .from(devicePairings)
        .where(
          and(
            eq(devicePairings.codeHash, hashSecret(code)),
            isNull(devicePairings.claimedAt),
            gt(devicePairings.expiresAt, sql`now()`),
          ),
        )
        .for('update');
      if (!pairing) {
        const failures = attempt.failures + 1;
        const lock = lockSeconds(failures);
        await tx
          .update(devicePairingAttempts)
          .set({
            failures,
            lockedUntil: lock ? new Date(now + lock * 1000) : null,
          })
          .where(mine);
        return lock ? { ok: false, retryAfter: lock } : { ok: false };
      }

      const [device] = await tx
        .insert(devices)
        .values({ tenantId, name, secretHash: pairing.secretHash })
        .returning({
          id: devices.id,
          name: devices.name,
          createdAt: devices.createdAt,
        });
      await tx
        .update(devicePairings)
        .set({
          tenantId,
          deviceId: device.id,
          claimedAt: sql`now()`,
          codeHash: null,
        })
        .where(eq(devicePairings.id, pairing.id));
      await tx
        .update(devicePairingAttempts)
        .set({ failures: 0, lockedUntil: null })
        .where(mine);
      return { ok: true, device };
    });
  }

  /**
   * The asking device looks whether it was paired. It proves itself with the secret it was handed at the
   * start; the answer is its own device token, built from that secret. Null: no such pairing (unknown,
   * expired, wrong secret, or its device was revoked).
   */
  async status(pairingToken: string) {
    const m = TOKEN.exec(pairingToken);
    if (!m) return null;
    const [row] = await this.db
      .select({
        tenantId: devicePairings.tenantId,
        deviceId: devicePairings.deviceId,
        secretHash: devicePairings.secretHash,
        left: sql<number>`extract(epoch from ${devicePairings.expiresAt} - now())::int`,
      })
      .from(devicePairings)
      .where(eq(devicePairings.id, m[1]));
    if (!row || row.left <= 0 || !secretMatches(m[2], row.secretHash))
      return null;
    if (!row.tenantId || !row.deviceId)
      return { status: 'pending' as const, expiresIn: row.left };
    const [device] = await this.db
      .select({ id: devices.id, name: devices.name })
      .from(devices)
      .where(
        and(
          eq(devices.tenantId, row.tenantId),
          eq(devices.id, row.deviceId),
          isNull(devices.revokedAt),
        ),
      );
    if (!device) return null;
    return {
      status: 'paired' as const,
      deviceToken: `${device.id}.${m[2]}`,
      device,
    };
  }
}

// The signed-out device's two routes: no session, and no store yet. Neither takes a pairing code.
@Controller('auth/device/pairing')
export class DevicePairingController {
  constructor(private readonly pairing: DevicePairing) {}

  @Public()
  @Post()
  @HttpCode(201)
  start() {
    return this.pairing.start();
  }

  @Public()
  @Post('status')
  @HttpCode(200)
  async status(@Body() body: unknown) {
    const { pairingToken } = parseBody(PairingStatus, body);
    const found = await this.pairing.status(pairingToken);
    if (!found) throw new NotFoundException();
    return found;
  }
}
