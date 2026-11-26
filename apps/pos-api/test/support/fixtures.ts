import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import postgres from 'postgres';
import { AppModule } from '../../src/app.module';
import { signSession } from '../../src/tenancy/session';
import { ADMIN_DATABASE_URL, APP_DATABASE_URL } from './env';

export async function createApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = moduleRef.createNestApplication();
  await app.init();
  return app;
}

/**
 * A UMKMall account (stub row) plus its store. Returns ids and an owner bearer token. `auth` is a session without
 * a sign-in time, as after a refresh; `freshAuth` is the session of an owner who signed in just now (UMK-2054:
 * making, removing or unlocking the owner's own PIN).
 */
export async function createStore() {
  const admin = postgres(ADMIN_DATABASE_URL, { max: 1 });
  const appDb = postgres(APP_DATABASE_URL, { max: 1 });
  try {
    const [user] = await admin<
      { id: string }[]
    >`insert into public.users default values returning id`;
    const [tenant] = await appDb<{ id: string }[]>`
      insert into pos.tenants (user_id) values (${user.id}) returning id`;
    const token = await signSession(
      { tenantId: tenant.id, actorId: user.id, kind: 'owner' },
      process.env.POS_SESSION_SECRET!,
    );
    const fresh = await signSession(
      {
        tenantId: tenant.id,
        actorId: user.id,
        kind: 'owner',
        signedInAt: Math.floor(Date.now() / 1000),
      },
      process.env.POS_SESSION_SECRET!,
    );
    return {
      userId: user.id,
      tenantId: tenant.id,
      token,
      auth: `Bearer ${token}`,
      freshAuth: `Bearer ${fresh}`,
    };
  } finally {
    await admin.end();
    await appDb.end();
  }
}
