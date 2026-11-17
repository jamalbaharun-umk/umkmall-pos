import {
  Body,
  Controller,
  HttpCode,
  Logger,
  NotFoundException,
  Post,
  ServiceUnavailableException,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { eq, lt } from 'drizzle-orm';
import { z } from 'zod';
import { loadEnv } from '../config';
import type { Db } from '../db/db.module';
import { InjectDb } from '../db/db.module';
import { handoffJtis, tenants } from '../db/schema';
import { CurrentSession, Public } from '../tenancy/decorators';
import type { PosSession } from '../tenancy/session';
import { signSession, verifyHandoff } from '../tenancy/session';

const SESSION_TTL = 15 * 60;
const LIVENESS_TIMEOUT_MS = 5_000;

const ExchangeBody = z.object({ token: z.string().min(1).max(4096) });
const DevBody = z.object({ userId: z.string().uuid() });

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new UnprocessableEntityException();
  return parsed.data;
}

@Controller('auth')
export class AuthController {
  private readonly env = loadEnv();
  private readonly logger = new Logger(AuthController.name);

  constructor(@InjectDb() private readonly db: Db) {}

  /** UMKMall handoff token → 15-minute owner session. Creates the store on the user's first visit. */
  @Public()
  @Post('umkmall/exchange')
  @HttpCode(200)
  async exchange(@Body() body: unknown) {
    const { token } = parse(ExchangeBody, body);
    const handoff = await verifyHandoff(token, this.env.UMKMALL_JWKS_URL);
    if (!handoff) throw new UnauthorizedException();

    const tenantId = await this.db.transaction(async (tx) => {
      await tx.delete(handoffJtis).where(lt(handoffJtis.expiresAt, new Date()));
      const spent = await tx
        .insert(handoffJtis)
        .values({ jti: handoff.jti, expiresAt: new Date(handoff.exp * 1000) })
        .onConflictDoNothing()
        .returning({ jti: handoffJtis.jti });
      if (spent.length === 0) throw new UnauthorizedException(); // replayed jti
      return this.findOrCreateTenant(tx, handoff.sub);
    });
    return this.issue({
      tenantId,
      actorId: handoff.sub,
      kind: 'owner',
      sid: handoff.sid,
    });
  }

  /** A fresh owner session while UMKMall says its session is still live. */
  @Post('refresh')
  @HttpCode(200)
  async refresh(@CurrentSession() session: PosSession) {
    if (session.kind !== 'owner' || !session.sid)
      throw new UnauthorizedException();
    if (!(await this.isLive(session.sid))) throw new UnauthorizedException();
    return this.issue(session);
  }

  /** Local work without UMKMall. Refused in production. The session has no sid, so it cannot refresh. */
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
      if ((error as { cause?: { code?: string } }).cause?.code === '23503')
        throw new UnprocessableEntityException();
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

  /** UMKMall liveness: true only for 200 { live: true }; false for 200 { live: false }; 503 otherwise. */
  private async isLive(sid: string): Promise<boolean> {
    let res: Response;
    try {
      res = await fetch(
        `${this.env.UMKMALL_API_URL.replace(/\/$/, '')}/auth/pos/liveness`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-pos-service-key': this.env.POS_SERVICE_KEY,
          },
          body: JSON.stringify({ sid }),
          signal: AbortSignal.timeout(LIVENESS_TIMEOUT_MS),
        },
      );
    } catch (error) {
      this.logger.warn(
        `UMKMall liveness unreachable: ${(error as Error).name}`,
      );
      throw new ServiceUnavailableException();
    }
    if (res.status !== 200) {
      this.logger.warn(`UMKMall liveness answered ${res.status}`);
      throw new ServiceUnavailableException();
    }
    const answer = (await res.json().catch(() => null)) as {
      live?: unknown;
    } | null;
    return answer?.live === true;
  }
}
