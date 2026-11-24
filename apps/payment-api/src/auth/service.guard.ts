import {
  BadRequestException,
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createHash, timingSafeEqual } from 'node:crypto';
import { loadEnv } from '../config';

const IS_PUBLIC = 'payment:public';
/** A route with no service key and no tenant (health only). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

type ServiceRequest = {
  headers: Record<string, string | string[] | undefined>;
  tenantId?: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const digest = (s: string) => createHash('sha256').update(s).digest();

/**
 * The only door into payment-api, and the only place that reads the service key and the tenant header.
 * 1. `X-Payment-Service-Key` must equal PAYMENT_SERVICE_KEY (digests compared in constant time).
 * 2. Only then is `X-Tenant-Id` read: the calling service set it from its own session, so it is trusted
 *    exactly as far as the key is. A tenant id anywhere else in the request is never read.
 */
@Injectable()
export class ServiceGuard implements CanActivate {
  private readonly serviceKey = digest(loadEnv().PAYMENT_SERVICE_KEY);

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<ServiceRequest>();
    const key = req.headers['x-payment-service-key'];
    if (
      typeof key !== 'string' ||
      key.length === 0 ||
      !timingSafeEqual(digest(key), this.serviceKey)
    )
      throw new UnauthorizedException({
        message: 'Invalid service key',
        code: 'invalid_service_key',
      });

    const tenant = req.headers['x-tenant-id'];
    if (typeof tenant !== 'string' || !UUID.test(tenant))
      throw new BadRequestException({
        message: 'X-Tenant-Id header must be a uuid',
        code: 'tenant_required',
      });
    req.tenantId = tenant.toLowerCase();
    return true;
  }
}

/** The tenant the calling service vouched for (set by ServiceGuard). */
export const TenantId = createParamDecorator(
  (_: unknown, context: ExecutionContext): string => {
    const { tenantId } = context.switchToHttp().getRequest<ServiceRequest>();
    // Unreachable behind the guard; fail closed if a route is ever wired without it.
    if (!tenantId) throw new UnauthorizedException();
    return tenantId;
  },
);
