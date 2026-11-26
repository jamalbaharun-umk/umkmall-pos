import { jsonb, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
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
