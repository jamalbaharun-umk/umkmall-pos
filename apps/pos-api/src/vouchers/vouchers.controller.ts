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
  UnprocessableEntityException,
} from '@nestjs/common';
import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { parse } from '../catalog/catalog.schemas';
import { type Db, InjectDb } from '../db/db.module';
import { VOUCHER_TYPES, vouchers } from '../db/schema';
import { isUniqueViolation, parseId } from '../staff/http';
import { RequirePermission } from '../staff/require-permission';
import type { Tx } from '../stock/stock.service';
import { CurrentSession } from '../tenancy/decorators';
import type { PosSession } from '../tenancy/session';

const rupiah = z.number().int().nonnegative().max(1_000_000_000_000);
const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((d) => !Number.isNaN(Date.parse(`${d}T00:00:00Z`)), 'tanggal');
const code = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .regex(/^\S+$/, 'tanpa spasi')
  .transform((c) => c.toUpperCase());

const Fields = z
  .object({
    name: z.string().trim().min(1).max(120),
    code,
    type: z.enum(VOUCHER_TYPES),
    nominal: rupiah.positive(),
    kuota: z.number().int().min(0).max(1_000_000),
    startDate: day,
    expired: day,
    minimalBuying: rupiah.default(0),
  })
  .strict();
const valid = (v: Partial<z.infer<typeof Fields>>) =>
  (v.type !== 'percentage' || (v.nominal ?? 0) <= 100) &&
  (!v.startDate || !v.expired || v.expired >= v.startDate);
const VoucherInput = Fields.refine(valid, 'nominal/tanggal');
const VoucherUpdate = Fields.partial().refine(
  (o) => Object.keys(o).length > 0 && valid(o),
  'nominal/tanggal',
);
const CheckInput = z.object({ code, amount: rupiah }).strict();

const columns = {
  id: vouchers.id,
  name: vouchers.name,
  code: vouchers.code,
  type: vouchers.type,
  nominal: vouchers.nominal,
  kuota: vouchers.kuota,
  startDate: vouchers.startDate,
  expired: vouchers.expired,
  minimalBuying: vouchers.minimalBuying,
  createdAt: vouchers.createdAt,
};

const live = (tenantId: string, id?: string) =>
  and(
    eq(vouchers.tenantId, tenantId),
    isNull(vouchers.deletedAt),
    id ? eq(vouchers.id, id) : undefined,
  );

const refuse = (message: string) =>
  new UnprocessableEntityException({ message });

/**
 * Validates a voucher for `amount` (the sale after its manual discount) WITHOUT touching quota
 * (Lakasir flaw 1: quota was taken before validation, so every attempt burned it).
 * Percentage rounds half up; flat is capped at the amount.
 */
export async function evaluateVoucher(
  db: Db | Tx,
  tenantId: string,
  voucherCode: string,
  amount: number,
) {
  // The store's day is Asia/Jakarta: a voucher "until 17 Nov" works until midnight WIB.
  const [v] = await db
    .select({
      id: vouchers.id,
      type: vouchers.type,
      nominal: vouchers.nominal,
      kuota: vouchers.kuota,
      minimalBuying: vouchers.minimalBuying,
      inRange: sql<boolean>`(now() at time zone 'Asia/Jakarta')::date between ${vouchers.startDate} and ${vouchers.expired}`,
    })
    .from(vouchers)
    .where(and(live(tenantId), eq(vouchers.code, voucherCode.toUpperCase())));
  if (!v) throw refuse('Voucher tidak ditemukan');
  if (!v.inRange) throw refuse('Voucher tidak berlaku hari ini');
  if (v.kuota <= 0) throw refuse('Kuota voucher habis');
  if (amount < v.minimalBuying)
    throw refuse(
      `Minimal belanja Rp${v.minimalBuying.toLocaleString('id-ID')} untuk voucher ini`,
    );
  const discount =
    v.type === 'percentage'
      ? Number((BigInt(amount) * BigInt(v.nominal) + 50n) / 100n)
      : Math.min(v.nominal, amount);
  return { id: v.id, discount };
}

