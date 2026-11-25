import {
  Body,
  Controller,
  HttpCode,
  HttpException,
  HttpStatus,
  Injectable,
  Ip,
  NotFoundException,
  Post,
} from '@nestjs/common';
import { and, eq, gt, isNull, lt, lte, sql } from 'drizzle-orm';
import { randomInt } from 'node:crypto';
import { z } from 'zod';
import type { Db } from '../db/db.module';
import { InjectDb } from '../db/db.module';
import { devicePairingAttempts, devicePairings, devices } from '../db/schema';
import { Public } from '../tenancy/decorators';
import { parseBody } from './http';
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
/**
 * Codes open at once for one network address, so that one caller cannot use up `MAX_LIVE_PAIRINGS` and block
 * pairing for every store. A shop pairing several tablets behind one address stays under it: a code stops
 * counting when it is used or expired.
 */
export const MAX_LIVE_PAIRINGS_PER_ADDRESS = 5;
/** How long after the claim the paired device may still fetch its token (a poll just after the code's end). */
export const PAIRING_TOKEN_GRACE_SECONDS = 10 * 60;
/** Status polls one network address may make per minute, per pos-api process. */
export const PAIRING_STATUS_POLLS_PER_MINUTE = 120;
const CODE_DIGITS = 6;
// pg_advisory_xact_lock key: one code is drawn at a time, so the caps are counted and the row is written as one.
const START_LOCK = 20220031;
const TOO_MANY = () =>
  new HttpException(
    { message: 'Terlalu banyak permintaan kode, coba lagi nanti' },
    HttpStatus.TOO_MANY_REQUESTS,
  );

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

  /**
   * The signed-out device asks for a code. `address` is the caller's network address: open codes are capped
   * per address and in all. The count and the insert are one step (a transaction-scoped advisory lock), so
   * parallel requests cannot pass the caps together.
   */
  async start(address: string) {
    const requesterHash = hashSecret(address);
    const secret = newDeviceSecret();
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(${START_LOCK})`);
      // Housekeeping: pairings long past their end (also the used ones; the device row is what stays).
      await tx
        .delete(devicePairings)
        .where(lt(devicePairings.expiresAt, sql`now() - interval '1 day'`));
      const [{ open, mine }] = await tx
        .select({
          open: sql<number>`count(*)::int`,
          mine: sql<number>`(count(*) filter (where ${devicePairings.requesterHash} = ${requesterHash}))::int`,
        })
        .from(devicePairings)
        .where(
          and(
            isNull(devicePairings.claimedAt),
            gt(devicePairings.expiresAt, sql`now()`),
          ),
        );
      if (open >= MAX_LIVE_PAIRINGS || mine >= MAX_LIVE_PAIRINGS_PER_ADDRESS)
        throw TOO_MANY();

      for (let attempt = 0; attempt < 5; attempt++) {
        const code = randomInt(0, 10 ** CODE_DIGITS)
          .toString()
          .padStart(CODE_DIGITS, '0');
        const codeHash = hashSecret(code);
        // An expired, unused pairing still holds its code's hash: free it.
        await tx
          .delete(devicePairings)
          .where(
            and(
              eq(devicePairings.codeHash, codeHash),
              lte(devicePairings.expiresAt, sql`now()`),
            ),
          );
        // Another open pairing drew the same code: nothing is written, draw again.
        const [row] = await tx
          .insert(devicePairings)
          .values({
            codeHash,
            secretHash: hashSecret(secret),
            requesterHash,
            expiresAt: sql`now() + make_interval(secs => ${PAIRING_CODE_TTL_SECONDS})`,
          })
          .onConflictDoNothing()
          .returning({ id: devicePairings.id });
        if (row)
          return {
            pairingToken: `${row.id}.${secret}`,
            code,
            expiresIn: PAIRING_CODE_TTL_SECONDS,
          };
      }
      throw TOO_MANY();
    });
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
          // The device learns of the claim by polling: give it time to, also when the code was about to end.
          expiresAt: sql`greatest(${devicePairings.expiresAt}, now() + make_interval(secs => ${PAIRING_TOKEN_GRACE_SECONDS}))`,
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
   * expired, wrong secret, or its device was revoked). A claimed pairing answers until
   * `PAIRING_TOKEN_GRACE_SECONDS` after the claim.
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
  /** Status polls per address in the current minute. In memory: a limit per process, lost on restart. */
  private readonly polls = new Map<string, { minute: number; count: number }>();

  constructor(private readonly pairing: DevicePairing) {}

  @Public()
  @Post()
  @HttpCode(201)
  start(@Ip() address: string) {
    return this.pairing.start(address);
  }

  @Public()
  @Post('status')
  @HttpCode(200)
  async status(@Ip() address: string, @Body() body: unknown) {
    this.countPoll(address);
    const { pairingToken } = parseBody(PairingStatus, body);
    const found = await this.pairing.status(pairingToken);
    if (!found) throw new NotFoundException();
    return found;
  }

  private countPoll(address: string) {
    const minute = Math.floor(Date.now() / 60_000);
    // Bounded: entries of past minutes are dropped before the map can grow without end.
    if (this.polls.size > 10_000)
      for (const [key, seen] of this.polls)
        if (seen.minute !== minute) this.polls.delete(key);
    const seen = this.polls.get(address);
    if (!seen || seen.minute !== minute) {
      this.polls.set(address, { minute, count: 1 });
      return;
    }
    if (++seen.count > PAIRING_STATUS_POLLS_PER_MINUTE)
      throw new HttpException(
        { message: 'Terlalu banyak permintaan, coba lagi nanti' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
  }
}
