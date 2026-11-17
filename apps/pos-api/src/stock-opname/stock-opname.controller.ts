import {
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { validate } from '../common/validation';
import { type Db, InjectDb } from '../db/db.module';
import { products, stockOpnameLines, stockOpnames } from '../db/schema';
import { assertStockProducts } from '../purchasing/purchasing.service';
import { parseId } from '../staff/http';
import { RequirePermission } from '../staff/require-permission';
import { StockModule } from '../stock/stock.module';
import { StockService } from '../stock/stock.service';
import { CurrentSession } from '../tenancy/decorators';
import type { PosSession } from '../tenancy/session';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

const fields = {
  note: z.string().trim().max(500).nullable().optional(),
  lines: z
    .array(
      z
        .object({
          productId: z.string().uuid(),
          countedQty: z
            .number()
            .int('Jumlah harus bilangan bulat')
            .nonnegative('Jumlah tidak boleh negatif')
            .max(1_000_000, 'Jumlah maksimal 1.000.000'),
          reason: z.string().trim().max(200).nullable().optional(),
        })
        .strict(),
    )
    .min(1)
    .max(500)
    .refine(
      (l) => new Set(l.map((x) => x.productId)).size === l.length,
      'Satu produk cukup satu baris',
    ),
};
const OpnameCreate = z.object(fields).strict();
const OpnameUpdate = z.object(fields).partial().strict();
type Lines = z.infer<typeof OpnameCreate>['lines'];

@Injectable()
export class StockOpnameService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly stock: StockService,
  ) {}

  list(tenantId: string) {
    return this.db
      .select({
        id: stockOpnames.id,
        status: stockOpnames.status,
        note: stockOpnames.note,
        approvedAt: stockOpnames.approvedAt,
        createdAt: stockOpnames.createdAt,
      })
      .from(stockOpnames)
      .where(eq(stockOpnames.tenantId, tenantId))
      .orderBy(desc(stockOpnames.createdAt))
      .limit(200);
  }

  async get(tenantId: string, id: string) {
    const [opname] = await this.db
      .select({
        id: stockOpnames.id,
        status: stockOpnames.status,
        note: stockOpnames.note,
        approvedBy: stockOpnames.approvedBy,
        approvedAt: stockOpnames.approvedAt,
        createdAt: stockOpnames.createdAt,
      })
      .from(stockOpnames)
      .where(and(eq(stockOpnames.tenantId, tenantId), eq(stockOpnames.id, id)));
    if (!opname) throw new NotFoundException();
    const lines = await this.db
      .select({
        id: stockOpnameLines.id,
        productId: stockOpnameLines.productId,
        productName: products.name,
        sku: products.sku,
        countedQty: stockOpnameLines.countedQty,
        systemQty: stockOpnameLines.systemQty,
        reason: stockOpnameLines.reason,
      })
      .from(stockOpnameLines)
      .innerJoin(products, eq(products.id, stockOpnameLines.productId))
      .where(
        and(
          eq(stockOpnameLines.tenantId, tenantId),
          eq(stockOpnameLines.opnameId, id),
        ),
      )
      .orderBy(products.name);
    // A draft shows today's on-hand (what approval will compare against); an approved one, what it applied.
    const live =
      opname.status === 'draft'
        ? await this.stock.onHand(
            tenantId,
            lines.map((l) => l.productId),
          )
        : {};
    return {
      ...opname,
      lines: lines.map((l) => {
        const systemQty = live[l.productId] ?? l.systemQty;
        return { ...l, systemQty, difference: l.countedQty - systemQty };
      }),
    };
  }

  async create(
    tenantId: string,
    actorId: string,
    input: z.infer<typeof OpnameCreate>,
  ) {
    const id = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(stockOpnames)
        .values({ tenantId, note: input.note, createdBy: actorId })
        .returning({ id: stockOpnames.id });
      await this.writeLines(tx, tenantId, row.id, input.lines);
      return row.id;
    });
    return this.get(tenantId, id);
  }

  async update(
    tenantId: string,
    id: string,
    input: z.infer<typeof OpnameUpdate>,
  ) {
    await this.db.transaction(async (tx) => {
      await this.lockDraft(tx, tenantId, id);
      await tx
        .update(stockOpnames)
        .set({ note: input.note, updatedAt: new Date() })
        .where(eq(stockOpnames.id, id));
      if (input.lines) {
        await tx
          .delete(stockOpnameLines)
          .where(eq(stockOpnameLines.opnameId, id));
        await this.writeLines(tx, tenantId, id, input.lines);
      }
    });
    return this.get(tenantId, id);
  }

  // Drafts only: nothing was applied, so nothing to reverse (Lakasir's delete added counts back to stock).
  async remove(tenantId: string, id: string) {
    await this.db.transaction(async (tx) => {
      await this.lockDraft(tx, tenantId, id);
      await tx.delete(stockOpnames).where(eq(stockOpnames.id, id));
    });
  }

  /** One `opname` adjustment per line with counted ≠ system, once: an approved opname changes nothing. */
  async approve(tenantId: string, actorId: string, id: string) {
    await this.db.transaction(async (tx) => {
      if ((await this.lock(tx, tenantId, id)) === 'approved') return;
      const lines = await tx
        .select()
        .from(stockOpnameLines)
        .where(eq(stockOpnameLines.opnameId, id))
        .orderBy(stockOpnameLines.productId); // stock's lock order: no deadlocks
      for (const l of lines) {
        // The count replaces what is on hand NOW (sales since the draft was saved included), read under the lock.
        const systemQty = await this.stock.lockedOnHand(
          tx,
          tenantId,
          l.productId,
        );
        if (systemQty !== l.systemQty)
          await tx
            .update(stockOpnameLines)
            .set({ systemQty })
            .where(eq(stockOpnameLines.id, l.id));
        const delta = l.countedQty - systemQty;
        if (delta !== 0)
          await this.stock.adjust(tx, {
            tenantId,
            productId: l.productId,
            delta,
            reason: 'opname',
            refId: id,
            actorId,
          });
      }
      await tx
        .update(stockOpnames)
        .set({
          status: 'approved',
          approvedBy: actorId,
          approvedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(stockOpnames.id, id));
    });
    return this.get(tenantId, id);
  }

  private async lock(tx: Tx, tenantId: string, id: string) {
    const [row] = await tx
      .select({ status: stockOpnames.status })
      .from(stockOpnames)
      .where(and(eq(stockOpnames.tenantId, tenantId), eq(stockOpnames.id, id)))
      .for('update');
    if (!row) throw new NotFoundException();
    return row.status;
  }

  private async lockDraft(tx: Tx, tenantId: string, id: string) {
    if ((await this.lock(tx, tenantId, id)) !== 'draft')
      throw new ConflictException('Opname sudah disetujui');
  }

  // system_qty = on-hand at the moment the count is saved (Lakasir's current_stock).
  private async writeLines(
    tx: Tx,
    tenantId: string,
    opnameId: string,
    lines: Lines,
  ) {
    const ids = lines.map((l) => l.productId);
    await assertStockProducts(tx, tenantId, ids);
    const onHand = await this.stock.onHand(tenantId, ids, tx);
    await tx.insert(stockOpnameLines).values(
      lines.map((l) => ({
        ...l,
        tenantId,
        opnameId,
        systemQty: onHand[l.productId] ?? 0,
      })),
    );
  }
}

