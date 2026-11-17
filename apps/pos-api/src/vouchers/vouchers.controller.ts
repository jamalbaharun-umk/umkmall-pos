import {
  Body,
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
import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  fieldError,
  formatRupiah,
  LocalDate,
  Rupiah,
  validate,
} from '../common/validation';
import { type Db, InjectDb } from '../db/db.module';
import { VOUCHER_TYPES, vouchers } from '../db/schema';
import { isUniqueViolation, parseId } from '../staff/http';
import { RequirePermission } from '../staff/require-permission';
import type { Tx } from '../stock/stock.service';
import { CurrentSession } from '../tenancy/decorators';
import type { PosSession } from '../tenancy/session';

const code = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .regex(/^\S+$/, 'Kode tanpa spasi')
  .transform((c) => c.toUpperCase());

const Fields = z
  .object({
    name: z.string().trim().min(1).max(120),
    code,
    type: z.enum(VOUCHER_TYPES),
    nominal: Rupiah.positive('Harus lebih dari 0'),
    kuota: z.number().int('Harus bilangan bulat').min(0).max(1_000_000),
    startDate: LocalDate,
    expired: LocalDate,
    minimalBuying: Rupiah.default(0),
  })
  .strict();
const VoucherInput = Fields.refine(
  (v) => v.type !== 'percentage' || v.nominal <= 100,
  { message: 'Persen antara 1 dan 100', path: ['nominal'] },
).refine((v) => v.expired >= v.startDate, {
  message: 'Tanggal berakhir harus sama dengan atau setelah tanggal mulai',
  path: ['expired'],
});
// A partial update is checked merged with the stored voucher (percentage ≤ 100, dates ordered).
const VoucherUpdate = Fields.partial().refine(
  (o) => Object.keys(o).length > 0,
  'Tidak ada yang diubah',
);
const CheckInput = z.object({ code, amount: Rupiah }).strict();

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
  field = 'voucherCode',
) {
  const refuse = (message: string) => fieldError(field, message);
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
  if (!v.inRange) throw refuse('Voucher belum berlaku atau sudah kedaluwarsa');
  if (v.kuota <= 0) throw refuse('Voucher sudah habis');
  if (amount < v.minimalBuying)
    throw refuse(
      `Belanja minimal ${formatRupiah(v.minimalBuying)} untuk voucher ini`,
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
  if (!rows.length) throw fieldError('voucherCode', 'Voucher sudah habis');
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
        throw fieldError('code', 'Kode voucher sudah dipakai', 409);
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

  async update(tenantId: string, id: string, body: unknown) {
    const changes = validate(VoucherUpdate, body);
    const c = await this.get(tenantId, id);
    const current = {
      name: c.name,
      code: c.code,
      type: c.type,
      nominal: c.nominal,
      kuota: c.kuota,
      startDate: c.startDate,
      expired: c.expired,
      minimalBuying: c.minimalBuying,
    };
    // Checked as a whole so a changed nominal or date is refused on its own field, not by the DB check.
    const input = validate(VoucherInput, { ...current, ...changes });
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
    return evaluateVoucher(this.db, tenantId, input.code, input.amount, 'code');
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
    return this.vouchers.create(s.tenantId, validate(VoucherInput, body));
  }

  // The cashier's preview of a code; the sale re-validates and takes the quota.
  @Post('check')
  @RequirePermission('sales.create')
  @HttpCode(200)
  check(@CurrentSession() s: PosSession, @Body() body: unknown) {
    return this.vouchers.check(s.tenantId, validate(CheckInput, body));
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
    return this.vouchers.update(s.tenantId, parseId(id), body);
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
