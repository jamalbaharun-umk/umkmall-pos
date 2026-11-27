import {
  forwardRef,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, isNull, or, sql } from 'drizzle-orm';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { recordAudit } from '../audit/record';
import {
  codedError,
  formatRupiah,
  Rupiah,
  UuidField,
} from '../common/validation';
import { type Db, InjectDb } from '../db/db.module';
import {
  CORRECTION_REASONS,
  paymentMethods,
  receivablePayments,
  receivables,
  sales,
  shiftCashEntries,
  shifts,
  staff,
} from '../db/schema';
import { PaymentSync } from '../payments-client/payment-sync.service';
import { paymentMethodCode } from '../payments-client/payments.client';
import {
  assertPersonAtTill,
  recordShiftCashIfOpen,
  recordShiftCashInShift,
} from '../shifts/cash-ledger';
import { isUniqueViolation } from '../staff/http';
import { isSelfApproval } from '../sales/line-discount';
import { hasPermission } from '../staff/require-permission';
import type { Tx } from '../stock/stock.service';
import { StoreCashDepositsService } from '../store-cash/store-cash-deposits.service';
import {
  assertStoreCashCovers,
  recordStoreCash,
} from '../store-cash/store-cash-ledger';
import type { PosSession } from '../tenancy/session';
import { type Approver, VoidPins } from '../void/void-pin';
import { VoidPin } from '../void/void.schemas';
import { ReceivablesService } from './receivables.controller';

export const CorrectionInput = z
  .object({
    // The payment as it should have been; null = "Batalkan saja": the payment is cancelled with no replacement.
    replacement: z
      .object({
        amount: Rupiah.positive('Harus lebih dari 0'),
        paymentMethodId: UuidField.optional(), // default: the store's Tunai
      })
      .strict()
      .nullable(),
    reasonCode: z.enum(CORRECTION_REASONS, {
      required_error: 'Pilih alasan koreksi',
      invalid_type_error: 'Pilih alasan koreksi',
    }),
    note: z.string().trim().max(200).optional(),
    // The owner or staff member holding `sales.void` whose void PIN is typed (design: "PIN admin").
    approverId: UuidField,
    pin: VoidPin,
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.reasonCode === 'other' && !v.note)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['note'],
        message: 'Tulis alasan koreksi',
      });
  });
export type CorrectionInput = z.infer<typeof CorrectionInput>;

/** The request's fingerprint for a replay. The PIN is not part of it and is stored nowhere. */
const requestHash = (
  receivableId: string,
  paymentId: string,
  i: CorrectionInput,
) =>
  createHash('sha256')
    .update(
      JSON.stringify([
        'correction',
        receivableId,
        paymentId,
        i.replacement?.amount ?? null,
        i.replacement?.paymentMethodId?.toLowerCase() ?? null,
        i.reasonCode,
        i.note || null,
        i.approverId.toLowerCase(),
      ]),
    )
    .digest('hex');

/** The new payment's own key: a client key never holds a `.`, so it cannot collide with one. */
const replacementKey = (key: string) => `${key}.n`;

const KEY_REUSED = 'Kunci ini sudah dipakai untuk transaksi lain';
export const CORRECTION_SELF_APPROVAL = 'CORRECTION_SELF_APPROVAL';
const NO_SHIFT_CASH = 'Buka shift dulu sebelum menerima pembayaran tunai';

const rp = receivablePayments;

type Original = {
  id: string;
  amount: number;
  paymentMethodId: string;
  isCash: boolean;
  actorId: string;
  actorKind: string;
  idempotencyKey: string | null;
  reversesId: string | null;
  collectedOutsideShift: boolean;
  seq: number | null;
};

/**
 * Where the cash of a corrected instalment goes back from (UMK-1971):
 * - `shift`: it was taken in shift `shiftId`; out of that drawer while it is open, else out of the store's cash (owner
 *   ruling 2026-11-26: a closed shift and today's drawer never change, as a voided drawer expense);
 * - `collector`: collected outside a shift by `collectorId`; out of the store's cash, lowering what they hold;
 * - `none`: not cash, or cash that never reached a drawer ledger.
 */
