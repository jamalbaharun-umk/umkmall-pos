import { createHash } from 'node:crypto';
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { storeToday } from '../common/store-day';
import { fieldError, LocalDate } from '../common/validation';
import { type Db, InjectDb } from '../db/db.module';
import {
  products,
  purchaseOrderLines,
  purchaseOrders,
  suppliers,
} from '../db/schema';
import { StockService } from '../stock/stock.service';
import { debtFromRow, dueInDaysSql, paidSql, returnedSql } from './debt';
import {
  PurchasePaymentsService,
  purchaseNumber,
} from './purchase-payments.service';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

const Line = z
  .object({
    productId: z.string().uuid(),
    qty: z
      .number()
      .int('Jumlah harus bilangan bulat')
      .positive('Jumlah harus lebih dari 0')
      .max(100_000, 'Jumlah maksimal 100.000'),
    // Integer rupiah per unit; capped so qty × cost × lines stays a safe integer.
    unitCost: z
      .number()
      .int('Harga beli harus bilangan bulat rupiah')
      .nonnegative('Harga beli tidak boleh negatif')
      .max(1_000_000_000, 'Harga beli maksimal Rp1.000.000.000'),
  })
  .strict();

const MAX_ORDER_TOTAL = 1_000_000_000_000;

const orderFields = {
  supplierId: z.string().uuid('Pilih pemasok'),
  paymentMethod: z.string().trim().max(60).nullable().optional(),
  note: z.string().trim().max(500).nullable().optional(),
  // UMK-1970: when the supplier wants the money; optional (without it a purchase is never late).
  dueDate: LocalDate.nullable().optional(),
  lines: z
    .array(Line)
    .min(1)
    .max(200)
    .refine(
      (l) => new Set(l.map((x) => x.productId)).size === l.length,
      'Satu produk cukup satu baris',
    )
    .refine(
      (l) => l.reduce((n, x) => n + x.qty * x.unitCost, 0) <= MAX_ORDER_TOTAL,
      'Total pembelian maksimal Rp1.000.000.000.000',
    ),
};
export const OrderCreate = z.object(orderFields).strict();
export const OrderUpdate = z.object(orderFields).partial().strict();
type OrderInput = z.infer<typeof OrderUpdate>;

/** 422 unless every id is a live stock-tracked product of this store. */
export async function assertStockProducts(
  tx: Tx,
  tenantId: string,
  ids: string[],
) {
  const found = await tx
    .select({ id: products.id })
    .from(products)
    .where(
      and(
        eq(products.tenantId, tenantId),
        inArray(products.id, ids),
        isNull(products.deletedAt),
        eq(products.type, 'product'),
      ),
    );
  if (found.length !== new Set(ids).size) {
    const ok = new Set(found.map((f) => f.id));
    throw fieldError(
      `lines.${ids.findIndex((id) => !ok.has(id))}.productId`,
      'Produk tidak ditemukan atau tidak memakai stok',
    );
  }
}

