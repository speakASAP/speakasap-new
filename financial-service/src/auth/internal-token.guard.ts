import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { ROLES_KEY } from './roles.decorator';

type ServiceActor = {
  type: 'service';
  serviceName: string;
  authMethod: 'auth-rs256';
  roles: string[];
};

type AuthValidateResponse = {
  valid?: boolean;
  user?: {
    id?: string;
    email?: string;
    roles?: unknown;
  };
};

/**
 * Intra-SpeakASAP machine auth: Auth-issued RS256 Bearer via POST /auth/validate.
 * Static FINANCIAL_INTERNAL_API_TOKEN compares are deleted.
 * See auth-microservice/docs/SERVICE_IDENTITY_CONSUMER_STANDARD.md.
 */
@Injectable()
export class InternalAuthGuard implements CanActivate {
  private readonly logger = new Logger(InternalAuthGuard.name);

  constructor(private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<{ roles: string[] }>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required?.roles?.length) {
      const handler = context.getHandler()?.name ?? 'unknown';
      const controller = context.getClass()?.name ?? 'unknown';
      this.logger.error(
        `Route ${controller}.${handler} has no @Roles; denying request.`,
      );
      throw new ForbiddenException('Route is missing an authorization policy');
    }

    const req = context.switchToHttp().getRequest<Request>();
    const header = req.headers.authorization;
    if (!header?.toLowerCase().startsWith('bearer ')) {
      throw new UnauthorizedException('Missing bearer token');
    }
    const token = header.slice(7).trim();
    if (!token) {
      throw new UnauthorizedException('Missing bearer token');
    }

    const user = await this.validateWithAuth(token);
    const roles = normalizeRoles(user.roles);
    if (!required.roles.some((r) => roles.includes(r))) {
      throw new ForbiddenException('Insufficient permissions');
    }

    (req as Request & { serviceActor?: ServiceActor }).serviceActor = {
      type: 'service',
      serviceName: user.email?.trim() || user.id || 'service',
      authMethod: 'auth-rs256',
      roles,
    };
    return true;
  }

  private async validateWithAuth(
    token: string,
  ): Promise<NonNullable<AuthValidateResponse['user']>> {
    const base = (
      process.env.AUTH_SERVICE_URL || process.env.AUTH_MICROSERVICE_URL || ''
    ).replace(/\/$/, '');
    if (!base) {
      throw new UnauthorizedException('AUTH_SERVICE_URL is not set');
    }
    const timeoutMs = Number(process.env.AUTH_SERVICE_TIMEOUT) || 5000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${base}/auth/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new UnauthorizedException('Invalid token');
      }
      const body = (await res.json()) as AuthValidateResponse;
      if (!body.valid || !body.user) {
        throw new UnauthorizedException('Invalid token');
      }
      return body.user;
    } catch (err) {
      if (err instanceof UnauthorizedException) {
        throw err;
      }
      this.logger.error(
        `auth/validate unreachable: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw new UnauthorizedException('Invalid token');
    } finally {
      clearTimeout(timer);
    }
  }
}

function normalizeRoles(roles: unknown): string[] {
  if (!Array.isArray(roles)) {
    return [];
  }
  return roles.filter((r): r is string => typeof r === 'string');
}