type CashBack =
  | { kind: 'none' }
  | { kind: 'shift'; shiftId: string; open: boolean }
  | { kind: 'collector'; collectorId: string; collectorKind: string };

/** The reversal's cash leaves the store's own cash: the instalment was taken in a shift that has closed since. */
const outOfStoreCash = (back: CashBack) => back.kind === 'shift' && !back.open;

/**
 * "Koreksi pembayaran kasbon" (UMK-1971, design feature 31, owner decision: reversal plus new payment). A correction
 * never changes or deletes a payment row: in one transaction, under the receivable's row lock, it appends a REVERSAL
 * row (`reverses_id`, minus the old amount) and, unless the payment is only cancelled, a NEW payment (`replaces_id`),
 * both dated now, and moves `receivables.rest` by `+old − new`. Closed shifts and closed days keep their figures.
 *
 * This file is the only writer of the ledger kinds `receivable_reversal` and `receivable_reversal_closed_shift` (guard
 * in src/guards.spec.ts); the ledger rows themselves go through `recordShiftCashInShift` / `recordStoreCash`.
 * The approver is a second person (`CORRECTION_SELF_APPROVAL`); the owner may approve their own.
 *
 * Lock order (the one a payment and a deposit use): receivable row, the collector's staff row, then shifts; when two
 * shifts are touched (the instalment's and the actor's), both at once in id order.
 * Checks run cheapest and safest first: validation, replay, state (no lock), then the approver's PIN, then all again
 * under the locks. A request that cannot succeed never costs a PIN attempt.
 *
 * Refusals carry a `code`: `CORRECTION_SELF_APPROVAL`, `IDEMPOTENCY_KEY_REUSED`, `RECEIVABLE_CANCELLED`, `ALREADY_REVERSED`, `NOT_CORRECTABLE`,
 * `DOWN_PAYMENT`, `SAME_AS_ORIGINAL`, `AMOUNT_EXCEEDS_REST`, `SHIFT_REQUIRED`, `REVERSAL_EXCEEDS_HELD` (with
 * `outstanding`), `AGENT_FORBIDDEN`; a wrong PIN is VoidPins' own 422/429.
 */
@Injectable()
export class ReceivableCorrectionsService {
  constructor(
    @InjectDb() private readonly db: Db,
    // forwardRef: receivables.controller.ts imports this file too (its module and route).
    @Inject(forwardRef(() => ReceivablesService))
    private readonly receivables: ReceivablesService,
    private readonly pins: VoidPins,
    private readonly payments: PaymentSync,
    private readonly collectors: StoreCashDepositsService,
  ) {}

  async correct(
    s: PosSession,
    receivableId: string,
    paymentId: string,
    key: string,
    input: CorrectionInput,
  ) {
    // An agent never corrects money: refused before any lookup.
    assertPersonAtTill(s.kind);
    // A second person approves (owner ruling 2026-11-26, the line-discount rule): only the owner may approve their
    // own correction. Refused before anything else, so no PIN attempt counts.
    if (isSelfApproval(s, input.approverId))
      throw codedError(
        CORRECTION_SELF_APPROVAL,
        'approverId',
        'Koreksi ini harus disetujui admin lain atau pemilik',
      );
    const hash = requestHash(receivableId, paymentId, input);
    const prior = await this.byKey(this.db, s.tenantId, key);
    if (prior)
      return this.answer(s, receivableId, replay(prior, paymentId, hash));

    await this.check(this.db, s, receivableId, paymentId, input, false);
    const approver = await this.pins.verify(
      s.tenantId,
      input.approverId,
      input.pin,
    );

    let done: { reversalId: string; recordedId: string | null };
    try {
      done = await this.db.transaction((tx) =>
        this.apply(tx, s, receivableId, paymentId, key, hash, input, approver),
      );
    } catch (e) {
      // The same key raced in (another correction or payment): the unique index refused this one.
      if (!isUniqueViolation(e)) throw e;
      const winner = await this.byKey(this.db, s.tenantId, key);
      if (!winner) throw e;
      return this.answer(s, receivableId, replay(winner, paymentId, hash));
    }
    // Committed. payment-api follows: the old payment is voided there, the new one recorded (the job repeats a
    // failure).
    await this.payments.afterCommit(
      'receivable_reversal',
      done.reversalId,
      () => this.payments.syncReceivableReversal(s.tenantId, done.reversalId),
    );
    const recorded = done.recordedId;
    if (recorded)
      await this.payments.afterCommit('receivable_payment', recorded, () =>
        this.payments.recordReceivablePayment(s.tenantId, recorded),
      );
    return this.answer(s, receivableId, done.reversalId);
  }

