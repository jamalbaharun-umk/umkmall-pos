import { createHash } from 'node:crypto';
import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  lt,
  isNull,
  sql,
  type SQL,
} from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import type { Db } from '../db/db.module';
import { InjectDb } from '../db/db.module';
import {
  members,
  paymentMethods,
  receivables,
  products,
  saleLines,
  sales,
  saleVoids,
  salesSettings,
  shifts,
  staff,
} from '../db/schema';
import { createReceivable } from '../receivables/receivables.controller';
import { isUniqueViolation } from '../staff/http';
import { hasPermission } from '../staff/require-permission';
import { StockService, type Tx } from '../stock/stock.service';
import type { PosSession } from '../tenancy/session';
import {
  consumeVoucher,
  evaluateVoucher,
} from '../vouchers/vouchers.controller';
import type { SaleInput, SalesQuery } from './sales.schemas';

const MAX_TOTAL = 1_000_000_000_000; // Rp1 triliun: far above any till, keeps every product in safe-integer range

/** Tax on the amount after discounts (Lakasir flaw 2), rounded half up to whole rupiah. */
export const taxOf = (taxable: number, bps: number) =>
  Number((BigInt(taxable) * BigInt(bps) + 5000n) / 10000n);

/** Order-independent fingerprint of a sale request (lines sorted, keys sorted). */
export const requestHash = (input: SaleInput) => {
  const lines = [...input.lines].sort((x, y) =>
    x.productId < y.productId ? -1 : 1,
  );
  const norm = { ...input, lines, note: input.note || undefined };
  const stable = JSON.stringify(norm, (_k, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v as Record<string, unknown>).sort(([a], [b]) =>
            a < b ? -1 : 1,
          ),
        )
      : v,
  );
  return createHash('sha256').update(stable).digest('hex');
};

/** Sum of a money column, as a JS number. */
const total = (column: AnyPgColumn) =>
  sql<number>`coalesce(sum(${column}), 0)::bigint`.mapWith(Number);

/** A 422 in the shared shape; `field` puts the message on that input (`paid`, `lines.0.qty`). */
const fail = (
  message: string,
  extra: Record<string, unknown> = {},
  field = '_',
) =>
  new UnprocessableEntityException({
    message,
    errors: { [field]: message },
    ...extra,
  });

/**
 * Cash sales (Lakasir SellingService + classic cashier). The server computes every price and total
 * (flaw 3: a client price counts only with `sales.price_override`, cost always stored), every sale
 * is linked to the actor's open shift (flaw 4), stock is drawn in the same transaction under row
 * locks (flaw 8), and `Idempotency-Key` makes a retry return the first sale (flaw 10).
 */
