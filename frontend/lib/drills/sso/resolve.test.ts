import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveSsoToken } from './resolve';

const SECRET = 'platform-test-secret';
const AUDIENCE = 'speakasap-platform';

function b64url(input: string | Buffer): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function sign(payload: Record<string, unknown>, secret = SECRET, header: Record<string, unknown> = {}) {
  const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT', ...header }));
  const body = b64url(JSON.stringify(payload));
  const mac = createHmac('sha256', secret).update(`${head}.${body}`).digest();
  return `${head}.${body}.${b64url(mac)}`;
}

function claims(overrides: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000);
  return {
    sub: '310740',
    iat: now,
    exp: now + 300,
    aud: AUDIENCE,
    email: 'student@example.com',
    first_name: 'Anna',
    last_name: 'B',
    ...overrides,
  };
}

const validToken = (overrides: Record<string, unknown> = {}) => sign(claims(overrides));
const expiredToken = () => sign(claims({ iat: 1000, exp: 2000 }));
const tokenSignedWith = (secret: string) => sign(claims(), secret);

function algNoneToken() {
  const head = b64url(JSON.stringify({ alg: 'none', typ: 'JWT' }));
  const body = b64url(JSON.stringify(claims()));
  return `${head}.${body}.`;
}

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.stubEnv('SPEAKASAP_PLATFORM_JWT_SECRET', SECRET);
  vi.stubEnv('AUTH_SERVICE_URL', 'http://auth.test');
  vi.stubEnv('INTERNAL_SERVICE_TOKEN', 'internal-token');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('resolveSsoToken', () => {
  it('returns the auth user when the mapping exists', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ authUserId: 'u-1', provisioned: false }) }),
    );

    await expect(resolveSsoToken(validToken())).resolves.toEqual({ authUserId: 'u-1' });
  });

  it('provisions and returns the auth user when no mapping exists', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ authUserId: 'u-new', provisioned: true }) }),
    );

    await expect(resolveSsoToken(validToken())).resolves.toEqual({ authUserId: 'u-new' });
  });

  it('FAILS CLOSED on a 500 — no session, no provisioning', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => 'boom' }),
    );

    await expect(resolveSsoToken(validToken())).resolves.toEqual({ error: 'IDENTITY_UNRESOLVED' });
  });

  it('FAILS CLOSED on a network timeout', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ETIMEDOUT')));

    await expect(resolveSsoToken(validToken())).resolves.toEqual({ error: 'IDENTITY_UNRESOLVED' });
  });

  it('NEVER falls back to the raw numeric sub', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ETIMEDOUT')));

    const result = await resolveSsoToken(validToken({ sub: '310740' }));

    expect(JSON.stringify(result)).not.toContain('310740');
  });

  it('rejects an expired token without calling auth at all', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(resolveSsoToken(expiredToken())).resolves.toEqual({ error: 'EXPIRED' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a token signed with the wrong secret', async () => {
    await expect(resolveSsoToken(tokenSignedWith('other-secret'))).resolves.toEqual({
      error: 'INVALID_TOKEN',
    });
  });

  it('rejects a token for a different audience', async () => {
    await expect(resolveSsoToken(validToken({ aud: 'marathon' }))).resolves.toEqual({
      error: 'WRONG_AUDIENCE',
    });
  });

  it('rejects a token with the alg set to none', async () => {
    await expect(resolveSsoToken(algNoneToken())).resolves.toEqual({ error: 'INVALID_TOKEN' });
  });

  it('rejects a malformed token', async () => {
    await expect(resolveSsoToken('not-a-jwt')).resolves.toEqual({ error: 'INVALID_TOKEN' });
  });

  it('rejects a token whose signature is valid but sub is not a positive integer', async () => {
    await expect(resolveSsoToken(validToken({ sub: 'abc' }))).resolves.toEqual({
      error: 'INVALID_TOKEN',
    });
  });

  it('rejects a token with no email, which could not provision anyway', async () => {
    await expect(resolveSsoToken(validToken({ email: '' }))).resolves.toEqual({
      error: 'INVALID_TOKEN',
    });
  });

  it('sends the internal service headers auth\'s guard requires', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ authUserId: 'u-1', provisioned: false }) });
    vi.stubGlobal('fetch', fetchMock);

    await resolveSsoToken(validToken());

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://auth.test/internal/users/resolve-or-provision-legacy');
    expect(init.headers).toMatchObject({
      'x-internal-service-token': 'internal-token',
      'x-service-name': 'speakasap-frontend',
    });
    expect(JSON.parse(init.body)).toEqual({
      system: 'speakasap-portal',
      legacyUserId: 310740,
      email: 'student@example.com',
      firstName: 'Anna',
      lastName: 'B',
    });
  });

  it('prefers Authorization Bearer when AUTH_SERVICE_TOKEN is set', async () => {
    vi.stubEnv('AUTH_SERVICE_TOKEN', 'rs256-service-jwt');
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ authUserId: 'u-1', provisioned: false }) });
    vi.stubGlobal('fetch', fetchMock);

    await resolveSsoToken(validToken());

    expect(fetchMock.mock.calls[0][1].headers).toMatchObject({
      Authorization: 'Bearer rs256-service-jwt',
    });
    expect(fetchMock.mock.calls[0][1].headers['x-internal-service-token']).toBeUndefined();
  });

  it('fails closed when the platform secret is not configured', async () => {
    vi.stubEnv('SPEAKASAP_PLATFORM_JWT_SECRET', '');

    await expect(resolveSsoToken(validToken())).resolves.toEqual({ error: 'INVALID_TOKEN' });
  });
});
