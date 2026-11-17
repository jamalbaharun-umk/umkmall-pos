import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { loadEnv } from '../config';
import { IS_PUBLIC, SessionRequest } from './decorators';
import { verifySession } from './session';

// Global: every route needs a valid POS session unless it is marked @Public().
@Injectable()
export class SessionGuard implements CanActivate {
  private readonly secret = loadEnv().POS_SESSION_SECRET;

  constructor(private readonly reflector: Reflector) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest<SessionRequest>();
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    const session = token ? await verifySession(token, this.secret) : null;
    if (!session) throw new UnauthorizedException();
    req.posSession = session;
    return true;
  }
}
