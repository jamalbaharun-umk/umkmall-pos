import { createRemoteJWKSet, jwtVerify, SignJWT } from 'jose';
import { z } from 'zod';

// The ONLY place a POS session token is signed or verified (guard: test/guards.spec.ts).
// U1 issues owner sessions after the UMKMall handoff; U4 issues cashier sessions after PIN sign-in.

const ISSUER = 'umkmall-pos';
const AUDIENCE = 'pos-api';

const ClaimsSchema = z.object({
  tid: z.string().uuid(), // tenant id — the only source of tenancy for a request
  sub: z.string().min(1), // actor: UMKMall user id (owner) or POS staff id (cashier)
  kind: z.enum(['owner', 'cashier']),
  sid: z.string().min(1).optional(), // UMKMall session id, owner sessions only (liveness refresh)
  csid: z.string().uuid().optional(), // cashier session row (U4); the guard checks it is still live
});

export type PosSession = {
  tenantId: string;
  actorId: string;
  kind: 'owner' | 'cashier';
  /** UMKMall auth session id; present on owner sessions from the handoff, never on cashier sessions. */
  sid?: string;
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
    ...(session.sid ? { sid: session.sid } : {}),
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
    return {
      tenantId: claims.tid,
      actorId: claims.sub,
      kind: claims.kind,
      ...(claims.sid ? { sid: claims.sid } : {}),
      ...(claims.csid && { cashierSessionId: claims.csid }),
    };
  } catch {
    return null;
  }
}

// --- UMKMall handoff token (contract: UMKMall/umkmall#1837, docs/architecture/pos-integration.md there) ---

const HandoffSchema = z.object({
  sub: z.string().uuid(), // UMKMall users.id
  sid: z.string().min(1), // UMKMall auth session id
  jti: z.string().min(1),
  exp: z.number(),
});

export type Handoff = z.infer<typeof HandoffSchema>;

const jwksByUrl = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

/**
 * Verifies a UMKMall handoff token against UMKMall's JWKS (cached; refetched on an unknown kid).
 * Returns the claims, or null for any invalid, expired or foreign token. Never throws.
 * Single use of `jti` is the caller's job (auth controller, inside its transaction).
 */
export async function verifyHandoff(
  token: string,
  jwksUrl: string,
): Promise<Handoff | null> {
  let jwks = jwksByUrl.get(jwksUrl);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(jwksUrl), {
      cacheMaxAge: 5 * 60_000,
      cooldownDuration: 5_000,
      timeoutDuration: 5_000,
    });
    jwksByUrl.set(jwksUrl, jwks);
  }
  try {
    const { payload } = await jwtVerify(token, jwks, {
      issuer: 'umkmall',
      audience: 'pos',
      algorithms: ['EdDSA'],
      requiredClaims: ['exp', 'jti', 'sub'],
      maxTokenAge: '6m', // contract: exp - iat <= 300 s; refuse anything minted long ago
    });
    return HandoffSchema.parse(payload);
  } catch {
    return null;
  }
}
