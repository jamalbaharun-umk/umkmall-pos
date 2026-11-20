import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Logger,
  NotFoundException,
  Post,
  Res,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { Response } from 'express';
import { z } from 'zod';
import { fieldError, validate } from '../common/validation';
import { loadEnv } from '../config';
import type { Db } from '../db/db.module';
import { InjectDb } from '../db/db.module';
import { tenants } from '../db/schema';
import { Public } from '../tenancy/decorators';
import type { PosSession } from '../tenancy/session';
import { signSession } from '../tenancy/session';

const SESSION_TTL = 15 * 60;
const UMKMALL_TIMEOUT_MS = 5_000;
/** UMKMall's login cookies (`@umkmall/auth` AUTH_COOKIE_NAME, REFRESH_COOKIE_NAME); no other cookie leaves the POS. */
const UMKMALL_COOKIES = new Set(['auth_token', 'auth_refresh']);

const MeAnswer = z.object({
  success: z.literal(true),
  user: z.object({ id: z.string().uuid() }),
});
const DevBody = z.object({ userId: z.string().uuid() });

const parse = validate;
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

  constructor(@InjectDb() private readonly db: Db) {}

  /**
   * The shared UMKMall login cookie (UMK-1945) → 15-minute owner session; also the owner refresh. Asks UMKMall's
   * `/api/auth/me` with only the two auth cookies. Every Set-Cookie it answers goes back unchanged: it can renew the
   * access cookie and mint the refresh cookie once, and dropping that signs the owner out of UMKMall later.
   */
  @Public()
  @Post('umkmall/session')
  @HttpCode(200)
  async umkmallSession(
    @Headers('cookie') cookie: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const forwarded = authCookies(cookie);
    if (!forwarded) throw new UnauthorizedException();
    let me: globalThis.Response;
    try {
      me = await fetch(
        `${this.env.UMKMALL_WEB_URL.replace(/\/$/, '')}/api/auth/me`,
        {
          headers: { cookie: forwarded, accept: 'application/json' },
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
    if (setCookies.length > 0) res.setHeader('set-cookie', setCookies);
    if (me.status === 401) throw new UnauthorizedException();
    if (me.status !== 200) {
      this.logger.warn(`UMKMall /auth/me answered ${me.status}`);
      throw new ServiceUnavailableException();
    }
    const answer = MeAnswer.safeParse(await me.json().catch(() => null));
    if (!answer.success) throw new UnauthorizedException();
    const userId = answer.data.user.id;
    const tenantId = await this.findOrCreateTenant(this.db, userId).catch(
      (error: unknown) => {
        // A UMKMall account with no users row in this database: refuse cleanly instead of a 500.
        if (isMissingUser(error))
          throw new UnauthorizedException({
            message: 'Akun UMKMall tidak ditemukan',
          });
        throw error;
      },
    );
    return this.issue({ tenantId, actorId: userId, kind: 'owner' });
  }

  /** Local work without UMKMall (localhost cookies carry no UMKMall login). Refused in production. */
  @Public()
  @Post('dev/sign-in')
  @HttpCode(200)
  async devSignIn(@Body() body: unknown) {
    if (process.env.NODE_ENV === 'production') throw new NotFoundException();
    const { userId } = parse(DevBody, body);
    try {
      const tenantId = await this.findOrCreateTenant(this.db, userId);
      return this.issue({ tenantId, actorId: userId, kind: 'owner' });
    } catch (error) {
      // 23503: no such public.users row
      if (isMissingUser(error))
        throw fieldError('userId', 'Pengguna tidak ditemukan');
      throw error;
    }
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
