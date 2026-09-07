import { AuthClientService } from './auth-client.service';

/**
 * Pins the credential contract with auth-microservice.
 *
 * There are two different internal-auth conventions in this ecosystem and both
 * are legitimate:
 *
 *   - the api-gateway checks `x-internal-token` (gateway-auth.guard.ts), which
 *     is what `drills/orchestration/http.ts` sends to content-service;
 *   - auth-microservice checks `x-internal-service-token` plus `x-service-name`
 *     against a TRUSTED_INTERNAL_SERVICES allowlist
 *     (auth/guards/internal-service.guard.ts).
 *
 * This client used to send the gateway's header to auth-microservice, so every
 * name lookup came back `401 Invalid internal service token` and the whole
 * roster silently degraded to ids (production, 2026-08-03). The tests below
 * exist so the two conventions cannot be conflated again.
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

describe('AuthClientService.resolveLegacyNames', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    process.env = {
      ...OLD_ENV,
      AUTH_SERVICE_URL: 'http://auth-microservice:3370',
      AUTH_SERVICE_TIMEOUT: '5000',
      INTERNAL_SERVICE_TOKEN: 'service-token',
      SERVICE_NAME: 'education-service',
    };
    delete process.env.AUTH_SERVICE_TOKEN;
  });

  afterEach(() => {
    process.env = OLD_ENV;
    delete (global as any).fetch;
  });

  it('sends the header auth-microservice actually checks', () => {
    const f = stubFetch();
    return new AuthClientService().resolveLegacyNames([58]).then(() => {
      expect(headersOf(f)['x-internal-service-token']).toBe('service-token');
    });
  });

  it('prefers Authorization Bearer when AUTH_SERVICE_TOKEN is set', async () => {
    process.env.AUTH_SERVICE_TOKEN = 'rs256-service-jwt';
    const f = stubFetch();
    await new AuthClientService().resolveLegacyNames([58]);
    expect(headersOf(f).Authorization).toBe('Bearer rs256-service-jwt');
    expect(headersOf(f)['x-internal-service-token']).toBeUndefined();
  });

  // The allowlist is checked separately from the token: a correct token with no
  // x-service-name is rejected with "Service is not trusted" once
  // TRUSTED_INTERNAL_SERVICES is non-empty.
  it('identifies itself so the trusted-services allowlist can match', async () => {
    const f = stubFetch();
    await new AuthClientService().resolveLegacyNames([58]);
    expect(headersOf(f)['x-service-name']).toBe('education-service');
  });

  // SERVICE_NAME is the Kubernetes deployment name, `speakasap-education`, which
  // is NOT what the allowlist is keyed on. Reading it here sent the deployment
  // name and every call 401'd with "Service is not trusted" — a message the
  // caller sees only as a generic 401, indistinguishable from a bad token.
  it('sends its caller identity, not the K8s deployment name', async () => {
    process.env.SERVICE_NAME = 'speakasap-education';
    const f = stubFetch();
    await new AuthClientService().resolveLegacyNames([58]);
    expect(headersOf(f)['x-service-name']).toBe('education-service');
    expect(headersOf(f)['x-service-name']).not.toBe('speakasap-education');
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
    stubFetch(401, { message: 'Invalid internal service token' });
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
});