@Injectable()
export class PurchasingService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly stock: StockService,
    private readonly payments: PurchasePaymentsService,
  ) {}

  /** The latest 200 purchases, each with its debt figures and payment status (UMK-1970). */
  async list(tenantId: string) {
    const rows = await this.db
      .select({
        id: purchaseOrders.id,
        number: purchaseOrders.number,
        status: purchaseOrders.status,
        supplierId: purchaseOrders.supplierId,
        supplierName: suppliers.name,
        paymentMethod: purchaseOrders.paymentMethod,
        total: purchaseOrders.total,
        dueDate: purchaseOrders.dueDate,
        approvedAt: purchaseOrders.approvedAt,
        createdAt: purchaseOrders.createdAt,
        paid: paidSql,
        returned: returnedSql,
        dueInDays: dueInDaysSql(tenantId),
      })
      .from(purchaseOrders)
      .innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
      .where(eq(purchaseOrders.tenantId, tenantId))
      .orderBy(desc(purchaseOrders.createdAt))
      .limit(200);
    return rows.map(({ paid, returned, dueInDays, ...r }) => ({
      ...r,
      code: purchaseNumber(r.number),
      ...debtFromRow({ ...r, paid, returned, dueInDays }),
    }));
  }

  /**
   * The store's debt to its suppliers over EVERY approved purchase (not only the listed 200): what is owed, the part
   * past its due date, and the part due within the next 7 days (today included). Store calendar days.
   */
  async summary(tenantId: string) {
    const today = storeToday(tenantId);
    const [r] = await this.db.execute(sql`
      select coalesce(sum(x.remaining), 0) as total,
             coalesce(sum(x.remaining) filter (where x.due_date < ${today}), 0) as overdue,
             coalesce(sum(x.remaining) filter (
               where x.due_date >= ${today} and x.due_date <= ${today} + 7), 0) as due_soon,
             count(*) filter (where x.remaining > 0)::int as open_count,
             count(*) filter (where x.remaining > 0 and x.due_date < ${today})::int as overdue_count
        from (select o.due_date,
                     greatest(o.total
                       - coalesce((select sum(pr.total) from pos.purchase_returns pr
                                    where pr.tenant_id = o.tenant_id and pr.order_id = o.id), 0)
                       - coalesce((select sum(pp.amount) from pos.purchase_payments pp
                                    where pp.tenant_id = o.tenant_id and pp.order_id = o.id
                                      and pp.voided_at is null), 0), 0) as remaining
                from pos.purchase_orders o
               where o.tenant_id = ${tenantId} and o.status = 'approved') x`);
    return {
      total: Number(r.total),
      overdue: Number(r.overdue),
      dueSoon: Number(r.due_soon),
      openCount: Number(r.open_count),
      overdueCount: Number(r.overdue_count),
    };
  }

  async get(tenantId: string, id: string, db: Db | Tx = this.db) {
    const [order] = await db
      .select({
        id: purchaseOrders.id,
        number: purchaseOrders.number,
        status: purchaseOrders.status,
        supplierId: purchaseOrders.supplierId,
        supplierName: suppliers.name,
        paymentMethod: purchaseOrders.paymentMethod,
        note: purchaseOrders.note,
        total: purchaseOrders.total,
        dueDate: purchaseOrders.dueDate,
        approvedBy: purchaseOrders.approvedBy,
        approvedAt: purchaseOrders.approvedAt,
        createdAt: purchaseOrders.createdAt,
        paid: paidSql,
        returned: returnedSql,
        dueInDays: dueInDaysSql(tenantId),
      })
      .from(purchaseOrders)
      .innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
      .where(
        and(eq(purchaseOrders.tenantId, tenantId), eq(purchaseOrders.id, id)),
      );
    if (!order) throw new NotFoundException();
    const lines = await db
      .select({
        id: purchaseOrderLines.id,
        productId: purchaseOrderLines.productId,
        productName: products.name,
        sku: products.sku,
        qty: purchaseOrderLines.qty,
        unitCost: purchaseOrderLines.unitCost,
      })
      .from(purchaseOrderLines)
      .innerJoin(products, eq(products.id, purchaseOrderLines.productId))
      .where(
        and(
          eq(purchaseOrderLines.tenantId, tenantId),
          eq(purchaseOrderLines.orderId, id),
        ),
      )
      .orderBy(products.name);
    const { paid, returned, dueInDays, ...head } = order;
    // UMK-1970: the debt, its history (payments, voided ones too, and returns) and per line what may still go back.
    const [payments, returns, stock] = await Promise.all([
      this.payments.payments(tenantId, id),
      this.payments.returns(tenantId, id),
      this.payments.lineStock(tenantId, id),
    ]);
    return {
      ...head,
      code: purchaseNumber(head.number),
      ...debtFromRow({ ...head, paid, returned, dueInDays }),
      lines: lines.map((l) => ({
        ...l,
        returnedQty: stock.get(l.id)?.returnedQty ?? 0,
        // What is left in the line's stock batch: the most a return may take (0 before approval).
        returnable: stock.get(l.id)?.returnable ?? 0,
      })),
      payments,
      returns,
    };
  }

  async create(
    tenantId: string,
    actorId: string,
    input: z.infer<typeof OrderCreate>,
  ) {
    const id = await this.db.transaction((tx) =>
      this.insertOrder(tx, tenantId, actorId, input),
    );
    return this.get(tenantId, id);
  }

  /**
   * UMK-2070: goods received in one step: the purchase is written and approved (stock in at its costs) in ONE
   * transaction, once per Idempotency-Key: a retry with the same key and body answers the first purchase, another
   * body under the key is 422. Used by UMKMall's agent (`stock_in`), so nothing is ever left half done.
   */
  async stockIn(
    tenantId: string,
    actorId: string,
    key: string,
    input: z.infer<typeof OrderCreate>,
  ) {
    const requestHash = createHash('sha256')
      .update(JSON.stringify(input))
      .digest('hex');
    const id = await this.db.transaction(async (tx) => {
      const id = await this.insertOrder(tx, tenantId, actorId, input, {
        key,
        requestHash,
      });
      await this.receiveOrder(tx, tenantId, actorId, id);
      return id;
    });
    return this.get(tenantId, id);
  }

  /** A new draft under the store's next number; with a key, the purchase already made under it instead. */
  private async insertOrder(
    tx: Tx,
    tenantId: string,
    actorId: string,
    input: z.infer<typeof OrderCreate>,
    idem?: { key: string; requestHash: string },
  ): Promise<string> {
    await this.assertSupplier(tx, tenantId, input.supplierId);
    // The next number of this store, one creation at a time (released at commit). It also serializes two
    // requests with one Idempotency-Key: the second finds the first's purchase below.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext('pos.purchase_number'), hashtext(${tenantId}))`,
    );
    if (idem) {
      const [prev] = await tx
        .select({
          id: purchaseOrders.id,
          requestHash: purchaseOrders.requestHash,
        })
        .from(purchaseOrders)
        .where(
          and(
            eq(purchaseOrders.tenantId, tenantId),
            eq(purchaseOrders.idempotencyKey, idem.key),
          ),
        );
      if (prev) {
        if (prev.requestHash !== idem.requestHash)
          throw fieldError(
            'idempotencyKey',
            'Idempotency-Key ini sudah dipakai untuk pembelian lain',
          );
        return prev.id;
      }
    }
    const [last] = await tx
      .select({ n: sql<number | null>`max(${purchaseOrders.number})` })
      .from(purchaseOrders)
      .where(eq(purchaseOrders.tenantId, tenantId));
    const [order] = await tx
      .insert(purchaseOrders)
      .values({
        tenantId,
        number: Number(last?.n ?? 0) + 1,
        supplierId: input.supplierId,
        paymentMethod: input.paymentMethod,
        note: input.note,
        dueDate: input.dueDate ?? null,
        createdBy: actorId,
        ...(idem && {
          idempotencyKey: idem.key,
          requestHash: idem.requestHash,
        }),
      })
      .returning({ id: purchaseOrders.id });
    await this.writeLines(tx, tenantId, order.id, input.lines);
    return order.id;
  }

  /**
   * A draft changes freely. An approved purchase changes only its due date (UMK-1970: the supplier's terms can move
   * after the goods came in); anything else, or a cancelled purchase, is 409.
   */
  async update(tenantId: string, id: string, input: OrderInput) {
    await this.db.transaction(async (tx) => {
      const status = await this.lock(tx, tenantId, id);
      const onlyDueDate = Object.keys(input).every((k) => k === 'dueDate');
      if (status !== 'draft' && !(status === 'approved' && onlyDueDate))
        throw new ConflictException(
          status === 'approved'
            ? 'Pembelian yang sudah disetujui hanya bisa diubah jatuh temponya'
            : 'Hanya draf yang bisa diubah',
        );
      if (input.supplierId)
        await this.assertSupplier(tx, tenantId, input.supplierId);
      await tx
        .update(purchaseOrders)
        .set({
          supplierId: input.supplierId,
          paymentMethod: input.paymentMethod,
          note: input.note,
          dueDate: input.dueDate,
          updatedAt: new Date(),
        })
        .where(eq(purchaseOrders.id, id));
      if (input.lines) {
        await tx
          .delete(purchaseOrderLines)
          .where(eq(purchaseOrderLines.orderId, id));
        await this.writeLines(tx, tenantId, id, input.lines);
      }
    });
    return this.get(tenantId, id);
  }

  async remove(tenantId: string, id: string) {
    await this.db.transaction(async (tx) => {
      await this.lockDraft(tx, tenantId, id);
      await tx.delete(purchaseOrders).where(eq(purchaseOrders.id, id));
    });
  }

  /**
   * Draft → approved, receiving every line as a stock batch at its unit cost, in one transaction under
   * the order's row lock. Approving an approved order changes nothing (Lakasir re-ran it: no status
   * check); a cancelled one is 409.
   */
  async approve(tenantId: string, actorId: string, id: string) {
    await this.db.transaction((tx) =>
      this.receiveOrder(tx, tenantId, actorId, id),
    );
    return this.get(tenantId, id);
  }

  /** Draft → approved under the order's row lock; approved stays approved (no second receipt); cancelled → 409. */
  private async receiveOrder(
    tx: Tx,
    tenantId: string,
    actorId: string,
    id: string,
  ) {
    const status = await this.lock(tx, tenantId, id);
    if (status === 'approved') return;
    if (status === 'cancelled')
      throw new ConflictException('Pembelian sudah dibatalkan');
    const lines = await tx
      .select()
      .from(purchaseOrderLines)
      .where(eq(purchaseOrderLines.orderId, id))
      .orderBy(purchaseOrderLines.productId);
    for (const l of lines)
      await this.stock.receive(tx, {
        tenantId,
        productId: l.productId,
        qty: l.qty,
        unitCost: l.unitCost,
        source: 'purchase',
        sourceId: id,
        actorId,
      });
    await tx
      .update(purchaseOrders)
      .set({
        status: 'approved',
        approvedBy: actorId,
        approvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(purchaseOrders.id, id));
  }

  /** Draft → cancelled; cancelled stays cancelled; approved → 409 (its stock is already in). */
  async cancel(tenantId: string, id: string) {
    await this.db.transaction(async (tx) => {
      const status = await this.lock(tx, tenantId, id);
      if (status === 'approved')
        throw new ConflictException('Pembelian sudah disetujui');
      if (status === 'draft')
        await tx
          .update(purchaseOrders)
          .set({ status: 'cancelled', updatedAt: new Date() })
          .where(eq(purchaseOrders.id, id));
    });
    return this.get(tenantId, id);
  }

  /** Locks the order row for the rest of the transaction; 404 for another store's id. */
  private async lock(tx: Tx, tenantId: string, id: string) {
    const [row] = await tx
      .select({ status: purchaseOrders.status })
      .from(purchaseOrders)
      .where(
        and(eq(purchaseOrders.tenantId, tenantId), eq(purchaseOrders.id, id)),
      )
      .for('update');
    if (!row) throw new NotFoundException();
    return row.status;
  }

  private async lockDraft(tx: Tx, tenantId: string, id: string) {
    if ((await this.lock(tx, tenantId, id)) !== 'draft')
      throw new ConflictException('Hanya draf yang bisa diubah');
  }

  private async assertSupplier(tx: Tx, tenantId: string, supplierId: string) {
    const [row] = await tx
      .select({ id: suppliers.id })
      .from(suppliers)
      .where(
        and(
          eq(suppliers.tenantId, tenantId),
          eq(suppliers.id, supplierId),
          isNull(suppliers.deletedAt),
        ),
      );
    if (!row) throw fieldError('supplierId', 'Pemasok tidak ditemukan');
  }

  private async writeLines(
    tx: Tx,
    tenantId: string,
    orderId: string,
    lines: z.infer<typeof Line>[],
  ) {
    await assertStockProducts(
      tx,
      tenantId,
      lines.map((l) => l.productId),
    );
    await tx
      .insert(purchaseOrderLines)
      .values(lines.map((l) => ({ ...l, tenantId, orderId })));
    const total = lines.reduce((sum, l) => sum + l.qty * l.unitCost, 0);
    await tx
      .update(purchaseOrders)
      .set({ total })
      .where(eq(purchaseOrders.id, orderId));
  }
}
