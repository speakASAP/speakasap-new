import { PaymentClientService, DisburseBody } from './payment-client.service';

/**
 * The HTTP client that actually moves money out to a teacher.
 *
 * `disburse` is the only call in this service with an irreversible side effect, and
 * `pollDisburse` is the only thing that ever learns whether that side effect succeeded.
 * Neither had a test. A mishandled response here is how a payout run records an outcome
 * that never happened.
 */

type FetchLike = typeof globalThis.fetch;

const realFetch = globalThis.fetch;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function textResponse(status: number, body: string): Response {
  return new Response(body, { status, headers: { 'Content-Type': 'application/json' } });
}

function stubFetch(impl: (url: string, init?: RequestInit) => Promise<Response>): jest.Mock {
  const mock = jest.fn(async (input: unknown, init?: RequestInit) =>
    impl(String(input), init),
  );
  globalThis.fetch = mock as unknown as FetchLike;
  return mock;
}

const body: DisburseBody = {
  idempotencyKey: 'salary:line-1:disburse',
  legacyPortalUserId: 4210,
  amountMinor: 35000,
  currency: 'CZK',
  metadata: { salaryPayoutLineId: 'line-1', period: '2026-05' },
};

async function messageOf(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
  } catch (error) {
    return (error as Error).message;
  }
  return 'DID_NOT_THROW';
}

