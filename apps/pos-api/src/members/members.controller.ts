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
  Query,
} from '@nestjs/common';
import { and, asc, count, eq, ilike, isNull, or } from 'drizzle-orm';
import { z } from 'zod';
import { fieldError, Paging, Phone, validate } from '../common/validation';
import { type Db, InjectDb } from '../db/db.module';
import { members } from '../db/schema';
import { isUniqueViolation, parseId } from '../staff/http';
import { RequirePermission } from '../staff/require-permission';
import { CurrentSession } from '../tenancy/decorators';
import type { PosSession } from '../tenancy/session';

/** Optional text: blank is stored as null. */
const optional = <T extends z.ZodTypeAny>(schema: T) =>
  z
    .union([z.literal(''), schema])
    .transform((v: unknown) => (v === '' ? null : (v as z.infer<T>)))
    .nullable()
    .optional();

// Minimised from Lakasir (no email, identity number or join date): store customers' PII, never logged.
const MemberInput = z
  .object({
    name: z.string().trim().min(1).max(120),
    // Upper-cased like voucher codes: "plg001" and "PLG001" are one code.
    code: z
      .string()
      .trim()
      .min(1)
      .max(40)
      .regex(/^\S+$/, 'Kode tanpa spasi')
      .transform((c) => c.toUpperCase()),
    phone: optional(Phone),
    address: optional(z.string().trim().max(500)),
  })
  .strict();
type MemberInput = z.infer<typeof MemberInput>;
const MemberUpdate = MemberInput.partial().refine(
  (o) => Object.keys(o).length > 0,
  'Tidak ada yang diubah',
);

const MemberQuery = z.object({ q: z.string().trim().max(60).optional() });
const MemberListQuery = MemberQuery.extend(Paging);

const columns = {
  id: members.id,
  name: members.name,
  code: members.code,
  phone: members.phone,
  address: members.address,
  createdAt: members.createdAt,
};

const live = (tenantId: string, id?: string) =>
  and(
    eq(members.tenantId, tenantId),
    isNull(members.deletedAt),
    id ? eq(members.id, id) : undefined,
  );

const escapeLike = (q: string) => q.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Members (Lakasir MemberResource): the kasbon holder and the cashier's customer picker. */
@Injectable()
export class MembersService {
  constructor(@InjectDb() private readonly db: Db) {}

  /** One page of the store's members (Lakasir's table: search name/code/phone, pages, a count). */
  async list(tenantId: string, query: z.infer<typeof MemberListQuery>) {
    const like = query.q ? `%${escapeLike(query.q)}%` : undefined;
    const where = and(
      live(tenantId),
      like
        ? or(
            ilike(members.name, like),
            ilike(members.code, like),
            ilike(members.phone, like),
          )
        : undefined,
    );
    const [data, [{ total }]] = await Promise.all([
      this.db
        .select(columns)
        .from(members)
        .where(where)
        .orderBy(asc(members.name), asc(members.id))
        .limit(query.perPage)
        .offset((query.page - 1) * query.perPage),
      this.db.select({ total: count() }).from(members).where(where),
    ]);
    return { data, total, page: query.page, perPage: query.perPage };
  }

  /** The cashier's picker: name and code only (phone and address stay behind members.manage). */
  pick(tenantId: string, q?: string) {
    const like = q ? `%${escapeLike(q)}%` : undefined;
    return this.db
      .select({ id: members.id, name: members.name, code: members.code })
      .from(members)
      .where(
        and(
          live(tenantId),
          like
            ? or(ilike(members.name, like), ilike(members.code, like))
            : undefined,
        ),
      )
      .orderBy(asc(members.name))
      .limit(20);
  }

  async get(tenantId: string, id: string) {
    const [row] = await this.db
      .select(columns)
      .from(members)
      .where(live(tenantId, id));
    if (!row) throw new NotFoundException();
    return row;
  }

  private async write<T>(op: () => Promise<T>) {
    try {
      return await op();
    } catch (e) {
      if (isUniqueViolation(e))
        throw fieldError('code', 'Kode pelanggan sudah dipakai', 409);
      throw e;
    }
  }

  create(tenantId: string, input: MemberInput) {
    return this.write(async () => {
      const [row] = await this.db
        .insert(members)
        .values({ tenantId, ...input })
        .returning(columns);
      return row;
    });
  }

  update(tenantId: string, id: string, input: Partial<MemberInput>) {
    return this.write(async () => {
      const [row] = await this.db
        .update(members)
        .set({ ...input, updatedAt: new Date() })
        .where(live(tenantId, id))
        .returning(columns);
      if (!row) throw new NotFoundException();
      return row;
    });
  }

  // Soft delete: sales and receivables keep pointing at it. The U8 purge removes the row.
  async remove(tenantId: string, id: string) {
    const [row] = await this.db
      .update(members)
      .set({ deletedAt: new Date() })
      .where(live(tenantId, id))
      .returning({ id: members.id });
    if (!row) throw new NotFoundException();
  }
}

@Controller('members')
export class MembersController {
  constructor(private readonly members: MembersService) {}

  // Full records are the store's customers' PII: members.manage only.
  @Get()
  @RequirePermission('members.manage')
  async list(@CurrentSession() s: PosSession, @Query() query: unknown) {
    return this.members.list(s.tenantId, validate(MemberListQuery, query));
  }

  @Get('picker')
  @RequirePermission('sales.create')
  async picker(@CurrentSession() s: PosSession, @Query() query: unknown) {
    const { q } = validate(MemberQuery, query);
    return { data: await this.members.pick(s.tenantId, q) };
  }

  @Post()
  @RequirePermission('members.manage')
  create(@CurrentSession() s: PosSession, @Body() body: unknown) {
    return this.members.create(s.tenantId, validate(MemberInput, body));
  }

  @Get(':id')
  @RequirePermission('members.manage')
  get(@CurrentSession() s: PosSession, @Param('id') id: string) {
    return this.members.get(s.tenantId, parseId(id));
  }

  @Patch(':id')
  @RequirePermission('members.manage')
  update(
    @CurrentSession() s: PosSession,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.members.update(
      s.tenantId,
      parseId(id),
      validate(MemberUpdate, body),
    );
  }

  @Delete(':id')
  @RequirePermission('members.manage')
  @HttpCode(204)
  async remove(@CurrentSession() s: PosSession, @Param('id') id: string) {
    await this.members.remove(s.tenantId, parseId(id));
  }
}

@Module({ controllers: [MembersController], providers: [MembersService] })
export class MembersModule {}