@Injectable()
export class SalesService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly stock: StockService,
  ) {}

  private async byKey(tenantId: string, key: string) {
    const [row] = await this.db
      .select({ id: sales.id, requestHash: sales.requestHash })
      .from(sales)
      .where(and(eq(sales.tenantId, tenantId), eq(sales.idempotencyKey, key)));
    return row;
  }

  /** A replay returns the first sale only for the same request; another body under that key is refused. */
  private async replay(s: PosSession, key: string, hash: string) {
    const prior = await this.byKey(s.tenantId, key);
    if (!prior) return null;
    if (prior.requestHash !== null && prior.requestHash !== hash)
      throw fail('Permintaan berbeda dengan transaksi sebelumnya');
    return this.get(s, prior.id, true);
  }

  async create(s: PosSession, key: string, input: SaleInput) {
    const hash = requestHash(input);
    const prior = await this.replay(s, key, hash);
    if (prior) return prior;
    let id: string;
    try {
      id = await this.db.transaction((tx) =>
        this.insert(tx, s, key, input, hash),
      );
    } catch (e) {
      // A concurrent request with the same key won the unique index: return its sale (same body only).
      if (isUniqueViolation(e)) {
        const winner = await this.replay(s, key, hash);
        if (winner) return winner;
      }
      throw e;
    }
    return this.get(s, id, true);
  }

  private async insert(
    tx: Tx,
    s: PosSession,
    key: string,
    input: SaleInput,
    hash: string,
  ): Promise<string> {
    // The shift row lock serializes this actor's sales with closing the shift.
    const [shift] = await tx
      .select({ id: shifts.id })
      .from(shifts)
      .where(
        and(
          eq(shifts.tenantId, s.tenantId),
          eq(shifts.actorId, s.actorId),
          isNull(shifts.closedAt),
        ),
      )
      .for('update');
    if (!shift) throw fail('Buka shift dulu sebelum berjualan');

    const ids = input.lines.map((l) => l.productId);
    const rows = await tx
      .select({
        id: products.id,
        name: products.name,
        sellingPrice: products.sellingPrice,
      })
      .from(products)
      .where(
        and(
          eq(products.tenantId, s.tenantId),
          inArray(products.id, ids),
          isNull(products.deletedAt),
          eq(products.isActive, true),
        ),
      );
    const byId = new Map(rows.map((r) => [r.id, r]));
    const missing = ids.filter((pid) => !byId.has(pid));
    if (missing.length)
      throw fail(
        'Produk tidak ditemukan atau tidak aktif',
        { productIds: missing },
        `lines.${input.lines.findIndex((l) => l.productId === missing[0])}.productId`,
      );

    const canOverride = hasPermission(s, 'sales.price_override');
    const lines = input.lines.map((l) => {
      const p = byId.get(l.productId)!;
      const overridden =
        canOverride && l.price !== undefined && l.price !== p.sellingPrice;
      const unitPrice = overridden ? l.price! : p.sellingPrice;
      return {
        productId: p.id,
        name: p.name,
        qty: l.qty,
        listPrice: p.sellingPrice,
        unitPrice,
        lineTotal: unitPrice * l.qty,
        priceOverriddenBy: overridden ? s.actorId : null,
      };
    });
    const subtotal = lines.reduce((n, l) => n + l.lineTotal, 0);
    if (subtotal > MAX_TOTAL) throw fail('Total terlalu besar', {}, 'lines');
    const discount = canOverride ? (input.discount ?? 0) : 0;
    if (discount > subtotal)
      throw fail('Diskon melebihi subtotal', {}, 'discount');
    // U7: validated before anything is taken (Lakasir flaw 1); quota is consumed below, in this transaction.
    const voucher = input.voucherCode
      ? await evaluateVoucher(
          tx,
          s.tenantId,
          input.voucherCode,
          subtotal - discount,
        )
      : null;
    const voucherDiscount = voucher?.discount ?? 0;
    const memberId = input.memberId
      ? await this.memberOf(tx, s.tenantId, input.memberId)
      : null;
    const method = await this.methodOf(tx, s.tenantId, input.paymentMethodId);

    // One row per store: the next receipt number and the tax rate, in one statement.
    const [settings] = await tx
      .insert(salesSettings)
      .values({ tenantId: s.tenantId, lastSaleNumber: 1 })
      .onConflictDoUpdate({
        target: salesSettings.tenantId,
        set: { lastSaleNumber: sql`${salesSettings.lastSaleNumber} + 1` },
      })
      .returning();
    // Tax on the amount after the manual discount AND the voucher (Lakasir flaw 2).
    const tax = taxOf(subtotal - discount - voucherDiscount, settings.taxBps);
    const total = subtotal - discount - voucherDiscount + tax;
    if (method.isCredit) {
      // Kasbon: the rest becomes the member's receivable; paid may be 0.
      if (!memberId) throw fail('Pilih member untuk kasbon', {}, 'memberId');
      if (input.paid >= total)
        throw fail('Kasbon harus menyisakan sisa tagihan', { total }, 'paid');
    } else if (method.isCash) {
      if (input.paid < total)
        throw fail('Uang dibayar kurang dari total', { total }, 'paid');
    } else if (input.paid !== total) {
      throw fail(
        'Pembayaran non-tunai harus sama dengan total',
        { total },
        'paid',
      );
    }
    if (voucher) await consumeVoucher(tx, s.tenantId, voucher.id);

    const overrideBy =
      discount > 0 || lines.some((l) => l.priceOverriddenBy) ? s.actorId : null;
    // Inserting the sale claims the idempotency key: a concurrent duplicate fails here and rolls back.
    const [sale] = await tx
      .insert(sales)
      .values({
        tenantId: s.tenantId,
        number: settings.lastSaleNumber,
        shiftId: shift.id,
        actorId: s.actorId,
        actorKind: s.kind,
        paymentMethodId: method.id,
        idempotencyKey: key,
        requestHash: hash,
        subtotal,
        discount,
        memberId,
        voucherId: voucher?.id ?? null,
        voucherDiscount,
        taxBps: settings.taxBps,
        tax,
        total,
        paid: input.paid,
        change: Math.max(input.paid - total, 0),
        costTotal: 0,
        overrideBy,
        note: input.note || null,
      })
      .returning({ id: sales.id });

    let costTotal = 0;
    // Product-id order: two multi-item sales lock batches in the same order (no deadlock).
    for (const l of [...lines].sort((x, y) =>
      x.productId < y.productId ? -1 : 1,
    )) {
      const { costTotal: cost } = await this.stock
        .consume(tx, {
          tenantId: s.tenantId,
          productId: l.productId,
          qty: l.qty,
          refId: sale.id,
          actorId: s.actorId,
        })
        .catch((e: unknown) => {
          // "Stok Es Teh Manis tidak cukup (sisa 2)", on that line's qty.
          if (e instanceof UnprocessableEntityException) {
            const body = e.getResponse() as { message: string } & Record<
              string,
              unknown
            >;
            const i = input.lines.findIndex((x) => x.productId === l.productId);
            throw fail(body.message, body, `lines.${i}.qty`);
          }
          throw e;
        });
      costTotal += cost;
      await tx.insert(saleLines).values({
        ...l,
        tenantId: s.tenantId,
        saleId: sale.id,
        costTotal: cost,
      });
    }
    await tx.update(sales).set({ costTotal }).where(eq(sales.id, sale.id));
    if (method.isCredit)
      await createReceivable(tx, s, {
        id: sale.id,
        memberId: memberId!,
        total,
        paid: input.paid,
        cashMethodId: await this.cashMethod(tx, s.tenantId),
      });
    return sale.id;
  }

  /** A live member of this store, else 422. */
  private async memberOf(tx: Tx, tenantId: string, id: string) {
    const [m] = await tx
      .select({ id: members.id })
      .from(members)
      .where(
        and(
          eq(members.tenantId, tenantId),
          eq(members.id, id),
          isNull(members.deletedAt),
        ),
      );
    if (!m) throw fail('Pelanggan tidak ditemukan', {}, 'memberId');
    return m.id;
  }

  /** The chosen live method of this store (default Tunai), else 422. */
  private async methodOf(tx: Tx, tenantId: string, id?: string) {
    const methodId = id ?? (await this.cashMethod(tx, tenantId));
    const [m] = await tx
      .select({
        id: paymentMethods.id,
        isCash: paymentMethods.isCash,
        isCredit: paymentMethods.isCredit,
      })
      .from(paymentMethods)
      .where(
        and(
          eq(paymentMethods.tenantId, tenantId),
          eq(paymentMethods.id, methodId),
          isNull(paymentMethods.deletedAt),
        ),
      );
    if (!m)
      throw fail('Metode pembayaran tidak ditemukan', {}, 'paymentMethodId');
    return m;
  }

  /** The store's cash method, "Tunai", created on first use. */
  private async cashMethod(tx: Tx, tenantId: string) {
    await tx
      .insert(paymentMethods)
      .values({ tenantId, name: 'Tunai', isCash: true })
      .onConflictDoNothing();
    const [m] = await tx
      .select({ id: paymentMethods.id })
      .from(paymentMethods)
      .where(
        and(
          eq(paymentMethods.tenantId, tenantId),
          eq(paymentMethods.name, 'Tunai'),
        ),
      );
    return m.id;
  }

  /** Cashiers see their own sales; `reports.view` sees the store's. */
  private scope(s: PosSession): SQL {
    return hasPermission(s, 'reports.view')
      ? eq(sales.tenantId, s.tenantId)
      : and(eq(sales.tenantId, s.tenantId), eq(sales.actorId, s.actorId))!;
  }

  async list(s: PosSession, q: SalesQuery) {
    const where = and(
      this.scope(s),
      q.shiftId ? eq(sales.shiftId, q.shiftId) : undefined,
      q.from ? gte(sales.createdAt, new Date(q.from)) : undefined,
      q.to ? lt(sales.createdAt, new Date(q.to)) : undefined,
    );
    const showCost = hasPermission(s, 'reports.view');
    const [rows, [rung], [reversed]] = await Promise.all([
      this.db
        .select({
          id: sales.id,
          number: sales.number,
          shiftId: sales.shiftId,
          actorKind: sales.actorKind,
          // Owner sales have no staff row (Lakasir's "user.name" column).
          cashier: sql<string>`coalesce(${staff.name}, 'Pemilik')`,
          subtotal: sales.subtotal,
          discount: sales.discount,
          voucherDiscount: sales.voucherDiscount,
          tax: sales.tax,
          total: sales.total,
          paid: sales.paid,
          change: sales.change,
          costTotal: sales.costTotal,
          status: sales.status,
          voidedAt: sales.voidedAt,
          createdAt: sales.createdAt,
        })
        .from(sales)
        .leftJoin(
          staff,
          and(eq(staff.tenantId, sales.tenantId), eq(staff.id, sales.actorId)),
        )
        .where(where)
        .orderBy(desc(sales.createdAt), desc(sales.number))
        .limit(q.perPage)
        .offset((q.page - 1) * q.perPage),
      this.db
        .select({
          count: count(),
          revenue: total(sales.total),
          discount: total(sales.discount),
          voucherDiscount: total(sales.voucherDiscount),
        })
        .from(sales)
        .where(where),
      // The reversals: voids DONE in the same window (and shift), of sales the actor may see.
      this.db
        .select({
          count: count(),
          revenue: total(saleVoids.total),
          discount: total(saleVoids.discount),
          voucherDiscount: total(saleVoids.voucherDiscount),
        })
        .from(saleVoids)
        .innerJoin(
          sales,
          and(
            eq(sales.tenantId, saleVoids.tenantId),
            eq(sales.id, saleVoids.saleId),
          ),
        )
        .where(
          and(
            this.scope(s),
            q.shiftId ? eq(saleVoids.shiftId, q.shiftId) : undefined,
            q.from ? gte(saleVoids.createdAt, new Date(q.from)) : undefined,
            q.to ? lt(saleVoids.createdAt, new Date(q.to)) : undefined,
          ),
        ),
    ]);
    // Dated like the reports (UMK-1962): a receipt stays in the summary of the window it was rung up in,
    // and its void is subtracted in the window the void was done. So the summary of an earlier day never
    // changes, a same-day void nets to zero, and the figures agree with /reports/sales for the same range.
    const summary = {
      count: rung.count - reversed.count,
      revenue: rung.revenue - reversed.revenue,
      discount: rung.discount - reversed.discount,
      voucherDiscount: rung.voucherDiscount - reversed.voucherDiscount,
      // Voids done in the window: what was subtracted above.
      voidedCount: reversed.count,
    };
    return {
      data: rows.map((r) => ({
        ...r,
        costTotal: showCost ? r.costTotal : undefined,
      })),
      total: rung.count,
      summary,
    };
  }

  /** One sale with lines. Cost is shown only to `reports.view`. `own` skips the scope (just created). */
  async get(s: PosSession, id: string, own = false) {
    const [sale] = await this.db
      .select({
        id: sales.id,
        number: sales.number,
        shiftId: sales.shiftId,
        actorId: sales.actorId,
        actorKind: sales.actorKind,
        paymentMethod: paymentMethods.name,
        subtotal: sales.subtotal,
        discount: sales.discount,
        memberId: sales.memberId,
        memberName: members.name,
        receivableId: receivables.id,
        receivableRest: receivables.rest,
        voucherDiscount: sales.voucherDiscount,
        taxBps: sales.taxBps,
        tax: sales.tax,
        total: sales.total,
        paid: sales.paid,
        change: sales.change,
        costTotal: sales.costTotal,
        overrideBy: sales.overrideBy,
        note: sales.note,
        status: sales.status,
        voidedAt: sales.voidedAt,
        createdAt: sales.createdAt,
      })
      .from(sales)
      .innerJoin(paymentMethods, eq(paymentMethods.id, sales.paymentMethodId))
      .leftJoin(members, eq(members.id, sales.memberId))
      .leftJoin(receivables, eq(receivables.saleId, sales.id))
      .where(
        and(
          own ? eq(sales.tenantId, s.tenantId) : this.scope(s),
          eq(sales.id, id),
        ),
      );
    if (!sale) throw new NotFoundException();
    const lines = await this.db
      .select({
        id: saleLines.id,
        productId: saleLines.productId,
        name: saleLines.name,
        qty: saleLines.qty,
        listPrice: saleLines.listPrice,
        unitPrice: saleLines.unitPrice,
        lineTotal: saleLines.lineTotal,
        costTotal: saleLines.costTotal,
        priceOverriddenBy: saleLines.priceOverriddenBy,
      })
      .from(saleLines)
      .where(and(eq(saleLines.tenantId, s.tenantId), eq(saleLines.saleId, id)))
      .orderBy(asc(saleLines.name));
    const showCost = hasPermission(s, 'reports.view');
    return {
      ...sale,
      costTotal: showCost ? sale.costTotal : undefined,
      lines: lines.map((l) => ({
        ...l,
        costTotal: showCost ? l.costTotal : undefined,
      })),
    };
  }

  /** What the printed receipt shows. */
  async receipt(s: PosSession, id: string) {
    const sale = await this.get(s, id);
    let cashier = 'Pemilik';
    if (sale.actorKind === 'cashier') {
      const [row] = await this.db
        .select({ name: staff.name })
        .from(staff)
        .where(and(eq(staff.tenantId, s.tenantId), eq(staff.id, sale.actorId)));
      cashier = row?.name ?? 'Kasir';
    }
    return {
      number: sale.number,
      createdAt: sale.createdAt,
      cashier,
      paymentMethod: sale.paymentMethod,
      lines: sale.lines.map((l) => ({
        name: l.name,
        qty: l.qty,
        unitPrice: l.unitPrice,
        lineTotal: l.lineTotal,
      })),
      subtotal: sale.subtotal,
      discount: sale.discount,
      voucherDiscount: sale.voucherDiscount,
      memberName: sale.memberName,
      receivableRest: sale.receivableRest,
      taxBps: sale.taxBps,
      tax: sale.tax,
      total: sale.total,
      paid: sale.paid,
      change: sale.change,
      note: sale.note,
      // A reprint of a voided receipt must say so.
      status: sale.status,
      voidedAt: sale.voidedAt,
    };
  }

  async settings(tenantId: string) {
    const [row] = await this.db
      .select({ taxBps: salesSettings.taxBps })
      .from(salesSettings)
      .where(eq(salesSettings.tenantId, tenantId));
    return { taxBps: row?.taxBps ?? 0 };
  }

  async updateSettings(tenantId: string, taxBps: number) {
    await this.db
      .insert(salesSettings)
      .values({ tenantId, taxBps })
      .onConflictDoUpdate({ target: salesSettings.tenantId, set: { taxBps } });
    return { taxBps };
  }
}
