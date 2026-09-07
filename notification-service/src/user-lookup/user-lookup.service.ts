import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { notificationHttpException } from '../shared/notification-http.exception';
import { logOperationalFailure } from '../shared/operational-log';

export type NotificationTarget = {
  email: string | null;
  doNotContact: boolean;
};

@Injectable()
export class UserLookupService {
  private readonly logger = new Logger(UserLookupService.name);

  async resolveNotificationTarget(authUserId: string, required: boolean): Promise<NotificationTarget> {
    const base = (process.env.USER_SERVICE_URL || '').replace(/\/$/, '');
    const token = (process.env.NOTIFICATION_TO_USER_SERVICE_TOKEN || '').trim();
    if (!base || !token) {
      if (required) {
        throw notificationHttpException(
          HttpStatus.BAD_REQUEST,
          'NOTIFICATION_VALIDATION_FAILED',
          'Configure USER_SERVICE_URL and NOTIFICATION_TO_USER_SERVICE_TOKEN to resolve userId to email',
          {},
        );
      }
      return { email: null, doNotContact: false };
    }
    const url = `${base}/api/v1/internal/notification-target`;
    const started = Date.now();
    const controller = new AbortController();
    const timeoutMs = Number(process.env.USER_SERVICE_TIMEOUT || process.env.AUTH_SERVICE_TIMEOUT || '5000');
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ authUserId }),
        signal: controller.signal,
      });
      const durationMs = Date.now() - started;
      this.logger.log(
        `${new Date().toISOString()} user-service internal/notification-target duration_ms=${durationMs} status=${res.status}`,
      );
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        logOperationalFailure(this.logger, {
          component: 'user-service',
          operation: 'POST /api/v1/internal/notification-target',
          duration_ms: durationMs,
          httpStatus: res.status,
          errorCode: 'NOTIFICATION_USER_LOOKUP_FAILED',
          message: `Upstream HTTP ${res.status}`,
          responsePreview: text.slice(0, 800),
        });
        throw notificationHttpException(
          HttpStatus.BAD_GATEWAY,
          'NOTIFICATION_USER_LOOKUP_FAILED',
          `user-service returned ${res.status}`,
          { upstreamStatus: res.status, upstreamBodyPreview: text.slice(0, 500) },
        );
      }
      const body = (await res.json()) as NotificationTarget;
      return {
        email: typeof body.email === 'string' ? body.email : null,
        doNotContact: Boolean(body.doNotContact),
      };
    } catch (err) {
      const durationMs = Date.now() - started;
      if ((err as Error).name === 'AbortError') {
        logOperationalFailure(this.logger, {
          component: 'user-service',
          operation: 'POST /api/v1/internal/notification-target',
          duration_ms: durationMs,
          errorCode: 'NOTIFICATION_USER_LOOKUP_TIMEOUT',
          message: 'AbortError (timeout or client abort)',
        });
        this.logger.error(
          `${new Date().toISOString()} user-service lookup timeout duration_ms=${durationMs}`,
        );
      } else if (!(err && typeof err === 'object' && 'getStatus' in err)) {
        logOperationalFailure(this.logger, {
          component: 'user-service',
          operation: 'POST /api/v1/internal/notification-target',
          duration_ms: durationMs,
          errorCode: 'NOTIFICATION_USER_LOOKUP_FAILED',
          message: (err as Error).message?.slice(0, 500) ?? 'unknown_error',
        });
      }
      if (err && typeof err === 'object' && 'getStatus' in err) {
        throw err;
      }
      throw notificationHttpException(
        HttpStatus.BAD_GATEWAY,
        'NOTIFICATION_USER_LOOKUP_FAILED',
        'user-service unreachable',
        { duration_ms: durationMs },
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
