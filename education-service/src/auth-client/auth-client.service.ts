import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import type { AuthContextUser } from '../shared/auth.types';

/**
 * Headers for auth-microservice internal routes.
 * Auth-issued per-pair RS256 only (`AUTH_SERVICE_TOKEN` as Bearer).
 * See auth-microservice/docs/SERVICE_IDENTITY_CONSUMER_STANDARD.md.
 */
export function buildAuthServiceHeaders(): Record<string, string> {
  const jwt = (process.env.AUTH_SERVICE_TOKEN || '').trim();
  if (!jwt) {
    throw new Error(
      'AUTH_SERVICE_TOKEN (Auth-minted RS256) required for auth internal calls',
    );
  }
  return { Authorization: `Bearer ${jwt}` };
}

@Injectable()
export class AuthClientService {
  private readonly logger = new Logger(AuthClientService.name);

  /**
   * Resolves legacy student ids to display names in one call.
   *
   * education-service stores `studentId` integers and nothing about the person, so every
   * name it reports has to come from here. Without this the teacher roster returned
   * `name: ''` for all 656 of teacher 10's students and the wizard showed "Student 58".
   *
   * Returns a Map so callers can fill names without a nested scan per student. Ids with
   * no auth mapping are simply absent — the caller decides what an unmapped student
   * should read as, rather than being handed a blank that looks like a real empty name.
   *
   * A failure here degrades the roster to ids rather than failing it: a picker showing
   * "Student 58" is poor, but a teacher who cannot open the picker at all is worse. The
   * error is logged loudly so this does not pass as normal.
   */
  async resolveLegacyNames(legacyUserIds: number[]): Promise<Map<number, string>> {
    const names = new Map<number, string>();
    if (legacyUserIds.length === 0) {
      return names;
    }

    const base = process.env.AUTH_SERVICE_URL!.replace(/\/$/, '');
    const url = `${base}/internal/users/names-by-legacy-ids`;
    const timeoutMs = Number(process.env.AUTH_SERVICE_TIMEOUT);
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...buildAuthServiceHeaders(),
        },
        body: JSON.stringify({ system: 'speakasap-portal', legacyUserIds }),
        signal: controller.signal,
      });
      const durationMs = Date.now() - started;

      if (!res.ok) {
        this.logger.error(
          `names-by-legacy-ids failed status=${res.status} requested=${legacyUserIds.length} duration_ms=${durationMs}`,
        );
        return names;
      }

      const body = (await res.json()) as {
        users?: Array<{ legacyUserId: number; name: string }>;
      };
      for (const user of body.users ?? []) {
        if (typeof user?.legacyUserId === 'number' && user.name) {
          names.set(user.legacyUserId, user.name);
        }
      }
      this.logger.log(
        `names-by-legacy-ids ok requested=${legacyUserIds.length} resolved=${names.size} duration_ms=${durationMs}`,
      );
      return names;
    } catch (err) {
      const durationMs = Date.now() - started;
      this.logger.error(
        `names-by-legacy-ids error requested=${legacyUserIds.length} duration_ms=${durationMs} ${(err as Error).message}`,
      );
      return names;
    } finally {
      clearTimeout(timer);
    }
  }

  async validateAccessToken(token: string): Promise<AuthContextUser> {
    const base = process.env.AUTH_SERVICE_URL!.replace(/\/$/, '');
    const url = `${base}/auth/validate`;
    const timeoutMs = Number(process.env.AUTH_SERVICE_TIMEOUT);
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
        signal: controller.signal,
      });
      const durationMs = Date.now() - started;
      if (!res.ok) {
        this.logger.warn(
          `auth/validate failed status=${res.status} duration_ms=${durationMs}`,
        );
        throw new UnauthorizedException('Invalid token');
      }
      const body = (await res.json()) as { valid?: boolean; user?: Record<string, unknown> };
      const u = body.user;
      if (!u || typeof u !== 'object' || typeof u.id !== 'string') {
        throw new UnauthorizedException('Invalid token');
      }
      this.logger.log(`auth/validate ok duration_ms=${durationMs}`);
      return {
        id: u.id,
        email: (u.email as string) ?? null,
        firstName: (u.firstName as string) ?? null,
        lastName: (u.lastName as string) ?? null,
        phone: (u.phone as string) ?? null,
        userType: String(u.userType || 'end_user'),
        roles: u.roles,
      };
    } catch (err) {
      const durationMs = Date.now() - started;
      if ((err as Error).name === 'AbortError') {
        this.logger.error(`auth/validate timeout duration_ms=${durationMs}`);
      }
      if (err instanceof UnauthorizedException) {
        throw err;
      }
      this.logger.error(`auth/validate error duration_ms=${durationMs} ${(err as Error).message}`);
      throw new UnauthorizedException('Invalid token');
    } finally {
      clearTimeout(timer);
    }
  }
}
