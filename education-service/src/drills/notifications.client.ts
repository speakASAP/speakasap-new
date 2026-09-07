import { Injectable } from '@nestjs/common';
import { DrillNotification, NotificationsClient } from './notifications.hook';
import { numericEnv, requestUpstream, requiredEnv } from './orchestration/http';

const UPSTREAM = 'notification-service';

/**
 * HTTP transport for the drill notifications.
 *
 * Targets notification-service's existing `POST /api/v1/dispatch/email`, which takes a
 * template machine name plus a context bag and does its own recipient resolution,
 * preference checks and idempotency. Nothing drill-specific is added there: the
 * two templates are seeded rows, and this is an ordinary caller of a generic route.
 *
 * The `idempotency-key` header is the assignment uuid plus the event. That is a
 * second line of defence only — the hook's conditional UPDATE already makes the
 * send at-most-once — but it also covers the window where the row is claimed and
 * the request is then retried at the transport level.
 *
 * Unlike the orchestration clients this one is called from a fire-and-forget path:
 * `NotificationsHook` catches everything, so a throw here degrades to a logged
 * warning rather than a failed transition. Hence the short timeout — nobody is
 * waiting on the result, and a slow notification service must not hold a
 * request open.
 */
@Injectable()
export class NotificationsClientAdapter implements NotificationsClient {
  async dispatch(notification: DrillNotification): Promise<void> {
    await requestUpstream<unknown>({
      url: `${requiredEnv('NOTIFICATION_SERVICE_URL', UPSTREAM)}/api/v1/dispatch/email`,
      method: 'POST',
      // Sent as Authorization Bearer: Auth RS256 pair JWT
      // (EDUCATION_TO_NOTIFICATION_SERVICE_TOKEN). Static x-internal-token deleted.
      token: requiredEnv('EDUCATION_TO_NOTIFICATION_SERVICE_TOKEN', UPSTREAM),
      body: {
        templateMachineName: notification.template,
        userId: String(notification.recipientId),
        context: {
          ...notification.payload,
          materialLanguage: notification.materialLanguage,
        },
      },
      idempotencyKey: `${notification.template}:${notification.payload.assignmentUuid}`,
      timeoutMs: numericEnv('DRILL_NOTIFICATION_TIMEOUT_MS', 10000),
      upstream: UPSTREAM,
    });
  }

  /**
   * notification-service creates the in-app record itself as part of dispatching,
   * and its `in-app` controller exposes read and mark-read only — there is no
   * create route to call. The hook's separate `createInApp` step is therefore a
   * no-op here rather than a second HTTP call that would duplicate the record.
   */
  async createInApp(): Promise<void> {
    return;
  }
}
