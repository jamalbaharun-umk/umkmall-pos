import { Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import type { Db } from '../db/db.module';
import { InjectDb } from '../db/db.module';
import { agentRequests } from '../db/schema';

/** JSON with object keys sorted, so the same input always hashes the same. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
      .map(
        (k) =>
          `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`,
      )
      .join(',')}}`;
  return JSON.stringify(value);
}

export type Claim =
  | { kind: 'run' }
  | { kind: 'replay'; answer: unknown }
  | { kind: 'refused'; message: string };

/**
 * UMK-1980: a confirmed agent write runs once per Idempotency-Key. `claim` reserves the key (a pending row) or
 * answers the stored result; `finish` stores the answer; `release` frees the key after a write that did not run.
 */
@Injectable()
export class AgentIdempotency {
  constructor(@InjectDb() private readonly db: Db) {}

  async claim(
    tenantId: string,
    key: string,
    tool: string,
    input: unknown,
  ): Promise<Claim> {
    const requestHash = createHash('sha256')
      .update(`${tool}\n${canonical(input)}`)
      .digest('hex');
    const [mine] = await this.db
      .insert(agentRequests)
      .values({ tenantId, idempotencyKey: key, tool, requestHash })
      .onConflictDoNothing()
      .returning({ id: agentRequests.id });
    if (mine) return { kind: 'run' };
    const [stored] = await this.db
      .select({
        requestHash: agentRequests.requestHash,
        answer: agentRequests.answer,
      })
      .from(agentRequests)
      .where(
        and(
          eq(agentRequests.tenantId, tenantId),
          eq(agentRequests.idempotencyKey, key),
        ),
      );
    // Released between our insert and select: the caller may simply retry.
    if (!stored)
      return { kind: 'refused', message: 'Coba kirim permintaan ini lagi.' };
    if (stored.requestHash !== requestHash)
      return {
        kind: 'refused',
        message:
          'Kunci idempotensi ini sudah dipakai untuk permintaan lain. Pakai kunci baru.',
      };
    if (stored.answer === null)
      return {
        kind: 'refused',
        message:
          'Permintaan dengan kunci ini masih diproses. Coba lagi sebentar.',
      };
    return { kind: 'replay', answer: stored.answer };
  }

  async finish(tenantId: string, key: string, answer: unknown): Promise<void> {
    await this.db
      .update(agentRequests)
      .set({ answer })
      .where(
        and(
          eq(agentRequests.tenantId, tenantId),
          eq(agentRequests.idempotencyKey, key),
        ),
      );
  }

  async release(tenantId: string, key: string): Promise<void> {
    await this.db
      .delete(agentRequests)
      .where(
        and(
          eq(agentRequests.tenantId, tenantId),
          eq(agentRequests.idempotencyKey, key),
          isNull(agentRequests.answer),
        ),
      );
  }
}
