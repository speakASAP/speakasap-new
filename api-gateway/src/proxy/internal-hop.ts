/**
 * Stamp Authorization Bearer for the second hop of an internal call.
 *
 * `/api/v1/internal/*` passes two auth boundaries:
 * - gateway `GatewayAuthGuard` (caller Auth RS256 Bearer → `/auth/validate` with
 *   an `internal:*` service role);
 * - upstream InternalAuthGuard (Auth RS256 Bearer, per SERVICE_IDENTITY_CONSUMER_STANDARD).
 *
 * Re-stamping swaps the caller's entry credential for the gateway→target pair JWT
 * (`GATEWAY_TO_<SERVICE>_TOKEN`). Static entry tokens (`GATEWAY_INTERNAL_API_TOKEN`,
 * `x-internal-token`) are deleted.
 */
import { ROUTES } from './upstream-resolve';

const INTERNAL_PREFIX = '/api/v1/internal/';

export function gatewayToServiceTokenEnv(upstreamUrlEnvKey: string): string {
  // USER_SERVICE_URL → GATEWAY_TO_USER_SERVICE_TOKEN
  const base = upstreamUrlEnvKey.replace(/_URL$/, '');
  return `GATEWAY_TO_${base}_TOKEN`;
}

export function resolveInternalHopTokenEnv(pathname: string): string | null {
  for (const { prefix, envKey } of ROUTES) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) {
      if (!prefix.startsWith('/api/v1/internal')) {
        return null;
      }
      return gatewayToServiceTokenEnv(envKey);
    }
  }
  return null;
}

export function applyInternalHopToken(headers: Headers, pathname: string): void {
  // Prefix match with the trailing slash, so `/api/v1/internal-notes` is not treated as
  // an internal route.
  if (!pathname.startsWith(INTERNAL_PREFIX) && pathname !== '/api/v1/internal') {
    return;
  }

  // Never forward the caller's static entry token as upstream identity.
  headers.delete('x-internal-token');
  headers.delete('x-internal-api-key');

  const tokenEnv = resolveInternalHopTokenEnv(pathname);
  if (!tokenEnv) {
    headers.delete('authorization');
    throw new Error(`No GATEWAY_TO_* token mapping for internal path ${pathname}`);
  }

  const jwt = (process.env[tokenEnv] || '').trim();
  if (!jwt) {
    headers.delete('authorization');
    throw new Error(`${tokenEnv} is unset; refuse internal hop to ${pathname}`);
  }

  headers.set('authorization', `Bearer ${jwt}`);
}
