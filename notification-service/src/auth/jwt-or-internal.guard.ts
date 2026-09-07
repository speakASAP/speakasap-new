import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AuthClientService } from '../auth-client/auth-client.service';
import { ROLES_KEY } from './roles.decorator';

/**
 * Accepts a human JWT or an Auth-issued service JWT (both via Bearer).
 *
 * Dispatch has two legitimate callers: gateway user traffic with a human JWT,
 * and education-service background hooks with a per-pair service JWT. Static
 * INTERNAL_API_TOKEN / x-internal-token is deleted — not flag-gated.
 *
 * Presence of an `internal:*` role selects the service path and requires @Roles.
 * Human principals (no `internal:` role) follow the JWT path.
 */
@Injectable()
export class JwtOrInternalGuard implements CanActivate {
  constructor(
    private readonly authClient: AuthClientService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const header = req.headers.authorization;
    if (!header?.toLowerCase().startsWith('bearer ')) {
      throw new UnauthorizedException('Missing bearer token');
    }
    const token = header.slice(7).trim();
    if (!token) {
      throw new UnauthorizedException('Missing bearer token');
    }

    const user = await this.authClient.validateAccessToken(token);
    req.authUser = user;
    this.authClient.attachRequestContext(user);

    const roles = Array.isArray(user.roles)
      ? user.roles.filter((r): r is string => typeof r === 'string')
      : [];
    const isService = roles.some((r) => r.startsWith('internal:'));
    if (!isService) {
      return true;
    }

    const required = this.reflector.getAllAndOverride<{ roles: string[] }>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required?.roles?.length) {
      throw new ForbiddenException('Route is missing an authorization policy');
    }
    if (!required.roles.some((r) => roles.includes(r))) {
      throw new ForbiddenException('Insufficient permissions');
    }
    return true;
  }
}
