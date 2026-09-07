import { Injectable, Logger } from '@nestjs/common';

/**
 * Headers for auth-microservice's teacher-grant route.
 * Auth-issued per-pair RS256 only (`AUTH_SERVICE_TOKEN` as Bearer).
 */
function buildAuthServiceHeaders(): Record<string, string> {
  const jwt = (process.env.AUTH_SERVICE_TOKEN || '').trim();
  if (!jwt) {
    throw new Error(
      'AUTH_SERVICE_TOKEN (Auth-minted RS256) required for auth teacher-grant calls',
    );
  }
  return { Authorization: `Bearer ${jwt}` };
}

/**
 * Grants the `app:speakasap:teacher` role through auth-microservice's scoped internal
 * endpoint.
 *
 * That endpoint exists specifically so this service never needs `global:superadmin`: it
 * can grant exactly one role and nothing else, so this client's token cannot be turned
 * into broader role control if user-service is compromised.
 */
@Injectable()
export class TeacherRoleClientService {
  private readonly logger = new Logger(TeacherRoleClientService.name);

  async grantTeacherRole(authUserId: string): Promise<{ granted: boolean }> {
    const base = process.env.AUTH_SERVICE_URL!.replace(/\/$/, '');
    const url = `${base}/internal/roles/speakasap/teacher/${encodeURIComponent(authUserId)}`;
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
        signal: controller.signal,
      });
      const durationMs = Date.now() - started;
      if (!res.ok) {
        const body = await res.text();
        // Never downgrade this to a warn-and-continue: a teacher missing the role cannot
        // reach the teacher portal, and the caller must be able to see that it happened.
        this.logger.error(
          `teacher role grant failed authUserId=${authUserId} status=${res.status} duration_ms=${durationMs} body=${body}`,
        );
        throw new Error(`Teacher role grant failed with status ${res.status}: ${body}`);
      }
      const parsed = (await res.json()) as { granted?: boolean };
      const granted = parsed.granted === true;
      this.logger.log(
        `teacher role grant ok authUserId=${authUserId} granted=${granted} duration_ms=${durationMs}`,
      );
      return { granted };
    } catch (err) {
      const durationMs = Date.now() - started;
      if ((err as Error).name === 'AbortError') {
        this.logger.error(
          `teacher role grant timeout authUserId=${authUserId} duration_ms=${durationMs}`,
        );
        throw new Error(`Teacher role grant timed out after ${timeoutMs}ms`);
      }
      this.logger.error(
        `teacher role grant error authUserId=${authUserId} duration_ms=${durationMs} ${(err as Error).message}`,
      );
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}
