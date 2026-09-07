import { AuthClientService, buildAuthServiceHeaders } from './auth-client.service';

/**
 * Pins the credential contract with auth-microservice.
 *
 * Auth internal routes accept Auth-issued per-pair RS256 via Authorization Bearer
 * (`AUTH_SERVICE_TOKEN`) only. Static `x-internal-service-token` was removed.
 *
 * Do not conflate with the api-gateway convention (`x-internal-token`), which
 * `drills/orchestration/http.ts` correctly sends to content-service.
 */

function stubFetch(status = 200, body: unknown = { users: [] }) {
  const f = jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  });
  (global as any).fetch = f;
  return f;
}

const headersOf = (f: jest.Mock): Record<string, string> =>
  (f.mock.calls[0][1] as { headers: Record<string, string> }).headers;

describe('buildAuthServiceHeaders', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    process.env = { ...OLD_ENV };
  });

  afterEach(() => {
    process.env = OLD_ENV;
  });

  it('returns Authorization Bearer when AUTH_SERVICE_TOKEN is set', () => {
    process.env.AUTH_SERVICE_TOKEN = 'rs256-service-jwt';
    expect(buildAuthServiceHeaders()).toEqual({
      Authorization: 'Bearer rs256-service-jwt',
    });
  });

  it('throws when AUTH_SERVICE_TOKEN is unset', () => {
    delete process.env.AUTH_SERVICE_TOKEN;
    expect(() => buildAuthServiceHeaders()).toThrow(/AUTH_SERVICE_TOKEN/);
  });
});

describe('AuthClientService.resolveLegacyNames', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    process.env = {
      ...OLD_ENV,
      AUTH_SERVICE_URL: 'http://auth-microservice:3370',
      AUTH_SERVICE_TIMEOUT: '5000',
      AUTH_SERVICE_TOKEN: 'rs256-service-jwt',
    };
    delete process.env.INTERNAL_SERVICE_TOKEN;
  });

  afterEach(() => {
    process.env = OLD_ENV;
    delete (global as any).fetch;
  });

  it('sends Authorization Bearer only', async () => {
    const f = stubFetch();
    await new AuthClientService().resolveLegacyNames([58]);
    expect(headersOf(f).Authorization).toBe('Bearer rs256-service-jwt');
    expect(headersOf(f)['x-internal-service-token']).toBeUndefined();
    expect(headersOf(f)['x-service-name']).toBeUndefined();
  });

  it('does NOT send the gateway header, which auth ignores', async () => {
    const f = stubFetch();
    await new AuthClientService().resolveLegacyNames([58]);
    expect(headersOf(f)['x-internal-token']).toBeUndefined();
  });

  it('maps returned names by legacy id', async () => {
    stubFetch(200, {
      users: [
        { legacyUserId: 58, name: 'Anna Ivanova' },
        { legacyUserId: 145, name: 'Boris Petrov' },
      ],
    });
    const names = await new AuthClientService().resolveLegacyNames([58, 145]);
    expect(names.get(58)).toBe('Anna Ivanova');
    expect(names.get(145)).toBe('Boris Petrov');
  });

  it('makes no request at all for an empty id list', async () => {
    const f = stubFetch();
    await expect(new AuthClientService().resolveLegacyNames([])).resolves.toEqual(new Map());
    expect(f).not.toHaveBeenCalled();
  });

  // A picker showing ids is poor; one that will not open is worse. Every failure
  // path degrades rather than throwing.
  it('degrades to an empty map on a non-2xx response', async () => {
    stubFetch(401, { message: 'Invalid token' });
    await expect(new AuthClientService().resolveLegacyNames([58])).resolves.toEqual(new Map());
  });

  it('degrades to an empty map when auth is unreachable', async () => {
    (global as any).fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(new AuthClientService().resolveLegacyNames([58])).resolves.toEqual(new Map());
  });

  it('skips entries with no usable name rather than storing blanks', async () => {
    stubFetch(200, {
      users: [
        { legacyUserId: 58, name: '' },
        { legacyUserId: 145, name: 'Boris Petrov' },
      ],
    });
    const names = await new AuthClientService().resolveLegacyNames([58, 145]);
    expect(names.has(58)).toBe(false);
    expect(names.get(145)).toBe('Boris Petrov');
  });

  it('degrades when AUTH_SERVICE_TOKEN is unset (header build throws)', async () => {
    delete process.env.AUTH_SERVICE_TOKEN;
    stubFetch();
    await expect(new AuthClientService().resolveLegacyNames([58])).resolves.toEqual(new Map());
  });
});