describe('PaymentClientService', () => {
  let client: PaymentClientService;
  const envBackup = { ...process.env };

  beforeEach(() => {
    client = new PaymentClientService();
    process.env.PAYMENT_SERVICE_URL = 'http://payment.test';
    process.env.SALARY_TO_PAYMENT_SERVICE_TOKEN = 'tok-internal';
    process.env.HTTP_CLIENT_TIMEOUT_MS = '50';
    jest.spyOn(client['logger'], 'log').mockImplementation(() => undefined);
    jest.spyOn(client['logger'], 'warn').mockImplementation(() => undefined);
    jest.spyOn(client['logger'], 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    process.env = { ...envBackup };
    jest.restoreAllMocks();
  });

  describe('disburse', () => {
    it('refuses to send money when no payment-service URL is configured', async () => {
      delete process.env.PAYMENT_SERVICE_URL;
      const fetchMock = stubFetch(async () => jsonResponse(200, {}));

      expect(await messageOf(() => client.disburse(body, 'key-1'))).toBe(
        'PAYMENT_SERVICE_URL_missing',
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('sends the idempotency key as a header so a retry cannot pay twice', async () => {
      const fetchMock = stubFetch(async () =>
        jsonResponse(200, { payoutRef: 'ref-1', status: 'queued' }),
      );

      await client.disburse(body, 'key-1');

      const init = fetchMock.mock.calls[0][1] as RequestInit;
      const headers = init.headers as Record<string, string>;
      expect(headers['Idempotency-Key']).toBe('key-1');
      expect(headers['Authorization']).toBe('Bearer tok-internal');
      expect(headers['X-Internal-Token']).toBeUndefined();
      expect(JSON.parse(init.body as string)).toEqual(body);
    });

    it('throws with the upstream status when payment-service rejects the disbursement', async () => {
      stubFetch(async () => textResponse(500, 'boom'));

      expect(await messageOf(() => client.disburse(body, 'key-1'))).toBe('payment_disburse_500');
    });

    it('throws rather than returning a payout without a reference', async () => {
      // A missing payoutRef would be stored as the line's payoutRef and the poll would
      // then query /disburse/undefined. The money is already gone at this point, so the
      // run must fail loudly instead of recording a reference it does not have.
      stubFetch(async () => jsonResponse(200, { status: 'queued' }));

      expect(await messageOf(() => client.disburse(body, 'key-1'))).toBe(
        'payment_disburse_malformed_response',
      );
    });

    it('throws a labelled error when the success body is not JSON', async () => {
      stubFetch(async () => textResponse(200, '<html>gateway</html>'));

      expect(await messageOf(() => client.disburse(body, 'key-1'))).toBe(
        'payment_disburse_malformed_response',
      );
    });

    it('logs an error when a disbursement response cannot be parsed', async () => {
      // Without this the one call that moves money can fail with no log line at all.
      const errorLog = jest.spyOn(client['logger'], 'error');
      stubFetch(async () => textResponse(200, 'not json'));

      await messageOf(() => client.disburse(body, 'key-1'));

      expect(errorLog).toHaveBeenCalled();
    });

    it('aborts a hanging request instead of blocking the payout run forever', async () => {
      process.env.HTTP_CLIENT_TIMEOUT_MS = '20';
      stubFetch(
        (_url, init) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () =>
              reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
            );
          }),
      );

      const message = await messageOf(() => client.disburse(body, 'key-1'));

      expect(message).not.toBe('DID_NOT_THROW');
    });
  });

  describe('pollDisburse', () => {
    it('returns as soon as the payment reaches a terminal state', async () => {
      const fetchMock = stubFetch(async () =>
        jsonResponse(200, { payoutRef: 'ref-1', status: 'completed' }),
      );

      expect(await client.pollDisburse('ref-1')).toEqual({
        payoutRef: 'ref-1',
        status: 'completed',
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('reports a failed payment as failed rather than retrying it away', async () => {
      stubFetch(async () => jsonResponse(200, { payoutRef: 'ref-1', status: 'failed' }));

      expect((await client.pollDisburse('ref-1')).status).toBe('failed');
    });

    it('url-encodes the payout reference', async () => {
      const fetchMock = stubFetch(async () =>
        jsonResponse(200, { payoutRef: 'a/b', status: 'completed' }),
      );

      await client.pollDisburse('a/b');

      expect(String(fetchMock.mock.calls[0][0])).toContain('/disburse/a%2Fb');
    });

    it('keeps polling while the payment is still queued, then reports it unresolved', async () => {
      // Genuinely still processing after every attempt is a real answer, not a failure.
      const fetchMock = stubFetch(async () =>
        jsonResponse(200, { payoutRef: 'ref-1', status: 'processing' }),
      );

      expect(await client.pollDisburse('ref-1')).toEqual({
        payoutRef: 'ref-1',
        status: 'processing',
      });
      expect(fetchMock).toHaveBeenCalledTimes(5);
    });

    it('throws when every poll attempt failed instead of reporting "processing"', async () => {
      // THE BUG THIS FILE EXISTS FOR. The money has already left via disburse. If every
      // poll 500s, we never learned the outcome — but returning `processing` makes the
      // caller write PayoutLineStatus.processing, which is indistinguishable from a
      // payment that is genuinely still in flight. An outage must not look like a queue.
      const fetchMock = stubFetch(async () => textResponse(503, 'upstream down'));

      expect(await messageOf(() => client.pollDisburse('ref-1'))).toBe(
        'payment_poll_unresolved_503',
      );
      expect(fetchMock).toHaveBeenCalledTimes(5);
    });

    it('throws when the last attempt failed even if an earlier one only returned a non-terminal status', async () => {
      let attempt = 0;
      stubFetch(async () => {
        attempt += 1;
        return attempt === 1
          ? jsonResponse(200, { payoutRef: 'ref-1', status: 'queued' })
          : textResponse(500, 'down');
      });

      expect(await messageOf(() => client.pollDisburse('ref-1'))).toBe(
        'payment_poll_unresolved_500',
      );
    });

    it('does not treat an unparseable poll body as a resolved payment', async () => {
      stubFetch(async () => textResponse(200, 'not json'));

      expect(await messageOf(() => client.pollDisburse('ref-1'))).toBe(
        'payment_poll_unresolved_malformed_response',
      );
    });

    it('recovers when a later attempt succeeds after an earlier failure', async () => {
      let attempt = 0;
      stubFetch(async () => {
        attempt += 1;
        return attempt < 3
          ? textResponse(502, 'bad gateway')
          : jsonResponse(200, { payoutRef: 'ref-1', status: 'completed' });
      });

      expect(await client.pollDisburse('ref-1')).toEqual({
        payoutRef: 'ref-1',
        status: 'completed',
      });
    });

    it('refuses to poll when no payment-service URL is configured', async () => {
      delete process.env.PAYMENT_SERVICE_URL;

      expect(await messageOf(() => client.pollDisburse('ref-1'))).toBe(
        'PAYMENT_SERVICE_URL_missing',
      );
    });
  });
});
