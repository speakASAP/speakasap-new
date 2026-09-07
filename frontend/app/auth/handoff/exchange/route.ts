import { NextResponse } from 'next/server';

import { resolveSsoToken } from '@/lib/drills/sso/resolve';

/**
 * Exchanges a portal SSO token for a platform session.
 *
 * This runs on the server because `resolveSsoToken` needs the platform JWT secret and
 * auth's service credential; the browser holds neither. The token arrives in the
 * request body rather than the URL so it stays out of access logs and referrers.
 *
 * Two calls to auth, and both must succeed before a student is signed in:
 * `resolve-or-provision-legacy` answers *who* the student is, then
 * `POST /internal/users/:userId/session` issues the session. A failure in either one
 * produces IDENTITY_UNRESOLVED — a resolved identity with no session is still no
 * session, and we never mint one locally.
 */

function buildAuthServiceHeaders(): Record<string, string> {
  const jwt = (process.env.AUTH_SERVICE_TOKEN || '').trim();
  if (!jwt) {
    throw new Error(
      'AUTH_SERVICE_TOKEN (Auth-minted RS256) required for auth session mint',
    );
  }
  return { Authorization: `Bearer ${jwt}` };
}

export async function POST(request: Request) {
  let token: string | undefined;
  try {
    const body = (await request.json()) as { token?: string };
    token = body?.token;
  } catch {
    return NextResponse.json({ error: 'INVALID_TOKEN' }, { status: 400 });
  }

  if (!token) {
    return NextResponse.json({ error: 'INVALID_TOKEN' }, { status: 400 });
  }

  const result = await resolveSsoToken(token);

  if ('error' in result) {
    // 503 for the retryable case, so a proxy or a monitor can tell it apart from a
    // token the student can do nothing about.
    const status = result.error === 'IDENTITY_UNRESOLVED' ? 503 : 401;
    return NextResponse.json({ error: result.error }, { status });
  }

  const session = await mintSession(result.authUserId);
  if (!session) {
    return NextResponse.json({ error: 'IDENTITY_UNRESOLVED' }, { status: 503 });
  }

  return NextResponse.json({
    authUserId: result.authUserId,
    accessToken: session.accessToken,
    expiresIn: session.expiresIn,
  });
}

/**
 * Asks auth-microservice for a session for an already-resolved user.
 *
 * Returns null on any failure, which the caller turns into IDENTITY_UNRESOLVED — the
 * same fail-closed rule as resolution itself. Nothing is minted locally: a session this
 * service invented would not be verifiable by any other service in the estate.
 */
async function mintSession(
  authUserId: string,
): Promise<{ accessToken: string; expiresIn?: number } | null> {
  const authUrl = (process.env.AUTH_SERVICE_URL || '').replace(/\/$/, '');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch(
      `${authUrl}/internal/users/${encodeURIComponent(authUserId)}/session`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...buildAuthServiceHeaders(),
        },
        signal: controller.signal,
        cache: 'no-store',
      },
    );
    if (!response.ok) {
      return null;
    }
    const body = (await response.json()) as { accessToken?: string; expiresIn?: number };
    return body?.accessToken ? { accessToken: body.accessToken, expiresIn: body.expiresIn } : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
