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
import { tenants } from '../db/schema';
import { WindowLimiter } from '../agent/rate-limit';
import { agentEnabled } from '../agent/usage';
import { Public } from '../tenancy/decorators';
import type { AgentScope, PosSession } from '../tenancy/session';
import { signSession } from '../tenancy/session';

const SESSION_TTL = 15 * 60;
/** Failed agent-key checks allowed per network address per minute (UMK-1978 review). */
export const AGENT_SESSIONS_PER_MINUTE = 30;
const UMKMALL_TIMEOUT_MS = 5_000;
/** UMKMall's login cookies (`@umkmall/auth` AUTH_COOKIE_NAME, REFRESH_COOKIE_NAME); no other cookie leaves the POS. */
const UMKMALL_COOKIES = new Set(['auth_token', 'auth_refresh']);

const MeAnswer = z.object({
  success: z.literal(true),
  user: z.object({ id: z.string().uuid() }),
});
const DevBody = z.object({ userId: z.string().uuid() });
/**
 * `signIn: true` is sent by the relay (pos-web) only when a person is signing in, never by the refresh of a
 * session (UMK-2054). pos-api cannot tell the two apart by itself: both are the same UMKMall cookie.
 */
const UmkmallSessionBody = z
  .object({ signIn: z.literal(true).optional() })
  .strict();
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

const parse = validate;
const nowSeconds = () => Math.floor(Date.now() / 1000);
const digest = (s: string) => createHash('sha256').update(s).digest();
/** The `Cookie` header cut down to UMKMall's two auth cookies, or undefined when neither is there. */
export function authCookies(header: string | undefined): string | undefined {
  const kept = (header ?? '')
    .split(';')
    .map((c) => c.trim())
    .filter((c) => UMKMALL_COOKIES.has(c.slice(0, c.indexOf('='))));
  return kept.length > 0 ? kept.join('; ') : undefined;
}

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

  constructor(@InjectDb() private readonly db: Db) {}

  /**
   * The shared UMKMall login cookie (UMK-1945) → 15-minute owner session; also the owner refresh. Asks UMKMall's
   * `/api/auth/me` with only the two auth cookies. Every Set-Cookie it answers goes back unchanged: it can renew the
   * access cookie and mint the refresh cookie once, and dropping that signs the owner out of UMKMall later.
   *
   * A sign-in (`{ signIn: true }`) stamps the session with its sign-in time, which makes it fresh for
   * `FRESH_SIGN_IN_SECONDS` (UMK-2054: resetting or unlocking the owner's PIN). A refresh sends no `signIn` and
   * its session carries no sign-in time: a refresh is never fresh, whatever the session before it was.
   */
  @Public()
  @Post('umkmall/session')
  @HttpCode(200)
  async umkmallSession(
    @Headers('cookie') cookie: string | undefined,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { signIn } = parse(UmkmallSessionBody, body ?? {});
    const forwarded = authCookies(cookie);
    if (!forwarded) throw new UnauthorizedException();
    const { userId, setCookies, unavailable } =
      await this.askUmkmall(forwarded);
    if (setCookies.length > 0) res.setHeader('set-cookie', setCookies);
    if (unavailable) throw new ServiceUnavailableException();
    if (!userId) throw new UnauthorizedException();
    const tenantId = await this.tenantOfUmkmallUser(userId);
    return this.issue({
      tenantId,
      actorId: userId,
      kind: 'owner',
      ...(signIn && { signedInAt: nowSeconds() }),
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

  private async findOrCreateTenant(
    db: Pick<Db, 'insert' | 'select'>,
    userId: string,
  ): Promise<string> {
    const [created] = await db
      .insert(tenants)
      .values({ userId })
      .onConflictDoNothing({ target: tenants.userId })
      .returning({ id: tenants.id });
    if (created) return created.id;
    const [existing] = await db
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.userId, userId));
    return existing.id;
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
