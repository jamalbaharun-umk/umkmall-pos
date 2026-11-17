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
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { parse } from '../catalog/catalog.schemas';
import { type Db, InjectDb } from '../db/db.module';
import { paymentMethods } from '../db/schema';
import { isUniqueViolation, parseId } from '../staff/http';
import { RequirePermission } from '../staff/require-permission';
import { CurrentSession } from '../tenancy/decorators';
import type { PosSession } from '../tenancy/session';

export const PAYMENT_KINDS = ['cash', 'debit', 'credit', 'wallet'] as const;
export type PaymentKind = (typeof PAYMENT_KINDS)[number];

const Input = z
  .object({
    name: z.string().trim().min(1).max(60),
    kind: z.enum(PAYMENT_KINDS),
  })
  .strict();

const flags = (kind: PaymentKind) => ({
  isCash: kind === 'cash',
  isDebit: kind === 'debit',
  isCredit: kind === 'credit',
  isWallet: kind === 'wallet',
});

export const paymentKind = sql<PaymentKind>`case when ${paymentMethods.isCash} then 'cash' when ${paymentMethods.isDebit} then 'debit' when ${paymentMethods.isCredit} then 'credit' else 'wallet' end`;

const columns = {
  id: paymentMethods.id,
  name: paymentMethods.name,
  kind: paymentKind,
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
  constructor(@InjectDb() private readonly db: Db) {}

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
        throw new ConflictException({ message: 'Nama sudah dipakai' });
      throw e;
    }
  }

  create(tenantId: string, input: z.infer<typeof Input>) {
    return this.write(async () => {
      await this.seedCash(tenantId);
      const [row] = await this.db
        .insert(paymentMethods)
        .values({ tenantId, name: input.name, ...flags(input.kind) })
        .returning(columns);
      return row;
    });
  }

  private async assertEditable(tenantId: string, id: string) {
    const row = await this.get(tenantId, id);
    if (row.name === 'Tunai')
      throw new UnprocessableEntityException({
        message: 'Metode Tunai tidak dapat diubah',
      });
  }

  async update(
    tenantId: string,
    id: string,
    input: Partial<z.infer<typeof Input>>,
  ) {
    await this.assertEditable(tenantId, id);
    if (input.name === 'Tunai')
      throw new ConflictException({ message: 'Nama sudah dipakai' });
    return this.write(async () => {
      const [row] = await this.db
        .update(paymentMethods)
        .set({
          name: input.name,
          ...(input.kind ? flags(input.kind) : {}),
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

  @Get()
  async list(@CurrentSession() s: PosSession) {
    return { data: await this.methods.list(s.tenantId) };
  }

  @Post()
  @RequirePermission('catalog.manage')
  create(@CurrentSession() s: PosSession, @Body() body: unknown) {
    return this.methods.create(s.tenantId, parse(Input, body));
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
      parse(
        Input.partial().refine((o) => Object.keys(o).length > 0),
        body,
      ),
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