  /** The approver picker of the correction dialog: who holds sales.void with a PIN, never the asking staff member. */
  async approvers(s: PosSession) {
    const all = await this.pins.approvers(s.tenantId);
    return all.filter((a) => !isSelfApproval(s, a.id));
  }

  private async byKey(db: Db | Tx, tenantId: string, key: string) {
    const [row] = await db
      .select({ id: rp.id, reversesId: rp.reversesId, hash: rp.requestHash })
      .from(rp)
      .where(and(eq(rp.tenantId, tenantId), eq(rp.idempotencyKey, key)));
    return row ?? null;
  }

  /**
   * Every refusal that needs no PIN. Run first without locks (`locked` false), then again inside the transaction
   * under the receivable's row lock, where it decides.
   */
  private async check(
    db: Db | Tx,
    s: PosSession,
    receivableId: string,
    paymentId: string,
    input: CorrectionInput,
    locked: boolean,
  ) {
    const q = db
      .select({ rest: receivables.rest, cancelledAt: receivables.cancelledAt })
      .from(receivables)
      .where(
        and(
          eq(receivables.tenantId, s.tenantId),
          eq(receivables.id, receivableId),
        ),
      );
    const [r] = locked ? await q.for('update') : await q;
    if (!r) throw new NotFoundException();
    const [p] = await db
      .select({
        id: rp.id,
        amount: rp.amount,
        paymentMethodId: rp.paymentMethodId,
        isCash: paymentMethods.isCash,
        actorId: rp.actorId,
        actorKind: rp.actorKind,
        idempotencyKey: rp.idempotencyKey,
        reversesId: rp.reversesId,
        collectedOutsideShift: rp.collectedOutsideShift,
        seq: rp.seq,
      })
      .from(rp)
      .innerJoin(
        paymentMethods,
        and(
          eq(paymentMethods.tenantId, rp.tenantId),
          eq(paymentMethods.id, rp.paymentMethodId),
        ),
      )
      .where(
        and(
          eq(rp.tenantId, s.tenantId),
          eq(rp.receivableId, receivableId),
          eq(rp.id, paymentId),
        ),
      );
    if (!p) throw new NotFoundException();
    if (r.cancelledAt)
      throw codedError(
        'RECEIVABLE_CANCELLED',
        '_',
        'Kasbon ini sudah dibatalkan bersama struknya, jadi pembayarannya tidak bisa dikoreksi',
      );
    if (p.reversesId)
      throw codedError(
        'NOT_CORRECTABLE',
        '_',
        'Baris pembalik tidak bisa dikoreksi. Koreksi pembayaran barunya bila masih salah.',
      );
    const [reversal] = await db
      .select({ id: rp.id })
      .from(rp)
      .where(and(eq(rp.tenantId, s.tenantId), eq(rp.reversesId, p.id)));
    if (reversal)
      throw codedError(
        'ALREADY_REVERSED',
        '_',
        'Pembayaran ini sudah dikoreksi sebelumnya. Muat ulang riwayat pembayaran.',
      );
    // The down payment (the only row without a key) is part of its sale: a void of the receipt undoes it.
    if (p.idempotencyKey === null)
      throw codedError(
        'DOWN_PAYMENT',
        '_',
        'Uang muka adalah bagian dari struk. Untuk mengubahnya, batalkan struknya.',
      );
    const restAfterReversal = r.rest + p.amount;
    const next = input.replacement;
    if (next && next.amount > restAfterReversal)
      throw codedError(
        'AMOUNT_EXCEEDS_REST',
        'replacement.amount',
        `Pembayaran melebihi sisa piutang (${formatRupiah(restAfterReversal)})`,
      );
    const method = next
      ? await this.receivables.method(
          db as Tx,
          s.tenantId,
          next.paymentMethodId,
        )
      : null;
    if (
      next &&
      method &&
      next.amount === p.amount &&
      method.id === p.paymentMethodId
    )
      throw codedError(
        'SAME_AS_ORIGINAL',
        'replacement.amount',
        'Jumlah dan cara bayar sama dengan pembayaran lama. Ubah salah satunya, atau pilih Batalkan saja.',
      );
    const back = await this.cashBack(db, s.tenantId, p);
    if (!locked) {
      // Without locks: refuse early what will certainly fail, so no PIN attempt is spent on it.
      const open = await this.hasOpenShift(s);
      if (method?.isCash && !open && hasPermission(s, 'sales.create'))
        throw codedError('SHIFT_REQUIRED', '_', NO_SHIFT_CASH);
      if (back.kind === 'collector')
        await this.assertHeld(db, s, back, p.amount);
      // Cash that goes back out of the store's cash, which never goes negative: refused before the PIN.
      if (outOfStoreCash(back))
        await assertStoreCashCovers(db, s.tenantId, p.amount);
    }
    return { r, p, method, back, restAfterReversal };
  }