/** Takes one use inside the sale's transaction: atomic, so two cashiers cannot share the last one. */
export async function consumeVoucher(tx: Tx, tenantId: string, id: string) {
  const rows = await tx
    .update(vouchers)
    .set({ kuota: sql`${vouchers.kuota} - 1` })
    .where(and(live(tenantId, id), gt(vouchers.kuota, 0)))
    .returning({ id: vouchers.id });
  if (!rows.length) throw refuse('Kuota voucher habis');
}

/** Vouchers (Lakasir VoucherResource + VoucherService). */
@Injectable()
export class VouchersService {
  constructor(@InjectDb() private readonly db: Db) {}

  list(tenantId: string) {
    return this.db
      .select(columns)
      .from(vouchers)
      .where(live(tenantId))
      .orderBy(desc(vouchers.createdAt));
  }

  async get(tenantId: string, id: string) {
    const [row] = await this.db
      .select(columns)
      .from(vouchers)
      .where(live(tenantId, id));
    if (!row) throw new NotFoundException();
    return row;
  }

  private async write<T>(op: () => Promise<T>) {
    try {
      return await op();
    } catch (e) {
      if (isUniqueViolation(e))
        throw new ConflictException({ message: 'Kode sudah dipakai' });
      // The row check (percentage ≤ 100, expired ≥ start) after merging a partial update.
      if ((e as { cause?: { code?: string } }).cause?.code === '23514')
        throw refuse('Nominal atau tanggal tidak valid');
      throw e;
    }
  }

  create(tenantId: string, input: z.infer<typeof VoucherInput>) {
    return this.write(async () => {
      const [row] = await this.db
        .insert(vouchers)
        .values({ tenantId, ...input })
        .returning(columns);
      return row;
    });
  }

  update(tenantId: string, id: string, input: z.infer<typeof VoucherUpdate>) {
    return this.write(async () => {
      const [row] = await this.db
        .update(vouchers)
        .set({ ...input, updatedAt: new Date() })
        .where(live(tenantId, id))
        .returning(columns);
      if (!row) throw new NotFoundException();
      return row;
    });
  }

  // Soft delete: past sales keep pointing at it.
  async remove(tenantId: string, id: string) {
    const [row] = await this.db
      .update(vouchers)
      .set({ deletedAt: new Date() })
      .where(live(tenantId, id))
      .returning({ id: vouchers.id });
    if (!row) throw new NotFoundException();
  }

  check(tenantId: string, input: z.infer<typeof CheckInput>) {
    return evaluateVoucher(this.db, tenantId, input.code, input.amount);
  }
}

@Controller('vouchers')
export class VouchersController {
  constructor(private readonly vouchers: VouchersService) {}

  @Get()
  @RequirePermission('vouchers.manage')
  async list(@CurrentSession() s: PosSession) {
    return { data: await this.vouchers.list(s.tenantId) };
  }

  @Post()
  @RequirePermission('vouchers.manage')
  create(@CurrentSession() s: PosSession, @Body() body: unknown) {
    return this.vouchers.create(s.tenantId, parse(VoucherInput, body));
  }

  // The cashier's preview of a code; the sale re-validates and takes the quota.
  @Post('check')
  @RequirePermission('sales.create')
  @HttpCode(200)
  check(@CurrentSession() s: PosSession, @Body() body: unknown) {
    return this.vouchers.check(s.tenantId, parse(CheckInput, body));
  }

  @Get(':id')
  @RequirePermission('vouchers.manage')
  get(@CurrentSession() s: PosSession, @Param('id') id: string) {
    return this.vouchers.get(s.tenantId, parseId(id));
  }

  @Patch(':id')
  @RequirePermission('vouchers.manage')
  update(
    @CurrentSession() s: PosSession,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.vouchers.update(
      s.tenantId,
      parseId(id),
      parse(VoucherUpdate, body),
    );
  }

  @Delete(':id')
  @RequirePermission('vouchers.manage')
  @HttpCode(204)
  async remove(@CurrentSession() s: PosSession, @Param('id') id: string) {
    await this.vouchers.remove(s.tenantId, parseId(id));
  }
}

@Module({ controllers: [VouchersController], providers: [VouchersService] })
export class VouchersModule {}
