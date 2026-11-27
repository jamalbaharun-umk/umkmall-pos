import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  codedError,
  fieldError,
  formatRupiah,
  Rupiah,
} from '../common/validation';
import { recordAudit } from '../audit/record';
import { type Db, InjectDb } from '../db/db.module';
import {
  AGENT_LABEL,
  PURCHASE_PAYMENT_SOURCES,
  PURCHASE_REFUND_DESTINATIONS,
  PURCHASE_RETURN_REASON_LABELS,
  PURCHASE_RETURN_REASONS,
  purchaseOrderLines,
  purchaseOrders,
  purchasePayments,
  purchaseRefunds,
  purchaseReturnLines,
  purchaseReturnReversals,
  purchaseReturns,
  shifts,
  staff,
  stockBatches,
  suppliers,
} from '../db/schema';
import {
  assertPersonAtTill,
  recordShiftCash,
  recordShiftCashInShift,
} from '../shifts/cash-ledger';
import { ShiftsService } from '../shifts/shifts.service';
import { isUniqueViolation } from '../staff/http';
import { hasPermission } from '../staff/require-permission';
import { StockService, type Tx } from '../stock/stock.service';
import { recordStoreCash } from '../store-cash/store-cash-ledger';
import type { PosSession } from '../tenancy/session';
import {
  creditOf,
  debtFromRow,
  paidSql,
  refundedSql,
  refundsDue,
  returnedSql,
} from './debt';

export const PaymentInput = z
  .object({
    amount: Rupiah.positive('Harus lebih dari 0'),
    source: z.enum(PURCHASE_PAYMENT_SOURCES, {
      errorMap: () => ({ message: 'Pilih Laci kasir atau Di luar laci' }),
    }),
    note: z.string().trim().max(200).optional(),
  })
  .strict();
export type PaymentInput = z.infer<typeof PaymentInput>;

export const VoidInput = z
  .object({ reason: z.string().trim().min(1).max(200) })
  .strict();

export const RefundInput = z
  .object({
    amount: Rupiah.positive('Harus lebih dari 0'),
    destination: z.enum(PURCHASE_REFUND_DESTINATIONS, {
      errorMap: () => ({ message: 'Pilih Laci kasir atau Kas toko' }),
    }),
    note: z.string().trim().max(200).optional(),
  })
  .strict();
export type RefundInput = z.infer<typeof RefundInput>;

export const ReturnInput = z
  .object({
    reason: z.enum(PURCHASE_RETURN_REASONS, {
      errorMap: () => ({ message: 'Pilih salah satu alasan' }),
    }),
    note: z.string().trim().max(200).optional(),
    lines: z
      .array(
        z
          .object({
            lineId: z.string().uuid('Pilihan tidak valid'),
            qty: z
              .number({ invalid_type_error: 'Harus berupa angka' })
              .int('Jumlah harus bilangan bulat')
              .positive('Jumlah harus lebih dari 0')
              .max(100_000, 'Jumlah maksimal 100.000'),
          })
          .strict(),
      )
      .min(1, 'Pilih barang yang dikembalikan')
      .max(200)
      .refine(
        (l) => new Set(l.map((x) => x.lineId)).size === l.length,
        'Satu barang cukup satu baris',
      ),
  })
  .strict()
  .superRefine((i, ctx) => {
    if (i.reason === 'lainnya' && !i.note)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['note'],
        message: 'Catatan wajib diisi untuk alasan Lainnya',
      });
  });
export type ReturnInput = z.infer<typeof ReturnInput>;

const hashOf = (parts: unknown[]) =>
  createHash('sha256').update(JSON.stringify(parts)).digest('hex');

const KEY_REUSED = 'Kunci ini sudah dipakai untuk catatan lain';
const NO_SHIFT =
  'Belum ada shift buka. Buka shift untuk membayar dari laci, atau pilih Di luar laci.';
const NO_SHIFT_REFUND =
  'Belum ada shift buka. Buka shift untuk menerima uang ke laci, atau pilih Kas toko.';

/** "PB-0012": the store's n-th purchase. */
export const purchaseNumber = (n: number | null) =>
  n === null ? 'PB' : `PB-${String(n).padStart(4, '0')}`;

const actorName = (kind: unknown, name: unknown) =>
  sql<string>`case when ${kind} = 'owner' then 'Pemilik'
    when ${kind} = 'agent' then ${AGENT_LABEL}
    else coalesce(${name}, 'Staf') end`;

type Key = { id: string; hash: string; actorId: string };

