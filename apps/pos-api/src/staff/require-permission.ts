import {
  applyDecorators,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UseGuards,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { SessionRequest } from '../tenancy/decorators';
import type { PosSession } from '../tenancy/session';
import type { Permission } from './permissions';

const REQUIRED = 'pos:requiredPermission';

/** True when the session holds `p`. Owners hold every permission (the session guard sets the list). */
export function hasPermission(session: PosSession, p: Permission): boolean {
  return session.permissions?.includes(p) ?? false;
}

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const p = this.reflector.getAllAndOverride<Permission | undefined>(
      REQUIRED,
      [ctx.getHandler(), ctx.getClass()],
    );
    if (!p) return true;
    const session = ctx.switchToHttp().getRequest<SessionRequest>().posSession;
    if (!session || !hasPermission(session, p)) throw new ForbiddenException();
    return true;
  }
}

/** 403 unless the signed-in actor holds `p`. Runs after the global session guard. */
export const RequirePermission = (p: Permission) =>
  applyDecorators(SetMetadata(REQUIRED, p), UseGuards(PermissionGuard));
