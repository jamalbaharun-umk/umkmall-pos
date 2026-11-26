import { createHash } from 'node:crypto';
import {
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
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
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import type { Db } from '../db/db.module';
import { InjectDb } from '../db/db.module';
import {
  FINAL_SALE_STATUSES,
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
import { priceLines, type ProductPricing } from '../catalog/pricing';
import { loadPricing } from '../catalog/pricing-store';
import {
  PaymentSync,
  type SaleSettlement,
} from '../payments-client/payment-sync.service';
import {
  isInFlight,
  isOnlineMethod,
  ONLINE_METHODS,
  PaymentApiError,
  paymentMethodCode,
} from '../payments-client/payments.client';
import { SalePayments } from '../payments-client/sale-payment.service';
import { cashMethodId, cashRounding } from './cash';
import { saleNumbers, takeNumber } from './numbers';
import { createReceivable } from '../receivables/receivables.controller';
import { isUniqueViolation } from '../staff/http';
import { hasPermission } from '../staff/require-permission';
import { StockService, type Tx } from '../stock/stock.service';
import type { PosSession } from '../tenancy/session';
import {
  consumeVoucher,
  evaluateVoucher,
} from '../vouchers/vouchers.controller';
import type {
  PaidSinceQuery,
  QuoteInput,
  SaleInput,
  SalesQuery,
} from './sales.schemas';

/** `paid-since` answers at most this many sales a page, and its last page's `asOf` is this far behind the clock. */
export const PAID_SINCE_LIMIT = 50;
const PAID_SINCE_OVERLAP_SECONDS = 10;

const isFinalSale = (status: string) =>
  (FINAL_SALE_STATUSES as readonly string[]).includes(status);

const MAX_TOTAL = 1_000_000_000_000; // Rp1 triliun: far above any till, keeps every product in safe-integer range

/** Tax on the amount after discounts (Lakasir flaw 2), rounded half up to whole rupiah. */
export const taxOf = (taxable: number, bps: number) =>
  Number((BigInt(taxable) * BigInt(bps) + 5000n) / 10000n);

export { cashRounding };

/** Order-independent fingerprint of a sale request (lines sorted by product, then unit; keys sorted). */
export const requestHash = (input: SaleInput) => {
  const order = (l: { productId: string; unit?: string }) =>
    `${l.productId}:${(l.unit ?? '').toLowerCase()}`;
  const lines = [...input.lines].sort((x, y) => (order(x) < order(y) ? -1 : 1));
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
    private readonly payments: PaymentSync,
    private readonly salePayments: SalePayments,
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
    return this.finish(s, prior.id);
  }

  /**
   * Step 2 (UMK-1991): charge through payment-api and complete the sale. For a sale that is already final
   * (a replay, a kasbon, payment-api off) it only reads the status. A sale still awaiting payment answers
   * 503: the cashier repeats the request with the same Idempotency-Key, or the job finishes it.
   *
   * A PG method (dynamic QRIS, VA) is not paid in this request: the sale is answered `awaiting_payment`
   * with `payment`, which carries what the customer pays with (`checkout`) and until when (`expiresAt`).
   */
  private async finish(s: PosSession, id: string) {
    let refused = false;
    const {
      outcome: status,
      payment,
      refusedCode,
    } = await this.payments
      .settle(s.tenantId, id, 'charge')
      .catch((e: unknown): SaleSettlement => {
        if (!(e instanceof PaymentApiError)) throw e;
        refused = e.kind === 'rejected';
        return { outcome: 'awaiting_payment', payment: null };
      });
    if (
      status === 'awaiting_payment' &&
      payment &&
      isInFlight(payment) &&
      isOnlineMethod(payment.method)
    )
      return {
        ...(await this.get(s, id, true)),
        payment: await this.salePayments.view(s, id, payment),
      };
    if (status === 'awaiting_payment')
      throw new ServiceUnavailableException({
        message: refused
          ? 'Pembayaran belum bisa dicatat. Penjualan menunggu pembayaran dan akan diselesaikan atau dibatalkan otomatis.'
          : 'Layanan pembayaran tidak bisa dihubungi. Penjualan menunggu pembayaran, coba lagi.',
        saleId: id,
        status,
      });
    if (status === 'cancelled')
      throw new ConflictException({
        message: refusedCode
          ? 'Pembayaran online belum aktif untuk toko ini. Penjualan dibatalkan, pilih metode pembayaran lain.'
          : 'Pembayaran gagal dan penjualan ini dibatalkan. Buat transaksi baru.',
        saleId: id,
        status,
        ...(refusedCode ? { code: refusedCode } : {}),
      });
    return this.get(s, id, true);
  }

  async create(s: PosSession, key: string, input: SaleInput) {
    const hash = requestHash(input);
    const prior = await this.replay(s, key, hash);
    if (prior) return prior;
    let created: { id: string; downPaymentId: string | null };
    try {
      created = await this.db.transaction((tx) =>
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
    // A kasbon's down payment is a payment of its own (order reference `<receivableId>:1`).
    const { downPaymentId } = created;
    if (downPaymentId)
      await this.payments.afterCommit('receivable_payment', downPaymentId, () =>
        this.payments.recordReceivablePayment(s.tenantId, downPaymentId),
      );
    return this.finish(s, created.id);
  }

  private async insert(
    tx: Tx,
    s: PosSession,
    key: string,
    input: SaleInput,
    hash: string,
  ): Promise<{ id: string; downPaymentId: string | null }> {
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

    const { byId, priced } = await this.price(tx, s.tenantId, input.lines);
    const canOverride = hasPermission(s, 'sales.price_override');
    const lines = input.lines.map((l, i) => {
      const p = byId.get(l.productId)!;
      const q = priced[i];
      // A client price replaces the price of the line's unit, and only with the permission.
      const overridden =
        canOverride && l.price !== undefined && l.price !== q.listPrice;
      const unitPrice = overridden ? l.price! : q.listPrice;
      return {
        productId: p.id,
        name: p.name,
        qty: l.qty,
        unit: q.unit,
        unitQty: q.unitQty,
        baseQty: q.baseQty,
        normalUnitPrice: q.normalUnitPrice,
        // Owner ruling 2026-11-25: a manual price is not wholesale. The tier is not recorded on an
        // overridden line (no "Harga grosir", no savings); `listPrice` stays the server's price and
        // `normalUnitPrice` the unit's. The line's base quantity counted toward the product's total.
        appliedTierMinQty: overridden ? null : (q.appliedTier?.minQty ?? null),
        listPrice: q.listPrice,
        unitPrice,
        lineTotal: unitPrice * l.qty,
        priceOverriddenBy: overridden ? s.actorId : null,
        index: i,
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

    // UMK-1991: with payment-api on, a sale that takes a payment waits for it (step 2 completes it).
    // A kasbon sale takes none (its down payment is recorded apart) and completes here.
    const charged = this.payments.enabled && !method.isCredit;
    // One row per store: the sale's number and the tax rate, in one statement. A sale that completes in
    // this transaction takes its receipt number now; one that waits for its payment takes a hold number,
    // and its receipt number when it is completed (UMK-2038: a cancelled sale leaves no gap).
    const settings = await takeNumber(
      tx,
      s.tenantId,
      charged ? 'hold' : 'receipt',
    );
    // Tax on the amount after the manual discount AND the voucher (Lakasir flaw 2).
    const tax = taxOf(subtotal - discount - voucherDiscount, settings.taxBps);
    const total = subtotal - discount - voucherDiscount + tax;
    // UMK-1993: only a cash sale is rounded, after tax, outside `total` (the tax base and the revenue do
    // not change). A kasbon and every non-cash method owe the exact total.
    const rounding = method.isCash ? cashRounding(total) : 0;
    const amountDue = total + rounding;
    if (method.isCredit) {
      // Kasbon: the rest becomes the member's receivable; paid may be 0.
      if (!memberId) throw fail('Pilih member untuk kasbon', {}, 'memberId');
      if (input.paid >= total)
        throw fail('Kasbon harus menyisakan sisa tagihan', { total }, 'paid');
    } else if (method.isCash) {
      if (input.paid < amountDue)
        throw fail(
          'Uang dibayar kurang dari jumlah yang harus dibayar',
          { total, rounding, amountDue },
          'paid',
        );
    } else if (
      method.isOnline &&
      // Asked again here: a method that exists must not sell where online payments are off (payment-api
      // off, production, NODE_ENV unset), nor with a gateway method this version does not know: such a
      // sale would wait for a payment nothing can ask for.
      (!this.payments.onlineEnabled || paymentMethodCode(method) === null)
    ) {
      throw fail(
        'Metode pembayaran online belum bisa dipakai',
        {},
        'paymentMethodId',
      );
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
        number: charged ? null : settings.number,
        holdNumber: charged ? settings.number : null,
        holdDay: charged ? settings.day : null,
        completedAt: charged ? null : sql`clock_timestamp()`,
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
        rounding,
        paid: input.paid,
        change: Math.max(input.paid - amountDue, 0),
        costTotal: 0,
        overrideBy,
        note: input.note || null,
        status: charged ? 'awaiting_payment' : 'completed',
        // Fixed now: a later edit of the method's kind does not change what this sale is charged as.
        paymentMethodCode: charged ? paymentMethodCode(method) : null,
      })
      .returning({ id: sales.id });

    let costTotal = 0;
    // Product-id order: two multi-item sales lock batches in the same order (no deadlock).
    const ordered = [...lines].sort((x, y) =>
      x.productId < y.productId ? -1 : x.productId > y.productId ? 1 : 0,
    );
    // UMK-1985: a product on several lines (pcs + dus) is checked once against its whole draw in base
    // units, so the refusal names what is really left, before any of its lines draws.
    const needed = new Map<string, number>();
    for (const l of ordered)
      needed.set(l.productId, (needed.get(l.productId) ?? 0) + l.baseQty);
    const checked = new Set<string>();
    for (const l of ordered) {
      const p = byId.get(l.productId)!;
      if (
        p.type === 'product' &&
        needed.get(l.productId) !== l.baseQty &&
        !checked.has(l.productId)
      ) {
        checked.add(l.productId);
        const available = await this.stock.lockedOnHand(
          tx,
          s.tenantId,
          l.productId,
        );
        if (available < needed.get(l.productId)!)
          throw fail(
            `Stok ${p.name} tidak cukup (sisa ${available})`,
            { productId: l.productId, available },
            `lines.${l.index}.qty`,
          );
      }
      // Stock is kept in base units: 1 dus of 24 draws 24, and its FIFO cost is the line's cost.
      const { costTotal: cost } = await this.stock
        .consume(tx, {
          tenantId: s.tenantId,
          productId: l.productId,
          qty: l.baseQty,
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
            throw fail(body.message, body, `lines.${l.index}.qty`);
          }
          throw e;
        });
      costTotal += cost;
      await tx.insert(saleLines).values({
        tenantId: s.tenantId,
        saleId: sale.id,
        productId: l.productId,
        name: l.name,
        qty: l.qty,
        unit: l.unit,
        unitQty: l.unitQty,
        normalUnitPrice: l.normalUnitPrice,
        appliedTierMinQty: l.appliedTierMinQty,
        listPrice: l.listPrice,
        unitPrice: l.unitPrice,
        lineTotal: l.lineTotal,
        priceOverriddenBy: l.priceOverriddenBy,
        costTotal: cost,
      });
    }
    await tx.update(sales).set({ costTotal }).where(eq(sales.id, sale.id));
    const downPaymentId = method.isCredit
      ? await createReceivable(tx, s, {
          id: sale.id,
          memberId: memberId!,
          total,
          paid: input.paid,
          cashMethodId: await cashMethodId(tx, s.tenantId),
          recordInPaymentApi: this.payments.enabled,
        })
      : null;
    return { id: sale.id, downPaymentId };
  }

  /**
   * UMK-1985: the live, active products of a cart and the server's price of every line (unit and wholesale
   * tier, catalog/pricing.ts). 422 on an unknown product, an unknown unit, or a product and unit named twice.
   */
  private async price(
    db: Db | Tx,
    tenantId: string,
    lines: { productId: string; qty: number; unit?: string }[],
  ) {
    const ids = [...new Set(lines.map((l) => l.productId))];
    const [rows, pricing] = await Promise.all([
      db
        .select({
          id: products.id,
          name: products.name,
          type: products.type,
          unit: products.unit,
          sellingPrice: products.sellingPrice,
        })
        .from(products)
        .where(
          and(
            eq(products.tenantId, tenantId),
            inArray(products.id, ids),
            isNull(products.deletedAt),
            eq(products.isActive, true),
          ),
        ),
      loadPricing(db, tenantId, ids),
    ]);
    const byId = new Map(rows.map((r) => [r.id, r]));
    const missing = ids.filter((pid) => !byId.has(pid));
    if (missing.length)
      throw fail(
        'Produk tidak ditemukan atau tidak aktif',
        { productIds: missing },
        `lines.${lines.findIndex((l) => l.productId === missing[0])}.productId`,
      );
    const pricingOf = (id: string): ProductPricing => {
      const p = byId.get(id)!;
      const extra = pricing.get(id);
      return {
        unit: p.unit,
        sellingPrice: p.sellingPrice,
        units: extra?.units ?? [],
        tiers: extra?.tiers ?? [],
      };
    };
    const priced = priceLines(lines, pricingOf);
    const seen = new Set<string>();
    const complete = priced.map((q, i) => {
      if (!q)
        throw fail(
          'Satuan tidak ditemukan untuk produk ini',
          {},
          `lines.${i}.unit`,
        );
      // "pcs" and no unit at all are the same line.
      const key = `${lines[i].productId}:${q.unit}`;
      if (seen.has(key))
        throw fail('Satu produk dan satuan cukup satu baris', {}, 'lines');
      seen.add(key);
      return q;
    });
    return { byId, priced: complete };
  }

  /**
   * `POST /sales/quote`: what the cart's lines would cost now, with nothing written and no stock check.
   * The cart shows "Harga grosir" from `appliedTier` and "Tambah N lagi" from `nextTier`.
   */
  async quote(s: PosSession, input: QuoteInput) {
    const { byId, priced } = await this.price(this.db, s.tenantId, input.lines);
    const lines = input.lines.map((l, i) => {
      const q = priced[i];
      return {
        productId: l.productId,
        name: byId.get(l.productId)!.name,
        qty: l.qty,
        unit: q.unit,
        unitQty: q.unitQty,
        baseQty: q.baseQty,
        normalUnitPrice: q.normalUnitPrice,
        unitPrice: q.listPrice,
        lineTotal: q.listPrice * l.qty,
        appliedTier: q.appliedTier,
        savings: q.savings,
        nextTier: q.nextTier,
      };
    });
    const subtotal = lines.reduce((n, l) => n + l.lineTotal, 0);
    if (subtotal > MAX_TOTAL) throw fail('Total terlalu besar', {}, 'lines');
    return { lines, subtotal };
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
    const methodId = id ?? (await cashMethodId(tx, tenantId));
    const [m] = await tx
      .select({
        id: paymentMethods.id,
        isCash: paymentMethods.isCash,
        isDebit: paymentMethods.isDebit,
        isWallet: paymentMethods.isWallet,
        isCredit: paymentMethods.isCredit,
        isOnline: paymentMethods.isOnline,
        gatewayMethod: paymentMethods.gatewayMethod,
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

  /** Cashiers see their own sales; `reports.view` sees the store's. */
  private scope(s: PosSession): SQL {
    return hasPermission(s, 'reports.view')
      ? eq(sales.tenantId, s.tenantId)
      : and(eq(sales.tenantId, s.tenantId), eq(sales.actorId, s.actorId))!;
  }

  async list(s: PosSession, q: SalesQuery) {
    const where = and(
      this.scope(s),
      // Receipts only, unless the waiting (or cancelled) ones are asked for (UMK-1991).
      q.status
        ? eq(sales.status, q.status)
        : inArray(sales.status, [...FINAL_SALE_STATUSES]),
      q.shiftId ? eq(sales.shiftId, q.shiftId) : undefined,
      // By the paid time, as the reports count (a PG sale paid after midnight is in the new day).
      q.from ? gte(sales.paidAt, new Date(q.from)) : undefined,
      q.to ? lt(sales.paidAt, new Date(q.to)) : undefined,
    );
    const showCost = hasPermission(s, 'reports.view');
    const [rows, [rung], [reversed]] = await Promise.all([
      this.db
        .select({
          id: sales.id,
          number: sales.number,
          holdNumber: sales.holdNumber,
          shiftId: sales.shiftId,
          actorKind: sales.actorKind,
          // Owner sales have no staff row (Lakasir's "user.name" column).
          cashier: sql<string>`coalesce(${staff.name}, 'Pemilik')`,
          subtotal: sales.subtotal,
          discount: sales.discount,
          voucherDiscount: sales.voucherDiscount,
          tax: sales.tax,
          total: sales.total,
          rounding: sales.rounding,
          paid: sales.paid,
          change: sales.change,
          costTotal: sales.costTotal,
          status: sales.status,
          paymentMethodCode: sales.paymentMethodCode,
          voidedAt: sales.voidedAt,
          paidAt: sales.paidAt,
          createdAt: sales.createdAt,
        })
        .from(sales)
        .leftJoin(
          staff,
          and(eq(staff.tenantId, sales.tenantId), eq(staff.id, sales.actorId)),
        )
        .where(where)
        .orderBy(
          desc(sales.paidAt),
          // Receipts by their number; waiting sales have none yet and follow their hold number.
          sql`${sales.number} desc nulls last`,
          desc(sales.holdNumber),
        )
        .limit(q.perPage)
        .offset((q.page - 1) * q.perPage),
      this.db
        .select({
          count: count(),
          revenue: total(sales.total),
          rounding: total(sales.rounding),
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
          rounding: total(saleVoids.rounding),
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
      // UMK-1993: cash rounding, outside revenue; revenue + rounding is what customers owed.
      rounding: rung.rounding - reversed.rounding,
      discount: rung.discount - reversed.discount,
      voucherDiscount: rung.voucherDiscount - reversed.voucherDiscount,
      // Voids done in the window: what was subtracted above.
      voidedCount: reversed.count,
    };
    return {
      data: rows.map(({ paymentMethodCode: code, ...r }) => ({
        ...r,
        ...saleNumbers(r),
        // UMK-1991: paid through a payment gateway: waited for on the payment screen, cancelled by refund.
        onlinePayment: isOnlineMethod(code),
        amountDue: r.total + r.rounding,
        costTotal: showCost ? r.costTotal : undefined,
      })),
      total: rung.count,
      summary,
    };
  }

  /**
   * `GET /sales/paid-since` (UMK-2046): what became of the actor's waiting sales after `since`, OLDEST
   * first, so a till that was away for long reads all of it, a page at a time. A till asks with the `asOf`
   * of its last answer. Listed:
   * - a sale paid through a payment gateway that was completed (`completed`; `void` when refunded since);
   * - a cash or EDC sale that the JOB completed (`completedByJob`): its payment could not be confirmed when
   *   it was rung up. One completed by a request of the till is not listed: the cashier saw it. Nor is a
   *   sale the cashier switched to cash;
   * - a sale that was cancelled: `expired` when its QR or VA ran out, else `cancelled`, with `reason`
   *   (CANCEL_REASONS; null when unknown). Its stock and voucher are back and it has no receipt number.
   *
   * By `endedAt`: `completed_at` or `cancelled_at`, when pos-api wrote the end, never `paid_at`: a payment
   * learned late is dated at the customer's paid time, which can be before the till last looked. Whose: the
   * actor's own sales, or the store's with `reports.view`, exactly as `GET /sales` (`scope`): the answer
   * carries totals.
   *
   * More than PAID_SINCE_LIMIT: `hasMore` is true, `asOf` is the last listed sale's end (to the
   * microsecond) and `afterId` its id; the next request sends both and continues right after that sale. Such
   * a cursor is kept out of the last PAID_SINCE_OVERLAP_SECONDS (see below).
   * Else `hasMore` is false, `afterId` null and `asOf` the database's time less
   * PAID_SINCE_OVERLAP_SECONDS: an end is stamped when it is written and seen when its transaction ends, so
   * the next request overlaps this one and the till drops the ids it already has.
   */
  async paidSince(s: PosSession, q: PaidSinceQuery) {
    const since = sql`${q.since}::timestamptz`;
    // A cancelled sale has no `completed_at`, and a completed one no `cancelled_at`.
    const endedAt = sql`coalesce(${sales.cancelledAt}, ${sales.completedAt})`;
    const [found, [{ asOf }]] = await Promise.all([
      this.db
        .select({
          id: sales.id,
          number: sales.number,
          holdNumber: sales.holdNumber,
          saleStatus: sales.status,
          cancelReason: sales.cancelReason,
          completedByJob: sales.settledByJob,
          code: sales.paymentMethodCode,
          total: sales.total,
          rounding: sales.rounding,
          paymentMethod: paymentMethods.name,
          paidAt: sales.paidAt,
          completedAt: sales.completedAt,
          cancelledAt: sales.cancelledAt,
          // The cursor: the times above are cut to milliseconds on their way out.
          at: sql<string>`to_char(${endedAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
          // Ended long enough ago that no transaction still running can commit an earlier end.
          settled: sql<boolean>`${endedAt} <= now() - make_interval(secs => ${PAID_SINCE_OVERLAP_SECONDS})`,
          createdAt: sales.createdAt,
        })
        .from(sales)
        .innerJoin(
          paymentMethods,
          and(
            eq(paymentMethods.tenantId, sales.tenantId),
            eq(paymentMethods.id, sales.paymentMethodId),
          ),
        )
        .where(
          and(
            this.scope(s),
            or(
              and(
                inArray(sales.status, [...FINAL_SALE_STATUSES]),
                or(
                  inArray(sales.paymentMethodCode, [...ONLINE_METHODS]),
                  eq(sales.settledByJob, true),
                ),
              ),
              eq(sales.status, 'cancelled'),
            ),
            q.afterId
              ? sql`(${endedAt}, ${sales.id}) > (${since}, ${q.afterId}::uuid)`
              : sql`${endedAt} > ${since}`,
          ),
        )
        .orderBy(asc(endedAt), asc(sales.id))
        .limit(PAID_SINCE_LIMIT + 1),
      this.db.execute<{ asOf: string }>(
        sql`select to_char((now() - make_interval(secs => ${PAID_SINCE_OVERLAP_SECONDS})) at time zone 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "asOf"`,
      ),
    ]);
    const hasMore = found.length > PAID_SINCE_LIMIT;
    let rows = found.slice(0, PAID_SINCE_LIMIT);
    // A cursor is never put inside the last PAID_SINCE_OVERLAP_SECONDS: a completion still being written
    // there may commit with an earlier time than the cursor and would be passed by. A page that would end
    // there stops at the last settled sale instead, and the sales after it come with the page that ends the
    // paging, whose `asOf` overlaps. (A page with no settled sale at all cannot be cut: more than a page
    // of sales ended within those seconds. It is paged as it is.)
    if (hasMore && !rows[rows.length - 1].settled && rows[0].settled)
      rows = rows.filter((r) => r.settled);
    const last = rows[rows.length - 1];
    return {
      data: rows.map(
        ({ rounding, at, settled, code, saleStatus, cancelReason, ...r }) => {
          void [at, settled]; // the cursor only
          return {
            ...r,
            ...saleNumbers(r),
            // `expired`: cancelled because the QR or VA ran out. The sale's own status is `cancelled` then.
            status:
              saleStatus === 'cancelled' && cancelReason === 'expired'
                ? ('expired' as const)
                : saleStatus,
            reason: cancelReason,
            onlinePayment: isOnlineMethod(code),
            amountDue: r.total + rounding,
            // When pos-api wrote the end the till is told of.
            endedAt: r.cancelledAt ?? r.completedAt,
          };
        },
      ),
      hasMore,
      asOf: hasMore ? last.at : asOf,
      afterId: hasMore ? last.id : null,
    };
  }

  /** One sale with lines. Cost is shown only to `reports.view`. `own` skips the scope (just created). */
  async get(s: PosSession, id: string, own = false) {
    const [sale] = await this.db
      .select({
        id: sales.id,
        number: sales.number,
        holdNumber: sales.holdNumber,
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
        rounding: sales.rounding,
        paid: sales.paid,
        change: sales.change,
        costTotal: sales.costTotal,
        overrideBy: sales.overrideBy,
        note: sales.note,
        status: sales.status,
        paymentMethodCode: sales.paymentMethodCode,
        voidedAt: sales.voidedAt,
        paidAt: sales.paidAt,
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
        // A line from before UMK-1985 was sold in the product's base unit.
        unit: sql<string>`coalesce(${saleLines.unit}, ${products.unit})`,
        unitQty: saleLines.unitQty,
        baseQty: sql<number>`${saleLines.qty} * ${saleLines.unitQty}`,
        normalUnitPrice:
          sql<number>`coalesce(${saleLines.normalUnitPrice}, ${saleLines.listPrice})`.mapWith(
            Number,
          ),
        appliedTierMinQty: saleLines.appliedTierMinQty,
        listPrice: saleLines.listPrice,
        unitPrice: saleLines.unitPrice,
        lineTotal: saleLines.lineTotal,
        costTotal: saleLines.costTotal,
        priceOverriddenBy: saleLines.priceOverriddenBy,
      })
      .from(saleLines)
      .innerJoin(products, eq(products.id, saleLines.productId))
      .where(and(eq(saleLines.tenantId, s.tenantId), eq(saleLines.saleId, id)))
      // Base unit before the larger units of the same product.
      .orderBy(asc(saleLines.name), asc(saleLines.unitQty), asc(saleLines.id));
    const showCost = hasPermission(s, 'reports.view');
    const { paymentMethodCode: code, ...rest } = sale;
    return {
      ...rest,
      ...saleNumbers(sale),
      // UMK-1991: paid through a payment gateway: waited for on the payment screen, cancelled by refund.
      onlinePayment: isOnlineMethod(code),
      // UMK-1993: what the customer owes; `rounding` is its own line ("Pembulatan"), 0 unless cash.
      amountDue: sale.total + sale.rounding,
      costTotal: showCost ? sale.costTotal : undefined,
      lines: lines.map(({ appliedTierMinQty, ...l }) => ({
        ...l,
        // UMK-1985: the wholesale tier that set the price ("Harga grosir"), and what it saved against the
        // unit's normal price. A line with a manual price has neither (stored without a tier).
        appliedTier:
          appliedTierMinQty === null
            ? null
            : { minQty: appliedTierMinQty, price: l.listPrice },
        savings:
          appliedTierMinQty === null
            ? 0
            : (l.normalUnitPrice - l.listPrice) * l.qty,
        // The price was typed by someone with sales.price_override ("Harga manual").
        manualPrice: l.priceOverriddenBy !== null,
        costTotal: showCost ? l.costTotal : undefined,
      })),
    };
  }

  /**
   * What the printed receipt shows. Only a receipt has one: a sale that awaits its payment or was cancelled
   * answers 409 `not_a_receipt` (UMK-2038: its `number` is a hold number, which must never be printed as
   * "No." next to real receipt numbers). So `number` here is always the receipt number.
   */
  async receipt(s: PosSession, id: string) {
    const sale = await this.get(s, id);
    if (sale.receiptNumber === null || !isFinalSale(sale.status))
      throw new ConflictException({
        message:
          sale.status === 'awaiting_payment'
            ? 'Penjualan ini masih menunggu pembayaran, belum ada struknya.'
            : 'Penjualan ini dibatalkan dan tidak punya struk.',
        code: 'not_a_receipt',
        saleId: id,
        status: sale.status,
      });
    let cashier = 'Pemilik';
    if (sale.actorKind === 'cashier') {
      const [row] = await this.db
        .select({ name: staff.name })
        .from(staff)
        .where(and(eq(staff.tenantId, s.tenantId), eq(staff.id, sale.actorId)));
      cashier = row?.name ?? 'Kasir';
    }
    return {
      number: sale.receiptNumber,
      receiptNumber: sale.receiptNumber,
      holdNumber: sale.holdNumber,
      createdAt: sale.createdAt,
      cashier,
      paymentMethod: sale.paymentMethod,
      lines: sale.lines.map((l) => ({
        name: l.name,
        qty: l.qty,
        unit: l.unit,
        unitQty: l.unitQty,
        baseQty: l.baseQty,
        unitPrice: l.unitPrice,
        lineTotal: l.lineTotal,
        normalUnitPrice: l.normalUnitPrice,
        appliedTier: l.appliedTier,
        savings: l.savings,
        manualPrice: l.manualPrice,
      })),
      subtotal: sale.subtotal,
      discount: sale.discount,
      voucherDiscount: sale.voucherDiscount,
      memberName: sale.memberName,
      receivableRest: sale.receivableRest,
      taxBps: sale.taxBps,
      tax: sale.tax,
      total: sale.total,
      rounding: sale.rounding,
      amountDue: sale.amountDue,
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
