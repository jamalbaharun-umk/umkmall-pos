import {
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  HttpCode,
  Injectable,
  Module,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { and, eq, gt, isNull, lte, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { recordAudit } from '../audit/record';
import { validate } from '../common/validation';
import { loadEnv } from '../config';
import type { Db } from '../db/db.module';
import { InjectDb } from '../db/db.module';
import { helperSessions } from '../db/schema';
import { lockDrawerShift } from '../shifts/cash-ledger';
import { isUniqueViolation } from '../staff/http';
import { hashSecret } from '../staff/secrets';
import { CurrentSession, HelperRoute } from '../tenancy/decorators';
import type { PosSession } from '../tenancy/session';
import { signSession } from '../tenancy/session';
import { VoidPin } from '../void/void.schemas';
import { VoidPins } from '../void/void-pin';

// UMK-2124 "Serahkan ke pembantu" (design 42, plan 2026-11-28-015). The owner parks the session behind the owner
// PIN and hands the till to a helper who may only sell; the owner comes back with the PIN. The security model is in
// the plan: a `helper` session kind that reaches only `@HelperRoute()` routes, the owner's native session refused by
// the refresh while parked (`parkedSidRefused`), the owner PIN counted with the void's rules (5 wrong, 5 minutes).

/** A handover lasts 12 hours (design 42); after that the owner signs in again by WhatsApp. */
export const HELPER_SESSION_SECONDS = 12 * 60 * 60;
/** The owner's POS session handed back at "Kembali ke pemilik": as long as a refreshed one. */
const OWNER_SESSION_SECONDS = 15 * 60;

export const HELPER_ACTIVE = 'helper_active';
export const SHIFT_REQUIRED_FOR_HELPER = 'shift_required';
export const SESSION_PARKED = 'session_parked';

const StartInput = z
  .object({
    pin: VoidPin,
    name: z
      .string({ invalid_type_error: 'Nama tidak valid' })
      .trim()
      .max(40, 'Nama paling banyak 40 huruf')
      .optional()
      .transform((v) => (v ? v : undefined)),
    // The owner's UMKMall native session id on this device (pos-web reads it from its httpOnly cookie). Stored
    // only as a hash; absent for a dev sign-in, which has no native session.
    parkedSid: z.string().min(1).max(200).optional(),
  })
  .strict();

const EndInput = z.object({ pin: VoidPin }).strict();

/**
 * True when `sid` is an owner's native session parked by a handover that the owner has not ended with the PIN:
 * one still running, or one that ran out (design 42: after 12 hours the owner signs in again by WhatsApp). The
 * refresh refuses such a session (`POST /auth/umkmall/refresh`, 403 `session_parked`).
 */
export async function parkedSidRefused(db: Db, sid: string) {
  const [parked] = await db
    .select({ id: helperSessions.id })
    .from(helperSessions)
    .where(
      and(
        eq(helperSessions.parkedSidHash, hashSecret(sid)),
        or(
          isNull(helperSessions.endedReason),
          eq(helperSessions.endedReason, 'expired'),
        ),
      ),
    )
    .limit(1);
  return Boolean(parked);
}

@Injectable()
export class HelperService {
  private readonly secret = loadEnv().POS_SESSION_SECRET;

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly pins: VoidPins,
  ) {}

  async start(s: PosSession, input: z.infer<typeof StartInput>) {
    if (s.kind !== 'owner')
      throw new ForbiddenException(
        'Hanya pemilik yang bisa menyerahkan kasir ke pembantu',
      );
    // The owner's own PIN, counted and locked like a void's (wrong 422, locked 429, none 422).
    await this.pins.verifyOwner(s.tenantId, s.actorId, input.pin);
    const row = await this.db
      .transaction(async (tx) => {
        // A handover that ran out was never ended by the PIN: it ends now as expired (its sid stays refused).
        await tx
          .update(helperSessions)
          .set({ endedAt: sql`now()`, endedReason: 'expired' })
          .where(
            and(
              eq(helperSessions.tenantId, s.tenantId),
              eq(helperSessions.ownerId, s.actorId),
              isNull(helperSessions.endedAt),
              lte(helperSessions.expiresAt, sql`now()`),
            ),
          );
        // The helper sells into the owner's shift: a store without staff opens it now (UMK-2120).
        const shift = await lockDrawerShift(tx, s, 'helper_start');
        if (!shift)
          throw new ConflictException({
            message:
              'Buka shift dulu, lalu serahkan kasir ke pembantu. Penjualan pembantu masuk ke shift Anda.',
            code: SHIFT_REQUIRED_FOR_HELPER,
          });
        const [created] = await tx
          .insert(helperSessions)
          .values({
            tenantId: s.tenantId,
            ownerId: s.actorId,
            name: input.name ?? null,
            parkedSidHash: input.parkedSid ? hashSecret(input.parkedSid) : null,
            expiresAt: sql`now() + make_interval(secs => ${HELPER_SESSION_SECONDS})`,
          })
          .returning({
            id: helperSessions.id,
            name: helperSessions.name,
            expiresAt: helperSessions.expiresAt,
          });
        await recordAudit(tx, s, 'helper_start', {
          target: {
            type: 'helper_session',
            id: created.id,
            label: 'Mode pembantu',
          },
          details: {
            helperSessionId: created.id,
            shiftId: shift.id,
            expiresAt: created.expiresAt.toISOString(),
          },
        });
        return created;
      })
      .catch((e: unknown) => {
        if (isUniqueViolation(e))
          throw new ConflictException({
            message:
              'Kasir sudah diserahkan ke pembantu di perangkat lain. Kembali ke pemilik di sana dulu.',
            code: HELPER_ACTIVE,
          });
        throw e;
      });
    const ttl = Math.max(
      1,
      Math.floor((row.expiresAt.getTime() - Date.now()) / 1000),
    );
    return {
      sessionToken: await signSession(
        {
          tenantId: s.tenantId,
          actorId: s.actorId,
          kind: 'helper',
          helperSessionId: row.id,
        },
        this.secret,
        ttl,
      ),
      expiresIn: ttl,
      helper: row,
    };
  }

  async end(s: PosSession, pin: string) {
    if (s.kind !== 'helper' || !s.helperSessionId)
      throw new ForbiddenException();
    await this.pins.verifyOwner(s.tenantId, s.actorId, pin);
    const helperSessionId = s.helperSessionId;
    await this.db.transaction(async (tx) => {
      const [ended] = await tx
        .update(helperSessions)
        .set({ endedAt: sql`now()`, endedReason: 'owner' })
        .where(
          and(
            eq(helperSessions.id, helperSessionId),
            eq(helperSessions.tenantId, s.tenantId),
            eq(helperSessions.ownerId, s.actorId),
            isNull(helperSessions.endedAt),
            gt(helperSessions.expiresAt, sql`now()`),
          ),
        )
        .returning({ id: helperSessions.id });
      // Ended meanwhile (a second "Kembali ke pemilik") or past its 12 hours: this token is dead.
      if (!ended) throw new UnauthorizedException();
      await recordAudit(tx, s, 'helper_end', {
        target: {
          type: 'helper_session',
          id: ended.id,
          label: 'Mode pembantu',
        },
        details: { helperSessionId: ended.id, reason: 'owner' },
      });
    });
    // The owner's session again, never fresh: making or resetting the owner PIN still needs a WhatsApp sign-in.
    return {
      sessionToken: await signSession(
        { tenantId: s.tenantId, actorId: s.actorId, kind: 'owner' },
        this.secret,
        OWNER_SESSION_SECONDS,
      ),
      expiresIn: OWNER_SESSION_SECONDS,
    };
  }
}

@Controller('helper')
export class HelperController {
  constructor(private readonly helper: HelperService) {}

  /** "Serahkan ke pembantu": the owner's PIN parks the owner session; the answer is the helper's token. */
  @Post('start')
  @HttpCode(201)
  start(@CurrentSession() s: PosSession, @Body() body: unknown) {
    return this.helper.start(s, validate(StartInput, body));
  }

  /** "Kembali ke pemilik": the owner's PIN ends the handover; the answer is the owner's token. */
  @HelperRoute()
  @Post('end')
  @HttpCode(200)
  end(@CurrentSession() s: PosSession, @Body() body: unknown) {
    return this.helper.end(s, validate(EndInput, body).pin);
  }
}

@Module({
  controllers: [HelperController],
  providers: [HelperService, VoidPins],
})
export class HelperModule {}
