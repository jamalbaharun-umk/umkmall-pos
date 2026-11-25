import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  NotFoundException,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { z } from 'zod';
import { parseBody } from '../staff/http';
import { RequirePermission } from '../staff/require-permission';
import { CurrentSession } from '../tenancy/decorators';
import type { PosSession } from '../tenancy/session';
import { PaymentApiError, PaymentsClient } from './payments.client';

const optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => v || null)
    .nullable()
    .optional();

/**
 * The short draft. A field that is not sent is not handed on, so payment-api keeps what it has; `null` or an
 * empty text clears it. Nothing else is accepted: no identity number, no document, no bank account.
 */
const Draft = z
  .object({
    businessType: z.enum(['individual', 'company']).nullable().optional(),
    businessName: optional(120),
    email: optional(254).refine(
      (v) => v == null || z.string().email().safeParse(v).success,
      'Format email tidak valid',
    ),
    phone: optional(20).refine(
      (v) => v == null || /^\+?[0-9]{8,15}$/.test(v),
      'Nomor HP tidak valid',
    ),
  })
  .strict('Isian tidak dikenal');

const Submit = z
  .object({
    termsAccepted: z.literal(true, {
      errorMap: () => ({ message: 'Syarat dan ketentuan harus disetujui' }),
    }),
  })
  .strict('Isian tidak dikenal');

const Toggle = z
  .object({
    enabled: z.boolean({
      required_error: 'Wajib diisi',
      invalid_type_error: 'Harus benar atau salah',
    }),
  })
  .strict('Isian tidak dikenal');

/** A provider or method name in the path: a short lower-case identifier, anything else is no such thing. */
function parseName(name: string): string {
  if (!/^[a-z][a-z0-9_]{0,39}$/.test(name)) throw new NotFoundException();
  return name;
}

// payment-api's refusals, in the owner's language. The code goes along for the screen.
const MESSAGES: Record<string, string> = {
  not_found: 'Penyedia pembayaran tidak ditemukan',
  merchant_locked: 'Data tidak bisa diubah pada status ini',
  draft_incomplete: 'Lengkapi data usaha sebelum mengajukan',
  merchant_not_verified:
    'Metode baru bisa dinyalakan setelah akun terverifikasi',
  verification_not_open: 'Akun tidak sedang menunggu verifikasi',
  verification_not_hosted: 'Penyedia ini tidak punya halaman verifikasi',
  verification_unsupported: 'Cara pendaftaran ini belum didukung',
  live_disabled: 'Pembayaran sungguhan belum diaktifkan',
  mode_unsupported: 'Penyedia ini tidak tersedia di lingkungan ini',
};
const UNAVAILABLE = 'Layanan pembayaran sedang tidak bisa dihubungi, coba lagi';

/**
 * The "Pembayaran Online" page's routes (UMK-2019): a thin pass to payment-api, which owns the account, its
 * status and every secret. The tenant is the session's; the actor is the session's. pos-api stores nothing
 * of it and hands on only the status, the draft the owner typed and the toggles.
 */
@Controller('online-payments')
export class OnlinePaymentsController {
  constructor(private readonly client: PaymentsClient) {}

  /** What the cashier may offer now: the methods of an active account that are switched on. */
  @Get('methods')
  @RequirePermission('sales.create')
  async methods(@CurrentSession() s: PosSession) {
    if (!this.client.enabled) return { methods: [] };
    const { accounts } = await this.ask(() =>
      this.client.merchantAccounts(s.tenantId),
    );
    return {
      methods: accounts.flatMap((a) =>
        a.methods.filter((m) => m.chargeable).map((m) => m.method),
      ),
    };
  }

  @Get()
  @RequirePermission('payments.manage')
  async list(@CurrentSession() s: PosSession) {
    if (!this.client.enabled)
      return { enabled: false, mode: null, accounts: [] };
    const { mode, accounts } = await this.ask(() =>
      this.client.merchantAccounts(s.tenantId),
    );
    return { enabled: true, mode, accounts };
  }

  @Put(':provider/draft')
  @RequirePermission('payments.manage')
  saveDraft(
    @CurrentSession() s: PosSession,
    @Param('provider') provider: string,
    @Body() body: unknown,
  ) {
    const draft = parseBody(Draft, body ?? {});
    return this.ask(() =>
      this.client.saveMerchantDraft(s.tenantId, parseName(provider), draft),
    );
  }

  @Post(':provider/submit')
  @HttpCode(200)
  @RequirePermission('payments.manage')
  submit(
    @CurrentSession() s: PosSession,
    @Param('provider') provider: string,
    @Body() body: unknown,
  ) {
    parseBody(Submit, body ?? {});
    return this.ask(() =>
      this.client.submitMerchant(s.tenantId, parseName(provider), {
        actorRef: s.actorId,
      }),
    );
  }

  @Post(':provider/verification-link')
  @HttpCode(200)
  @RequirePermission('payments.manage')
  verificationLink(
    @CurrentSession() s: PosSession,
    @Param('provider') provider: string,
  ) {
    return this.ask(() =>
      this.client.merchantVerificationLink(s.tenantId, parseName(provider)),
    );
  }

  @Post(':provider/sync')
  @HttpCode(200)
  @RequirePermission('payments.manage')
  sync(@CurrentSession() s: PosSession, @Param('provider') provider: string) {
    return this.ask(() =>
      this.client.syncMerchant(s.tenantId, parseName(provider)),
    );
  }

  @Put(':provider/methods/:method')
  @RequirePermission('payments.manage')
  setMethod(
    @CurrentSession() s: PosSession,
    @Param('provider') provider: string,
    @Param('method') method: string,
    @Body() body: unknown,
  ) {
    const { enabled } = parseBody(Toggle, body ?? {});
    return this.ask(() =>
      this.client.setMerchantMethod(
        s.tenantId,
        parseName(provider),
        parseName(method),
        { enabled, actorRef: s.actorId },
      ),
    );
  }

  /** payment-api's clear refusal keeps its status and code; no clear answer is 503. Nothing of it is echoed. */
  private async ask<T>(call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (error) {
      if (!(error instanceof PaymentApiError)) throw error;
      if (error.kind === 'rejected' && error.status)
        throw new HttpException(
          {
            message:
              (error.code && MESSAGES[error.code]) ?? 'Permintaan ditolak',
            ...(error.code ? { code: error.code } : {}),
          },
          error.status,
        );
      throw new HttpException({ message: UNAVAILABLE }, 503);
    }
  }
}