  private async hasOpenShift(s: PosSession) {
    const [open] = await this.db
      .select({ id: shifts.id })
      .from(shifts)
      .where(
        and(
          eq(shifts.tenantId, s.tenantId),
          eq(shifts.actorId, s.actorId),
          sql`${shifts.closedAt} is null`,
        ),
      );
    return !!open;
  }

  private async cashBack(
    db: Db | Tx,
    tenantId: string,
    p: Original,
  ): Promise<CashBack> {
    if (!p.isCash) return { kind: 'none' };
    if (p.collectedOutsideShift)
      return {
        kind: 'collector',
        collectorId: p.actorId,
        collectorKind: p.actorKind,
      };
    const [entry] = await db
      .select({ shiftId: shiftCashEntries.shiftId, closedAt: shifts.closedAt })
      .from(shiftCashEntries)
      .innerJoin(
        shifts,
        and(
          eq(shifts.tenantId, shiftCashEntries.tenantId),
          eq(shifts.id, shiftCashEntries.shiftId),
        ),
      )
      .where(
        and(
          eq(shiftCashEntries.tenantId, tenantId),
          eq(shiftCashEntries.kind, 'receivable_payment'),
          eq(shiftCashEntries.refId, p.id),
        ),
      );
    return entry
      ? { kind: 'shift', shiftId: entry.shiftId, open: entry.closedAt === null }
      : { kind: 'none' };
  }

  /**
   * A reversal may lower what the collector still holds, never below what their deposits already covered: the
   * cash handed over is in a drawer now, and a correction changes the customer's debt, not a deposit.
   */
  private async assertHeld(
    db: Db | Tx,
    s: PosSession,
    back: { collectorId: string },
    amount: number,
  ) {
    const [cash] = await this.collectors.collectors(
      s.tenantId,
      db,
      back.collectorId,
    );
    const outstanding = cash?.outstanding ?? 0;
    if (amount > outstanding)
      throw codedError(
        'REVERSAL_EXCEEDS_HELD',
        '_',
        `Uang pembayaran ini sudah disetor penagih. Koreksi hanya bisa sebesar uang yang masih dipegang penagih (${formatRupiah(outstanding)}).`,
        { outstanding },
      );
  }

