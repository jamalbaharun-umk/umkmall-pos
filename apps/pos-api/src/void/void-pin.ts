import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { fieldError } from '../common/validation';
import type { Db } from '../db/db.module';
import { InjectDb } from '../db/db.module';
import {
  rolePermissions,
  staff,
  staffRoles,
  tenants,
  voidPins,
} from '../db/schema';
import { hashPin, verifyPin } from '../staff/secrets';
import type { Tx } from '../stock/stock.service';
import type { PosSession } from '../tenancy/session';
import { freshSignIn } from '../tenancy/session';

export const MAX_PIN_FAILURES = 5;
export const PIN_LOCK_SECONDS = 5 * 60;

export type Approver = { id: string; kind: 'owner' | 'cashier'; name: string };

type PinRow = typeof voidPins.$inferSelect;
type Check =
  { ok: true } | { ok: false; retryAfter?: number; attemptsLeft?: number };

const WRONG_PIN = 'PIN salah';

/** Uuids compared as Postgres does: an upper-case spelling of the owner's id is still the owner's row. */
const sameId = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** The refusal of a change to the owner's own PIN that needs a sign-in of the last minutes (UMK-2054). */
export const FRESH_SIGN_IN_REQUIRED = 'fresh_sign_in_required';

const wrongPin = (field: string) => fieldError(field, WRONG_PIN);

const locked = (field: string, retryAfter: number) => {
  const message = `Terlalu banyak PIN salah. Coba lagi dalam ${Math.ceil(retryAfter / 60)} menit, minta admin lain, atau minta pemilik membuka kuncinya.`;
  return new HttpException(
    { message, errors: { [field]: message }, retryAfter },
    HttpStatus.TOO_MANY_REQUESTS,
  );
};

/** The owner's own PIN is locked (an owner-only approval, UMK-2055): nobody else can stand in for it. */
export const OWNER_PIN_LOCKED = 'owner_pin_locked';
/** The owner has no PIN yet, so an owner-only approval cannot be given (UMK-2055). */
export const OWNER_PIN_MISSING = 'owner_pin_missing';

const ownerLocked = (retryAfter: number) => {
  const message = `Terlalu banyak PIN salah. Coba lagi dalam ${Math.ceil(retryAfter / 60)} menit, atau buka kuncinya di Pengaturan, Keamanan (Anda diminta masuk lagi dulu).`;
  return new HttpException(
    { message, errors: { pin: message }, retryAfter, code: OWNER_PIN_LOCKED },
    HttpStatus.TOO_MANY_REQUESTS,
  );
};

const ownerMissing = () => {
  const message =
    'Anda belum membuat PIN pembatalan. Buat dulu di Pengaturan, Keamanan.';
  return new HttpException(
    { message, errors: { pin: message }, code: OWNER_PIN_MISSING },
    HttpStatus.UNPROCESSABLE_ENTITY,
  );
};

/**
 * The void PIN (UMK-1962): the 6-digit PIN an approver types to approve a void. The only file that reads
 * or writes pos.void_pins (guard in src/guards.spec.ts), so the hash never reaches a response or a log.
 *
 * Lockout: every guess runs under the PIN row's lock, so parallel guesses are counted one by one. The
 * 5th wrong PIN in a row locks that approver for 5 minutes; a guess during the lock is refused without
 * being checked and does not extend it; after the lock the count starts again at 0. A correct PIN
 * resets the count. The owner can unlock an admin, and can remove an admin's forgotten PIN.
 *
 * The owner's own PIN (UMK-2054) approves what the owner session alone may not (the retry of a refused refund),
 * so the session alone never gets around it: changing it needs the old PIN; making the first one, removing a
 * forgotten one and clearing its lock need a fresh sign-in (`freshSignIn`: the owner came through UMKMall's
 * login in the last minutes; a refreshed session never counts), else 403 `fresh_sign_in_required`. An admin's
 * PIN is not that hole: the owner cannot set it, and it never approves an owner-only action.
 */
