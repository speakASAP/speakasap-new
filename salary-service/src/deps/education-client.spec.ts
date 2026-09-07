import { EducationClientService } from './education-client.service';

/**
 * The HTTP client that supplies the lesson hours every payout is computed from.
 *
 * Nothing here moves money directly, but a mishandled response is how a calculation run
 * gets wrong inputs — and wrong inputs become real payments one step later. The empty
 * result this client returns on an unimplemented endpoint is deliberately fail-soft; the
 * tests below pin the flag that keeps it from silently becoming a zero-hours payout.
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
  const mock = jest.fn(async (input: unknown, init?: RequestInit) => impl(String(input), init));
  globalThis.fetch = mock as unknown as FetchLike;
  return mock;
}

async function messageOf(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
  } catch (error) {
    return (error as Error).message;
  }
  return 'DID_NOT_THROW';
}

const item = {
  legacyPortalUserId: 4210,
  finishedLessonCount: 12,
  totalMinutes: 540,
};

describe('EducationClientService', () => {
  let client: EducationClientService;
  const envBackup = { ...process.env };

  beforeEach(() => {
    client = new EducationClientService();
    process.env.EDUCATION_SERVICE_URL = 'http://education.test';
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

  describe('request shape', () => {
    it('sends the period, the requested teachers and the internal token', async () => {
      const fetchMock = stubFetch(async () => jsonResponse(200, { items: [item] }));

      await client.fetchPeriodAggregates('2026-05', [4210, 4211], 'tok-internal');

      const url = new URL(String(fetchMock.mock.calls[0][0]));
      expect(url.pathname).toBe('/api/v1/internal/salary/period-aggregates');
      expect(url.searchParams.get('period')).toBe('2026-05');
      expect(url.searchParams.get('legacyPortalUserIds')).toBe('4210,4211');
      const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
      expect(headers['X-Internal-Token']).toBeUndefined();
      expect(headers['Authorization']).toBe('Bearer tok-internal');
    });

    it('omits the teacher filter when no teachers were requested', async () => {
      const fetchMock = stubFetch(async () => jsonResponse(200, { items: [] }));

      await client.fetchPeriodAggregates('2026-05', [], 'tok-internal');

      const url = new URL(String(fetchMock.mock.calls[0][0]));
      expect(url.searchParams.has('legacyPortalUserIds')).toBe(false);
    });

    it('does not double the slash when the configured base URL has a trailing one', async () => {
      process.env.EDUCATION_SERVICE_URL = 'http://education.test/';
      const fetchMock = stubFetch(async () => jsonResponse(200, { items: [] }));

      await client.fetchPeriodAggregates('2026-05', [], 'tok');

      expect(String(fetchMock.mock.calls[0][0])).toContain(
        'http://education.test/api/v1/internal/salary/period-aggregates',
      );
    });
  });

  describe('successful response', () => {
    it('keys the aggregates by teacher so a calculation line can find its own hours', async () => {
      stubFetch(async () =>
        jsonResponse(200, { items: [item, { ...item, legacyPortalUserId: 4211, totalMinutes: 60 }] }),
      );

      const result = await client.fetchPeriodAggregates('2026-05', [4210, 4211], 'tok');

      expect(result.items.get(4210)?.totalMinutes).toBe(540);
      expect(result.items.get(4211)?.totalMinutes).toBe(60);
      expect(result.items.size).toBe(2);
    });

    it('passes readiness, blocker samples and warnings through to the caller', async () => {
      // These are what gate a calculation run. Dropping them would let a run proceed on
      // aggregates the upstream already flagged as not ready.
      stubFetch(async () =>
        jsonResponse(200, {
          items: [item],
          meta: {
            readiness: { salaryCalculationReady: false, shortRecordCount: 6 },
            blockerSamples: [{ reason: 'short_record', lessonUuid: 'uuid-1' }],
            warnings: ['six short recordings'],
          },
        }),
      );

      const result = await client.fetchPeriodAggregates('2026-05', [4210], 'tok');

      expect(result.readiness).toEqual({ salaryCalculationReady: false, shortRecordCount: 6 });
      expect(result.blockerSamples).toHaveLength(1);
      expect(result.warnings).toEqual(['six short recordings']);
    });

    it('defaults missing metadata to empty rather than undefined', async () => {
      stubFetch(async () => jsonResponse(200, { items: [item] }));

      const result = await client.fetchPeriodAggregates('2026-05', [4210], 'tok');

      expect(result.readiness).toEqual({});
      expect(result.blockerSamples).toEqual([]);
      expect(result.warnings).toEqual([]);
    });

    it('returns an empty map when the response carries no items at all', async () => {
      stubFetch(async () => jsonResponse(200, {}));

      const result = await client.fetchPeriodAggregates('2026-05', [4210], 'tok');

      expect(result.items.size).toBe(0);
    });
  });

  describe('failure handling', () => {
    it('marks the period not ready when the endpoint is unconfigured', async () => {
      // Fail-soft is allowed here only because salaryCalculationReady:false blocks the run.
      delete process.env.EDUCATION_SERVICE_URL;
      const fetchMock = stubFetch(async () => jsonResponse(200, { items: [item] }));

      const result = await client.fetchPeriodAggregates('2026-05', [4210], 'tok');

      expect(fetchMock).not.toHaveBeenCalled();
      expect(result.readiness.salaryCalculationReady).toBe(false);
      expect(result.warnings).toEqual(['EDUCATION_SERVICE_URL unset']);
      expect(result.items.size).toBe(0);
    });

    it.each([404, 501])(
      'marks the period not ready when the endpoint is not implemented (%i)',
      async (status) => {
        stubFetch(async () => textResponse(status, 'nope'));

        const result = await client.fetchPeriodAggregates('2026-05', [4210], 'tok');

        expect(result.readiness.salaryCalculationReady).toBe(false);
        expect(result.warnings).toEqual([`education_http_${status}`]);
        expect(result.items.size).toBe(0);
      },
    );

    it.each([400, 401, 403, 500, 502, 503])(
      'throws on an unexpected upstream status (%i) instead of reporting zero hours',
      async (status) => {
        // An empty aggregate is a payout of nothing. Any status we do not explicitly
        // understand must reach the caller as a failure.
        stubFetch(async () => textResponse(status, 'boom'));

        expect(await messageOf(() => client.fetchPeriodAggregates('2026-05', [4210], 'tok'))).toBe(
          `education_http_${status}`,
        );
      },
    );

    it('throws rather than returning zero hours when the body is not JSON', async () => {
      stubFetch(async () => textResponse(200, '<html>gateway timeout</html>'));

      expect(await messageOf(() => client.fetchPeriodAggregates('2026-05', [4210], 'tok'))).not.toBe(
        'DID_NOT_THROW',
      );
    });

    it('logs at error level when a request fails', async () => {
      const errorLog = jest.spyOn(client['logger'], 'error');
      stubFetch(async () => textResponse(500, 'boom'));

      await messageOf(() => client.fetchPeriodAggregates('2026-05', [4210], 'tok'));

      expect(errorLog).toHaveBeenCalled();
    });

    it('aborts a hanging request instead of stalling the calculation run', async () => {
      process.env.HTTP_CLIENT_TIMEOUT_MS = '20';
      stubFetch(
        (_url, init) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () =>
              reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
            );
          }),
      );

      expect(await messageOf(() => client.fetchPeriodAggregates('2026-05', [4210], 'tok'))).not.toBe(
        'DID_NOT_THROW',
      );
    });

    it('propagates a transport failure rather than swallowing it into empty aggregates', async () => {
      stubFetch(async () => {
        throw new Error('ECONNREFUSED');
      });

      expect(await messageOf(() => client.fetchPeriodAggregates('2026-05', [4210], 'tok'))).toBe(
        'ECONNREFUSED',
      );
    });
  });
});
