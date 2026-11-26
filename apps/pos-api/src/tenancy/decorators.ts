import {
  createParamDecorator,
  ExecutionContext,
  SetMetadata,
} from '@nestjs/common';
import type { Request } from 'express';
import type { PosSession } from './session';

export const IS_PUBLIC = 'pos:isPublic';

/** Opts a route out of the global session guard (health checks, owner sign-in). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const AGENT_ROUTE = 'pos:agentRoute';

/** A route UMKMall's agent session may call (UMK-1978). Every other route answers it 403: new routes stay closed. */
export const AgentRoute = () => SetMetadata(AGENT_ROUTE, true);

export type SessionRequest = Request & { posSession?: PosSession };

/** The verified session. Take the tenant id from here, never from the body, query or path. */
export const CurrentSession = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): PosSession => {
    const session = ctx.switchToHttp().getRequest<SessionRequest>().posSession;
    if (!session)
      throw new Error(
        'CurrentSession used on a route the session guard did not run on',
      );
    return session;
  },
);
