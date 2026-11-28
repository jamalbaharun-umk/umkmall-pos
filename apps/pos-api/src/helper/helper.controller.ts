import {
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  HttpCode,
  HttpException,
  Injectable,
  Module,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { and, eq, gt, isNull, lte, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { recordAudit } from '../audit/record';
import { fieldError, validate } from '../common/validation';
import { loadEnv } from '../config';
import type { Db } from '../db/db.module';
import { InjectDb } from '../db/db.module';
import { helperSessions } from '../db/schema';
import { lockDrawerShift } from '../shifts/cash-ledger';
import { isUniqueViolation } from '../staff/http';
import { hashSecret } from '../staff/secrets';
import { CurrentSession, HelperRoute } from '../tenancy/decorators';
import type { PosSession } from '../tenancy/session';
import { freshSignIn, signSession } from '../tenancy/session';
import { VoidPin } from '../void/void.schemas';
import { FRESH_SIGN_IN_REQUIRED, VoidPins } from '../void/void-pin';

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
export const SIGN_IN_AGAIN = 'sign_in_again';
export const HELPER_NOT_ACTIVE = 'helper_not_active';

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
    // only as a hash, and it must be the native session this owner session came from (the token's `nsh`). Required
    // whenever the owner signs in by WhatsApp; absent only where there is no native sign-in (a dev sign-in).
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
        // Released only by the owner's PIN: a running handover, one that ran out, and one the owner ended by
        // signing in again (that sign-in made a new native session; the parked one never wakes).
        or(
          isNull(helperSessions.endedReason),
          eq(helperSessions.endedReason, 'expired'),
          eq(helperSessions.endedReason, 'signin'),
        ),
      ),
    )
    .limit(1);
  return Boolean(parked);
}

@Injectable()
export class HelperService {
  private readonly env = loadEnv();
  private readonly secret = this.env.POS_SESSION_SECRET;

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly pins: VoidPins,
  ) {}

  async start(s: PosSession, input: z.infer<typeof StartInput>) {
    if (s.kind !== 'owner')
      throw new ForbiddenException(
        'Hanya pemilik yang bisa menyerahkan kasir ke pembantu',
      );
    const parkedSidHash = this.parkedHashOf(s, input.parkedSid);
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
            parkedSidHash,
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
    const helperSessionId = s.helperSessionId;
    try {
      await this.pins.verifyOwner(s.tenantId, s.actorId, pin);
    } catch (e) {
      await this.auditRefusal(s, helperSessionId, e);
      throw e;
    }
    const parked = await this.db.transaction(async (tx) => {
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
        .returning({
          id: helperSessions.id,
          parkedSidHash: helperSessions.parkedSidHash,
        });
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
      return ended.parkedSidHash;
    });
    // The owner's session again, never fresh: making or resetting the owner PIN still needs a WhatsApp sign-in, and
    // so does changing it (a handover happened since it was set). It names the native session it unparked.
    return {
      sessionToken: await signSession(
        {
          tenantId: s.tenantId,
          actorId: s.actorId,
          kind: 'owner',
          ...(parked && { nativeSidHash: parked }),
        },
        this.secret,
        OWNER_SESSION_SECONDS,
      ),
      expiresIn: OWNER_SESSION_SECONDS,
    };
  }

  /**
   * The owner ends a handover from a fresh WhatsApp sign-in (review of PR 109): the device that held the helper's
   * till is lost or was signed out, so "Kembali ke pemilik" cannot be pressed there. The handover ends as `signin`
   * and its parked native session stays refused (the sign-in made a new one). 409 `helper_not_active` when there is
   * none to end.
   */
  async closeByOwner(s: PosSession) {
    if (s.kind !== 'owner')
      throw new ForbiddenException(
        'Hanya pemilik yang bisa mengakhiri mode pembantu',
      );
    if (!freshSignIn(s))
      throw new ForbiddenException({
        message:
          'Untuk keamanan, masuk lagi dengan akun UMKMall, lalu akhiri mode pembantu dalam 5 menit.',
        code: FRESH_SIGN_IN_REQUIRED,
      });
    return this.db.transaction(async (tx) => {
      const [ended] = await tx
        .update(helperSessions)
        .set({
          endedAt: sql`now()`,
          endedReason: sql`case when ${helperSessions.expiresAt} <= now() then 'expired' else 'signin' end`,
        })
        .where(
          and(
            eq(helperSessions.tenantId, s.tenantId),
            eq(helperSessions.ownerId, s.actorId),
            isNull(helperSessions.endedAt),
          ),
        )
        .returning({
          id: helperSessions.id,
          endedReason: helperSessions.endedReason,
        });
      if (!ended)
        throw new ConflictException({
          message: 'Tidak ada mode pembantu yang sedang berjalan.',
          code: HELPER_NOT_ACTIVE,
        });
      await recordAudit(tx, s, 'helper_end', {
        target: {
          type: 'helper_session',
          id: ended.id,
          label: 'Mode pembantu',
        },
        details: { helperSessionId: ended.id, reason: ended.endedReason },
      });
      return { ended: true };
    });
  }

  /**
   * The parked native session's hash for a start: the one this owner session came from. A WhatsApp-signed-in owner
   * must name it (pos-web reads its httpOnly cookie), so a start can never leave the owner's native session awake
   * for the helper's device to refresh. A session without `nsh` where native sign-in exists (signed before UMK-2124)
   * signs in again; only without native sign-in (development) is there nothing to park.
   */
  private parkedHashOf(s: PosSession, parkedSid: string | undefined) {
    if (s.nativeSidHash) {
      if (!parkedSid || hashSecret(parkedSid) !== s.nativeSidHash)
        throw fieldError(
          'parkedSid',
          'Sesi pemilik di perangkat ini tidak cocok. Masuk lagi lewat WhatsApp, lalu serahkan kasir.',
        );
      return s.nativeSidHash;
    }
    if (this.env.UMKMALL_API_URL)
      throw new ForbiddenException({
        message: 'Masuk lagi lewat WhatsApp, lalu serahkan kasir ke pembantu.',
        code: SIGN_IN_AGAIN,
      });
    return null;
  }

  /** A wrong, locked or missing owner PIN at "Kembali ke pemilik" is audited (never the PIN), in its own write. */
  private async auditRefusal(
    s: PosSession,
    helperSessionId: string,
    e: unknown,
  ) {
    if (!(e instanceof HttpException)) return;
    const status = e.getStatus();
    const code = (e.getResponse() as { code?: unknown }).code;
    const reason =
      status === 429
        ? 'locked'
        : code === 'owner_pin_missing'
          ? 'missing'
          : status === 422
            ? 'wrong_pin'
            : null;
    if (!reason) return;
    // A failed audit write must not turn the PIN's 422/429 into a 500: the refusal is answered either way.
    await this.db
      .transaction((tx) =>
        recordAudit(tx, s, 'helper_end_refused', {
          target: {
            type: 'helper_session',
            id: helperSessionId,
            label: 'Mode pembantu',
          },
          details: { helperSessionId, reason },
        }),
      )
      .catch(() => undefined);
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

  /** The owner ends a handover from a fresh WhatsApp sign-in, when the helper's device cannot be reached. */
  @Post('close')
  @HttpCode(200)
  close(@CurrentSession() s: PosSession) {
    return this.helper.closeByOwner(s);
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
