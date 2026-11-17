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
  Query,
} from '@nestjs/common';
import { and, asc, eq, ilike, isNull, or } from 'drizzle-orm';
import { z } from 'zod';
import { parse } from '../catalog/catalog.schemas';
import { type Db, InjectDb } from '../db/db.module';
import { members } from '../db/schema';
import { isUniqueViolation, parseId } from '../staff/http';
import { RequirePermission } from '../staff/require-permission';
import { CurrentSession } from '../tenancy/decorators';
import type { PosSession } from '../tenancy/session';

const optionalText = (max: number) =>
  z.string().trim().max(max).nullable().optional();

// Minimised from Lakasir (no email, identity number or join date): store customers' PII, never logged.
const MemberInput = z
  .object({
    name: z.string().trim().min(1).max(120),
    code: z.string().trim().min(1).max(40).regex(/^\S+$/, 'tanpa spasi'),
    phone: optionalText(30),
    address: optionalText(500),
  })
  .strict();
type MemberInput = z.infer<typeof MemberInput>;

const MemberQuery = z.object({ q: z.string().trim().max(60).optional() });

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

/** Members (Lakasir MemberResource): the cashier's customer picker and the kasbon holder. */
@Injectable()
export class MembersService {
  constructor(@InjectDb() private readonly db: Db) {}

  list(tenantId: string, q?: string) {
    const like = q ? `%${escapeLike(q)}%` : undefined;
    return this.db
      .select(columns)
      .from(members)
      .where(
        and(
          live(tenantId),
          like
            ? or(
                ilike(members.name, like),
                ilike(members.code, like),
                ilike(members.phone, like),
              )
            : undefined,
        ),
      )
      .orderBy(asc(members.name))
      .limit(50);
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
        throw new ConflictException({ message: 'Kode sudah dipakai' });
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

  @Get()
  async list(@CurrentSession() s: PosSession, @Query() query: unknown) {
    return {
      data: await this.members.list(s.tenantId, parse(MemberQuery, query).q),
    };
  }

  @Post()
  @RequirePermission('members.manage')
  create(@CurrentSession() s: PosSession, @Body() body: unknown) {
    return this.members.create(s.tenantId, parse(MemberInput, body));
  }

  @Get(':id')
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
      parse(
        MemberInput.partial().refine((o) => Object.keys(o).length > 0),
        body,
      ),
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