/**
 * Supplier payments, purchase returns, their undoing and the money a supplier hands back (UMK-1970, design feature
 * 29). This file is the only writer of `pos.purchase_payments`, `pos.purchase_returns`, `pos.purchase_return_lines`,
 * `pos.purchase_return_reversals`, `pos.purchase_refunds` and of the cash ledger kinds `purchase_payment`,
 * `purchase_payment_reversal`, `purchase_refund`, `purchase_refund_reversal` (shift) and `purchase_payment_void`,
 * `purchase_refund`, `purchase_refund_void` (store), guard in src/guards.spec.ts. Every write locks the purchase row
 * first (then its shift, then stock batches), so two writes of one purchase are judged one after the other. Under
 * that lock every write keeps live refunds <= the credit (what payments and returns put above the total).
 * Refusals carry a `code`: `PURCHASE_OVERPAY` (with `remaining`), `PURCHASE_NOT_APPROVED`, `SHIFT_REQUIRED`,
 * `DRAWER_INSUFFICIENT` (with `drawerCash`), `RETURN_EXCEEDS_BATCH` (with `available`), `IDEMPOTENCY_KEY_REUSED`,
 * `REFUND_EXCEEDS_DUE` (with `refundDue`), `REFUND_RECEIVED` and `RETURN_REFUNDED` (with `refunded`),
 * `RETURN_UNDO_BATCH_FULL`, `STORE_CASH_INSUFFICIENT` (with `available`), 403 `DRAWER_REFUND_NOT_YOURS`.
 */
