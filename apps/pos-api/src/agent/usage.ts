import { Injectable, Logger } from '@nestjs/common';
import { and, desc, eq, gte, lt } from 'drizzle-orm';
import type { Db } from '../db/db.module';
import { InjectDb } from '../db/db.module';
import { agentAccess, agentToolCalls } from '../db/schema';

/** What UMKMall said a call is for (headers on /mcp): New Teman AI's goal, assistant, run and step mode. */
export type CallContext = {
  goalRef?: string;
  assistantRef?: string;
  runRef?: string;
  mode?: 'agentic' | 'guided';
};

export type CallRecord = CallContext & {
  tenantId: string;
  actorId: string;
  consentRef?: string;
  tool: string;
  outcome: 'ok' | 'preview' | 'refused';
  resultRefs?: unknown;
  durationMs: number;
};

/** False only after the owner turned UMKMall's agent off (no row = on until UMK-2059's opt-in). */
export async function agentEnabled(
  db: Pick<Db, 'select'>,
  tenantId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ enabled: agentAccess.enabled })
    .from(agentAccess)
    .where(eq(agentAccess.tenantId, tenantId));
  return row?.enabled ?? true;
}

/** New Teman AI usage and provenance for the POS side: every agent call, and the owner's revocation. */
@Injectable()
export class AgentUsage {
  private readonly logger = new Logger(AgentUsage.name);

  constructor(@InjectDb() private readonly db: Db) {}

  /** Never fails the tool call it records: a lost row is logged (ids and codes only) and the answer still goes out. */
  async record(r: CallRecord): Promise<void> {
    try {
      await this.db.insert(agentToolCalls).values({
        tenantId: r.tenantId,
        actorId: r.actorId,
        tool: r.tool,
        outcome: r.outcome,
        mode: r.mode ?? null,
        goalRef: r.goalRef ?? null,
        assistantRef: r.assistantRef ?? null,
        runRef: r.runRef ?? null,
        consentRef: r.consentRef ?? null,
        resultRefs: r.resultRefs ?? null,
        durationMs: r.durationMs,
      });
    } catch (error) {
      this.logger.warn(
        `agent call not recorded: tool=${r.tool} ${(error as Error).name}`,
      );
    }
  }

  /** The store's agent calls between two instants, newest first, at most `limit`. */
  list(tenantId: string, from: Date, to: Date, limit: number) {
    return this.db
      .select({
        id: agentToolCalls.id,
        at: agentToolCalls.createdAt,
        tool: agentToolCalls.tool,
        outcome: agentToolCalls.outcome,
        mode: agentToolCalls.mode,
        goalRef: agentToolCalls.goalRef,
        assistantRef: agentToolCalls.assistantRef,
        runRef: agentToolCalls.runRef,
        consentRef: agentToolCalls.consentRef,
        resultRefs: agentToolCalls.resultRefs,
        durationMs: agentToolCalls.durationMs,
      })
      .from(agentToolCalls)
      .where(
        and(
          eq(agentToolCalls.tenantId, tenantId),
          gte(agentToolCalls.createdAt, from),
          lt(agentToolCalls.createdAt, to),
        ),
      )
      .orderBy(desc(agentToolCalls.createdAt))
      .limit(limit);
  }

  /** Turns the agent off for good (until the owner turns it on) and refuses every session issued so far. */
  async revokeAll(tenantId: string): Promise<Date> {
    const now = new Date();
    await this.db
      .insert(agentAccess)
      .values({ tenantId, enabled: false, revokedBefore: now, updatedAt: now })
      .onConflictDoUpdate({
        target: agentAccess.tenantId,
        set: { enabled: false, revokedBefore: now, updatedAt: now },
      });
    return now;
  }

  /** The owner lets the agent in again; sessions revoked before stay refused. */
  async enable(tenantId: string): Promise<void> {
    const now = new Date();
    await this.db
      .insert(agentAccess)
      .values({ tenantId, enabled: true, updatedAt: now })
      .onConflictDoUpdate({
        target: agentAccess.tenantId,
        set: { enabled: true, updatedAt: now },
      });
  }

  isEnabled(tenantId: string): Promise<boolean> {
    return agentEnabled(this.db, tenantId);
  }
}