@Injectable()
export class VoidPins {
  constructor(@InjectDb() private readonly db: Db) {}

  private where(tenantId: string, actorId: string) {
    return and(eq(voidPins.tenantId, tenantId), eq(voidPins.actorId, actorId));
  }

  /** One guess against a locked row. The caller commits the transaction before answering. */
  private async check(tx: Tx, row: PinRow, pin: string): Promise<Check> {
    const now = Date.now();
    if (row.lockedUntil && row.lockedUntil.getTime() > now)
      return {
        ok: false,
        retryAfter: Math.ceil((row.lockedUntil.getTime() - now) / 1000),
      };
    const where = this.where(row.tenantId, row.actorId);
    if (await verifyPin(pin, row.pinHash)) {
      await tx
        .update(voidPins)
        .set({ failures: 0, lockedUntil: null })
        .where(where);
      return { ok: true };
    }
    // A lock that has run out is over: the count starts again.
    const failures = (row.lockedUntil ? 0 : row.failures) + 1;
    const lock = failures >= MAX_PIN_FAILURES;
    await tx
      .update(voidPins)
      .set({
        failures,
        lockedUntil: lock ? new Date(now + PIN_LOCK_SECONDS * 1000) : null,
      })
      .where(where);
    return lock
      ? { ok: false, retryAfter: PIN_LOCK_SECONDS }
      : { ok: false, attemptsLeft: MAX_PIN_FAILURES - failures };
  }

  private async lockRow(tx: Tx, tenantId: string, actorId: string) {
    const [row] = await tx
      .select()
      .from(voidPins)
      .where(this.where(tenantId, actorId))
      .for('update');
    return row;
  }

  /** Staff of this store who hold `sales.void` (active, not deleted), by id. */
  private async staffApprovers(tenantId: string, id?: string) {
    return this.db
      .selectDistinct({ id: staff.id, name: staff.name })
      .from(staff)
      .innerJoin(
        staffRoles,
        and(
          eq(staffRoles.tenantId, staff.tenantId),
          eq(staffRoles.staffId, staff.id),
        ),
      )
      .innerJoin(
        rolePermissions,
        and(
          eq(rolePermissions.tenantId, staffRoles.tenantId),
          eq(rolePermissions.roleId, staffRoles.roleId),
        ),
      )
      .where(
        and(
          eq(staff.tenantId, tenantId),
          eq(staff.active, true),
          isNull(staff.deletedAt),
          eq(rolePermissions.permission, 'sales.void'),
          id ? eq(staff.id, id) : undefined,
        ),
      )
      .orderBy(asc(staff.name));
  }

  private async ownerId(tenantId: string) {
    const [t] = await this.db
      .select({ userId: tenants.userId })
      .from(tenants)
      .where(eq(tenants.id, tenantId));
    return t?.userId ?? null;
  }

  /** The store's owner or a live staff member holding `sales.void`; null for anyone else. */
  private async approver(
    tenantId: string,
    actorId: string,
  ): Promise<Approver | null> {
    if ((await this.ownerId(tenantId)) === actorId)
      return { id: actorId, kind: 'owner', name: 'Pemilik' };
    const [member] = await this.staffApprovers(tenantId, actorId);
    return member ? { ...member, kind: 'cashier' } : null;
  }

  /** Who can approve a void in this store, and whether each can right now. Never the PIN or its hash. */
  async approvers(tenantId: string) {
    const ownerId = await this.ownerId(tenantId);
    const all: Approver[] = [
      ...(ownerId
        ? [{ id: ownerId, kind: 'owner' as const, name: 'Pemilik' }]
        : []),
      ...(await this.staffApprovers(tenantId)).map((m) => ({
        ...m,
        kind: 'cashier' as const,
      })),
    ];
    const pins = all.length
      ? await this.db
          .select({
            actorId: voidPins.actorId,
            lockedUntil: voidPins.lockedUntil,
          })
          .from(voidPins)
          .where(
            and(
              eq(voidPins.tenantId, tenantId),
              inArray(
                voidPins.actorId,
                all.map((a) => a.id),
              ),
            ),
          )
      : [];
    const byId = new Map(pins.map((p) => [p.actorId, p]));
    const now = Date.now();
    return all.map((a) => {
      const pin = byId.get(a.id);
      const until = pin?.lockedUntil;
      return {
        ...a,
        hasPin: !!pin,
        lockedUntil: until && until.getTime() > now ? until : null,
      };
    });
  }

