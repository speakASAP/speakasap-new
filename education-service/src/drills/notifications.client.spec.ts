import { NotificationsClientAdapter } from './notifications.client';
import { DrillNotification } from './notifications.hook';

const NOTIFICATION: DrillNotification = {
  template: 'drill_assignment_assigned',
  recipientId: 42,
  materialLanguage: 'ru',
  payload: { assignmentUuid: 'assignment-1' },
} as DrillNotification;

describe('NotificationsClientAdapter', () => {
  const fetchMock = jest.fn();
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.resetAllMocks();
    global.fetch = fetchMock as any;
    process.env.NOTIFICATION_SERVICE_URL = 'http://speakasap-notification:4209';
    process.env.EDUCATION_TO_NOTIFICATION_SERVICE_TOKEN = 'rs256-edu-to-notification';
    delete process.env.DRILL_NOTIFICATION_TIMEOUT_MS;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  // notification-service sets a global prefix of `api/v1` excluding only `health`
  // (notification-service/src/main.ts). A client that posts to the bare
  // `/dispatch/email` gets a 404 that the hook swallows into a warning, so every
  // drill email silently stops being sent. This pins the prefix so that regression
  // fails here rather than in production six weeks later.
  it('posts to the api/v1-prefixed dispatch route', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });

    await new NotificationsClientAdapter().dispatch(NOTIFICATION);

    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe('http://speakasap-notification:4209/api/v1/dispatch/email');
  });

  it('sends the idempotency key so a retried transport does not double-send', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });

    await new NotificationsClientAdapter().dispatch(NOTIFICATION);

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers['idempotency-key']).toBe(
      'drill_assignment_assigned:assignment-1',
    );
  });

  it('throws rather than reporting success when dispatch fails', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404, text: async () => 'Cannot POST' });

    await expect(new NotificationsClientAdapter().dispatch(NOTIFICATION)).rejects.toThrow(
      /notification-service/i,
    );
  });
});
