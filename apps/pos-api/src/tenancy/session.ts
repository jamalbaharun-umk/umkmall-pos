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
  scp: z.array(z.enum(['pos.read', 'pos.write'])).optional(), // agent scopes the owner consented to
  cid: z.string().max(100).optional(), // UMKMall's consent record behind an agent session
  auth_time: z.number().int().positive().optional(), // owner: when the owner signed in (never set by a refresh)
});

/** What an owner let UMKMall's agent do: read the store, and separately act on it (New Teman AI consent). */
export type AgentScope = 'pos.read' | 'pos.write';

export type PosSession = {
  tenantId: string;
  actorId: string;
  /** `agent`: UMKMall's agent acting for the owner (UMK-1978); it reaches only `@AgentRoute()` routes. */
  kind: 'owner' | 'cashier' | 'agent';
  cashierSessionId?: string;
  /** Agent sessions only: the consented scopes (read is always there) and UMKMall's consent record id. */
  agentScopes?: readonly AgentScope[];
  consentRef?: string;
  /**
   * Owner sessions only (UMK-2054): when the owner SIGNED IN (epoch seconds). Set by a sign-in, never by the
   * refresh of a session, so it says how long ago the owner last came through UMKMall's login. Read it with
   * `freshSignIn`.
   */
  signedInAt?: number;
  /** When the token was signed (epoch seconds), read from the token; the owner's agent revocation compares it. */
  issuedAt?: number;
  /** Set by the session guard per request, never from the token (U4). Owners hold every permission. */
  permissions?: readonly string[];
};

/** Clocks of two pos-api instances may differ by this much: a sign-in this far ahead is still now. */
export const SIGN_IN_SKEW_SECONDS = 5;

/** How long after a sign-in an owner session counts as fresh (UMK-2054). */
export const FRESH_SIGN_IN_SECONDS = 5 * 60;

/**
 * True for an owner session whose sign-in is at most `FRESH_SIGN_IN_SECONDS` old: what resetting or unlocking the
 * owner's own PIN asks for. A refreshed session carries no sign-in time and is never fresh; nor is a sign-in time
 * more than `SIGN_IN_SKEW_SECONDS` in the future.
 */
export function freshSignIn(session: PosSession, now = Date.now()): boolean {
  if (session.kind !== 'owner' || session.signedInAt === undefined)
    return false;
  const age = Math.floor(now / 1000) - session.signedInAt;
  return age >= -SIGN_IN_SKEW_SECONDS && age <= FRESH_SIGN_IN_SECONDS;
}

export async function signSession(
  session: PosSession,
  secret: string,
  ttlSeconds = 15 * 60,
): Promise<string> {
  return new SignJWT({
    tid: session.tenantId,
    kind: session.kind,
    ...(session.cashierSessionId && { csid: session.cashierSessionId }),
    ...(session.agentScopes && { scp: session.agentScopes }),
    ...(session.consentRef && { cid: session.consentRef }),
    ...(session.kind === 'owner' &&
      session.signedInAt !== undefined && { auth_time: session.signedInAt }),
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
      ...(claims.kind === 'owner' &&
        claims.auth_time !== undefined && { signedInAt: claims.auth_time }),
      ...(claims.kind === 'agent' && {
        issuedAt: payload.iat,
        agentScopes: claims.scp ?? ['pos.read'],
        ...(claims.cid && { consentRef: claims.cid }),
      }),
    };
  } catch {
    return null;
  }
}
