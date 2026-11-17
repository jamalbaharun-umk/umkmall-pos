import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { type Db, InjectDb } from '../db/db.module';
import {
  products,
  purchaseOrderLines,
  purchaseOrders,
  suppliers,
} from '../db/schema';

export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

const Line = z
  .object({
    productId: z.string().uuid(),
    qty: z.number().int().positive().max(1_000_000),
    // Integer rupiah per unit.
    unitCost: z.number().int().nonnegative().max(1_000_000_000_000),
  })
  .strict();

const orderFields = {
  supplierId: z.string().uuid(),
  paymentMethod: z.string().trim().max(60).nullable().optional(),
  note: z.string().trim().max(500).nullable().optional(),
  lines: z
    .array(Line)
    .min(1)
    .max(200)
    .refine(
      (l) => new Set(l.map((x) => x.productId)).size === l.length,
      'produk ganda',
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
  if (found.length !== new Set(ids).size)
    throw new UnprocessableEntityException({
      message: 'Produk tidak ditemukan atau tidak memakai stok',
      fields: ['lines'],
    });
}

@Injectable()
export class PurchasingService {
  constructor(@InjectDb() private readonly db: Db) {}

  list(tenantId: string) {
    return this.db
      .select({
        id: purchaseOrders.id,
        status: purchaseOrders.status,
        supplierId: purchaseOrders.supplierId,
        supplierName: suppliers.name,
        paymentMethod: purchaseOrders.paymentMethod,
        total: purchaseOrders.total,
        approvedAt: purchaseOrders.approvedAt,
        createdAt: purchaseOrders.createdAt,
      })
      .from(purchaseOrders)
      .innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
      .where(eq(purchaseOrders.tenantId, tenantId))
      .orderBy(desc(purchaseOrders.createdAt))
      .limit(200);
  }

  async get(tenantId: string, id: string, db: Db | Tx = this.db) {
    const [order] = await db
      .select({
        id: purchaseOrders.id,
        status: purchaseOrders.status,
        supplierId: purchaseOrders.supplierId,
        supplierName: suppliers.name,
        paymentMethod: purchaseOrders.paymentMethod,
        note: purchaseOrders.note,
        total: purchaseOrders.total,
        approvedBy: purchaseOrders.approvedBy,
        approvedAt: purchaseOrders.approvedAt,
        createdAt: purchaseOrders.createdAt,
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
    return { ...order, lines };
  }

  async create(
    tenantId: string,
    actorId: string,
    input: z.infer<typeof OrderCreate>,
  ) {
    const id = await this.db.transaction(async (tx) => {
      await this.assertSupplier(tx, tenantId, input.supplierId);
      const [order] = await tx
        .insert(purchaseOrders)
        .values({
          tenantId,
          supplierId: input.supplierId,
          paymentMethod: input.paymentMethod,
          note: input.note,
          createdBy: actorId,
        })
        .returning({ id: purchaseOrders.id });
      await this.writeLines(tx, tenantId, order.id, input.lines);
      return order.id;
    });
    return this.get(tenantId, id);
  }

  async update(tenantId: string, id: string, input: OrderInput) {
    await this.db.transaction(async (tx) => {
      await this.lockDraft(tx, tenantId, id);
      if (input.supplierId)
        await this.assertSupplier(tx, tenantId, input.supplierId);
      await tx
        .update(purchaseOrders)
        .set({
          supplierId: input.supplierId,
          paymentMethod: input.paymentMethod,
          note: input.note,
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
    if (!row)
      throw new UnprocessableEntityException({
        message: 'Pemasok tidak ditemukan',
        fields: ['supplierId'],
      });
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