  private async apply(
    tx: Tx,
    s: PosSession,
    receivableId: string,
    paymentId: string,
    key: string,
    hash: string,
    input: CorrectionInput,
    approver: Approver,
  ): Promise<{ reversalId: string; recordedId: string | null }> {
    // The receivable's row lock first: two corrections, or a correction and a payment or a void, apply one after
    // the other. A duplicate in flight waits here and then finds the first correction under its key.
    await tx
      .select({ id: receivables.id })
      .from(receivables)
      .where(
        and(
          eq(receivables.tenantId, s.tenantId),
          eq(receivables.id, receivableId),
        ),
      )
      .for('update');
    const prior = await this.byKey(tx, s.tenantId, key);
    if (prior)
      return { reversalId: replay(prior, paymentId, hash), recordedId: null };
    const { r, p, method, back, restAfterReversal } = await this.check(
      tx,
      s,
      receivableId,
      paymentId,
      input,
      true,
    );
    const reversalId = randomUUID();
    const next = input.replacement;

    // The reversal row first: it claims the key (a concurrent duplicate on another receivable fails here).
    await tx.insert(rp).values({
      id: reversalId,
      tenantId: s.tenantId,
      receivableId,
      amount: -p.amount,
      paymentMethodId: p.paymentMethodId,
      restBefore: r.rest,
      actorId: s.actorId,
      actorKind: s.kind,
      idempotencyKey: key,
      requestHash: hash,
      // The reversal of an outside-shift instalment takes its cash out of the store's cash as well.
      collectedOutsideShift: back.kind === 'collector',
      reversesId: p.id,
      reasonCode: input.reasonCode,
      note: input.note || null,
      approvedBy: approver.id,
      approvedByKind: approver.kind,
      paymentSyncPending: this.payments.enabled && p.seq !== null,
    });

    // The old payment's cash goes back out the way it came in.
    const cashOut = {
      direction: 'out',
      kind: 'receivable_reversal',
      amount: p.amount,
      refId: reversalId,
    } as const;
    if (back.kind === 'collector') {
      // The collector's staff row lock serialises this with their deposits (the lock a deposit takes).
      await tx
        .select({ id: staff.id })
        .from(staff)
        .where(
          and(eq(staff.tenantId, s.tenantId), eq(staff.id, back.collectorId)),
        )
        .for('update');
      await this.assertHeld(tx, s, back, p.amount);
      // Lowers the balance and what this cashier collector holds alike (an owner never collects outside a shift: the
      // owner holds `sales.create`), so the store's own cash is untouched: no store cash lock.
      await recordStoreCash(tx, s, cashOut);
    } else if (back.kind === 'shift') {
      // The instalment's shift and the actor's open one, locked together in id order: two cashiers correcting each
      // other's instalments would otherwise each hold one drawer and wait for the other (40P01).
      await tx
        .select({ id: shifts.id })
        .from(shifts)
        .where(
          and(
            eq(shifts.tenantId, s.tenantId),
            or(
              eq(shifts.id, back.shiftId),
              and(eq(shifts.actorId, s.actorId), isNull(shifts.closedAt)),
            ),
          ),
        )
        .orderBy(shifts.id)
        .for('update');
      // Out of the instalment's own drawer while that shift is open. A closed shift never changes and today's
      // drawer did not hold that cash: it goes out of the store's cash (owner ruling 2026-11-26), no shift needed.
      const inOwnShift = await recordShiftCashInShift(
        tx,
        s,
        back.shiftId,
        cashOut,
      );
      if (!inOwnShift)
        await recordStoreCash(
          tx,
          s,
          {
            ...cashOut,
            kind: 'receivable_reversal_closed_shift',
          },
          { mustCover: true },
        );
    }

    let recordedId: string | null = null;
    let newPaymentId: string | null = null;
    if (next && method) {
      const newId = randomUUID();
      newPaymentId = newId;
      const [{ seq }] = await tx
        .select({
          seq: sql<number>`coalesce(max(${rp.seq}), 0) + 1`.mapWith(Number),
        })
        .from(rp)
        .where(
          and(eq(rp.tenantId, s.tenantId), eq(rp.receivableId, receivableId)),
        );
      // The instalment rule of `ReceivablesService.pay`: the actor's open shift takes cash; an actor who can open
      // a shift must; one who cannot collects outside a shift into the store's cash.
      const cashIn = {
        direction: 'in',
        kind: 'receivable_payment',
        amount: next.amount,
        refId: newId,
      } as const;
      const shiftId = method.isCash
        ? await recordShiftCashIfOpen(tx, s, cashIn)
        : null;
      const outsideShift = method.isCash && !shiftId;
      if (outsideShift) {
        if (hasPermission(s, 'sales.create'))
          throw codedError('SHIFT_REQUIRED', '_', NO_SHIFT_CASH);
        await recordStoreCash(tx, s, cashIn);
      }
      await tx.insert(rp).values({
        id: newId,
        tenantId: s.tenantId,
        receivableId,
        amount: next.amount,
        paymentMethodId: method.id,
        restBefore: restAfterReversal,
        actorId: s.actorId,
        actorKind: s.kind,
        idempotencyKey: replacementKey(key),
        requestHash: hash,
        collectedOutsideShift: outsideShift,
        replacesId: p.id,
        seq: this.payments.enabled ? seq : null,
        paymentMethodCode: this.payments.enabled
          ? paymentMethodCode(method)
          : null,
      });
      if (this.payments.enabled) recordedId = newId;
    }
    await tx
      .update(receivables)
      .set({
        rest: restAfterReversal - (next?.amount ?? 0),
        ...(next ? { lastPaymentAt: new Date() } : {}),
      })
      .where(
        and(
          eq(receivables.tenantId, s.tenantId),
          eq(receivables.id, receivableId),
        ),
      );
    // Log aktivitas (UMK-1969): ids, amounts, the reason code and the approver; never the note or the customer.
    const [sale] = await tx
      .select({ number: sales.number })
      .from(receivables)
      .innerJoin(
        sales,
        and(
          eq(sales.tenantId, receivables.tenantId),
          eq(sales.id, receivables.saleId),
        ),
      )
      .where(
        and(
          eq(receivables.tenantId, s.tenantId),
          eq(receivables.id, receivableId),
        ),
      );
    await recordAudit(tx, s, 'kasbon_correction', {
      target: {
        type: 'receivable',
        id: receivableId,
        label: sale?.number ? `Kasbon struk #${sale.number}` : 'Kasbon',
      },
      details: {
        receivableId,
        paymentId: p.id,
        reversalId,
        newPaymentId,
        oldAmount: p.amount,
        newAmount: next?.amount ?? null,
        reasonCode: input.reasonCode,
        approvedBy: approver.id,
      },
    });
    return { reversalId, recordedId };
  }