@Injectable()
export class PurchasePaymentsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly shifts: ShiftsService,
    private readonly stock: StockService,
  ) {}

  /** Locks the purchase row and reads its debt under the lock; 404 for another store's id. */
  private async lockOrder(tx: Tx, tenantId: string, id: string) {
    const [locked] = await tx
      .select({ id: purchaseOrders.id })
      .from(purchaseOrders)
      .where(
        and(eq(purchaseOrders.tenantId, tenantId), eq(purchaseOrders.id, id)),
      )
      .for('update');
    if (!locked) throw new NotFoundException();
    // Read after the lock: a payment committed by the transaction we waited for is counted.
    const [row] = await tx
      .select({
        status: purchaseOrders.status,
        total: purchaseOrders.total,
        number: purchaseOrders.number,
        supplierName: suppliers.name,
        paid: paidSql,
        returned: returnedSql,
        refunded: refundedSql,
      })
      .from(purchaseOrders)
      .innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
      .where(
        and(eq(purchaseOrders.tenantId, tenantId), eq(purchaseOrders.id, id)),
      );
    const debt = debtFromRow({ ...row, dueInDays: null });
    return { ...row, debt };
  }

  /** 422 when the refunds received would be above the credit a void or an undo leaves (`paid`, `returned` after). */
  private assertRefundsCovered(
    order: { total: number; debt: { refunded: number } },
    paid: number,
    returned: number,
    code: 'REFUND_RECEIVED' | 'RETURN_REFUNDED',
  ) {
    const refunded = order.debt.refunded;
    if (refunded <= creditOf(order.total, paid, returned)) return;
    throw codedError(
      code,
      '_',
      code === 'REFUND_RECEIVED'
        ? `Pemasok sudah mengembalikan ${formatRupiah(refunded)} yang bergantung pada pembayaran ini. Batalkan dulu uang retur yang diterima.`
        : `Pemasok sudah mengembalikan ${formatRupiah(refunded)} untuk retur. Batalkan dulu uang retur yang diterima, lalu batalkan returnya.`,
      { refunded },
    );
  }

  /** The audit row's target: the purchase, by its store number. */
  private auditTarget(orderId: string, number: number | null) {
    return { type: 'purchase', id: orderId, label: purchaseNumber(number) };
  }

  private assertApproved(status: string, what: string) {
    if (status !== 'approved')
      throw new ConflictException({
        message: `Hanya pembelian yang sudah disetujui yang bisa ${what}`,
        error: 'Conflict',
        statusCode: 409,
        code: 'PURCHASE_NOT_APPROVED',
      });
  }

  private replayer(s: PosSession, hash: string) {
    // A key answers only the actor who first sent it, with the same request.
    return (prior: Key) => {
      if (prior.hash !== hash || prior.actorId !== s.actorId)
        throw codedError(
          'IDEMPOTENCY_KEY_REUSED',
          'idempotencyKey',
          KEY_REUSED,
        );
      return prior.id;
    };
  }

  private async paymentByKey(db: Db | Tx, tenantId: string, key: string) {
    const [prior] = await db
      .select({
        id: purchasePayments.id,
        hash: purchasePayments.requestHash,
        actorId: purchasePayments.actorId,
      })
      .from(purchasePayments)
      .where(
        and(
          eq(purchasePayments.tenantId, tenantId),
          eq(purchasePayments.idempotencyKey, key),
        ),
      );
    return prior ?? null;
  }

  private async refundByKey(db: Db | Tx, tenantId: string, key: string) {
    const [prior] = await db
      .select({
        id: purchaseRefunds.id,
        hash: purchaseRefunds.requestHash,
        actorId: purchaseRefunds.actorId,
      })
      .from(purchaseRefunds)
      .where(
        and(
          eq(purchaseRefunds.tenantId, tenantId),
          eq(purchaseRefunds.idempotencyKey, key),
        ),
      );
    return prior ?? null;
  }

  private async returnByKey(db: Db | Tx, tenantId: string, key: string) {
    const [prior] = await db
      .select({
        id: purchaseReturns.id,
        hash: purchaseReturns.requestHash,
        actorId: purchaseReturns.actorId,
      })
      .from(purchaseReturns)
      .where(
        and(
          eq(purchaseReturns.tenantId, tenantId),
          eq(purchaseReturns.idempotencyKey, key),
        ),
      );
    return prior ?? null;
  }

  /**
   * Records a payment to the purchase's supplier. At most the debt (`PURCHASE_OVERPAY`). From the drawer: the
   * actor's own open shift (`SHIFT_REQUIRED`), enough expected cash in it (`DRAWER_INSUFFICIENT`) and the
   * permission that holds a drawer (`sales.create`); one `purchase_payment` cash-out entry. Not an expense.
   */
  async pay(s: PosSession, orderId: string, key: string, input: PaymentInput) {
    const hash = hashOf([
      'payment',
      orderId,
      input.amount,
      input.source,
      input.note || null,
    ]);
    const replay = this.replayer(s, hash);
    // A retry answers the first payment and changes nothing, whatever happened since (the debt, the shift).
    const done = await this.paymentByKey(this.db, s.tenantId, key);
    if (done) return this.payment(s.tenantId, orderId, replay(done));
    let id: string;
    try {
      id = await this.db.transaction(async (tx) => {
        // Lock order: the purchase row, then (drawer) the shift.
        const order = await this.lockOrder(tx, s.tenantId, orderId);
        const prior = await this.paymentByKey(tx, s.tenantId, key);
        if (prior) return replay(prior);
        // After both replay checks: a retry of a recorded payment answers it, whatever the actor holds now.
        if (input.source === 'drawer' && !hasPermission(s, 'sales.create'))
          throw new ForbiddenException({
            message: 'Membayar dari laci butuh izin kasir. Pilih Di luar laci.',
            error: 'Forbidden',
            statusCode: 403,
            code: 'DRAWER_PERMISSION',
          });
        this.assertApproved(order.status, 'dibayar');
        const remaining = order.debt.remaining ?? 0;
        if (input.amount > remaining)
          throw codedError(
            'PURCHASE_OVERPAY',
            'amount',
            remaining === 0
              ? 'Pembelian ini sudah lunas, tidak bisa dibayar lagi'
              : `Jumlah ${formatRupiah(input.amount)} melebihi sisa hutang ${formatRupiah(remaining)}`,
            { remaining },
          );
        const newId = randomUUID();
        let shiftId: string | null = null;
        let drawerCashBefore: number | null = null;
        if (input.source === 'drawer') {
          shiftId = await recordShiftCash(
            tx,
            s,
            {
              direction: 'out',
              kind: 'purchase_payment',
              amount: input.amount,
              refId: newId,
              note: `${purchaseNumber(order.number)} · ${order.supplierName}`,
            },
            NO_SHIFT,
          );
          // Under the shift's lock: what the drawer held just before this payment.
          drawerCashBefore =
            (await this.shifts.expectedCashOf(tx, s.tenantId, shiftId)) +
            input.amount;
          if (input.amount > drawerCashBefore)
            throw codedError(
              'DRAWER_INSUFFICIENT',
              'amount',
              `Uang di laci (${formatRupiah(Math.max(drawerCashBefore, 0))}) kurang dari jumlah. Kurangi jumlah atau pilih Di luar laci.`,
              { drawerCash: Math.max(drawerCashBefore, 0) },
            );
        }
        // Claims the key: a concurrent duplicate fails here and rolls its ledger entry back.
        await tx.insert(purchasePayments).values({
          id: newId,
          tenantId: s.tenantId,
          orderId,
          amount: input.amount,
          source: input.source,
          note: input.note || null,
          shiftId,
          drawerCashBefore,
          actorId: s.actorId,
          actorKind: s.kind,
          idempotencyKey: key,
          requestHash: hash,
        });
        return newId;
      });
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
      const prior = await this.paymentByKey(this.db, s.tenantId, key);
      if (!prior) throw e;
      id = replay(prior);
    }
    return this.payment(s.tenantId, orderId, id);
  }

  /**
   * The correction of a payment (never an edit or a delete): the row stays, marked voided with its reason, and the
   * debt grows back. A drawer payment whose shift is still open gets one cash-in entry in that shift; a closed shift
   * never changes, so the cash goes to the store cash instead (as a voided drawer expense). Repeating changes nothing.
   */
  async voidPayment(
    s: PosSession,
    orderId: string,
    paymentId: string,
    reason: string,
  ) {
    await this.db.transaction(async (tx) => {
      // Lock order: the purchase row, the payment row, then its shift.
      const order = await this.lockOrder(tx, s.tenantId, orderId);
      const [row] = await tx
        .select({
          source: purchasePayments.source,
          amount: purchasePayments.amount,
          shiftId: purchasePayments.shiftId,
          voidedAt: purchasePayments.voidedAt,
        })
        .from(purchasePayments)
        .where(
          and(
            eq(purchasePayments.tenantId, s.tenantId),
            eq(purchasePayments.orderId, orderId),
            eq(purchasePayments.id, paymentId),
          ),
        )
        .for('update');
      if (!row) throw new NotFoundException();
      if (row.voidedAt) return;
      // Money the supplier handed back because of this payment cannot stay recorded once the payment is gone.
      this.assertRefundsCovered(
        order,
        order.debt.paid - row.amount,
        order.debt.returned,
        'REFUND_RECEIVED',
      );
      const drawerReversed =
        row.source === 'drawer' && row.shiftId
          ? await recordShiftCashInShift(tx, s, row.shiftId, {
              direction: 'in',
              kind: 'purchase_payment_reversal',
              amount: row.amount,
              refId: paymentId,
            })
          : null;
      if (drawerReversed === false)
        await recordStoreCash(tx, s, {
          direction: 'in',
          kind: 'purchase_payment_void',
          amount: row.amount,
          refId: paymentId,
          note: reason,
        });
      await tx
        .update(purchasePayments)
        .set({
          voidedAt: new Date(),
          voidedById: s.actorId,
          voidedByKind: s.kind,
          voidReason: reason,
          drawerReversed,
        })
        .where(
          and(
            eq(purchasePayments.tenantId, s.tenantId),
            eq(purchasePayments.id, paymentId),
          ),
        );
      // Ids and amounts only: the reason is free text and stays on the payment row.
      await recordAudit(tx, s, 'purchase_payment_void', {
        target: this.auditTarget(orderId, order.number),
        details: {
          orderId,
          paymentId,
          amount: row.amount,
          source: row.source,
          shiftId: row.shiftId,
          drawerReversed,
        },
      });
    });
    return this.payment(s.tenantId, orderId, paymentId);
  }

  /**
   * Sends goods of an approved purchase back to its supplier. Each line leaves the stock batch it was received as
   * (StockService, under the batch's row lock), at most what is left in it (`RETURN_EXCEEDS_BATCH`), at that
   * batch's cost; the debt goes down by Σ qty × cost. Worth more than the debt: allowed, the debt stops at 0 and
   * the difference is money the supplier owes back (`refundDue`, outside the system, computed on read). Append-only.
   */
  async createReturn(
    s: PosSession,
    orderId: string,
    key: string,
    input: ReturnInput,
  ) {
    const hash = hashOf([
      'return',
      orderId,
      input.reason,
      input.note || null,
      [...input.lines]
        .sort((a, b) => a.lineId.localeCompare(b.lineId))
        .map((l) => [l.lineId.toLowerCase(), l.qty]),
    ]);
    const replay = this.replayer(s, hash);
    const done = await this.returnByKey(this.db, s.tenantId, key);
    if (done) return this.returnRow(s.tenantId, orderId, replay(done));
    let id: string;
    try {
      id = await this.db.transaction(async (tx) => {
        const order = await this.lockOrder(tx, s.tenantId, orderId);
        const prior = await this.returnByKey(tx, s.tenantId, key);
        if (prior) return replay(prior);
        this.assertApproved(order.status, 'diretur');
        const ids = input.lines.map((l) => l.lineId.toLowerCase());
        const lines = await tx
          .select({
            id: purchaseOrderLines.id,
            productId: purchaseOrderLines.productId,
            batchId: stockBatches.id,
          })
          .from(purchaseOrderLines)
          .leftJoin(
            stockBatches,
            and(
              eq(stockBatches.tenantId, purchaseOrderLines.tenantId),
              eq(stockBatches.source, 'purchase'),
              eq(stockBatches.sourceId, purchaseOrderLines.orderId),
              eq(stockBatches.productId, purchaseOrderLines.productId),
            ),
          )
          .where(
            and(
              eq(purchaseOrderLines.tenantId, s.tenantId),
              eq(purchaseOrderLines.orderId, orderId),
              inArray(purchaseOrderLines.id, ids),
            ),
          );
        const byId = new Map(lines.map((l) => [l.id, l]));
        const picked = input.lines.map((l, i) => {
          const line = byId.get(l.lineId.toLowerCase());
          if (!line?.batchId)
            throw fieldError(
              `lines.${i}.lineId`,
              'Barang ini tidak ada di pembelian ini',
            );
          return { ...l, i, line, batchId: line.batchId };
        });
        const newId = randomUUID();
        // Batches in product-id order, the order a sale locks them.
        picked.sort((a, b) => a.line.productId.localeCompare(b.line.productId));
        const out: {
          orderLineId: string;
          productId: string;
          batchId: string;
          qty: number;
          unitCost: number;
        }[] = [];
        for (const p of picked) {
          const { unitCost } = await this.stock.returnToSupplier(tx, {
            tenantId: s.tenantId,
            batchId: p.batchId,
            qty: p.qty,
            refId: newId,
            actorId: s.actorId,
            field: `lines.${p.i}.qty`,
          });
          out.push({
            orderLineId: p.line.id,
            productId: p.line.productId,
            batchId: p.batchId,
            qty: p.qty,
            unitCost,
          });
        }
        const total = out.reduce((n, l) => n + l.qty * l.unitCost, 0);
        if (total === 0)
          throw fieldError(
            'lines',
            'Barang dengan harga beli Rp0 tidak mengurangi hutang; tidak ada yang dicatat',
          );
        // Claims the key: a concurrent duplicate fails here and its stock draw rolls back.
        await tx.insert(purchaseReturns).values({
          id: newId,
          tenantId: s.tenantId,
          orderId,
          reason: input.reason,
          note: input.note || null,
          total,
          actorId: s.actorId,
          actorKind: s.kind,
          idempotencyKey: key,
          requestHash: hash,
        });
        await tx
          .insert(purchaseReturnLines)
          .values(
            out.map((l) => ({ ...l, tenantId: s.tenantId, returnId: newId })),
          );
        return newId;
      });
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
      const prior = await this.returnByKey(this.db, s.tenantId, key);
      if (!prior) throw e;
      id = replay(prior);
    }
    return this.returnRow(s.tenantId, orderId, id);
  }

  /**
   * Undoes a return (append-only: one `purchase_return_reversals` row, the return stays). Each line's units go back
   * into the batch they left, at that batch's cost, and the debt rises by the return's total; stock sold since does
   * not matter. Refused while the money the supplier already handed back would be above the credit left
   * (`RETURN_REFUNDED`). A repeat answers the first reversal and changes nothing.
   */
  async reverseReturn(
    s: PosSession,
    orderId: string,
    returnId: string,
    reason: string,
  ) {
    try {
      await this.db.transaction(async (tx) => {
        // Lock order: the purchase row, then the batches (in product-id order, as a sale takes them).
        const order = await this.lockOrder(tx, s.tenantId, orderId);
        const [ret] = await tx
          .select({ total: purchaseReturns.total })
          .from(purchaseReturns)
          .where(
            and(
              eq(purchaseReturns.tenantId, s.tenantId),
              eq(purchaseReturns.orderId, orderId),
              eq(purchaseReturns.id, returnId),
            ),
          );
        if (!ret) throw new NotFoundException();
        const [done] = await tx
          .select({ id: purchaseReturnReversals.id })
          .from(purchaseReturnReversals)
          .where(
            and(
              eq(purchaseReturnReversals.tenantId, s.tenantId),
              eq(purchaseReturnReversals.returnId, returnId),
            ),
          );
        if (done) return;
        this.assertApproved(order.status, 'dibatalkan returnya');
        this.assertRefundsCovered(
          order,
          order.debt.paid,
          order.debt.returned - ret.total,
          'RETURN_REFUNDED',
        );
        const reversalId = randomUUID();
        const lines = await tx
          .select({
            batchId: purchaseReturnLines.batchId,
            qty: purchaseReturnLines.qty,
          })
          .from(purchaseReturnLines)
          .where(
            and(
              eq(purchaseReturnLines.tenantId, s.tenantId),
              eq(purchaseReturnLines.returnId, returnId),
            ),
          )
          .orderBy(asc(purchaseReturnLines.productId));
        for (const l of lines)
          await this.stock.undoReturnToSupplier(tx, {
            tenantId: s.tenantId,
            batchId: l.batchId,
            qty: l.qty,
            refId: reversalId,
            actorId: s.actorId,
          });
        await tx.insert(purchaseReturnReversals).values({
          id: reversalId,
          tenantId: s.tenantId,
          returnId,
          reason,
          actorId: s.actorId,
          actorKind: s.kind,
        });
        await recordAudit(tx, s, 'purchase_return_undo', {
          target: this.auditTarget(orderId, order.number),
          details: {
            orderId,
            returnId,
            reversalId,
            total: ret.total,
            units: lines.reduce((n, l) => n + l.qty, 0),
          },
        });
      });
    } catch (e) {
      // A concurrent undo of the same return committed first: its reversal is the answer.
      if (!isUniqueViolation(e)) throw e;
    }
    return this.returnRow(s.tenantId, orderId, returnId);
  }

  /**
   * Records money the supplier hands back after a return (or an overpayment): at most what is still due back
   * (`REFUND_EXCEEDS_DUE`), partial allowed. Into the drawer: a person at the till, `sales.create` and the actor's own
   * open shift; one `purchase_refund` cash-in entry. Into the store cash: one `purchase_refund` store entry. Not income.
   */
  async refund(
    s: PosSession,
    orderId: string,
    key: string,
    input: RefundInput,
  ) {
    // Cash recorded by hand into a drawer is for a person at the till, checked before any query.
    if (input.destination === 'drawer') assertPersonAtTill(s.kind);
    const hash = hashOf([
      'refund',
      orderId,
      input.amount,
      input.destination,
      input.note || null,
    ]);
    const replay = this.replayer(s, hash);
    const done = await this.refundByKey(this.db, s.tenantId, key);
    if (done) return this.refundRow(s.tenantId, orderId, replay(done));
    let id: string;
    try {
      id = await this.db.transaction(async (tx) => {
        const order = await this.lockOrder(tx, s.tenantId, orderId);
        const prior = await this.refundByKey(tx, s.tenantId, key);
        if (prior) return replay(prior);
        if (input.destination === 'drawer' && !hasPermission(s, 'sales.create'))
          throw new ForbiddenException({
            message: 'Menerima uang ke laci butuh izin kasir. Pilih Kas toko.',
            error: 'Forbidden',
            statusCode: 403,
            code: 'DRAWER_PERMISSION',
          });
        this.assertApproved(order.status, 'menerima uang retur');
        const due = order.debt.refundDue;
        if (input.amount > due)
          throw codedError(
            'REFUND_EXCEEDS_DUE',
            'amount',
            due === 0
              ? 'Tidak ada uang yang masih harus dikembalikan pemasok untuk pembelian ini'
              : `Jumlah ${formatRupiah(input.amount)} melebihi uang yang masih harus dikembalikan pemasok (${formatRupiah(due)})`,
            { refundDue: due },
          );
        const newId = randomUUID();
        const note = `${purchaseNumber(order.number)} · ${order.supplierName}`;
        let shiftId: string | null = null;
        if (input.destination === 'drawer')
          shiftId = await recordShiftCash(
            tx,
            s,
            {
              direction: 'in',
              kind: 'purchase_refund',
              amount: input.amount,
              refId: newId,
              note,
            },
            NO_SHIFT_REFUND,
          );
        else
          await recordStoreCash(tx, s, {
            direction: 'in',
            kind: 'purchase_refund',
            amount: input.amount,
            refId: newId,
            note,
          });
        // Claims the key: a concurrent duplicate fails here and rolls its ledger entry back.
        await tx.insert(purchaseRefunds).values({
          id: newId,
          tenantId: s.tenantId,
          orderId,
          amount: input.amount,
          destination: input.destination,
          note: input.note || null,
          shiftId,
          actorId: s.actorId,
          actorKind: s.kind,
          idempotencyKey: key,
          requestHash: hash,
        });
        await recordAudit(tx, s, 'purchase_refund', {
          target: this.auditTarget(orderId, order.number),
          details: {
            orderId,
            refundId: newId,
            amount: input.amount,
            destination: input.destination,
            shiftId,
          },
        });
        return newId;
      });
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
      const prior = await this.refundByKey(this.db, s.tenantId, key);
      if (!prior) throw e;
      id = replay(prior);
    }
    return this.refundRow(s.tenantId, orderId, id);
  }

  /**
   * The correction of a refund, as of a payment: the row stays, marked voided, and what is due back grows again. A
   * drawer refund whose shift is still open gets one cash-out entry in that shift (`DRAWER_INSUFFICIENT` when the
   * drawer no longer holds it); otherwise the cash leaves the store cash, which never goes below zero
   * (`STORE_CASH_INSUFFICIENT`, owner ruling 2026-11-27). Repeating changes nothing.
   *
   * A drawer refund is voided only by a person at that till (owner ruling 2026-11-27): the owner, the cashier whose
   * shift took the cash, or an admin (a `sales.void` holder, the permission that reverses another cashier's till
   * money); anyone else, purchasing staff without cashier rights included, gets 403 `DRAWER_REFUND_NOT_YOURS`.
   */
  async voidRefund(
    s: PosSession,
    orderId: string,
    refundId: string,
    reason: string,
  ) {
    await this.db.transaction(async (tx) => {
      // Lock order: the purchase row, the refund row, then its shift.
      const order = await this.lockOrder(tx, s.tenantId, orderId);
      const [row] = await tx
        .select({
          destination: purchaseRefunds.destination,
          amount: purchaseRefunds.amount,
          shiftId: purchaseRefunds.shiftId,
          voidedAt: purchaseRefunds.voidedAt,
        })
        .from(purchaseRefunds)
        .where(
          and(
            eq(purchaseRefunds.tenantId, s.tenantId),
            eq(purchaseRefunds.orderId, orderId),
            eq(purchaseRefunds.id, refundId),
          ),
        )
        .for('update');
      if (!row) throw new NotFoundException();
      if (row.destination === 'drawer')
        await this.assertMayVoidDrawerRefund(tx, s, row.shiftId);
      if (row.voidedAt) return;
      let drawerReversed: boolean | null = null;
      if (row.destination === 'drawer' && row.shiftId) {
        drawerReversed = await recordShiftCashInShift(tx, s, row.shiftId, {
          direction: 'out',
          kind: 'purchase_refund_reversal',
          amount: row.amount,
          refId: refundId,
        });
        if (drawerReversed) {
          // Under the shift's lock: the drawer must still hold the cash it takes back.
          const after = await this.shifts.expectedCashOf(
            tx,
            s.tenantId,
            row.shiftId,
          );
          if (after < 0)
            throw codedError(
              'DRAWER_INSUFFICIENT',
              '_',
              `Uang di laci (${formatRupiah(Math.max(after + row.amount, 0))}) kurang dari jumlah yang dibatalkan.`,
              { drawerCash: Math.max(after + row.amount, 0) },
            );
        }
      }
      if (drawerReversed !== true)
        await recordStoreCash(
          tx,
          s,
          {
            direction: 'out',
            kind: 'purchase_refund_void',
            amount: row.amount,
            refId: refundId,
            note: reason,
          },
          { mustCover: true },
        );
      await tx
        .update(purchaseRefunds)
        .set({
          voidedAt: new Date(),
          voidedById: s.actorId,
          voidedByKind: s.kind,
          voidReason: reason,
          drawerReversed,
        })
        .where(
          and(
            eq(purchaseRefunds.tenantId, s.tenantId),
            eq(purchaseRefunds.id, refundId),
          ),
        );
      await recordAudit(tx, s, 'purchase_refund_void', {
        target: this.auditTarget(orderId, order.number),
        details: {
          orderId,
          refundId,
          amount: row.amount,
          destination: row.destination,
          shiftId: row.shiftId,
          drawerReversed,
        },
      });
    });
    return this.refundRow(s.tenantId, orderId, refundId);
  }

  /** 403 unless the actor may take a drawer refund's cash back: the owner, that shift's cashier, or an admin. */
  private async assertMayVoidDrawerRefund(
    tx: Tx,
    s: PosSession,
    shiftId: string | null,
  ) {
    assertPersonAtTill(s.kind);
    if (s.kind === 'owner' || hasPermission(s, 'sales.void')) return;
    const [shift] = shiftId
      ? await tx
          .select({ actorId: shifts.actorId, actorKind: shifts.actorKind })
          .from(shifts)
          .where(and(eq(shifts.tenantId, s.tenantId), eq(shifts.id, shiftId)))
      : [];
    if (shift?.actorKind === s.kind && shift.actorId === s.actorId) return;
    throw new ForbiddenException({
      message:
        'Uang ini masuk laci shift kasir lain. Yang bisa membatalkannya: kasir shift itu, admin, atau pemilik.',
      error: 'Forbidden',
      statusCode: 403,
      code: 'DRAWER_REFUND_NOT_YOURS',
    });
  }

  /** The purchase's refunds, oldest first, voided ones included. */
  async refunds(tenantId: string, orderId: string, refundId?: string) {
    const r = purchaseRefunds;
    return this.db
      .select({
        id: r.id,
        amount: r.amount,
        destination: r.destination,
        note: r.note,
        shiftId: r.shiftId,
        actorName: actorName(r.actorKind, staff.name),
        createdAt: r.createdAt,
        voidedAt: r.voidedAt,
        voidReason: r.voidReason,
        drawerReversed: r.drawerReversed,
      })
      .from(r)
      .leftJoin(
        staff,
        and(eq(staff.tenantId, r.tenantId), eq(staff.id, r.actorId)),
      )
      .where(
        and(
          eq(r.tenantId, tenantId),
          eq(r.orderId, orderId),
          refundId ? eq(r.id, refundId) : undefined,
        ),
      )
      .orderBy(asc(r.createdAt), asc(r.id));
  }

  private async refundRow(tenantId: string, orderId: string, id: string) {
    const [row] = await this.refunds(tenantId, orderId, id);
    if (!row) throw new NotFoundException();
    return row;
  }

  private paymentColumns() {
    const p = purchasePayments;
    return {
      id: p.id,
      amount: p.amount,
      source: p.source,
      note: p.note,
      shiftId: p.shiftId,
      drawerCashBefore: p.drawerCashBefore,
      actorName: actorName(p.actorKind, staff.name),
      createdAt: p.createdAt,
      voidedAt: p.voidedAt,
      voidReason: p.voidReason,
      drawerReversed: p.drawerReversed,
    };
  }

  /** The purchase's payments, oldest first, voided ones included (they are the history). */
  async payments(tenantId: string, orderId: string, paymentId?: string) {
    const p = purchasePayments;
    return this.db
      .select(this.paymentColumns())
      .from(p)
      .leftJoin(
        staff,
        and(eq(staff.tenantId, p.tenantId), eq(staff.id, p.actorId)),
      )
      .where(
        and(
          eq(p.tenantId, tenantId),
          eq(p.orderId, orderId),
          paymentId ? eq(p.id, paymentId) : undefined,
        ),
      )
      .orderBy(asc(p.createdAt), asc(p.id));
  }

  private async payment(tenantId: string, orderId: string, id: string) {
    const [row] = await this.payments(tenantId, orderId, id);
    if (!row) throw new NotFoundException();
    return row;
  }

  /** The purchase's returns, oldest first, each with its lines. */
  async returns(tenantId: string, orderId: string, returnId?: string) {
    const r = purchaseReturns;
    const rr = purchaseReturnReversals;
    const reverser = alias(staff, 'reverser');
    const heads = await this.db
      .select({
        id: r.id,
        reason: r.reason,
        note: r.note,
        total: r.total,
        actorName: actorName(r.actorKind, staff.name),
        createdAt: r.createdAt,
        // Undone (UMK-1970 addition): when, why, by whom; null while the return stands.
        reversedAt: rr.createdAt,
        reverseReason: rr.reason,
        reversedByName: sql<string | null>`case when ${rr.id} is null then null
          else ${actorName(rr.actorKind, reverser.name)} end`,
      })
      .from(r)
      .leftJoin(
        staff,
        and(eq(staff.tenantId, r.tenantId), eq(staff.id, r.actorId)),
      )
      .leftJoin(rr, and(eq(rr.tenantId, r.tenantId), eq(rr.returnId, r.id)))
      .leftJoin(
        reverser,
        and(eq(reverser.tenantId, rr.tenantId), eq(reverser.id, rr.actorId)),
      )
      .where(and(eq(r.tenantId, tenantId), eq(r.orderId, orderId)))
      .orderBy(asc(r.createdAt), asc(r.id));
    if (heads.length === 0) return [];
    // Every return of the purchase is read: what is due back depends on the ones before and on today's payments.
    const [order] = await this.db
      .select({ total: purchaseOrders.total, paid: paidSql })
      .from(purchaseOrders)
      .where(
        and(
          eq(purchaseOrders.tenantId, tenantId),
          eq(purchaseOrders.id, orderId),
        ),
      );
    const due = refundsDue(
      order?.total ?? 0,
      Number(order?.paid ?? 0),
      // An undone return puts nothing above the total.
      heads.map((h) => (h.reversedAt ? 0 : h.total)),
    );
    const l = purchaseReturnLines;
    const lines = await this.db
      .select({
        returnId: l.returnId,
        orderLineId: l.orderLineId,
        productId: l.productId,
        qty: l.qty,
        unitCost: l.unitCost,
      })
      .from(l)
      .where(
        and(
          eq(l.tenantId, tenantId),
          inArray(
            l.returnId,
            heads.map((h) => h.id),
          ),
        ),
      );
    // Returns whose products a stock count (opname) changed after them: undoing one adds its units on top of a count
    // that already left them out, so the screen warns before the undo.
    const counted = await this.db.execute(sql`
      select distinct rl.return_id
        from pos.purchase_return_lines rl
        join pos.purchase_returns pr on pr.tenant_id = rl.tenant_id and pr.id = rl.return_id
        join pos.stock_movements m on m.tenant_id = rl.tenant_id and m.product_id = rl.product_id
       where rl.tenant_id = ${tenantId} and pr.order_id = ${orderId}
         and m.reason = 'opname' and m.created_at > pr.created_at`);
    const countedSince = new Set(
      (counted as unknown as { return_id: string }[]).map((r) => r.return_id),
    );
    return heads
      .map((h, i) => ({ h, refundDue: due[i] }))
      .filter(({ h }) => !returnId || h.id === returnId)
      .map(({ h, refundDue }) => ({
        ...h,
        refundDue,
        countedSince: countedSince.has(h.id),
        reasonLabel: PURCHASE_RETURN_REASON_LABELS[h.reason],
        lines: lines
          .filter((x) => x.returnId === h.id)
          .map((x) => ({
            orderLineId: x.orderLineId,
            productId: x.productId,
            qty: x.qty,
            unitCost: x.unitCost,
          })),
      }));
  }

  private async returnRow(tenantId: string, orderId: string, id: string) {
    const [row] = await this.returns(tenantId, orderId, id);
    if (!row) throw new NotFoundException();
    return row;
  }

  /** Per purchase line: units returned so far (undone returns left out) and what is left in its stock batch (the most a return may take). */
  async lineStock(tenantId: string, orderId: string) {
    const rows = await this.db.execute(sql`
      select l.id as line_id,
             coalesce(b.qty_remaining, 0) as returnable,
             coalesce((select sum(rl.qty) from pos.purchase_return_lines rl
                        where rl.tenant_id = l.tenant_id and rl.order_line_id = l.id
                          and not exists (select 1 from pos.purchase_return_reversals rr
                                           where rr.tenant_id = rl.tenant_id and rr.return_id = rl.return_id)), 0)
               as returned_qty
        from pos.purchase_order_lines l
        left join pos.stock_batches b
          on b.tenant_id = l.tenant_id and b.source = 'purchase' and b.source_id = l.order_id
         and b.product_id = l.product_id
       where l.tenant_id = ${tenantId} and l.order_id = ${orderId}`);
    return new Map(
      (rows as unknown as Record<string, unknown>[]).map((r) => [
        r.line_id as string,
        {
          returnable: Number(r.returnable),
          returnedQty: Number(r.returned_qty),
        },
      ]),
    );
  }
}
