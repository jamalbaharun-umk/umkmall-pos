import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { setTimeout as sleep } from 'node:timers/promises';
import type { ObjectStorage } from '../catalog/storage';
import { OBJECT_STORAGE } from '../catalog/storage';
import type { Db } from '../db/db.module';
import { InjectDb } from '../db/db.module';
import { tenants } from '../db/schema';

const quote = (name: string) => `"${name.replace(/"/g, '""')}"`;

/**
 * Children before parents: a table is deleted only once no remaining table references it.
 * Throws on a cycle (no table schema has one; a new one must be designed for the purge).
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

  constructor(
    @InjectDb() private readonly db: Db,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  /** Erases the store of UMKMall user `userId`. False when the user has no store. */
  async purge(userId: string): Promise<boolean> {
    const [tenant] = await this.db
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.userId, userId));
    if (!tenant) return false;

    // Images first: a storage failure throws (503 to UMKMall) with every row intact, so a retry finds the
    // tenant again. After the commit there would be no row left to find the files from.
    await this.deleteImages(tenant.id);

    await this.db.transaction(async (tx) => {
      const tables = (
        await tx.execute<{ name: string }>(sql`
          select c.relname as name from pg_class c
          join pg_namespace n on n.oid = c.relnamespace
          join pg_attribute a on a.attrelid = c.oid
          where n.nspname = 'pos' and c.relkind = 'r'
            and a.attname = 'tenant_id' and not a.attisdropped`)
      ).map((r) => r.name);
      const edges = await tx.execute<{ child: string; parent: string }>(sql`
        select cc.relname as child, pc.relname as parent from pg_constraint k
        join pg_class cc on cc.oid = k.conrelid
        join pg_class pc on pc.oid = k.confrelid
        where k.contype = 'f' and k.connamespace = 'pos'::regnamespace`);
      for (const table of deleteOrder(tables, [...edges])) {
        await tx.execute(
          sql`delete from ${sql.raw(`pos.${quote(table)}`)} where tenant_id = ${tenant.id}`,
        );
      }
      await tx.delete(tenants).where(eq(tenants.id, tenant.id));
    });
    this.logger.log(`purged tenant ${tenant.id}`);
    return true;
  }

  private async deleteImages(tenantId: string) {
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.storage.deletePrefix(`tenants/${tenantId}/`);
      } catch (error) {
        this.logger.warn(
          `purge: image delete failed for tenant ${tenantId} (attempt ${attempt}): ${(error as Error).name}`,
        );
        if (attempt === 3) throw error;
        await sleep(200 * attempt);
      }
    }
  }
}
