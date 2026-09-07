import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Server-only. Verifies a portal-issued SSO token and resolves it to a platform user.
 *
 * This must never reach the browser bundle: it reads both the platform JWT secret and
 * the internal service token, neither of which a client may hold.
 *
 * ## The rule this module exists to enforce
 *
 * | Resolution result | Action |
 * |---|---|
 * | Mapping found | Issue the session |
 * | 404 / no mapping | Provision from the token's signed claims, then issue the session |
 * | Timeout / 5xx / transport failure | **No session, no provisioning.** Retryable error. |
 *
 * Marathon fails soft to the raw numeric `sub` on a lookup failure
 * (`marathon/src/shared/auth-client.ts:110`). We do not. Provisioning blind during an
 * outage can create a duplicate user for someone already mapped, and an unverified
 * identity would then own graded work.
 */

export type SsoError = 'INVALID_TOKEN' | 'EXPIRED' | 'WRONG_AUDIENCE' | 'IDENTITY_UNRESOLVED';

export type SsoResult = { authUserId: string } | { error: SsoError };

const AUDIENCE = 'speakasap-platform';
const LEGACY_SYSTEM = 'speakasap-portal';
const RESOLVE_TIMEOUT_MS = 5000;

/**
 * Prefers AUTH_SERVICE_TOKEN (RS256). Static INTERNAL_SERVICE_TOKEN only while
 * auth still accepts it. See SERVICE_IDENTITY_CONSUMER_STANDARD.md.
 */
function buildAuthServiceHeaders(): Record<string, string> {
  const jwt = (process.env.AUTH_SERVICE_TOKEN || '').trim();
  if (jwt) {
    return { Authorization: `Bearer ${jwt}` };
  }

  const staticToken = (process.env.INTERNAL_SERVICE_TOKEN || '').trim();
  if (!staticToken) {
    throw new Error(
      'AUTH_SERVICE_TOKEN (RS256) or INTERNAL_SERVICE_TOKEN required for auth SSO calls',
    );
  }

  // eslint-disable-next-line no-console
  console.error(
    '[sso/resolve] AUTH_SERVICE_TOKEN unset; using legacy static internal token as speakasap-frontend',
  );

  return {
    'x-internal-service-token': staticToken,
    'x-service-name': 'speakasap-frontend',
  };
}

interface SsoClaims {
  sub: string;
  exp: number;
  iat: number;
  aud: string;
  email: string;
  first_name?: string;
  last_name?: string;
}

function decodeSegment(segment: string): unknown {
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
}

/**
 * Verifies the signature and returns the claims, or null.
 *
 * The algorithm is taken from our own allowlist and never from the token's header, which
 * is what makes the classic `alg: none` bypass impossible here: a header claiming `none`
 * simply fails HS256 verification rather than skipping it.
 */
function verify(token: string, secret: string): SsoClaims | null {
  const parts = token.split('.');
  if (parts.length !== 3) {
    return null;
  }
  const [head, body, signature] = parts;
  if (!head || !body || !signature) {
    return null;
  }

  let header: { alg?: string };
  let claims: SsoClaims;
  try {
    header = decodeSegment(head) as { alg?: string };
    claims = decodeSegment(body) as SsoClaims;
  } catch {
    return null;
  }

  if (header?.alg !== 'HS256') {
    return null;
  }

  const expected = createHmac('sha256', secret).update(`${head}.${body}`).digest();
  let provided: Buffer;
  try {
    provided = Buffer.from(signature, 'base64url');
  } catch {
    return null;
  }
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return null;
  }

  return claims;
}

export async function resolveSsoToken(token: string): Promise<SsoResult> {
  const secret = process.env.SPEAKASAP_PLATFORM_JWT_SECRET || '';
  if (!secret) {
    // No secret means no token can be trusted. Failing closed here is the only safe
    // reading of a misconfiguration.
    return { error: 'INVALID_TOKEN' };
  }

  const claims = verify(token, secret);
  if (!claims) {
    return { error: 'INVALID_TOKEN' };
  }

  // Expiry before audience: an old token for the right audience is still expired, and
  // "this link has expired" is the more useful thing to tell a student.
  const now = Math.floor(Date.now() / 1000);
  if (typeof claims.exp !== 'number' || claims.exp <= now) {
    return { error: 'EXPIRED' };
  }

  if (claims.aud !== AUDIENCE) {
    return { error: 'WRONG_AUDIENCE' };
  }

  const legacyUserId = Number(claims.sub);
  if (!Number.isInteger(legacyUserId) || legacyUserId <= 0) {
    return { error: 'INVALID_TOKEN' };
  }

  const email = (claims.email || '').trim();
  if (!email) {
    // The portal refuses to issue these, but a token that reached us without an email
    // could not provision, and we do not guess an identity.
    return { error: 'INVALID_TOKEN' };
  }

  const authUrl = (process.env.AUTH_SERVICE_URL || '').replace(/\/$/, '');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), RESOLVE_TIMEOUT_MS);

  try {
    const response = await fetch(`${authUrl}/internal/users/resolve-or-provision-legacy`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...buildAuthServiceHeaders(),
      },
      body: JSON.stringify({
        system: LEGACY_SYSTEM,
        legacyUserId,
        email,
        firstName: claims.first_name || '',
        lastName: claims.last_name || '',
      }),
      signal: controller.signal,
      cache: 'no-store',
    });

    if (!response.ok) {
      // Any non-2xx, including a 404 — auth provisions on a miss, so a 404 here means
      // something else went wrong and we still refuse to guess.
      return { error: 'IDENTITY_UNRESOLVED' };
    }

    const body = (await response.json()) as { authUserId?: string };
    if (!body?.authUserId) {
      return { error: 'IDENTITY_UNRESOLVED' };
    }

    return { authUserId: body.authUserId };
  } catch {
    // Timeout, abort, transport failure, unparseable body. There is no branch here that
    // falls back to claims.sub, and there must never be one.
    return { error: 'IDENTITY_UNRESOLVED' };
  } finally {
    clearTimeout(timeout);
  }
}