  /** The signed-in actor's own PIN state. */
  async status(s: PosSession) {
    const [row] = await this.db
      .select({ lockedUntil: voidPins.lockedUntil })
      .from(voidPins)
      .where(this.where(s.tenantId, s.actorId));
    const until = row?.lockedUntil;
    return {
      hasPin: !!row,
      lockedUntil: until && until.getTime() > Date.now() ? until : null,
    };
  }

  /**
   * Checks `pin` for `approverId` and returns the approver. An unknown id, another store's id, a
   * deactivated staff member and one without `sales.void` all get the wrong-PIN answer and count nowhere.
   */
  async verify(
    tenantId: string,
    approverId: string,
    pin: string,
  ): Promise<Approver> {
    const approver = await this.approver(tenantId, approverId);
    if (!approver) throw wrongPin('pin');
    const outcome = await this.guess(tenantId, approverId, pin);
    if (!outcome)
      throw fieldError(
        'approverId',
        'Admin ini belum membuat PIN pembatalan. Buat dulu di Pengaturan, Keamanan.',
      );
    if (!outcome.ok)
      throw outcome.retryAfter
        ? locked('pin', outcome.retryAfter)
        : wrongPin('pin');
    return approver;
  }

  /** One guess against the approver's PIN row, under its lock; null when the approver has no PIN. */
  private guess(tenantId: string, approverId: string, pin: string) {
    return this.db.transaction(async (tx) => {
      const row = await this.lockRow(tx, tenantId, approverId);
      return row ? this.check(tx, row, pin) : null;
    });
  }

  /**
   * As `verify`, for an approval that is the OWNER's alone (the retry of a refused refund, owner decision
   * 2026-11-26): `approverId` must be the store's owner, so only the owner's own PIN row is ever checked.
   * Any other id, also an admin's who holds `sales.void` and has a PIN, or another store's owner, gets the
   * wrong-PIN answer and counts nowhere. The owner's count and lock are the void's own.
   *
   * Told in the owner's words (UMK-2055): no PIN yet is 422 `owner_pin_missing` on `pin`, a lock is 429
   * `owner_pin_locked` that points to Keamanan (clearing it needs a fresh sign-in, UMK-2054), never "ask another
   * admin": no admin can approve this.
   */
  async verifyOwner(
    tenantId: string,
    approverId: string,
    pin: string,
  ): Promise<Approver> {
    if ((await this.ownerId(tenantId)) !== approverId) throw wrongPin('pin');
    const outcome = await this.guess(tenantId, approverId, pin);
    if (!outcome) throw ownerMissing();
    if (!outcome.ok)
      throw outcome.retryAfter
        ? ownerLocked(outcome.retryAfter)
        : wrongPin('pin');
    return { id: approverId, kind: 'owner', name: 'Pemilik' };
  }

  /** The owner's own PIN row is touched without the old PIN only after a fresh sign-in (UMK-2054). */
  private needsFreshSignIn(s: PosSession) {
    if (!freshSignIn(s))
      throw new ForbiddenException({
        message:
          'Untuk keamanan, masuk lagi dengan akun UMKMall, lalu ulangi dalam 5 menit.',
        code: FRESH_SIGN_IN_REQUIRED,
      });
  }

