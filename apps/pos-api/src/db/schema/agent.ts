import {
  boolean,
  index,
  integer,
  jsonb,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, id, pos } from './_base';
import { tenants } from './tenants';

// UMK-1980: one row per write an agent confirmed, keyed by its Idempotency-Key. A retry with the same key and the
// same input answers `answer` again; another input under the key is refused. `answer` is null while the write runs.
export const agentRequests = pos
  .table(
    'agent_requests',
    {
      id: id(),
      tenantId: uuid('tenant_id')
        .notNull()
        .references(() => tenants.id, { onDelete: 'restrict' }),
      idempotencyKey: text('idempotency_key').notNull(),
      tool: text('tool').notNull(),
      // sha256 of the tool name and its input (without the key): tells a retry from a reuse of the key.
      requestHash: text('request_hash').notNull(),
      answer: jsonb('answer'),
      createdAt: createdAt(),
    },
    (t) => [
      uniqueIndex('agent_requests_tenant_key_uq').on(
        t.tenantId,
        t.idempotencyKey,
      ),
    ],
  )
  .enableRLS();

export const AGENT_CALL_OUTCOMES = ['ok', 'preview', 'refused'] as const;
export const AGENT_MODES = ['agentic', 'guided'] as const;

// New Teman AI usage and provenance: one row per MCP tool call, with the goal, assistant and run it served (sent by
// UMKMall as headers), the consent behind it, and the ids a write produced. Never the input or the answer itself.
export const agentToolCalls = pos
  .table(
    'agent_tool_calls',
    {
      id: id(),
      tenantId: uuid('tenant_id')
        .notNull()
        .references(() => tenants.id, { onDelete: 'restrict' }),
      tool: text('tool').notNull(),
      outcome: text('outcome', { enum: AGENT_CALL_OUTCOMES }).notNull(),
      mode: text('mode', { enum: AGENT_MODES }),
      goalRef: text('goal_ref'),
      assistantRef: text('assistant_ref'),
      runRef: text('run_ref'),
      consentRef: text('consent_ref'),
      // UMKMall user the agent acted for.
      actorId: text('actor_id').notNull(),
      resultRefs: jsonb('result_refs'),
      durationMs: integer('duration_ms').notNull(),
      createdAt: createdAt(),
    },
    (t) => [
      index('agent_tool_calls_tenant_at_idx').on(t.tenantId, t.createdAt),
    ],
  )
  .enableRLS();

// The owner's switch for UMKMall's agent, persistent: `enabled = false` (set by revoke) refuses every new agent
// session until the owner turns it on again, and sessions issued before `revoked_before` are refused at once.
// No row = enabled (UMK-2059 makes the default off with an explicit opt-in).
export const agentAccess = pos
  .table('agent_access', {
    tenantId: uuid('tenant_id')
      .primaryKey()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    enabled: boolean('enabled').notNull().default(true),
    revokedBefore: timestamp('revoked_before', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  })
  .enableRLS();
