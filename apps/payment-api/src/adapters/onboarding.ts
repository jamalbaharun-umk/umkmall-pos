import type { GatewayMode } from '../config';
import type { WebhookInput } from './adapter';

/**
 * Onboarding a store at a payment gateway (UMK-2019). One contract per PG, next to its payment adapters;
 * payment-api's routes and its callers know only this, so a second provider changes neither pos-api nor
 * pos-web. Whatever the mode, an account moves through the same seven statuses.
 *
 * `verification` says how a store gets its account at the PG:
 * - `hosted`: the store is a sub-account of UMKMall's platform account and the owner verifies on the PG's own
 *   page, reached through `verificationLink` (Xendit Managed, OY!). Identity documents and bank details go
 *   from the owner to the PG and never reach the POS or payment-api. The fake gateway is this mode.
 * - `platform`: the platform registers the sub-account and there is no owner step (DOKU): no
 *   `verificationLink`; the account is reviewed after `createAccount`.
 * - `own_keys`: the store has its own account at the PG and gives its keys (Midtrans and most others).
 *   DESIGNED, NOT BUILT: the keys would be stored encrypted in `merchant_accounts.credentials_encrypted`
 *   and handed to the adapter per call. Until a store asks for it, payment-api refuses to submit an account
 *   of an `own_keys` adapter (`verification_unsupported`), and nothing writes that column.
 */
export const VERIFICATION_MODES = ['hosted', 'platform', 'own_keys'] as const;
export type VerificationKind = (typeof VERIFICATION_MODES)[number];

/** What the gateway says about a sub-account. `pending`: it is reviewing, or waiting for the owner. */
export type ProviderAccountStatus =
  'pending' | 'needs_fix' | 'rejected' | 'verified' | 'suspended';

/** The short draft the owner fills in. No identity number, no document, no bank account. */
export interface MerchantProfile {
  businessType: 'individual' | 'company';
  businessName: string;
  email: string;
  phone: string;
}

/** What an adapter is told about one of our merchant accounts. */
export interface MerchantRef {
  /** Our account id: the reference AND the idempotency key we give the gateway. */
  id: string;
  tenantId: string;
  /** The PG's reference of the account, opaque to payment-api; null until `createAccount` answered. */
  providerAccountId: string | null;
}

export interface AccountStatusResult {
  /** `not_found`: the gateway has no sub-account for this reference. */
  status: ProviderAccountStatus | 'not_found';
  /** Why, for needs_fix, rejected and suspended: shown to the owner. */
  reason?: string;
  /**
   * When the account last changed at the gateway, by the gateway's own clock. payment-api never applies an
   * answer older than one it already applied, so two answers that cross on the way cannot put an old status
   * over a new one. An adapter whose gateway gives no such time leaves it out: payment-api then applies the
   * answer only when no other answer was applied since it read the account, and asks again otherwise.
   */
  updatedAt?: Date;
}

/**
 * A verified notification. As for payments it carries no status: it only says "look at this account";
 * payment-api then asks `getAccountStatus`.
 */
export interface AccountNotice {
  eventId: string;
  /** Our merchant account id as the gateway sent it back; null when the notification names none. */
  reference: string | null;
}

export interface OnboardingAdapter {
  /** The PG: the `<provider>` of `POST /webhooks/<provider>/accounts`, and of its payment adapters. */
  readonly provider: string;
  /** The environments this adapter serves. An account is created in the environment's mode. */
  readonly modes: readonly GatewayMode[];
  readonly verification: VerificationKind;
  /**
   * The payment methods this PG serves for a store's account. A toggle exists only for these; each must be a
   * registered payment adapter of the same provider.
   */
  readonly methods: readonly string[];

  /**
   * Creates the sub-account, once per `merchant.id`: a repeat answers the same sub-account.
   * Throws when the outcome is unknown; payment-api repeats the call.
   */
  createAccount(
    merchant: MerchantRef,
    profile: MerchantProfile,
  ): Promise<{ providerAccountId: string }>;
  /**
   * Hands the corrected draft to the sub-account that exists (`merchant.providerAccountId` is set), after
   * the gateway asked for a fix: the gateway keeps the sub-account and reviews it again. Safe to repeat.
   * Throws when the outcome is unknown; payment-api repeats the call until it is delivered.
   */
  updateAccount(merchant: MerchantRef, profile: MerchantProfile): Promise<void>;
  /** `hosted` only: where the owner verifies. A fresh link per call; payment-api never stores it. */
  verificationLink?(
    merchant: MerchantRef,
  ): Promise<{ url: string; expiresAt?: Date }>;
  getAccountStatus(merchant: MerchantRef): Promise<AccountStatusResult>;
  /**
   * Checks the signature or token in constant time and reads the notification.
   * Throws WebhookSignatureError when it does not verify.
   */
  handleAccountWebhook(input: WebhookInput): Promise<AccountNotice>;
}

export const ONBOARDING_ADAPTERS = Symbol('ONBOARDING_ADAPTERS');
