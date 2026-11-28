import {
  Body,
  Controller,
  ForbiddenException,
  Headers,
  HttpCode,
  HttpException,
  Logger,
  NotFoundException,
  Post,
  Req,
  Res,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { fieldError, validate } from '../common/validation';
import { loadEnv } from '../config';
import type { Db } from '../db/db.module';
import { InjectDb } from '../db/db.module';
import { parkedSidRefused, SESSION_PARKED } from '../helper/helper.controller';
import { tenants } from '../db/schema';
import { cashMethodId } from '../sales/cash';
import { WindowLimiter } from '../agent/rate-limit';
import { agentEnabled } from '../agent/usage';
import { addressKey } from '../staff/address-limits';
import { Public } from '../tenancy/decorators';
import type { AgentScope, PosSession } from '../tenancy/session';
import { signSession } from '../tenancy/session';
import { type NativeAnswer, UmkmallNative } from './umkmall-native';

const SESSION_TTL = 15 * 60;
/** Failed agent-key checks allowed per network address per minute (UMK-1978 review). */
export const AGENT_SESSIONS_PER_MINUTE = 30;
const UMKMALL_TIMEOUT_MS = 5_000;

const MeAnswer = z.object({
  success: z.literal(true),
  user: z.object({ id: z.string().uuid() }),
});
const DevBody = z.object({ userId: z.string().uuid() });
// A JWT or any opaque token: no character that could end the cookie or add another one.
// New Teman AI consent: the scopes the owner granted and UMKMall's consent record. Read is always included.
const agentGrant = {
  scopes: z
    .array(z.enum(['pos.read', 'pos.write']))
    .max(2)
    .optional()
    .transform((s) => [...new Set<AgentScope>(['pos.read', ...(s ?? [])])]),
  consentRef: z
    .string()
    .regex(/^[A-Za-z0-9:._-]{1,100}$/)
    .optional(),
};
const DevAgentBody = z.object({ userId: z.string().uuid(), ...agentGrant });
const AgentBody = z
  .object({
    ...agentGrant,
    token: z
      .string()
      .min(16)
      .max(4096)
      .regex(/^[A-Za-z0-9._~+/-]+$/),
  })
  .strict();

// WhatsApp OTP sign-in (UMK-2065). UMKMall checks the number and the code; these only keep junk away from it.
const Phone = z
  .string({ required_error: 'Nomor WhatsApp wajib diisi' })
  .trim()
  .regex(/^\+?[0-9][0-9 -]{7,19}$/, 'Format nomor WhatsApp tidak valid');
/** What the owner agreed to on the consent dialog: the live versions UMKMall named in `consent_required`. */
const Consent = z
  .object({
    tosVersionId: z.string().max(100).nullable().optional(),
    privacyVersionId: z.string().max(100).nullable().optional(),
    ageConfirmed: z.boolean().optional(),
  })
  .strict();
const OtpRequestBody = z
  .object({ phone: Phone, consent: Consent.optional() })
  .strict();
const OtpVerifyBody = z
  .object({
    phone: Phone,
    otp: z
      .string({ required_error: 'Kode OTP wajib diisi' })
      .regex(/^\d{4,8}$/, 'Kode OTP harus berupa angka'),
    consent: Consent.optional(),
  })
  .strict();
/** UMKMall's native session as the POS keeps it (pos-web's httpOnly cookie): its id and refresh secret. */
const NativeSessionBody = z
  .object({
    sid: z
      .string()
      .min(1)
      .max(200)
      .regex(/^[A-Za-z0-9._:-]+$/),
    refreshToken: z
      .string()
      .min(16)
      .max(1024)
      .regex(/^[A-Za-z0-9._~+/=-]+$/),
  })
  .strict();
const ConsentStatus = z.object({
  needsConsent: z.boolean(),
  needsAgeConfirmation: z.boolean().optional(),
  tos: z
    .object({ id: z.string(), version: z.unknown(), title: z.unknown() })
    .nullable(),
  privacy: z
    .object({ id: z.string(), version: z.unknown(), title: z.unknown() })
    .nullable(),
});
const OtpSent = z.object({
  data: z.object({
    otpLength: z.number().int().min(4).max(8),
    expiresAt: z.string(),
  }),
});
const NativeSignedIn = z.object({
  data: z.object({
    accessToken: z.string().min(1),
    refreshToken: z.string().min(16).optional(), // absent on a refresh that lost the rotation race (UMKMall's grace)
    // lower case: the same user must map to the same store and the same actor id however UMKMall spells it
    user: z.object({
      id: z
        .string()
        .uuid()
        .transform((id) => id.toLowerCase()),
    }),
    session: z.object({ id: z.string().min(1) }),
    isNewUser: z.boolean().optional(),
  }),
});
/** Per network address, before UMKMall: its own per-IP caps see only pos-api until UMK-2066. */
export const OTP_REQUESTS_PER_WINDOW = 10;
export const OTP_VERIFIES_PER_WINDOW = 30;
const OTP_WINDOW_SECONDS = 600;
const UNAVAILABLE =
  'Layanan login UMKMall sedang tidak bisa dihubungi. Coba lagi beberapa saat lagi.';
const TOO_MANY = 'Terlalu banyak percobaan. Coba lagi beberapa menit lagi.';

const parse = validate;
const nowSeconds = () => Math.floor(Date.now() / 1000);
const digest = (s: string) => createHash('sha256').update(s).digest();
const isMissingUser = (e: unknown) =>
  (e as { cause?: { code?: string } }).cause?.code === '23503';

@Controller('auth')
export class AuthController {
  private readonly env = loadEnv();
  private readonly logger = new Logger(AuthController.name);
  private readonly agentKey = this.env.POS_AGENT_SERVICE_KEY
    ? digest(this.env.POS_AGENT_SERVICE_KEY)
    : null;
  private readonly agentLimit = new WindowLimiter(
    AGENT_SESSIONS_PER_MINUTE,
    60_000,
  );

  private readonly umkmall = this.env.UMKMALL_API_URL
    ? new UmkmallNative(this.env.UMKMALL_API_URL)
    : null;
  private readonly otpRequestLimit = new WindowLimiter(
    OTP_REQUESTS_PER_WINDOW,
    OTP_WINDOW_SECONDS * 1000,
  );
  private readonly otpVerifyLimit = new WindowLimiter(
    OTP_VERIFIES_PER_WINDOW,
    OTP_WINDOW_SECONDS * 1000,
  );

  constructor(@InjectDb() private readonly db: Db) {}

  /**
   * Step 1 of the owner's WhatsApp sign-in (UMK-2065): UMKMall sends the code. A number UMKMall has no current consent
   * for (a new account, or a new policy version) answers 409 `consent_required` with the versions to show, and no code
   * is sent until the owner agrees and asks again with `consent`. Like UMKMall's own login, a new number becomes a new
   * UMKMall account at the verify step.
   */
  @Public()
  @Post('otp/request')
  @HttpCode(200)
  async otpRequest(
    @Req() req: Request,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const umkmall = this.nativeOrNotFound();
    const { phone, consent } = parse(OtpRequestBody, body);
    this.limit(this.otpRequestLimit, req, res);
    await this.assertConsent(umkmall, phone, consent, res);
    const sent = await umkmall.call('POST', '/mobile/v1/auth/otp/request', {
      phone,
    });
    if (sent.status !== 200) throw this.refusal(sent, 'phone', res);
    const answer = OtpSent.safeParse(sent.body);
    if (!answer.success) throw this.unavailable();
    return answer.data.data;
  }

  /**
   * Step 2: UMKMall checks the code and opens a native session for the POS; the owner gets a 15-minute POS session
   * stamped as a sign-in (fresh for UMK-2054) and UMKMall's `{ sid, refreshToken }` for `POST /auth/umkmall/refresh`.
   * pos-api keeps neither. Consent the owner gave at step 1 is recorded at UMKMall before the session is handed out.
   */
  @Public()
  @Post('otp/verify')
  @HttpCode(200)
  async otpVerify(
    @Req() req: Request,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const umkmall = this.nativeOrNotFound();
    const { phone, otp, consent } = parse(OtpVerifyBody, body);
    this.limit(this.otpVerifyLimit, req, res);
    const needed = await this.assertConsent(umkmall, phone, consent, res);
    const verified = await umkmall.call('POST', '/mobile/v1/auth/otp/verify', {
      phone,
      otp,
    });
    if (verified.status !== 200) throw this.refusal(verified, 'otp', res);
    const answer = NativeSignedIn.safeParse(verified.body);
    if (!answer.success) throw this.unavailable();
    if (!answer.data.data.refreshToken) {
      // A session the POS could never refresh or end: end it now rather than leave it open at UMKMall.
      await umkmall.call(
        'DELETE',
        '/mobile/v1/auth/session',
        undefined,
        answer.data.data.accessToken,
      );
      throw this.unavailable();
    }
    const { accessToken, refreshToken, user, session, isNewUser } =
      answer.data.data;
    if (needed && consent) {
      const recorded = await umkmall.call(
        'POST',
        '/mobile/v1/auth/consent/record',
        {
          ...consent,
          acceptanceMethod: isNewUser ? 'initial_signup' : 'forced_reconfirm',
        },
        accessToken,
      );
      if (recorded.status !== 200) {
        // No session without the consent it needs: end the one UMKMall just opened.
        await umkmall.call(
          'DELETE',
          '/mobile/v1/auth/session',
          undefined,
          accessToken,
        );
        if (recorded.status === 409) await this.assertConsent(umkmall, phone);
        throw this.unavailable();
      }
    }
    const tenantId = await this.tenantOfUmkmallUser(user.id);
    return {
      ...(await this.issue({
        tenantId,
        actorId: user.id,
        kind: 'owner',
        signedInAt: nowSeconds(),
      })),
      umkmall: { sid: session.id, refreshToken },
    };
  }

  /**
   * The owner refresh for a WhatsApp sign-in: UMKMall rotates its native session and names the user again, so a
   * session UMKMall ended (sign-out everywhere, account deletion) ends here within 15 minutes. Never a sign-in: the
   * session carries no sign-in time (UMK-2054). `umkmall.refreshToken` is there only when UMKMall rotated it.
   */
  @Public()
  @Post('umkmall/refresh')
  @HttpCode(200)
  async umkmallRefresh(@Body() body: unknown) {
    const umkmall = this.nativeOrNotFound();
    const { sid, refreshToken } = parse(NativeSessionBody, body);
    // UMK-2124: a native session parked by "Serahkan ke pembantu" wakes only through the owner's PIN.
    if (await parkedSidRefused(this.db, sid))
      throw new ForbiddenException({
        message:
          'Sesi pemilik sedang diparkir. Kembali ke pemilik dengan PIN, atau masuk lagi lewat WhatsApp.',
        code: SESSION_PARKED,
      });
    const refreshed = await umkmall.call('POST', '/mobile/v1/auth/refresh', {
      sid,
      refreshToken,
    });
    if (refreshed.status === 401 || refreshed.status === 400)
      throw new UnauthorizedException();
    if (refreshed.status !== 200) throw this.unavailable();
    const answer = NativeSignedIn.safeParse(refreshed.body);
    if (!answer.success) throw this.unavailable();
    const { user, refreshToken: rotated } = answer.data.data;
    const tenantId = await this.tenantOfUmkmallUser(user.id);
    return {
      ...(await this.issue({ tenantId, actorId: user.id, kind: 'owner' })),
      umkmall: { sid, ...(rotated && { refreshToken: rotated }) },
    };
  }

  /** Ends the POS's own UMKMall session (the owner's web and app sessions stay). An already ended one is fine. */
  @Public()
  @Post('umkmall/sign-out')
  @HttpCode(204)
  async umkmallSignOut(@Body() body: unknown): Promise<void> {
    const umkmall = this.nativeOrNotFound();
    const { sid, refreshToken } = parse(NativeSessionBody, body);
    // UMKMall signs a device out by its access token, which the POS does not keep: refresh once for one.
    const refreshed = await umkmall.call('POST', '/mobile/v1/auth/refresh', {
      sid,
      refreshToken,
    });
    if (refreshed.status === 401 || refreshed.status === 400) return;
    const answer = NativeSignedIn.safeParse(refreshed.body);
    if (refreshed.status !== 200 || !answer.success) throw this.unavailable();
    const ended = await umkmall.call(
      'DELETE',
      '/mobile/v1/auth/session',
      undefined,
      answer.data.data.accessToken,
    );
    if (ended.status !== 200 && ended.status !== 204 && ended.status !== 401)
      throw this.unavailable();
  }

  private nativeOrNotFound(): UmkmallNative {
    if (!this.umkmall) throw new NotFoundException();
    return this.umkmall;
  }

  private limit(limiter: WindowLimiter, req: Request, res: Response): void {
    if (limiter.hit(addressKey(req.ip ?? 'unknown'))) return;
    res.setHeader('retry-after', String(OTP_WINDOW_SECONDS));
    throw new HttpException(
      {
        message: TOO_MANY,
        code: 'too_many_attempts',
        retryAfterSeconds: OTP_WINDOW_SECONDS,
      },
      429,
    );
  }

  /**
   * 409 `consent_required` (with the live versions) when UMKMall needs the owner's consent and none was sent. Answers
   * whether consent was needed, so verify records it only then.
   */
  private async assertConsent(
    umkmall: UmkmallNative,
    phone: string,
    consent?: z.infer<typeof Consent>,
    res?: Response,
  ): Promise<boolean> {
    const status = await umkmall.call(
      'POST',
      '/mobile/v1/auth/consent/status',
      { phone },
    );
    if (status.status !== 200) throw this.refusal(status, 'phone', res);
    const answer = ConsentStatus.safeParse(status.body);
    if (!answer.success) throw this.unavailable();
    const { needsConsent, needsAgeConfirmation, tos, privacy } = answer.data;
    if (needsConsent && !consent)
      throw new HttpException(
        {
          message:
            'Setujui Syarat & Ketentuan dan Kebijakan Privasi UMKMall untuk melanjutkan.',
          code: 'consent_required',
          consent: {
            tos,
            privacy,
            needsAgeConfirmation: needsAgeConfirmation ?? false,
          },
        },
        409,
      );
    return needsConsent;
  }

  /**
   * UMKMall's refusal as the POS answers it. 400 is the owner's input (UMKMall's own Indonesian message, which names
   * no value) → 422 on `field`; 429 keeps its wait; 401 stays 401; anything else, or no answer, is 503.
   */
  private refusal(
    answer: NativeAnswer,
    field: 'phone' | 'otp',
    res?: Response,
  ): HttpException {
    const message = answer.body.message;
    if (answer.status === 400)
      return fieldError(
        field,
        typeof message === 'string' && message.length <= 160
          ? message
          : 'Data tidak valid',
      );
    if (answer.status === 429) {
      const wait = Number(answer.body.retryAfterSeconds);
      const retryAfterSeconds =
        Number.isInteger(wait) && wait > 0 ? wait : OTP_WINDOW_SECONDS;
      res?.setHeader('retry-after', String(retryAfterSeconds));
      return new HttpException(
        { message: TOO_MANY, code: 'too_many_attempts', retryAfterSeconds },
        429,
      );
    }
    if (answer.status === 401) return new UnauthorizedException();
    return this.unavailable();
  }

  private unavailable(): HttpException {
    return new ServiceUnavailableException({
      message: UNAVAILABLE,
      code: 'umkmall_unavailable',
    });
  }

  /** Local work without UMKMall (localhost cookies carry no UMKMall login). Only in development or test. */
  @Public()
  @Post('dev/sign-in')
  @HttpCode(200)
  async devSignIn(@Body() body: unknown) {
    // Fails closed: only an explicit development or test environment has it (an unset NODE_ENV does not).
    if (!['development', 'test'].includes(process.env.NODE_ENV ?? ''))
      throw new NotFoundException();
    const { userId } = parse(DevBody, body);
    try {
      const tenantId = await this.findOrCreateTenant(this.db, userId);
      // Always a sign-in (this route refreshes nothing), so local work can reset the owner's PIN too.
      return this.issue({
        tenantId,
        actorId: userId,
        kind: 'owner',
        signedInAt: nowSeconds(),
      });
    } catch (error) {
      // 23503: no such public.users row
      if (isMissingUser(error))
        throw fieldError('userId', 'Pengguna tidak ditemukan');
      throw error;
    }
  }

  /**
   * UMKMall's agent acting for a signed-in owner (UMK-1978) → 15-minute agent session for that owner's store. The
   * owner's UMKMall access token goes to `/api/auth/me` as the `auth_token` cookie, the cookie that route reads. Only
   * UMKMall's agent backend may hold that token: it is the owner's full UMKMall credential. Never logged.
   */
  @Public()
  @Post('agent/session')
  @HttpCode(200)
  async agentSession(
    @Headers('x-pos-agent-key') key: string | undefined,
    @Req() req: Request,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!this.agentKey) throw new NotFoundException();
    // Server to server only: the scopes and consent below are the caller's word, so only UMKMall's agent backend,
    // holding its own key, may ask (the owner's token alone does not open an agent session). Only FAILED key checks
    // are counted, per network address: UMKMall's backend (one address, a valid key) is never limited here.
    if (!key || !timingSafeEqual(digest(key), this.agentKey)) {
      if (!this.agentLimit.hit(req.ip ?? 'unknown'))
        throw new HttpException(
          {
            message: 'Terlalu banyak permintaan sesi agent, coba lagi sebentar',
          },
          429,
        );
      throw new UnauthorizedException({ message: 'Kunci layanan tidak valid' });
    }
    const { token, scopes, consentRef } = parse(AgentBody, body);
    const { userId, setCookies, unavailable } = await this.askUmkmall(
      `auth_token=${token}`,
    );
    // /auth/me can re-sign the access token and mint the session's refresh secret ONCE (UMKMall
    // session.controller adoptWebRefreshSecret); dropping that cookie would sign the owner's browser out later.
    // So it goes back to the caller unchanged, like the owner sign-in, and UMKMall's agent backend must pass it
    // on to the owner's browser (docs/agent-integration.md).
    if (setCookies.length > 0) res.setHeader('set-cookie', setCookies);
    if (unavailable) throw new ServiceUnavailableException();
    if (!userId) throw new UnauthorizedException();
    const tenantId = await this.tenantOfUmkmallUser(userId);
    await this.assertAgentEnabled(tenantId);
    return this.issue({
      tenantId,
      actorId: userId,
      kind: 'agent',
      agentScopes: scopes,
      ...(consentRef && { consentRef }),
    });
  }

  /** The agent session for local work and tests (no UMKMall). Refused in production. */
  @Public()
  @Post('dev/agent-session')
  @HttpCode(200)
  async devAgentSession(@Body() body: unknown) {
    // Fails closed: only an explicit development or test environment has it (an unset NODE_ENV does not).
    if (!['development', 'test'].includes(process.env.NODE_ENV ?? ''))
      throw new NotFoundException();
    const { userId, scopes, consentRef } = parse(DevAgentBody, body);
    try {
      const tenantId = await this.findOrCreateTenant(this.db, userId);
      await this.assertAgentEnabled(tenantId);
      return this.issue({
        tenantId,
        actorId: userId,
        kind: 'agent',
        agentScopes: scopes,
        ...(consentRef && { consentRef }),
      });
    } catch (error) {
      if (isMissingUser(error))
        throw fieldError('userId', 'Pengguna tidak ditemukan');
      throw error;
    }
  }

  /**
   * Asks UMKMall's `/api/auth/me` with the given Cookie header (5 s). 401 or a bad body → no user; another status →
   * `unavailable`; an unreachable UMKMall or a timeout → 503 at once. The Set-Cookie lines come back for a caller
   * that relays them, whatever the status.
   */
  private async askUmkmall(cookie: string): Promise<{
    userId: string | null;
    setCookies: string[];
    unavailable: boolean;
  }> {
    let me: globalThis.Response;
    try {
      me = await fetch(
        `${this.env.UMKMALL_WEB_URL.replace(/\/$/, '')}/api/auth/me`,
        {
          headers: { cookie, accept: 'application/json' },
          redirect: 'manual',
          signal: AbortSignal.timeout(UMKMALL_TIMEOUT_MS),
        },
      );
    } catch (error) {
      this.logger.warn(
        `UMKMall /auth/me unreachable: ${(error as Error).name}`,
      );
      throw new ServiceUnavailableException();
    }
    const setCookies = me.headers.getSetCookie();
    if (me.status === 401)
      return { userId: null, setCookies, unavailable: false };
    if (me.status !== 200) {
      this.logger.warn(`UMKMall /auth/me answered ${me.status}`);
      return { userId: null, setCookies, unavailable: true };
    }
    const answer = MeAnswer.safeParse(await me.json().catch(() => null));
    return {
      userId: answer.success ? answer.data.user.id : null,
      setCookies,
      unavailable: false,
    };
  }

  /** 403 while the owner has UMKMall's agent turned off (POST /agent/access/revoke), until they turn it on. */
  private async assertAgentEnabled(tenantId: string): Promise<void> {
    if (!(await agentEnabled(this.db, tenantId)))
      throw new ForbiddenException({
        message:
          'Pemilik toko mematikan akses agent UMKMall. Nyalakan lagi dari POS.',
      });
  }

  private tenantOfUmkmallUser(userId: string): Promise<string> {
    return this.findOrCreateTenant(this.db, userId).catch((error: unknown) => {
      // A UMKMall account with no users row in this database: refuse cleanly instead of a 500.
      if (isMissingUser(error))
        throw new UnauthorizedException({
          message: 'Akun UMKMall tidak ditemukan',
        });
      throw error;
    });
  }

  /**
   * The owner's store, created on first sign-in together with its "Tunai" method (UMK-2120), so the cash method
   * and the "Kelengkapan toko" step for it are there from the start. Idempotent: an existing store without Tunai
   * (created before this) gets it at the owner's next sign-in.
   */
  private findOrCreateTenant(db: Db, userId: string): Promise<string> {
    return db.transaction(async (tx) => {
      const [created] = await tx
        .insert(tenants)
        .values({ userId })
        .onConflictDoNothing({ target: tenants.userId })
        .returning({ id: tenants.id });
      const tenantId =
        created?.id ??
        (
          await tx
            .select({ id: tenants.id })
            .from(tenants)
            .where(eq(tenants.userId, userId))
        )[0].id;
      await cashMethodId(tx, tenantId);
      return tenantId;
    });
  }

  private async issue(session: PosSession) {
    return {
      sessionToken: await signSession(
        session,
        this.env.POS_SESSION_SECRET,
        SESSION_TTL,
      ),
      expiresIn: SESSION_TTL,
      tenant: { id: session.tenantId },
    };
  }
}
