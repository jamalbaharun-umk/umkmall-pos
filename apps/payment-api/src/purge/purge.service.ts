import { Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Db } from '../db/db.module';
import { InjectDb } from '../db/db.module';

const quote = (name: string) => `"${name.replace(/"/g, '""')}"`;

/**
 * Children before parents: a table is deleted only once no remaining table references it.
 * Throws on a cycle (the schema has none; a new one must be designed for the purge).
 */
export function deleteOrder(
  tables: string[],
  edges: { child: string; parent: string }[],
): string[] {
  const remaining = new Set(tables);
  const order: string[] = [];
  while (remaining.size > 0) {
    const leaves = [...remaining].filter(
      (t) =>
        !edges.some(
          (e) => e.parent === t && e.child !== t && remaining.has(e.child),
        ),
    );
    if (leaves.length === 0)
      throw new Error('purge: foreign key cycle among tenant tables');
    for (const t of leaves.sort()) {
      order.push(t);
      remaining.delete(t);
    }
  }
  return order;
}

@Injectable()
export class PurgeService {
  private readonly logger = new Logger(PurgeService.name);

  constructor(@InjectDb() private readonly db: Db) {}

  /**
   * Deletes every row of one tenant, in one transaction. Tables are discovered at runtime: every table in
   * schema `payment` with a `tenant_id` column, so a new table is covered without touching this code
   * (guard: test/purge.e2e-spec.ts). False when the tenant had no rows.
   *
   * payment-api cannot see whether the account is being erased (that lives in UMKMall's database): the
   * caller decides, and must call this only from its own purge.
   */
  async purge(tenantId: string): Promise<boolean> {
    const deleted = await this.db.transaction(async (tx) => {
      const tables = (
        await tx.execute<{ name: string }>(sql`
          select c.relname as name from pg_class c
          join pg_namespace n on n.oid = c.relnamespace
          join pg_attribute a on a.attrelid = c.oid
          where n.nspname = 'payment' and c.relkind = 'r'
            and a.attname = 'tenant_id' and not a.attisdropped`)
      ).map((r) => r.name);
      const edges = await tx.execute<{ child: string; parent: string }>(sql`
        select cc.relname as child, pc.relname as parent from pg_constraint k
        join pg_class cc on cc.oid = k.conrelid
        join pg_class pc on pc.oid = k.confrelid
        where k.contype = 'f' and k.connamespace = 'payment'::regnamespace`);
      let rows = 0;
      for (const table of deleteOrder(tables, [...edges])) {
        const result = await tx.execute(
          sql`delete from ${sql.raw(`payment.${quote(table)}`)} where tenant_id = ${tenantId}`,
        );
        rows += result.count;
      }
      return rows;
    });
    if (deleted > 0) this.logger.log(`purged tenant ${tenantId}`);
    return deleted > 0;
  }
}
