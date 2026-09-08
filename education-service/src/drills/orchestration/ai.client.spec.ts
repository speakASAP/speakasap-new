import { AiClient } from './ai.client';

const TEACHER_TOKEN = 'teacher-bearer-token-must-not-be-sent';
const SERVICE_TOKEN = 'edu-to-ai-rs256-pair-jwt';

function stubFetch(status = 200, body: unknown = { items: [], meta: {} }) {
  const f = jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => 'application/json' },
    json: async () => body,
    text: async () => JSON.stringify(body),
  });
  (global as any).fetch = f;
  return f;
}

const headersOf = (f: jest.Mock): Record<string, string> =>
  (f.mock.calls[0][1] as { headers: Record<string, string> }).headers;

const bearerOf = (f: jest.Mock): string => headersOf(f).Authorization.replace('Bearer ', '');

describe('AiClient', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    process.env = {
      ...OLD_ENV,
      AI_SERVICE_URL: 'http://ai-microservice:3380',
      EDUCATION_TO_AI_SERVICE_TOKEN: SERVICE_TOKEN,
    };
  });

  afterEach(() => {
    process.env = OLD_ENV;
    delete (global as any).fetch;
  });

  it('does NOT send the caller token to ai-microservice', async () => {
    const f = stubFetch();
    await new AiClient().generate({ correlationId: 'c-1' } as never, TEACHER_TOKEN);
    expect(bearerOf(f)).not.toBe(TEACHER_TOKEN);
    expect(JSON.stringify(f.mock.calls[0])).not.toContain(TEACHER_TOKEN);
  });

  it('sends the Auth-issued pair JWT', async () => {
    const f = stubFetch();
    await new AiClient().generate({ correlationId: 'c-1' } as never, TEACHER_TOKEN);
    expect(bearerOf(f)).toBe(SERVICE_TOKEN);
  });

  it('authenticates validate the same way as generate', async () => {
    const f = stubFetch(200, { results: [], meta: {} });
    await new AiClient().validate({ correlationId: 'c-1' } as never, TEACHER_TOKEN);
    expect(bearerOf(f)).toBe(SERVICE_TOKEN);
  });

  it('hits the routes ai-microservice actually exposes', async () => {
    const f = stubFetch();
    await new AiClient().generate({ correlationId: 'c-1' } as never, TEACHER_TOKEN);
    expect(String(f.mock.calls[0][0])).toBe(
      'http://ai-microservice:3380/api/teacher-assistant/generate-drill',
    );
  });

  it('fails loudly when the pair JWT is not configured', async () => {
    delete process.env.EDUCATION_TO_AI_SERVICE_TOKEN;
    stubFetch();
    await expect(
      new AiClient().generate({ correlationId: 'c-1' } as never, TEACHER_TOKEN),
    ).rejects.toThrow(/EDUCATION_TO_AI_SERVICE_TOKEN/);
    expect((global as any).fetch).not.toHaveBeenCalled();
  });
});