  /**
   * Sets the actor's own PIN; changing an existing one needs the current PIN (counted like a void's). The
   * owner's first PIN (never made, or removed) has no old PIN to ask for, so it needs a fresh sign-in.
   */
  async set(s: PosSession, pin: string, currentPin?: string) {
    const pinHash = await hashPin(pin);
    const outcome = await this.db.transaction(async (tx): Promise<Check> => {
      const row = await this.lockRow(tx, s.tenantId, s.actorId);
      if (!row) {
        if (s.kind === 'owner') this.needsFreshSignIn(s);
        // On conflict: a concurrent first set won; this one is refused below like a missing current PIN.
        const made = await tx
          .insert(voidPins)
          .values({
            tenantId: s.tenantId,
            actorId: s.actorId,
            actorKind: s.kind,
            pinHash,
          })
          .onConflictDoNothing()
          .returning({ actorId: voidPins.actorId });
        return made.length ? { ok: true } : { ok: false, attemptsLeft: -1 };
      }
      if (currentPin === undefined) return { ok: false, attemptsLeft: -1 };
      const checked = await this.check(tx, row, currentPin);
      if (checked.ok)
        await tx
          .update(voidPins)
          .set({ pinHash, updatedAt: new Date() })
          .where(this.where(s.tenantId, s.actorId));
      return checked;
    });
    if (!outcome.ok) {
      if (outcome.retryAfter) throw locked('currentPin', outcome.retryAfter);
      throw outcome.attemptsLeft === -1
        ? fieldError('currentPin', 'Masukkan PIN lama untuk menggantinya')
        : wrongPin('currentPin');
    }
    return this.status(s);
  }

  /**
   * The owner's "Lupa PIN" (UMK-2054): replaces the owner's own PIN, or makes the first one, and clears its count
   * and lock, in ONE statement, so there is never a moment with the old PIN gone and no new one. Owner only, and
   * only after a fresh sign-in (as removing it and clearing its lock are). An admin's forgotten PIN is removed by
   * the owner (`reset`) and set again by the admin.
   */
  async replaceForgotten(s: PosSession, pin: string) {
    this.ownerOnly(s);
    this.needsFreshSignIn(s);
    const pinHash = await hashPin(pin);
    await this.db
      .insert(voidPins)
      .values({
        tenantId: s.tenantId,
        actorId: s.actorId,
        actorKind: s.kind,
        pinHash,
      })
      .onConflictDoUpdate({
        target: [voidPins.tenantId, voidPins.actorId],
        set: { pinHash, failures: 0, lockedUntil: null, updatedAt: new Date() },
      });
    return this.status(s);
  }

  private ownerOnly(s: PosSession) {
    if (s.kind !== 'owner') throw new ForbiddenException();
  }

  /**
   * Owner only: clears an approver's lock and count. 404 for an id without a PIN in this store. The owner's own
   * lock needs a fresh sign-in.
   */
  async unlock(s: PosSession, actorId: string) {
    this.ownerOnly(s);
    if (sameId(actorId, s.actorId)) this.needsFreshSignIn(s);
    const rows = await this.db
      .update(voidPins)
      .set({
        failures: 0,
        lockedUntil: null,
        unlockedAt: new Date(),
        unlockedBy: s.actorId,
      })
      .where(this.where(s.tenantId, actorId))
      .returning({ actorId: voidPins.actorId });
    if (!rows.length) throw new NotFoundException();
    return { actorId, hasPin: true, lockedUntil: null };
  }

  /** Owner only: removes a forgotten PIN, so its holder sets a new one. The owner's own needs a fresh sign-in. */
  async reset(s: PosSession, actorId: string) {
    this.ownerOnly(s);
    if (sameId(actorId, s.actorId)) this.needsFreshSignIn(s);
    const rows = await this.db
      .delete(voidPins)
      .where(this.where(s.tenantId, actorId))
      .returning({ actorId: voidPins.actorId });
    if (!rows.length) throw new NotFoundException();
    return { actorId, hasPin: false, lockedUntil: null };
  }
}
