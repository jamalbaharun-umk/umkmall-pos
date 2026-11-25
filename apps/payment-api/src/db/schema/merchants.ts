import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, id, payment, tenantId, updatedAt } from './_base';

/** The allowed moves are in src/merchants/transitions.ts. */
export const MERCHANT_STATUSES = [
  'not_submitted',
  'submitted',
  'needs_fix',
  'rejected',
  'verified',
  'active',
  'suspended',
] as const;
export type MerchantStatus = (typeof MERCHANT_STATUSES)[number];

const inList = (values: readonly string[]) =>
  sql.raw(values.map((v) => `'${v}'`).join(', '));

// A store's sub-account at one payment gateway (UMK-2019): one row per (tenant, provider).
// What is kept is the short draft the owner typed and what the gateway said. No identity document, identity
// number or bank account is ever stored here: the owner gives those to the gateway on the gateway's own page.
export const merchantAccounts = payment
  .table(
    'merchant_accounts',
    {
      // Also the reference and the idempotency key we give the gateway.
      id: id(),
      tenantId: tenantId(),
      // An onboarding adapter's provider name. Text: a new adapter needs no migration.
      provider: text('provider').notNull(),
      // The environment's mode when the account was created (fake, sandbox, live). A charge needs it to be
      // the environment's mode still: a sandbox account never takes live money.
      mode: text('mode').notNull(),
      status: text('status').$type<MerchantStatus>().notNull(),
      // Why the gateway asked for a fix, rejected or suspended. Shown to the owner.
      statusReason: text('status_reason'),
      // The gateway's reference of the account, opaque to us. Never answered by any route.
      providerAccountId: text('provider_account_id'),
      // Extension point for adapters of verification mode `own_keys` (the store's own gateway keys, encrypted
      // by payment-api). Designed, not built: nothing writes or reads it, and no route may ever answer it.
      credentialsEncrypted: text('credentials_encrypted'),
      // The draft. Each may be empty until the owner submits.
      businessType: text('business_type').$type<'individual' | 'company'>(),
      businessName: text('business_name'),
      email: text('email'),
      phone: text('phone'),
      termsAcceptedAt: timestamp('terms_accepted_at', { withTimezone: true }),
      // The methods the owner switched on. A charge needs status `active` and the method in this list.
      enabledMethods: text('enabled_methods')
        .array()
        .notNull()
        .default(sql`'{}'::text[]`),
      submittedAt: timestamp('submitted_at', { withTimezone: true }),
      // Last time the gateway was asked about this account.
      lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
      createdAt: createdAt(),
      updatedAt: updatedAt(),
    },
    (t) => [
      uniqueIndex('merchant_accounts_tenant_provider').on(
        t.tenantId,
        t.provider,
      ),
      uniqueIndex('merchant_accounts_provider_account').on(
        t.provider,
        t.providerAccountId,
      ),
      // The reconciliation reads accounts waiting on the gateway across tenants.
      index('merchant_accounts_waiting')
        .on(t.status, t.updatedAt)
        .where(sql`${t.status} in ('submitted', 'needs_fix')`),
      check(
        'merchant_accounts_status',
        sql`${t.status} in (${inList(MERCHANT_STATUSES)})`,
      ),
      check(
        'merchant_accounts_mode',
        sql`${t.mode} in ('fake', 'sandbox', 'live')`,
      ),
    ],
  )
  .enableRLS();

// Audit trail: one row per status change and per method switched on or off. Rows are only ever inserted.
export const merchantAccountEvents = payment
  .table(
    'merchant_account_events',
    {
      id: id(),
      tenantId: tenantId(),
      merchantAccountId: uuid('merchant_account_id')
        .notNull()
        .references(() => merchantAccounts.id, { onDelete: 'restrict' }),
      fromStatus: text('from_status').$type<MerchantStatus>(),
      toStatus: text('to_status').$type<MerchantStatus>().notNull(),
      // submit, toggle, webhook, sync, reconciliation
      source: text('source').notNull(),
      // Caller-supplied reference of who asked; `system` for the gateway's news.
      actorRef: text('actor_ref').notNull(),
      note: text('note'),
      createdAt: createdAt(),
    },
    (t) => [
      index('merchant_account_events_tenant_account').on(
        t.tenantId,
        t.merchantAccountId,
      ),
    ],
  )
  .enableRLS();

export type MerchantWebhookState =
  'received' | 'processed' | 'unmatched' | 'failed';

// Inbox of the gateway's account notifications, once per (provider, event). The body is NOT kept: a real
// gateway's may carry the owner's personal data, and the status is read again from the gateway anyway.
export const merchantWebhookEvents = payment
  .table(
    'merchant_webhook_events',
    {
      id: id(),
      // Null until the event is matched to one of our accounts: the tenant comes from that row, never from
      // the payload. The column exists so the tenant purge covers this table too.
      tenantId: uuid('tenant_id'),
      provider: text('provider').notNull(),
      eventId: text('event_id').notNull(),
      // Our merchant account id, as the gateway sent it back.
      reference: text('reference'),
      merchantAccountId: uuid('merchant_account_id').references(
        () => merchantAccounts.id,
        { onDelete: 'restrict' },
      ),
      state: text('state')
        .$type<MerchantWebhookState>()
        .notNull()
        .default('received'),
      attempts: integer('attempts').notNull().default(0),
      processedAt: timestamp('processed_at', { withTimezone: true }),
      createdAt: createdAt(),
    },
    (t) => [
      uniqueIndex('merchant_webhook_events_provider_event').on(
        t.provider,
        t.eventId,
      ),
      index('merchant_webhook_events_state').on(t.state, t.createdAt),
    ],
  )
  .enableRLS();