  /** The correction and the receivable as they stand now. */
  private async answer(
    s: PosSession,
    receivableId: string,
    reversalId: string,
  ) {
    const receivable = await this.receivables.get(s.tenantId, receivableId);
    const reversal = receivable.payments.find((x) => x.id === reversalId);
    if (!reversal?.reversesId) throw new NotFoundException();
    const old = receivable.payments.find((x) => x.id === reversal.reversesId);
    const replacement = receivable.payments.find(
      (x) => x.replacesId === reversal.reversesId,
    );
    return {
      correction: {
        id: reversal.id,
        paymentId: reversal.reversesId,
        oldAmount: old?.amount ?? -reversal.amount,
        newAmount: replacement?.amount ?? null,
        newPaymentId: replacement?.id ?? null,
        reasonCode: reversal.reasonCode,
        restAfter: receivable.rest,
        createdAt: reversal.createdAt,
      },
      receivable,
    };
  }
}

/** A key already used: the first correction when it is the same request, else 422 `IDEMPOTENCY_KEY_REUSED`. */
function replay(
  prior: { id: string; reversesId: string | null; hash: string | null },
  paymentId: string,
  hash: string,
): string {
  if (prior.reversesId !== paymentId || prior.hash !== hash)
    throw codedError('IDEMPOTENCY_KEY_REUSED', 'idempotencyKey', KEY_REUSED);
  return prior.id;
}
