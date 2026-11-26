import { jwtVerify, SignJWT } from 'jose';
import { z } from 'zod';

// The ONLY place a POS session token is signed or verified (guard: test/guards.spec.ts).
// Owner sessions follow a UMKMall `/auth/me` check (UMK-1945); U4 issues cashier sessions after PIN sign-in.

const ISSUER = 'umkmall-pos';
const AUDIENCE = 'pos-api';

const ClaimsSchema = z.object({
  tid: z.string().uuid(), // tenant id — the only source of tenancy for a request
  sub: z.string().min(1), // actor: UMKMall user id (owner, agent) or POS staff id (cashier)
  kind: z.enum(['owner', 'cashier', 'agent']),
  csid: z.string().uuid().optional(), // cashier session row (U4); the guard checks it is still live
});

export type PosSession = {
  tenantId: string;
  actorId: string;
  /** `agent`: UMKMall's agent acting for the owner (UMK-1978); it reaches only `@AgentRoute()` routes. */
  kind: 'owner' | 'cashier' | 'agent';
  cashierSessionId?: string;
  /** Set by the session guard per request, never from the token (U4). Owners hold every permission. */
  permissions?: readonly string[];
};

export async function signSession(
  session: PosSession,
  secret: string,
  ttlSeconds = 15 * 60,
): Promise<string> {
  return new SignJWT({
    tid: session.tenantId,
    kind: session.kind,
    ...(session.cashierSessionId && { csid: session.cashierSessionId }),
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(session.actorId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(new TextEncoder().encode(secret));
}

/**
 * Returns the session, or null for any invalid, expired or foreign token. Never throws.
 */
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
    return {
      tenantId: claims.tid,
      actorId: claims.sub,
      kind: claims.kind,
      ...(claims.csid && { cashierSessionId: claims.csid }),
    };
  } catch {
    return null;
  }
}
