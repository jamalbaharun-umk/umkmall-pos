import type { Db } from '../db/db.module';
import { auditLog } from '../db/schema';
import type { PosSession } from '../tenancy/session';
import { AUDIT_EVENTS, type AuditEvent } from './events';
import { scrubDetails, scrubString } from './scrub';

type Writer = Pick<Db, 'insert'>;

export type AuditActor = Pick<PosSession, 'tenantId' | 'actorId' | 'kind'>;

export type AuditInput = {
  /** What the row is about: a sale, shift, staff member, role or device. */
  target?: { type: string; id?: string; label?: string };
  /** Ids, amounts and reason codes only; scrubbed again here. Never a note, a name of a customer or a secret. */
  details?: Record<string, unknown>;
};

/**
 * Appends one row to the store's audit log. Call it with the `tx` of the action it describes, after the action's own
 * writes: the row commits with the action and rolls back with it, so no action succeeds without its log and no log
 * exists for an action that did not happen (guard: test/audit.e2e-spec.ts). Append only: there is no update or
 * delete of a row anywhere in src/.
 */
export async function recordAudit(
  tx: Writer,
  actor: AuditActor,
  event: AuditEvent,
  input: AuditInput = {},
): Promise<void> {
  if (!(event in AUDIT_EVENTS)) throw new Error('unknown audit event');
  await tx.insert(auditLog).values({
    tenantId: actor.tenantId,
    actorId: actor.actorId,
    actorKind: actor.kind,
    event,
    targetType: input.target?.type ?? null,
    targetId: input.target?.id ?? null,
    targetLabel: input.target?.label ? scrubString(input.target.label) : null,
    details: scrubDetails(input.details ?? {}),
  });
}
