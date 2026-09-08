import { ContentClient } from './content.client';
import { AiClient } from './ai.client';

const SEARCH_REQ = {
  languageCode: 'de',
  materialLanguage: 'ru',
  topicSlugs: [] as string[],
  limit: 5,
};

describe('ContentClient', () => {
  const fetchMock = jest.fn();
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.resetAllMocks();
    global.fetch = fetchMock as any;
    process.env.CONTENT_SERVICE_URL = 'http://content:4201';
    process.env.EDUCATION_TO_CONTENT_SERVICE_TOKEN = 'rs256-edu-to-content';
    delete process.env.DRILL_CLIENT_TIMEOUT_MS;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('forwards the caller bearer token', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ items: [], totalAvailable: 0 }) });

    await new ContentClient().searchItems(SEARCH_REQ, 'tok-1');

    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer rs256-edu-to-content');
  });

  // The bank routes live behind the gateway's `internal/` prefix, which rejects
  // any request without x-internal-token (api-gateway/src/proxy/gateway-auth.guard.ts).
  // A client that sends only the bearer token gets a 403 from the gateway and the
  // orchestrator concludes the bank is empty — the same failure mode as swallowing a 500.
  it('sends the internal token that the gateway requires on internal routes', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ items: [], totalAvailable: 0 }) });

    await new ContentClient().searchItems(SEARCH_REQ, 'tok-1');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://content:4201/api/v1/internal/drill-items/search');
    expect(init.headers['Authorization']).toBe('Bearer rs256-edu-to-content');
    expect(init.headers['x-internal-token']).toBeUndefined();
  });

  it('throws ServiceUnavailable rather than returning an empty result on 500', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, text: async () => 'boom' });

    await expect(new ContentClient().searchItems(SEARCH_REQ, 'tok')).rejects.toThrow(
      /content-service/i,
    );
  });

  it('times out rather than hanging the generation job', async () => {
    fetchMock.mockImplementation(
      (_url: string, init: any) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    process.env.DRILL_CLIENT_TIMEOUT_MS = '50';

    await expect(new ContentClient().searchItems(SEARCH_REQ, 'tok')).rejects.toThrow(
      /content-service/i,
    );
  });

  it('throws when CONTENT_SERVICE_URL is not configured', async () => {
    delete process.env.CONTENT_SERVICE_URL;

    await expect(new ContentClient().searchItems(SEARCH_REQ, 'tok')).rejects.toThrow(
      /CONTENT_SERVICE_URL/,
    );
  });

  it('requests a vocabulary baseline by course, language and lesson ceiling', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ courseKey: 'de-a1', languageCode: 'de', maxLessonOrder: 3, words: [], index: [] }),
    });

    const baseline = await new ContentClient().getBaseline('de-a1', 'de', 3, 'tok');

    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.pathname).toBe('/api/v1/internal/course-vocabulary');
    expect(url.searchParams.get('courseKey')).toBe('de-a1');
    expect(url.searchParams.get('languageCode')).toBe('de');
    expect(url.searchParams.get('maxLessonOrder')).toBe('3');
    expect(baseline.courseKey).toBe('de-a1');
  });

  it('lists topics from the public drill-topics route', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => [] });

    await new ContentClient().getTopics('de', 'ru', 'tok');

    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.pathname).toBe('/api/v1/drill-topics');
    expect(url.searchParams.get('languageCode')).toBe('de');
    expect(url.searchParams.get('materialLanguage')).toBe('ru');
  });

  it('replaces set items through the internal route', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ uuid: 'set-1' }) });
    const items = [{ template: 'x', blanks: [], hint: null, topicSlug: 't' }];

    await new ContentClient().replaceSetItems(
      'set-1',
      [0, 2],
      items as any,
      { recordRevisionReason: 'REGENERATED' },
      'tok',
    );

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://content:4201/api/v1/internal/drill-sets/set-1/replace-items');
    expect(init.headers['Authorization']).toBe('Bearer rs256-edu-to-content');
    expect(init.headers['x-internal-token']).toBeUndefined();
    const body = JSON.parse(init.body);
    expect(body.positions).toEqual([0, 2]);
    expect(body.recordRevisionReason).toBe('REGENERATED');
  });

  it('patches a set review state through the internal route', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ uuid: 'set-1' }) });

    await new ContentClient().updateSet('set-1', { reviewState: 'PENDING_REVIEW' }, 'tok');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://content:4201/api/v1/internal/drill-sets/set-1/update');
    expect(JSON.parse(init.body).reviewState).toBe('PENDING_REVIEW');
  });

  it('creates a set through the internal route', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ uuid: 'set-1' }) });

    const created = await new ContentClient().createSet(
      {
        uuid: 'set-1',
        title: 'Dative practice',
        languageId: 1,
        materialLanguage: 'ru',
        origin: 'MIXED',
        itemIds: [1, 2],
      },
      'tok',
    );

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://content:4201/api/v1/internal/drill-sets');
    expect(init.method).toBe('POST');
    expect(init.headers['Authorization']).toBe('Bearer rs256-edu-to-content');
    expect(init.headers['x-internal-token']).toBeUndefined();
    expect(JSON.parse(init.body).itemIds).toEqual([1, 2]);
    expect(created.uuid).toBe('set-1');
  });
});

describe('AiClient', () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    jest.resetAllMocks();
    global.fetch = fetchMock as any;
    process.env.AI_SERVICE_URL = 'http://ai-microservice:3380';
    // Required since AiClient mints its own service JWT rather than forwarding
    // the caller's token; without it every call throws before reaching fetch.
    process.env.AI_SERVICE_JWT_SECRET = 'test-secret';
    delete process.env.DRILL_AI_CLIENT_TIMEOUT_MS;
  });

  it('posts generation requests to the teacher-assistant agent', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ items: [], meta: {} }) });

    await new AiClient().generate({ correlationId: 'corr-1' } as any, 'tok-ai');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://ai-microservice:3380/api/teacher-assistant/generate-drill');
    // NOT `Bearer tok-ai`. This assertion previously required the caller's token
    // to be forwarded, which is exactly the defect that made every drill
    // generation fail with `401 Malformed token` in production: ai-microservice
    // verifies a service JWT, not a user token. See ai.client.spec.ts.
    expect(init.headers.Authorization).not.toBe('Bearer tok-ai');
    expect(init.headers.Authorization).toMatch(/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/);
    expect(JSON.parse(init.body).correlationId).toBe('corr-1');
  });

  it('posts validation requests to the validator agent', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ results: [], meta: {} }) });

    await new AiClient().validate({ correlationId: 'corr-2' } as any, 'tok-ai');

    expect(fetchMock.mock.calls[0][0]).toBe(
      'http://ai-microservice:3380/api/teacher-assistant/validate-drill',
    );
  });

  it('throws naming ai-microservice rather than returning zero items on 500', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, text: async () => 'boom' });

    await expect(new AiClient().generate({ correlationId: 'c' } as any, 'tok')).rejects.toThrow(
      /ai-microservice/i,
    );
  });

  // Generation is slow by nature; the AI client must not inherit the content
  // client's 30s budget or every real generation run aborts mid-flight.
  it('allows a longer timeout than the content client by default', async () => {
    expect(new AiClient().timeoutMs()).toBeGreaterThan(new ContentClient().timeoutMs());
  });
});
