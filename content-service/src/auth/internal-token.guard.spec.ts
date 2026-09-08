import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InternalAuthGuard } from './internal-token.guard';
import { ROLES_KEY } from './roles.decorator';

const ROLE = 'internal:content-service:internal';

function contextFor(headers: Record<string, string>, rolesMeta: { roles: string[] } | undefined) {
  const req = { headers };
  return {
    getHandler: () => ({}),
    getClass: () => ({ name: 'DrillsController' }),
    switchToHttp: () => ({ getRequest: () => req }),
    _rolesMeta: rolesMeta,
  } as never;
}

describe('InternalAuthGuard', () => {
  const originalFetch = globalThis.fetch;
  let guard: InternalAuthGuard;
  let reflector: Reflector;

  beforeEach(() => {
    process.env.AUTH_SERVICE_URL = 'http://auth.test';
    process.env.AUTH_SERVICE_TIMEOUT = '1000';
    reflector = {
      getAllAndOverride: jest.fn((_key: string) => ({ roles: [ROLE] })),
    } as unknown as Reflector;
    guard = new InternalAuthGuard(reflector);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('denies undecorated routes', async () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue(undefined);
    await expect(guard.canActivate(contextFor({ authorization: 'Bearer x' }, undefined))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('rejects x-internal-token (static path deleted)', async () => {
    await expect(
      guard.canActivate(contextFor({ 'x-internal-token': 'static-secret' }, { roles: [ROLE] })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('accepts Auth RS256 bearer with required role', async () => {
    globalThis.fetch = jest.fn(async () =>
      new Response(
        JSON.stringify({
          valid: true,
          user: { id: 'svc-1', email: 'svc-salary-service--content-service@internal.alfares.cz', roles: [ROLE] },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    ) as unknown as typeof fetch;

    await expect(
      guard.canActivate(contextFor({ authorization: 'Bearer jwt-here' }, { roles: [ROLE] })),
    ).resolves.toBe(true);
  });

  it('rejects bearer lacking the required role', async () => {
    globalThis.fetch = jest.fn(async () =>
      new Response(
        JSON.stringify({
          valid: true,
          user: { id: 'svc-1', email: 'other@internal.alfares.cz', roles: ['internal:other:read'] },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    ) as unknown as typeof fetch;

    await expect(
      guard.canActivate(contextFor({ authorization: 'Bearer jwt-here' }, { roles: [ROLE] })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
