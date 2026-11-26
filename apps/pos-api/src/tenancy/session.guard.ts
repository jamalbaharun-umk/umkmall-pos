import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { loadEnv } from '../config';
import { AGENT_ROUTE, IS_PUBLIC, SessionRequest } from './decorators';
import { verifySession } from './session';
import { StaffAccess } from '../staff/staff-access';

// Global: every route needs a valid POS session unless it is marked @Public().
@Injectable()
export class SessionGuard implements CanActivate {
  private readonly secret = loadEnv().POS_SESSION_SECRET;

  constructor(
    private readonly reflector: Reflector,
    private readonly staffAccess: StaffAccess,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest<SessionRequest>();
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    const verified = token ? await verifySession(token, this.secret) : null;
    // U4: cashier sessions must still be live; every session gets its current permissions.
    const session = verified ? await this.staffAccess.resolve(verified) : null;
    if (!session) throw new UnauthorizedException();
    if (
      session.kind === 'agent' &&
      !this.reflector.getAllAndOverride<boolean>(AGENT_ROUTE, [
        ctx.getHandler(),
        ctx.getClass(),
      ])
    )
      throw new ForbiddenException();
    req.posSession = session;
    return true;
  }
}
