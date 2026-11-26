import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  codedError,
  fieldError,
  formatRupiah,
  Rupiah,
} from '../common/validation';
import { type Db, InjectDb } from '../db/db.module';
import {
  AGENT_LABEL,
  PURCHASE_PAYMENT_SOURCES,
  PURCHASE_RETURN_REASON_LABELS,
  PURCHASE_RETURN_REASONS,
  purchaseOrderLines,
  purchaseOrders,
  purchasePayments,
  purchaseReturnLines,
  purchaseReturns,
  staff,
  stockBatches,
  suppliers,
} from '../db/schema';
import { recordShiftCash, recordShiftCashInShift } from '../shifts/cash-ledger';
import { ShiftsService } from '../shifts/shifts.service';
import { isUniqueViolation } from '../staff/http';
import { hasPermission } from '../staff/require-permission';
import { StockService, type Tx } from '../stock/stock.service';
import { recordStoreCash } from '../store-cash/store-cash-ledger';
import type { PosSession } from '../tenancy/session';
import { debtFromRow, paidSql, returnedSql } from './debt';

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

/** "PB-0012": the store's n-th purchase. */
export const purchaseNumber = (n: number | null) =>
  n === null ? 'PB' : `PB-${String(n).padStart(4, '0')}`;

const actorName = (kind: unknown, name: unknown) =>
  sql<string>`case when ${kind} = 'owner' then 'Pemilik'
    when ${kind} = 'agent' then ${AGENT_LABEL}
    else coalesce(${name}, 'Staf') end`;

type Key = { id: string; hash: string; actorId: string };

/**
 * Supplier payments and purchase returns (UMK-1970, design feature 29). This file is the only writer of
 * `pos.purchase_payments`, `pos.purchase_returns`, `pos.purchase_return_lines` and of the cash ledger kinds
 * `purchase_payment`, `purchase_payment_reversal` (shift) and `purchase_payment_void` (store), guard in
 * src/guards.spec.ts. Every write locks the purchase row first (then its shift, then stock batches), so two
 * payments of one purchase are judged one after the other against the debt. Refusals carry a `code`:
 * `PURCHASE_OVERPAY` (with `remaining`), `PURCHASE_NOT_APPROVED`, `SHIFT_REQUIRED`, `DRAWER_INSUFFICIENT`
 * (with `drawerCash`), `RETURN_EXCEEDS_BATCH` (with `available`), `IDEMPOTENCY_KEY_REUSED`.
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
      })
      .from(purchaseOrders)
      .innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
      .where(
        and(eq(purchaseOrders.tenantId, tenantId), eq(purchaseOrders.id, id)),
      );
    const debt = debtFromRow({ ...row, dueInDays: null });
    return { ...row, debt };
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
    if (input.source === 'drawer' && !hasPermission(s, 'sales.create'))
      throw new ForbiddenException({
        message: 'Membayar dari laci butuh izin kasir. Pilih Di luar laci.',
        error: 'Forbidden',
        statusCode: 403,
        code: 'DRAWER_PERMISSION',
      });
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
      await this.lockOrder(tx, s.tenantId, orderId);
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
    });
    return this.payment(s.tenantId, orderId, paymentId);
  }

  /**
   * Sends goods of an approved purchase back to its supplier. Each line leaves the stock batch it was received as
   * (StockService, under the batch's row lock), at most what is left in it (`RETURN_EXCEEDS_BATCH`), at that
   * batch's cost; the debt goes down by Σ qty × cost. Worth more than the debt: allowed, the debt stops at 0 and
   * the difference is kept as money the supplier owes back (`refundDue`, outside the system). Append-only.
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
        const refundDue = Math.max(0, total - (order.debt.remaining ?? 0));
        // Claims the key: a concurrent duplicate fails here and its stock draw rolls back.
        await tx.insert(purchaseReturns).values({
          id: newId,
          tenantId: s.tenantId,
          orderId,
          reason: input.reason,
          note: input.note || null,
          total,
          refundDue,
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
    const heads = await this.db
      .select({
        id: r.id,
        reason: r.reason,
        note: r.note,
        total: r.total,
        refundDue: r.refundDue,
        actorName: actorName(r.actorKind, staff.name),
        createdAt: r.createdAt,
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
          returnId ? eq(r.id, returnId) : undefined,
        ),
      )
      .orderBy(asc(r.createdAt), asc(r.id));
    if (heads.length === 0) return [];
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
    return heads.map((h) => ({
      ...h,
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

  /** Per purchase line: units returned so far and what is left in its stock batch (the most a return may take). */
  async lineStock(tenantId: string, orderId: string) {
    const rows = await this.db.execute(sql`
      select l.id as line_id,
             coalesce(b.qty_remaining, 0) as returnable,
             coalesce((select sum(rl.qty) from pos.purchase_return_lines rl
                        where rl.tenant_id = l.tenant_id and rl.order_line_id = l.id), 0) as returned_qty
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