@Controller('stock-opnames')
export class StockOpnameController {
  constructor(private readonly opnames: StockOpnameService) {}

  @Get()
  async list(@CurrentSession() s: PosSession) {
    return { data: await this.opnames.list(s.tenantId) };
  }

  @Post()
  @RequirePermission('purchasing.manage')
  create(@CurrentSession() s: PosSession, @Body() body: unknown) {
    return this.opnames.create(
      s.tenantId,
      s.actorId,
      validate(OpnameCreate, body),
    );
  }

  @Get(':id')
  get(@CurrentSession() s: PosSession, @Param('id') id: string) {
    return this.opnames.get(s.tenantId, parseId(id));
  }

  @Patch(':id')
  @RequirePermission('purchasing.manage')
  update(
    @CurrentSession() s: PosSession,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.opnames.update(
      s.tenantId,
      parseId(id),
      validate(OpnameUpdate, body),
    );
  }

  @Delete(':id')
  @RequirePermission('purchasing.manage')
  @HttpCode(204)
  async remove(@CurrentSession() s: PosSession, @Param('id') id: string) {
    await this.opnames.remove(s.tenantId, parseId(id));
  }

  @Post(':id/approve')
  @RequirePermission('purchasing.manage')
  @HttpCode(200)
  approve(@CurrentSession() s: PosSession, @Param('id') id: string) {
    return this.opnames.approve(s.tenantId, s.actorId, parseId(id));
  }
}

@Module({
  imports: [StockModule],
  controllers: [StockOpnameController],
  providers: [StockOpnameService],
})
export class StockOpnameModule {}
