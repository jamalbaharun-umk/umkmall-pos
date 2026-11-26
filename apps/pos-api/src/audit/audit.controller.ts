import {
  Controller,
  Get,
  Module,
  NotFoundException,
  Param,
  Query,
} from '@nestjs/common';
import {
  and,
  count,
  desc,
  eq,
  gte,
  inArray,
  lt,
  sql,
  type SQL,
} from 'drizzle-orm';
import { z } from 'zod';
import { validate } from '../common/validation';
import type { Db } from '../db/db.module';
import { InjectDb } from '../db/db.module';
import { auditLog, staff } from '../db/schema';
import { parseId } from '../staff/http';
import { RequirePermission } from '../staff/require-permission';
import { CurrentSession } from '../tenancy/decorators';
import type { PosSession } from '../tenancy/session';
import { AUDIT_EVENT_CODES, AUDIT_EVENTS, AUDIT_GROUPS } from './events';

const DEFAULT_TIMEZONE = 'Asia/Jakarta';

const isDate = (v: string) => {
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
};
const day = (label: string) =>
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, `${label} harus berformat TTTT-BB-HH`)
    .refine(isDate, `${label} tidak ada di kalender`)
    .optional();

const ListQuery = z
  .object({
    page: z.coerce.number().int().min(1).max(100_000).default(1),
    perPage: z.coerce.number().int().min(1).max(100).default(20),
    group: z.enum(AUDIT_GROUPS).optional(),
    event: z.enum(AUDIT_EVENT_CODES).optional(),
    // A staff id, or `owner` for what the owner did.
    actor: z.union([z.literal('owner'), z.string().uuid()]).optional(),
    // The last N days of the store, today included (7 = today and the 6 days before). Not with from.
    days: z.coerce.number().int().min(1).max(3660).optional(),
    from: day('Tanggal mulai'),
    to: day('Tanggal akhir'),
  })
  .strict();

const columns = {
  id: auditLog.id,
  occurredAt: auditLog.occurredAt,
  event: auditLog.event,
  actorId: auditLog.actorId,
  actorKind: auditLog.actorKind,
  actorName: staff.name,
  targetType: auditLog.targetType,
  targetId: auditLog.targetId,
  targetLabel: auditLog.targetLabel,
  details: auditLog.details,
};

type Row = {
  id: string;
  occurredAt: Date;
  event: string;
  actorId: string;
  actorKind: string;
  actorName: string | null;
  targetType: string | null;
  targetId: string | null;
  targetLabel: string | null;
  details: Record<string, unknown>;
};

const present = (r: Row) => ({
  id: r.id,
  occurredAt: r.occurredAt,
  event: r.event,
  group: AUDIT_EVENTS[r.event as keyof typeof AUDIT_EVENTS] ?? null,
  actor: {
    id: r.actorId,
    kind: r.actorKind,
    // Staff names only; the owner and the agent have none here (the screen says "Pemilik").
    name: r.actorKind === 'cashier' ? r.actorName : null,
  },
  target: r.targetType
    ? { type: r.targetType, id: r.targetId, label: r.targetLabel }
    : null,
  details: r.details,
});

/**
 * UMK-1969: the owner reads the audit log. Read only: there is no route that writes, changes or deletes a row
 * (guard: test/audit.e2e-spec.ts). Rows are written by `recordAudit` in the transaction of each action.
 */
@Controller('audit-log')
@RequirePermission('staff.manage')
export class AuditController {
  constructor(@InjectDb() private readonly db: Db) {}

  private async timezone(tenantId: string): Promise<string> {
    const rows = (await this.db.execute(
      sql`select timezone from pos.report_settings where tenant_id = ${tenantId}`,
    )) as unknown as { timezone?: string }[];
    const tz = rows[0]?.timezone;
    if (!tz) return DEFAULT_TIMEZONE;
    // A name Postgres does not know would make every `at time zone` below fail with 500: use the default.
    const known = (await this.db.execute(
      sql`select 1 as ok from pg_timezone_names where name = ${tz}`,
    )) as unknown as unknown[];
    return known.length ? tz : DEFAULT_TIMEZONE;
  }

  private from(staffRows = true) {
    const q = this.db.select(columns).from(auditLog);
    return staffRows
      ? q.leftJoin(
          staff,
          and(
            eq(staff.tenantId, auditLog.tenantId),
            eq(staff.id, auditLog.actorId),
          ),
        )
      : q;
  }

  @Get()
  async list(@CurrentSession() s: PosSession, @Query() query: unknown) {
    const q = validate(
      ListQuery.refine((v) => v.days === undefined || v.from === undefined, {
        message: 'Pilih rentang hari atau tanggal mulai, tidak keduanya',
        path: ['days'],
      }),
      query,
    );
    const tz = await this.timezone(s.tenantId);
    const where: (SQL | undefined)[] = [eq(auditLog.tenantId, s.tenantId)];
    if (q.event) where.push(eq(auditLog.event, q.event));
    else if (q.group)
      where.push(
        inArray(
          auditLog.event,
          AUDIT_EVENT_CODES.filter((e) => AUDIT_EVENTS[e] === q.group),
        ),
      );
    if (q.actor === 'owner') where.push(eq(auditLog.actorKind, 'owner'));
    else if (q.actor) where.push(eq(auditLog.actorId, q.actor.toLowerCase()));
    // Days are the store's days: [from 00:00, to + 1 day 00:00) in its timezone.
    if (q.days)
      where.push(
        gte(
          auditLog.occurredAt,
          sql`(((now() at time zone ${tz})::date - ${q.days - 1}::int)::timestamp at time zone ${tz})`,
        ),
      );
    if (q.from)
      where.push(
        gte(
          auditLog.occurredAt,
          sql`(${q.from}::date)::timestamp at time zone ${tz}`,
        ),
      );
    if (q.to)
      where.push(
        lt(
          auditLog.occurredAt,
          sql`((${q.to}::date + 1)::timestamp at time zone ${tz})`,
        ),
      );
    const cond = and(...where);
    const [rows, [{ total }]] = await Promise.all([
      this.from()
        .where(cond)
        .orderBy(desc(auditLog.occurredAt), desc(auditLog.seq))
        .limit(q.perPage)
        .offset((q.page - 1) * q.perPage),
      this.db.select({ total: count() }).from(auditLog).where(cond),
    ]);
    return {
      data: rows.map(present),
      total,
      page: q.page,
      perPage: q.perPage,
      timezone: tz,
    };
  }

  @Get(':id')
  async one(@CurrentSession() s: PosSession, @Param('id') id: string) {
    const [row] = await this.from().where(
      and(eq(auditLog.tenantId, s.tenantId), eq(auditLog.id, parseId(id))),
    );
    if (!row) throw new NotFoundException();
    return present(row);
  }
}

@Module({ controllers: [AuditController] })
export class AuditModule {}
