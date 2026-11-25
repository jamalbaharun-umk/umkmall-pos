import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';

/**
 * TEST SEEDING ONLY. A PG charge is refused unless the store's gateway account is `active` with the method on
 * (UMK-2019). A test about something else (a payment flow, pos-api's cashier flow) seeds that account here
 * instead of walking the onboarding; production has no such shortcut.
 */
export const FAKE_ONLINE_METHODS = ['fake_qris', 'fake_va', 'fake_checkout'];

export interface SeededMerchant {
  tenantId: string;
  provider?: string;
  mode?: 'fake' | 'sandbox' | 'live';
  status?: string;
  enabledMethods?: string[];
}

/** The column values of an onboarded store: provider `fake`, mode `fake`, active, every fake method on. */
export const merchantValues = (seed: SeededMerchant) => ({
  tenantId: seed.tenantId,
  provider: seed.provider ?? 'fake',
  mode: seed.mode ?? ('fake' as const),
  status: (seed.status ?? 'active') as 'active',
  providerAccountId: `seeded-${randomUUID()}`,
  enabledMethods: seed.enabledMethods ?? FAKE_ONLINE_METHODS,
});

/**
 * Seeds (or resets) a store's gateway account with plain SQL, as the database owner. For suites that hold a
 * connection to the payment database and not the app, such as pos-api's integration tests.
 */
export async function seedMerchant(sql: postgres.Sql, seed: SeededMerchant) {
  const v = merchantValues(seed);
  await sql`
    insert into payment.merchant_accounts
      (tenant_id, provider, mode, status, provider_account_id, enabled_methods)
    values (${v.tenantId}, ${v.provider}, ${v.mode}, ${v.status}, ${v.providerAccountId},
            ${sql.array(v.enabledMethods)})
    on conflict (tenant_id, provider) do update
      set mode = excluded.mode, status = excluded.status, enabled_methods = excluded.enabled_methods`;
}
