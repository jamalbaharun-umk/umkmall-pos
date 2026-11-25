import {
  ConflictException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { PaymentAdapter } from '../adapters/adapter';
import { AdapterRegistry } from '../adapters/adapters.module';
import type {
  MerchantProfile,
  OnboardingAdapter,
} from '../adapters/onboarding';
import { fieldError } from '../common/validation';
import { Clock, PaymentSettings } from '../config';
import type { Db } from '../db/db.module';
import { InjectDb } from '../db/db.module';
import {
  merchantAccountEvents,
  merchantAccounts,
  MerchantStatus,
} from '../db/schema';
import type { DraftInput, SubmitInput, ToggleInput } from './merchants.schemas';
import { canMove, EDITABLE, statusFor, VERIFIED, WAITING } from './transitions';

export type MerchantRow = typeof merchantAccounts.$inferSelect;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export type MerchantSource =
  'submit' | 'toggle' | 'webhook' | 'sync' | 'reconciliation';

const SYSTEM_ACTOR = 'system';
const REASON_MAX = 500;
const DRAFT_FIELDS = [
  'businessType',
  'businessName',
  'email',
  'phone',
] as const;

const refusal = (
  code: string,
  message: string,
  meta?: Record<string, unknown>,
) => new ConflictException({ message, code, ...(meta ? { meta } : {}) });

const notFound = () =>
  new NotFoundException({
    message: 'No such payment provider',
    code: 'not_found',
  });

const gatewayDown = () =>
  new ServiceUnavailableException({
    message: 'Payment gateway unavailable',
    code: 'gateway_unavailable',
  });

const profileOf = (row: MerchantRow): MerchantProfile | null =>
  row.businessType && row.businessName && row.email && row.phone
    ? {
        businessType: row.businessType,
        businessName: row.businessName,
        email: row.email,
        phone: row.phone,
      }
    : null;

/**
 * A store's account at a payment gateway (UMK-2019), for the calling service. Every query filters `tenantId`,
 * which only ever comes from the service guard. The ONE place that changes an account's status, always under
 * `select … for update` and by `transitions.ts`.
 *
 * As for payments, the gateway is never called inside a transaction that holds the row, and its news is never
 * taken from a webhook: `settle` asks the gateway and applies what it answers.
 */
@Injectable()
export class MerchantsService {
  private readonly logger = new Logger(MerchantsService.name);

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly adapters: AdapterRegistry,
    private readonly settings: PaymentSettings,
    private readonly clock: Clock,
  ) {}

  // ---- what a calling service asks ------------------------------------------------------------------------

  /** One account per onboarding provider of this environment; `not_submitted` when the store has none yet. */
  async list(tenantId: string) {
    const offered = this.adapters
      .onboardingAdapters()
      .filter((a) => a.modes.includes(this.settings.gatewayMode));
    const rows = offered.length
      ? await this.db
          .select()
          .from(merchantAccounts)
          .where(
            and(
              eq(merchantAccounts.tenantId, tenantId),
              inArray(
                merchantAccounts.provider,
                offered.map((a) => a.provider),
              ),
            ),
          )
      : [];
    return {
      mode: this.settings.gatewayMode,
      items: offered.map((adapter) =>
        this.view(
          adapter,
          rows.find((r) => r.provider === adapter.provider),
        ),
      ),
    };
  }

  /** Saves the draft. Only before the first submit and while the gateway asks for a fix. */
  async saveDraft(tenantId: string, provider: string, input: DraftInput) {
    const adapter = this.adapterFor(provider);
    const now = this.clock.now();
    const row = await this.db.transaction(async (tx) => {
      await tx
        .insert(merchantAccounts)
        .values({
          tenantId,
          provider,
          mode: this.settings.gatewayMode,
          status: 'not_submitted',
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing();
      const current = (await this.lock(tx, tenantId, provider))!;
      if (!EDITABLE.includes(current.status)) throw this.locked(current);
      const [saved] = await tx
        .update(merchantAccounts)
        .set({ ...input, updatedAt: now })
        .where(eq(merchantAccounts.id, current.id))
        .returning();
      return saved;
    });
    return this.view(adapter, row);
  }

  /**
   * Submits the draft: the account becomes `submitted` and its sub-account is created at the gateway.
   * Idempotent: a repeat answers the submitted account, and creates the sub-account when the first call's
   * answer from the gateway was lost (the gateway creates one per account id).
   */
  async submit(tenantId: string, provider: string, input: SubmitInput) {
    const adapter = this.adapterFor(provider);
    if (adapter.verification === 'own_keys')
      throw refusal(
        'verification_unsupported',
        'Accounts with the store’s own gateway keys are not supported yet',
      );
    this.assertLive(this.settings.gatewayMode);
    const now = this.clock.now();
    const { row, send } = await this.db.transaction(async (tx) => {
      const current = await this.lock(tx, tenantId, provider);
      const missing = DRAFT_FIELDS.filter((f) => !current?.[f]);
      if (!current || (EDITABLE.includes(current.status) && missing.length))
        throw refusal('draft_incomplete', 'The draft is not complete', {
          missing,
        });
      if (current.status === 'submitted')
        return { row: current, send: !current.providerAccountId };
      if (!EDITABLE.includes(current.status)) throw this.locked(current);
      const moved = await this.move(tx, current, 'submitted', 'owner', {
        source: 'submit',
        actorRef: input.actorRef,
        set: {
          // A draft saved in another mode is submitted in this environment's.
          mode: current.providerAccountId
            ? current.mode
            : this.settings.gatewayMode,
          statusReason: null,
          termsAcceptedAt: now,
          submittedAt: now,
        },
      });
      return { row: moved, send: true };
    });
    if (!send) return this.view(adapter, row);
    const profile = profileOf(row)!;
    const created = await this.gateway(() =>
      adapter.createAccount(
        {
          id: row.id,
          tenantId: row.tenantId,
          providerAccountId: row.providerAccountId,
        },
        profile,
      ),
    );
    await this.db
      .update(merchantAccounts)
      .set({ providerAccountId: created.providerAccountId })
      .where(
        and(
          eq(merchantAccounts.id, row.id),
          isNull(merchantAccounts.providerAccountId),
        ),
      );
    // The gateway's own word closes the submit (a `platform` gateway may have verified at once).
    const settled = await this.settle(row.id, 'sync').catch(() => undefined);
    return this.view(adapter, settled ?? row);
  }

  /** `hosted` only: the gateway's page where the owner verifies. Never stored, never logged. */
  async verificationLink(tenantId: string, provider: string) {
    const adapter = this.adapterFor(provider);
    if (!adapter.verificationLink)
      throw refusal(
        'verification_not_hosted',
        'This provider has no verification page for the owner',
      );
    const row = await this.find(tenantId, provider);
    if (!row || !WAITING.includes(row.status) || !row.providerAccountId)
      throw refusal(
        'verification_not_open',
        'The account is not waiting for verification',
        { status: row?.status ?? 'not_submitted' },
      );
    const link = await this.gateway(() =>
      adapter.verificationLink!({
        id: row.id,
        tenantId: row.tenantId,
        providerAccountId: row.providerAccountId,
      }),
    );
    return { url: link.url, expiresAt: link.expiresAt ?? null };
  }

  /** Manual status check: asks the gateway (throttled like a payment's) and answers the stored account. */
  async sync(tenantId: string, provider: string) {
    const adapter = this.adapterFor(provider);
    const row = await this.find(tenantId, provider);
    if (!row) return this.view(adapter, undefined);
    const fresh =
      row.lastSyncedAt &&
      this.clock.now().getTime() - row.lastSyncedAt.getTime() <
        this.settings.syncMinIntervalMs;
    if (fresh) return this.view(adapter, row);
    const settled = await this.gateway(() => this.settle(row.id, 'sync'));
    return this.view(adapter, settled ?? row);
  }

  /**
   * Switches one method on or off. Only once the gateway verified the account. The account is `active` while
   * at least one method is on and `verified` again when the last one is off. A payment already waiting on
   * the method is not touched: it settles by the payment rules.
   */
  async setMethod(
    tenantId: string,
    provider: string,
    method: string,
    input: ToggleInput,
  ) {
    const adapter = this.adapterFor(provider);
    if (!this.adapters.methodsOf(provider).includes(method))
      throw fieldError('method', 'Unknown payment method');
    const row = await this.db.transaction(async (tx) => {
      const current = await this.lock(tx, tenantId, provider);
      if (!current || !VERIFIED.includes(current.status))
        throw refusal(
          'merchant_not_verified',
          'Methods can be switched only once the gateway verified the account',
          { status: current?.status ?? 'not_submitted' },
        );
      const on = current.enabledMethods.includes(method);
      if (on === input.enabled) return current;
      const enabledMethods = input.enabled
        ? [...current.enabledMethods, method]
        : current.enabledMethods.filter((m) => m !== method);
      return this.move(
        tx,
        current,
        enabledMethods.length ? 'active' : 'verified',
        'owner',
        {
          source: 'toggle',
          actorRef: input.actorRef,
          note: `${method} ${input.enabled ? 'on' : 'off'}`,
          set: { enabledMethods },
        },
      );
    });
    return this.view(adapter, row);
  }

  // ---- the charge gate ------------------------------------------------------------------------------------

  /**
   * Why a NEW charge on this adapter must be refused for the store, or null. A PG charge needs the store's
   * account at that PG to be `active`, in this environment's mode, with the method on. CASHAC is never gated.
   */
  async chargeRefusal(
    tenantId: string,
    adapter: PaymentAdapter,
  ): Promise<HttpException | null> {
    if (adapter.kind !== 'online') return null;
    if (this.settings.gatewayMode === 'live' && !this.settings.liveEnabled)
      return this.liveDisabled();
    const row = adapter.provider
      ? await this.find(tenantId, adapter.provider)
      : undefined;
    if (!row || row.status !== 'active')
      return refusal(
        'merchant_not_active',
        'The store’s account at the payment gateway is not active',
        { status: row?.status ?? 'not_submitted' },
      );
    if (row.mode === 'live' && !this.settings.liveEnabled)
      return this.liveDisabled();
    if (row.mode !== this.settings.gatewayMode)
      return refusal(
        'merchant_mode_mismatch',
        'The store’s gateway account belongs to another environment mode',
      );
    if (!row.enabledMethods.includes(adapter.method))
      return refusal(
        'method_disabled',
        'This payment method is switched off for the store',
      );
    return null;
  }

  // ---- the gateway's news ---------------------------------------------------------------------------------

  /**
   * Asks the gateway where the account stands and applies the answer. Webhook, manual sync and reconciliation
   * all end here. Creates the sub-account first when an earlier submit never got the gateway's answer.
   * Throws when the gateway cannot be asked; the caller decides whether that is an error.
   */
  async settle(
    id: string,
    source: MerchantSource,
  ): Promise<MerchantRow | undefined> {
    const [row] = await this.db
      .select()
      .from(merchantAccounts)
      .where(eq(merchantAccounts.id, id));
    if (!row || row.status === 'not_submitted') return row;
    const adapter = this.adapters.onboarding(row.provider);
    if (!adapter) return row;
    const ref = {
      id: row.id,
      tenantId: row.tenantId,
      providerAccountId: row.providerAccountId,
    };
    if (!ref.providerAccountId) {
      const profile = profileOf(row);
      if (!profile) return row;
      const created = await adapter.createAccount(ref, profile);
      ref.providerAccountId = created.providerAccountId;
      await this.db
        .update(merchantAccounts)
        .set({ providerAccountId: created.providerAccountId })
        .where(
          and(
            eq(merchantAccounts.id, id),
            isNull(merchantAccounts.providerAccountId),
          ),
        );
    }
    const answer = await adapter.getAccountStatus(ref);
    const now = this.clock.now();
    return this.db.transaction(async (tx) => {
      const [locked] = await tx
        .select()
        .from(merchantAccounts)
        .where(eq(merchantAccounts.id, id))
        .for('update');
      if (!locked) return undefined;
      if (answer.status === 'not_found') {
        this.logger.warn(`merchant account ${id}: unknown at the gateway`);
        const [seen] = await tx
          .update(merchantAccounts)
          .set({ lastSyncedAt: now })
          .where(eq(merchantAccounts.id, id))
          .returning();
        return seen;
      }
      const target = statusFor(answer.status, locked.enabledMethods.length);
      const statusReason = ['needs_fix', 'rejected', 'suspended'].includes(
        target,
      )
        ? (answer.reason?.slice(0, REASON_MAX) ?? null)
        : null;
      if (
        target === locked.status ||
        !canMove(locked.status, target, 'gateway')
      ) {
        const [seen] = await tx
          .update(merchantAccounts)
          .set({
            lastSyncedAt: now,
            ...(target === locked.status ? { statusReason } : {}),
          })
          .where(eq(merchantAccounts.id, id))
          .returning();
        return seen;
      }
      return this.move(tx, locked, target, 'gateway', {
        source,
        actorRef: SYSTEM_ACTOR,
        set: { statusReason, lastSyncedAt: now },
      });
    });
  }

  /** Asks the gateway about accounts that have waited on it longer than the reconciliation threshold. */
  async reconcile(limit = 100): Promise<{ accounts: number; failed: number }> {
    const cutoff = new Date(
      this.clock.now().getTime() - this.settings.reconcileAfterMs,
    ).toISOString();
    const due = await this.db
      .select({ id: merchantAccounts.id })
      .from(merchantAccounts)
      .where(
        and(
          inArray(merchantAccounts.status, [...WAITING]),
          sql`coalesce(${merchantAccounts.lastSyncedAt}, ${merchantAccounts.updatedAt}) <= ${cutoff}::timestamptz`,
        ),
      )
      .orderBy(
        sql`${merchantAccounts.lastSyncedAt} asc nulls first`,
        asc(merchantAccounts.updatedAt),
      )
      .limit(limit);
    let failed = 0;
    for (const { id } of due) {
      try {
        await this.settle(id, 'reconciliation');
      } catch (error) {
        failed++;
        this.logger.warn(
          `reconciliation could not settle merchant account ${id}: ${(error as Error).name}`,
        );
      }
    }
    return { accounts: due.length - failed, failed };
  }

  // ---- internals ------------------------------------------------------------------------------------------

  /** The one writer of `status`: a checked move, the row and its audit line in the caller's transaction. */
  private async move(
    tx: Tx,
    row: MerchantRow,
    to: MerchantStatus,
    by: 'owner' | 'gateway',
    meta: {
      source: MerchantSource;
      actorRef: string;
      note?: string;
      set?: Partial<typeof merchantAccounts.$inferInsert>;
    },
  ): Promise<MerchantRow> {
    const changes = to !== row.status;
    if (changes && !canMove(row.status, to, by))
      throw new Error(`merchant account: illegal move ${row.status} → ${to}`);
    const now = this.clock.now();
    const [moved] = await tx
      .update(merchantAccounts)
      .set({ ...meta.set, status: to, updatedAt: now })
      .where(eq(merchantAccounts.id, row.id))
      .returning();
    await tx.insert(merchantAccountEvents).values({
      tenantId: row.tenantId,
      merchantAccountId: row.id,
      fromStatus: row.status,
      toStatus: to,
      source: meta.source,
      actorRef: meta.actorRef,
      note: meta.note ?? null,
      createdAt: now,
    });
    if (changes)
      this.logger.log(`merchant account ${row.id}: ${row.status} → ${to}`);
    return moved;
  }

  private async find(tenantId: string, provider: string) {
    const [row] = await this.db
      .select()
      .from(merchantAccounts)
      .where(
        and(
          eq(merchantAccounts.tenantId, tenantId),
          eq(merchantAccounts.provider, provider),
        ),
      );
    return row as MerchantRow | undefined;
  }

  private async lock(tx: Tx, tenantId: string, provider: string) {
    const [row] = await tx
      .select()
      .from(merchantAccounts)
      .where(
        and(
          eq(merchantAccounts.tenantId, tenantId),
          eq(merchantAccounts.provider, provider),
        ),
      )
      .for('update');
    return row as MerchantRow | undefined;
  }

  /** The provider's onboarding adapter in this environment; anything else is no provider at all (404). */
  private adapterFor(provider: string): OnboardingAdapter {
    const adapter = this.adapters.onboarding(provider);
    if (!adapter || !adapter.modes.includes(this.settings.gatewayMode))
      throw notFound();
    return adapter;
  }

  private liveDisabled() {
    return refusal(
      'live_disabled',
      'Live payments are switched off (PAYMENT_LIVE_ENABLED)',
    );
  }

  private assertLive(mode: string) {
    if (mode === 'live' && !this.settings.liveEnabled)
      throw this.liveDisabled();
  }

  private locked(row: MerchantRow) {
    return refusal(
      'merchant_locked',
      'The account can no longer be changed in this status',
      { status: row.status },
    );
  }

  /** A gateway call from a request: anything it throws is "no clear answer" (503), never a 500 with details. */
  private async gateway<T>(call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.warn(`gateway call failed: ${(error as Error).name}`);
      throw gatewayDown();
    }
  }

  /**
   * What a caller sees: the status, the draft the caller itself sent, and the toggles. Never the gateway's
   * account reference, never a credential, no tenant id.
   */
  private view(adapter: OnboardingAdapter, row: MerchantRow | undefined) {
    const enabled = row?.enabledMethods ?? [];
    const takesCharges =
      row?.status === 'active' &&
      row.mode === this.settings.gatewayMode &&
      (row.mode !== 'live' || this.settings.liveEnabled);
    return {
      provider: adapter.provider,
      mode: row?.mode ?? this.settings.gatewayMode,
      status: row?.status ?? 'not_submitted',
      statusReason: row?.statusReason ?? null,
      verification: adapter.verification,
      profile: {
        businessType: row?.businessType ?? null,
        businessName: row?.businessName ?? null,
        email: row?.email ?? null,
        phone: row?.phone ?? null,
      },
      termsAcceptedAt: row?.termsAcceptedAt ?? null,
      submittedAt: row?.submittedAt ?? null,
      methods: this.adapters.methodsOf(adapter.provider).map((method) => ({
        method,
        enabled: enabled.includes(method),
        chargeable: takesCharges && enabled.includes(method),
      })),
      lastSyncedAt: row?.lastSyncedAt ?? null,
      updatedAt: row?.updatedAt ?? null,
    };
  }
}
