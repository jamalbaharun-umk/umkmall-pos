import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Injectable,
  Module,
  Param,
  Put,
} from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { validate } from '../common/validation';
import type { Db } from '../db/db.module';
import { InjectDb } from '../db/db.module';
import { guideProgress } from '../db/schema';
import { CurrentSession } from '../tenancy/decorators';
import type { PosSession } from '../tenancy/session';

/** The guide's key as pos-web's guides.ts names it ("kasir", "catalog.products", ...). */
export const GuideKey = z
  .string()
  .regex(/^[a-z0-9_.-]{1,60}$/, 'Kunci panduan tidak valid');
const ProgressInput = z
  .object({ status: z.enum(['done', 'skipped']) })
  .strict();

type Person = { tenantId: string; kind: 'owner' | 'cashier'; id: string };

/**
 * The person the progress belongs to: the session's own actor. An agent has no screens, so no guides; a helper
 * (UMK-2124) acts as the owner and never reaches these routes (not `@HelperRoute()`).
 */
function personOf(s: PosSession): Person {
  if (s.kind === 'agent' || s.kind === 'helper') throw new ForbiddenException();
  return { tenantId: s.tenantId, kind: s.kind, id: s.actorId };
}

const mine = (p: Person) =>
  and(
    eq(guideProgress.tenantId, p.tenantId),
    eq(guideProgress.actorKind, p.kind),
    eq(guideProgress.actorId, p.id),
  );

@Injectable()
export class GuidesService {
  constructor(@InjectDb() private readonly db: Db) {}

  list(p: Person) {
    return this.db
      .select({
        key: guideProgress.guideKey,
        status: guideProgress.status,
        updatedAt: guideProgress.updatedAt,
      })
      .from(guideProgress)
      .where(mine(p))
      .orderBy(asc(guideProgress.guideKey));
  }

  async mark(p: Person, key: string, status: 'done' | 'skipped') {
    const [row] = await this.db
      .insert(guideProgress)
      .values({
        tenantId: p.tenantId,
        actorKind: p.kind,
        actorId: p.id,
        guideKey: key,
        status,
      })
      .onConflictDoUpdate({
        target: [
          guideProgress.tenantId,
          guideProgress.actorKind,
          guideProgress.actorId,
          guideProgress.guideKey,
        ],
        set: { status, updatedAt: new Date() },
      })
      .returning({
        key: guideProgress.guideKey,
        status: guideProgress.status,
        updatedAt: guideProgress.updatedAt,
      });
    return row;
  }

  /** "Ulangi": forget one guide (or every guide), so it starts again on the next visit. */
  async reset(p: Person, key?: string) {
    await this.db
      .delete(guideProgress)
      .where(and(mine(p), key ? eq(guideProgress.guideKey, key) : undefined));
  }
}

/**
 * UMK-2134 coach marks (design 46): each person's guide progress, kept on the server so a new device does not replay
 * what they have seen. Every signed-in person reads and writes only their own rows; no permission is needed (the
 * guides explain screens, they open none). Not an agent route.
 */
@Controller('guides/progress')
export class GuidesController {
  constructor(private readonly guides: GuidesService) {}

  @Get()
  async list(@CurrentSession() s: PosSession) {
    return { data: await this.guides.list(personOf(s)) };
  }

  @Put(':key')
  mark(
    @CurrentSession() s: PosSession,
    @Param('key') key: string,
    @Body() body: unknown,
  ) {
    const p = personOf(s);
    return this.guides.mark(
      p,
      validate(GuideKey, key),
      validate(ProgressInput, body).status,
    );
  }

  @Delete()
  @HttpCode(204)
  async resetAll(@CurrentSession() s: PosSession) {
    await this.guides.reset(personOf(s));
  }

  @Delete(':key')
  @HttpCode(204)
  async reset(@CurrentSession() s: PosSession, @Param('key') key: string) {
    const p = personOf(s);
    await this.guides.reset(p, validate(GuideKey, key));
  }
}

@Module({ controllers: [GuidesController], providers: [GuidesService] })
export class GuidesModule {}
