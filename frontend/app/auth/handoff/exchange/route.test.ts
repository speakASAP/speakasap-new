import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as sso from '@/lib/drills/sso/resolve';

import { POST } from './route';

function request(body: unknown) {
  return new Request('http://localhost/auth/handoff/exchange', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.stubEnv('AUTH_SERVICE_URL', 'http://auth.test');
  vi.stubEnv('INTERNAL_SERVICE_TOKEN', 'internal-token');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('POST /auth/handoff/exchange', () => {
  it('returns a session when resolution and minting both succeed', async () => {
    vi.spyOn(sso, 'resolveSsoToken').mockResolvedValue({ authUserId: 'u-1' });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ accessToken: 'tok', expiresIn: 43200 }) }),
    );

    const response = await POST(request({ token: 't' }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      authUserId: 'u-1',
      accessToken: 'tok',
      expiresIn: 43200,
    });
  });

  it('calls the session route with the resolved id and the internal headers', async () => {
    vi.spyOn(sso, 'resolveSsoToken').mockResolvedValue({ authUserId: 'u-1' });
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ accessToken: 'tok', expiresIn: 1 }) });
    vi.stubGlobal('fetch', fetchMock);

    await POST(request({ token: 't' }));

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://auth.test/internal/users/u-1/session');
    expect(init.headers).toMatchObject({
      'x-internal-service-token': 'internal-token',
      'x-service-name': 'speakasap-frontend',
    });
  });

  it('prefers Authorization Bearer when AUTH_SERVICE_TOKEN is set', async () => {
    vi.stubEnv('AUTH_SERVICE_TOKEN', 'rs256-service-jwt');
    vi.spyOn(sso, 'resolveSsoToken').mockResolvedValue({ authUserId: 'u-1' });
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ accessToken: 'tok', expiresIn: 1 }) });
    vi.stubGlobal('fetch', fetchMock);

    await POST(request({ token: 't' }));

    expect(fetchMock.mock.calls[0][1].headers).toMatchObject({
      Authorization: 'Bearer rs256-service-jwt',
    });
    expect(fetchMock.mock.calls[0][1].headers['x-internal-service-token']).toBeUndefined();
  });

  it('FAILS CLOSED with 503 when minting fails, even though resolution succeeded', async () => {
    vi.spyOn(sso, 'resolveSsoToken').mockResolvedValue({ authUserId: 'u-1' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));

    const response = await POST(request({ token: 't' }));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: 'IDENTITY_UNRESOLVED' });
  });

  it('FAILS CLOSED when the session call times out', async () => {
    vi.spyOn(sso, 'resolveSsoToken').mockResolvedValue({ authUserId: 'u-1' });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ETIMEDOUT')));

    const response = await POST(request({ token: 't' }));

    expect(response.status).toBe(503);
  });

  it('never returns an accessToken the auth service did not issue', async () => {
    vi.spyOn(sso, 'resolveSsoToken').mockResolvedValue({ authUserId: 'u-1' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));

    const response = await POST(request({ token: 't' }));

    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain('accessToken');
  });

  it('maps a retryable resolution failure to 503', async () => {
    vi.spyOn(sso, 'resolveSsoToken').mockResolvedValue({ error: 'IDENTITY_UNRESOLVED' });

    const response = await POST(request({ token: 't' }));

    expect(response.status).toBe(503);
  });

  it('maps a bad token to 401 and never calls the session route', async () => {
    vi.spyOn(sso, 'resolveSsoToken').mockResolvedValue({ error: 'EXPIRED' });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await POST(request({ token: 't' }));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'EXPIRED' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('400s on a request with no token', async () => {
    const response = await POST(request({}));

    expect(response.status).toBe(400);
  });
});
