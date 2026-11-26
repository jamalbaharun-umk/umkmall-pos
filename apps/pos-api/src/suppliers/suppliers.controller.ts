import {
  ForbiddenException,
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
import { and, asc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { Phone, validate } from '../common/validation';
import { type Db, InjectDb } from '../db/db.module';
import { suppliers } from '../db/schema';
import { parseId } from '../staff/http';
import { hasPermission, RequirePermission } from '../staff/require-permission';
import { AgentRoute, CurrentSession } from '../tenancy/decorators';
import type { PosSession } from '../tenancy/session';

const optionalText = (max: number) =>
  z.string().trim().max(max).nullable().optional();

const SupplierInput = z
  .object({
    name: z.string().trim().min(1).max(120),
    // Same rule as members: digits, optional leading +, 8–15 digits; blank means no phone.
    phone: z.preprocess(
      (v) => (typeof v === 'string' && !v.trim() ? null : v),
      Phone.nullable().optional(),
    ),
    address: optionalText(500),
  })
  .strict();

const columns = {
  id: suppliers.id,
  name: suppliers.name,
  phone: suppliers.phone,
  address: suppliers.address,
  createdAt: suppliers.createdAt,
};

const live = (tenantId: string, id?: string) =>
  and(
    eq(suppliers.tenantId, tenantId),
    isNull(suppliers.deletedAt),
    id ? eq(suppliers.id, id) : undefined,
  );

@Injectable()
export class SuppliersService {
  constructor(@InjectDb() private readonly db: Db) {}

  list(tenantId: string) {
    return this.db
      .select(columns)
      .from(suppliers)
      .where(live(tenantId))
      .orderBy(asc(suppliers.name));
  }

  async get(tenantId: string, id: string) {
    const [row] = await this.db
      .select(columns)
      .from(suppliers)
      .where(live(tenantId, id));
    if (!row) throw new NotFoundException();
    return row;
  }

  async create(tenantId: string, input: z.infer<typeof SupplierInput>) {
    const [row] = await this.db
      .insert(suppliers)
      .values({ tenantId, ...input })
      .returning(columns);
    return row;
  }

  async update(
    tenantId: string,
    id: string,
    input: Partial<z.infer<typeof SupplierInput>>,
  ) {
    const [row] = await this.db
      .update(suppliers)
      .set({ ...input, updatedAt: new Date() })
      .where(live(tenantId, id))
      .returning(columns);
    if (!row) throw new NotFoundException();
    return row;
  }

  // Soft delete (Lakasir SoftDeletes): its purchase orders keep pointing at it.
  async remove(tenantId: string, id: string) {
    const [row] = await this.db
      .update(suppliers)
      .set({ deletedAt: new Date() })
      .where(live(tenantId, id))
      .returning({ id: suppliers.id });
    if (!row) throw new NotFoundException();
  }
}

@Controller('suppliers')
export class SuppliersController {
  constructor(private readonly suppliers: SuppliersService) {}

  @AgentRoute()
  @Get()
  async list(@CurrentSession() s: PosSession) {
    // Supplier phones and addresses: UMKMall's agent reads them only with the write consent (pos.write).
    if (s.kind === 'agent' && !hasPermission(s, 'purchasing.manage'))
      throw new ForbiddenException();
    return { data: await this.suppliers.list(s.tenantId) };
  }

  @AgentRoute()
  @Post()
  @RequirePermission('purchasing.manage')
  create(@CurrentSession() s: PosSession, @Body() body: unknown) {
    return this.suppliers.create(s.tenantId, validate(SupplierInput, body));
  }

  @Get(':id')
  get(@CurrentSession() s: PosSession, @Param('id') id: string) {
    return this.suppliers.get(s.tenantId, parseId(id));
  }

  @Patch(':id')
  @RequirePermission('purchasing.manage')
  update(
    @CurrentSession() s: PosSession,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.suppliers.update(
      s.tenantId,
      parseId(id),
      validate(SupplierInput.partial(), body),
    );
  }

  @Delete(':id')
  @RequirePermission('purchasing.manage')
  @HttpCode(204)
  async remove(@CurrentSession() s: PosSession, @Param('id') id: string) {
    await this.suppliers.remove(s.tenantId, parseId(id));
  }
}

@Module({ controllers: [SuppliersController], providers: [SuppliersService] })
export class SuppliersModule {}
