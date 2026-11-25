import type { ProviderAccountStatus } from '../adapters/onboarding';
import type { MerchantStatus } from '../db/schema';

/**
 * The only status moves a merchant account may make (UMK-2019).
 *
 * The owner moves it by submitting the draft and by switching methods: an account is `active` exactly when
 * the gateway verified it and at least one method is on.
 *
 * Everything else is the gateway's word, read from the gateway itself (never from a webhook's body): it is
 * followed from any status but `not_submitted`, where the gateway has no account yet. That includes leaving
 * `rejected` or `suspended` when the gateway reopens or reinstates the account.
 */
const OWNER_MOVES: Record<MerchantStatus, readonly MerchantStatus[]> = {
  not_submitted: ['submitted'],
  submitted: [],
  needs_fix: ['submitted'],
  rejected: [],
  verified: ['active'],
  active: ['verified'],
  suspended: [],
};

const GATEWAY_TARGETS: readonly MerchantStatus[] = [
  'submitted',
  'needs_fix',
  'rejected',
  'verified',
  'active',
  'suspended',
];

export const canMove = (
  from: MerchantStatus,
  to: MerchantStatus,
  by: 'owner' | 'gateway',
): boolean =>
  from !== to &&
  (by === 'owner'
    ? OWNER_MOVES[from].includes(to)
    : from !== 'not_submitted' && GATEWAY_TARGETS.includes(to));

/** Our status for what the gateway says. A verified account is `active` only while a method is on. */
export function statusFor(
  gateway: ProviderAccountStatus,
  enabledMethods: number,
): MerchantStatus {
  switch (gateway) {
    case 'pending':
      return 'submitted';
    case 'verified':
      return enabledMethods > 0 ? 'active' : 'verified';
    default:
      return gateway;
  }
}

/** The owner may edit the draft and submit it. */
export const EDITABLE: readonly MerchantStatus[] = [
  'not_submitted',
  'needs_fix',
];

/** The gateway verified the account: methods may be switched. */
export const VERIFIED: readonly MerchantStatus[] = ['verified', 'active'];

/** The gateway's review is open: its verification page may be asked for. */
export const WAITING: readonly MerchantStatus[] = ['submitted', 'needs_fix'];

/** Waiting on the gateway's review: the reconciliation asks about these after the usual threshold. */
export const RECONCILE_SOON: readonly MerchantStatus[] = ['submitted'];

/**
 * Nothing is expected from the gateway, but it may still change its mind (suspend, reinstate, verify after
 * the owner's fix on its page, reopen a rejected account) and its webhook may be lost: the reconciliation asks about these too, slowly.
 */
export const RECONCILE_SLOWLY: readonly MerchantStatus[] = [
  'needs_fix',
  'rejected',
  'verified',
  'active',
  'suspended',
];

/** How often the reconciliation asks about an account of `RECONCILE_SLOWLY`. THE one place. */
export const SLOW_RECONCILE_INTERVAL_MS = 6 * 60 * 60 * 1000;
