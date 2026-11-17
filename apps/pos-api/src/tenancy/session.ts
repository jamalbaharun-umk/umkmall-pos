import { jwtVerify, SignJWT } from 'jose';
import { z } from 'zod';

// The ONLY place a POS session token is signed or verified (guard: test/guards.spec.ts).
// U1 issues owner sessions after the UMKMall handoff; U4 issues cashier sessions after PIN sign-in.

const ISSUER = 'umkmall-pos';
const AUDIENCE = 'pos-api';

const ClaimsSchema = z.object({
  tid: z.string().uuid(), // tenant id — the only source of tenancy for a request
  sub: z.string().min(1), // actor: UMKMall user id (owner) or POS staff id (cashier)
  kind: z.enum(['owner', 'cashier']),
});

export type PosSession = {
  tenantId: string;
  actorId: string;
  kind: 'owner' | 'cashier';
};

export async function signSession(
  session: PosSession,
  secret: string,
  ttlSeconds = 15 * 60,
): Promise<string> {
  return new SignJWT({ tid: session.tenantId, kind: session.kind })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(session.actorId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(new TextEncoder().encode(secret));
}

/** Returns the session, or null for any invalid, expired or foreign token. Never throws. */
export async function verifySession(
  token: string,
  secret: string,
): Promise<PosSession | null> {
  try {
    const { payload } = await jwtVerify(
      token,
      new TextEncoder().encode(secret),
      {
        issuer: ISSUER,
        audience: AUDIENCE,
        algorithms: ['HS256'],
      },
    );
    const claims = ClaimsSchema.parse(payload);
    return { tenantId: claims.tid, actorId: claims.sub, kind: claims.kind };
  } catch {
    return null;
  }
}
