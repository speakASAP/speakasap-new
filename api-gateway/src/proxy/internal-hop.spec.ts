import { applyInternalHopToken, gatewayToServiceTokenEnv } from './internal-hop';

/**
 * Second hop stamps Authorization Bearer from GATEWAY_TO_<SERVICE>_TOKEN
 * (Auth RS256). Static INTERNAL_API_TOKEN / x-internal-token are deleted.
 */
describe('applyInternalHopToken', () => {
  const TOKEN_ENV = 'GATEWAY_TO_EDUCATION_SERVICE_TOKEN';
  const CONTENT_TOKEN_ENV = 'GATEWAY_TO_CONTENT_SERVICE_TOKEN';
  const ORIGINAL = process.env[TOKEN_ENV];
  const ORIGINAL_CONTENT = process.env[CONTENT_TOKEN_ENV];

  afterEach(() => {
    if (ORIGINAL === undefined) {
      delete process.env[TOKEN_ENV];
    } else {
      process.env[TOKEN_ENV] = ORIGINAL;
    }
    if (ORIGINAL_CONTENT === undefined) {
      delete process.env[CONTENT_TOKEN_ENV];
    } else {
      process.env[CONTENT_TOKEN_ENV] = ORIGINAL_CONTENT;
    }
  });

  function headersWith(token?: string): Headers {
    const h = new Headers();
    if (token !== undefined) {
      h.set('x-internal-token', token);
    }
    return h;
  }

  it('maps USER_SERVICE_URL to GATEWAY_TO_USER_SERVICE_TOKEN', () => {
    expect(gatewayToServiceTokenEnv('USER_SERVICE_URL')).toBe('GATEWAY_TO_USER_SERVICE_TOKEN');
  });

  it('replaces entry credential with Authorization Bearer on an internal path', () => {
    process.env[TOKEN_ENV] = 'rs256-gateway-to-education';
    const headers = headersWith('gateway-entry-token');

    applyInternalHopToken(headers, '/api/v1/internal/drill-assignments/by-student/42');

    expect(headers.get('authorization')).toBe('Bearer rs256-gateway-to-education');
    expect(headers.get('x-internal-token')).toBeNull();
  });

  it('never forwards the caller-supplied x-internal-token onward', () => {
    process.env[TOKEN_ENV] = 'rs256-gateway-to-education';
    const headers = headersWith('gateway-entry-token');

    applyInternalHopToken(headers, '/api/v1/internal/drill-assignments/by-teacher/10');

    expect(headers.get('x-internal-token')).toBeNull();
    expect(headers.get('authorization')).not.toContain('gateway-entry-token');
  });

  it('leaves non-internal paths untouched', () => {
    process.env[TOKEN_ENV] = 'rs256-gateway-to-education';
    const headers = headersWith('something');

    applyInternalHopToken(headers, '/api/v1/drill-assignments/a-1/runner');

    expect(headers.get('x-internal-token')).toBe('something');
  });

  it('throws when the pair JWT env is unset', () => {
    delete process.env[TOKEN_ENV];
    const headers = headersWith('gateway-entry-token');

    expect(() =>
      applyInternalHopToken(headers, '/api/v1/internal/drill-assignments/by-student/42'),
    ).toThrow(/GATEWAY_TO_EDUCATION_SERVICE_TOKEN/);
    expect(headers.get('authorization')).toBeNull();
    expect(headers.get('x-internal-token')).toBeNull();
  });

  it('stamps Bearer even when the caller sent no internal header', () => {
    process.env.GATEWAY_TO_CONTENT_SERVICE_TOKEN = 'rs256-gateway-to-content';
    const headers = headersWith();

    applyInternalHopToken(headers, '/api/v1/internal/drill-sets/available-for-me');

    expect(headers.get('authorization')).toBe('Bearer rs256-gateway-to-content');
  });

  it('matches the internal prefix exactly, not a lookalike path', () => {
    process.env[TOKEN_ENV] = 'rs256-gateway-to-education';
    const headers = headersWith('caller');

    applyInternalHopToken(headers, '/api/v1/internal-notes/1');

    expect(headers.get('x-internal-token')).toBe('caller');
  });
});
