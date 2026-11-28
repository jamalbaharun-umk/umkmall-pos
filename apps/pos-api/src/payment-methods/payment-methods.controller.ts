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
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { fieldError, validate } from '../common/validation';
import { type Db, InjectDb } from '../db/db.module';
import { paymentMethods } from '../db/schema';
import { PaymentSync } from '../payments-client/payment-sync.service';
import { ONLINE_METHODS } from '../payments-client/payments.client';
import { isUniqueViolation, parseId } from '../staff/http';
import { RequirePermission } from '../staff/require-permission';
import { AgentRoute, CurrentSession, HelperRoute } from '../tenancy/decorators';
import type { PosSession } from '../tenancy/session';

// `online` (UMK-1991): paid through a payment gateway (dynamic QRIS, VA), as payment-api's `gatewayMethod`.
export const PAYMENT_KINDS = [
  'cash',
  'debit',
  'credit',
  'wallet',
  'online',
] as const;
export type PaymentKind = (typeof PAYMENT_KINDS)[number];

const Fields = z
  .object({
    name: z.string().trim().min(1).max(60),
    kind: z.enum(PAYMENT_KINDS),
    gatewayMethod: z.enum(ONLINE_METHODS).optional(),
  })
  .strict();
type Fields = z.infer<typeof Fields>;

/** An online method names its gateway method; no other kind may. The kind decides, so both come together. */
const gatewayRule = (v: Partial<Fields>, ctx: z.RefinementCtx) => {
  if (v.kind === 'online' && !v.gatewayMethod)
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['gatewayMethod'],
      message: 'Pilih jenis pembayaran online',
    });
  if (v.kind !== 'online' && v.gatewayMethod)
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['gatewayMethod'],
      message: 'Hanya untuk metode pembayaran online',
    });
};
const Input = Fields.superRefine(gatewayRule);
const PatchInput = Fields.partial()
  .refine((o) => Object.keys(o).length > 0, 'Tidak ada yang diubah')
  .superRefine(gatewayRule);

const flags = (kind: PaymentKind, gatewayMethod?: string) => ({
  isCash: kind === 'cash',
  isDebit: kind === 'debit',
  isCredit: kind === 'credit',
  isWallet: kind === 'wallet',
  isOnline: kind === 'online',
  gatewayMethod: kind === 'online' ? (gatewayMethod ?? null) : null,
});

export const paymentKind = sql<PaymentKind>`case when ${paymentMethods.isCash} then 'cash' when ${paymentMethods.isDebit} then 'debit' when ${paymentMethods.isCredit} then 'credit' when ${paymentMethods.isOnline} then 'online' else 'wallet' end`;

const columns = {
  id: paymentMethods.id,
  name: paymentMethods.name,
  kind: paymentKind,
  gatewayMethod: paymentMethods.gatewayMethod,
};

const live = (tenantId: string, id?: string) =>
  and(
    eq(paymentMethods.tenantId, tenantId),
    isNull(paymentMethods.deletedAt),
    id ? eq(paymentMethods.id, id) : undefined,
  );

/** Payment methods (Lakasir PaymentMethodResource). "Tunai" is U3's seeded cash method and stays fixed. */
@Injectable()
export class PaymentMethodsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly payments: PaymentSync,
  ) {}

  /**
   * UMK-1991: an online method works only through payment-api, and until the legal gate (UMK-1977) its
   * only gateway is the local fake one: refused unless NODE_ENV is explicitly development or test.
   */
  private assertOnlineAllowed(kind?: PaymentKind) {
    if (kind !== 'online') return;
    if (!this.payments.onlineEnabled)
      throw fieldError('kind', 'Pembayaran online belum tersedia');
  }

  // The store's Tunai exists before any other method, so no one can claim the name with another kind.
  private seedCash(tenantId: string) {
    return this.db
      .insert(paymentMethods)
      .values({ tenantId, name: 'Tunai', isCash: true })
      .onConflictDoNothing();
  }

  async list(tenantId: string) {
    await this.seedCash(tenantId);
    return this.db
      .select(columns)
      .from(paymentMethods)
      .where(live(tenantId))
      .orderBy(asc(paymentMethods.createdAt), asc(paymentMethods.name));
  }

  async get(tenantId: string, id: string) {
    const [row] = await this.db
      .select(columns)
      .from(paymentMethods)
      .where(live(tenantId, id));
    if (!row) throw new NotFoundException();
    return row;
  }

  private async write<T>(op: () => Promise<T>) {
    try {
      return await op();
    } catch (e) {
      if (isUniqueViolation(e))
        throw fieldError('name', 'Nama metode pembayaran sudah dipakai', 409);
      throw e;
    }
  }

  create(tenantId: string, input: Fields) {
    this.assertOnlineAllowed(input.kind);
    return this.write(async () => {
      await this.seedCash(tenantId);
      const [row] = await this.db
        .insert(paymentMethods)
        .values({
          tenantId,
          name: input.name,
          ...flags(input.kind, input.gatewayMethod),
        })
        .returning(columns);
      return row;
    });
  }

  private async assertEditable(tenantId: string, id: string) {
    const row = await this.get(tenantId, id);
    if (row.name === 'Tunai')
      throw fieldError('_', 'Metode Tunai tidak dapat diubah atau dihapus');
  }

  async update(tenantId: string, id: string, input: Partial<Fields>) {
    this.assertOnlineAllowed(input.kind);
    await this.assertEditable(tenantId, id);
    if (input.name?.toLowerCase() === 'tunai')
      throw fieldError('name', 'Nama metode pembayaran sudah dipakai', 409);
    return this.write(async () => {
      const [row] = await this.db
        .update(paymentMethods)
        .set({
          name: input.name,
          ...(input.kind ? flags(input.kind, input.gatewayMethod) : {}),
        })
        .where(live(tenantId, id))
        .returning(columns);
      if (!row) throw new NotFoundException();
      return row;
    });
  }

  // Soft delete: past sales and payments keep pointing at it.
  async remove(tenantId: string, id: string) {
    await this.assertEditable(tenantId, id);
    await this.db
      .update(paymentMethods)
      .set({ deletedAt: new Date() })
      .where(live(tenantId, id));
  }
}

@Controller('payment-methods')
export class PaymentMethodsController {
  constructor(private readonly methods: PaymentMethodsService) {}

  @AgentRoute()
  @HelperRoute()
  @Get()
  async list(@CurrentSession() s: PosSession) {
    return { data: await this.methods.list(s.tenantId) };
  }

  @Post()
  @RequirePermission('catalog.manage')
  create(@CurrentSession() s: PosSession, @Body() body: unknown) {
    return this.methods.create(s.tenantId, validate(Input, body));
  }

  @Get(':id')
  get(@CurrentSession() s: PosSession, @Param('id') id: string) {
    return this.methods.get(s.tenantId, parseId(id));
  }

  @Patch(':id')
  @RequirePermission('catalog.manage')
  update(
    @CurrentSession() s: PosSession,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.methods.update(
      s.tenantId,
      parseId(id),
      validate(PatchInput, body),
    );
  }

  @Delete(':id')
  @RequirePermission('catalog.manage')
  @HttpCode(204)
  async remove(@CurrentSession() s: PosSession, @Param('id') id: string) {
    await this.methods.remove(s.tenantId, parseId(id));
  }
}

@Module({
  controllers: [PaymentMethodsController],
  providers: [PaymentMethodsService],
})
export class PaymentMethodsModule {}
