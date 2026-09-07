import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { GatewayAuthGuard } from './gateway-auth.guard';
import type { AuthContextUser } from '../shared/auth.types';

function ctxFor(req: Record<string, unknown>) {
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as never;
}

function reqFor(
  method: string,
  originalUrl: string,
  headers: Record<string, string> = {},
): Record<string, unknown> {
  return { method, originalUrl, headers };
}

function userWith(roles: unknown): AuthContextUser {
  return {
    id: 'user-1',
    email: 'someone@example.com',
    firstName: null,
    lastName: null,
    phone: null,
    userType: 'end_user',
    roles,
  };
}

function guardReturning(user: AuthContextUser) {
  const auth = {
    validateAccessToken: jest.fn(async () => user),
    attachRequestContext: jest.fn(),
  };
  return { guard: new GatewayAuthGuard(auth as never), auth };
}

const BEARER = { authorization: 'Bearer token-abc' };

describe('GatewayAuthGuard — preserved bypasses', () => {
  // These four bypasses are deliberate. Role enforcement must never touch
  // them, so each is asserted to pass with no token at all.
  const { guard, auth } = guardReturning(userWith([]));

  it('lets payment webhooks through without a token', async () => {
    await expect(
      guard.canActivate(ctxFor(reqFor('POST', '/api/v1/webhooks/payments/stripe'))),
    ).resolves.toBe(true);
    expect(auth.validateAccessToken).not.toHaveBeenCalled();
  });

  it('lets the lesson record download through without a token', async () => {
    await expect(
      guard.canActivate(ctxFor(reqFor('GET', '/api/v1/lessons/abc-123/record/download'))),
    ).resolves.toBe(true);
  });

  it('lets public /api/v1/seven GETs through without a token', async () => {
    await expect(guard.canActivate(ctxFor(reqFor('GET', '/api/v1/seven')))).resolves.toBe(true);
    await expect(guard.canActivate(ctxFor(reqFor('GET', '/api/v1/seven/lesson-1')))).resolves.toBe(
      true,
    );
  });

  it('rejects /api/v1/internal without a bearer (no static entry-token fallback)', async () => {
    await expect(
      guard.canActivate(
        ctxFor(
          reqFor('GET', '/api/v1/internal/drill-items/search', {
            'x-api-key': 'secret-internal',
          }),
        ),
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(auth.validateAccessToken).not.toHaveBeenCalled();
  });

  it('rejects a missing bearer token on a normal route', async () => {
    await expect(guard.canActivate(ctxFor(reqFor('GET', '/api/v1/lessons')))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});

describe('GatewayAuthGuard — /api/v1/internal Auth RS256 entry', () => {
  it('admits a JWT with internal:speakasap-api-gateway:*', async () => {
    const { guard, auth } = guardReturning(
      userWith(['internal:speakasap-api-gateway:proxy']),
    );
    const req = reqFor('GET', '/api/v1/internal/drill-items/search', BEARER);
    await expect(guard.canActivate(ctxFor(req))).resolves.toBe(true);
    expect(auth.validateAccessToken).toHaveBeenCalledWith('token-abc');
    expect((req as { serviceActor?: { serviceName: string; authMethod: string } }).serviceActor).toEqual({
      type: 'service',
      serviceName: 'user-1',
      authMethod: 'auth-rs256',
    });
  });

  it('rejects another service internal:* role at gateway entry', async () => {
    const { guard } = guardReturning(userWith(['internal:education-service:drill-read']));
    await expect(
      guard.canActivate(ctxFor(reqFor('GET', '/api/v1/internal/drill-assignments/x', BEARER))),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('forbids a valid human JWT with no gateway internal role', async () => {
    const { guard } = guardReturning(userWith(['app:speakasap:user']));
    await expect(
      guard.canActivate(ctxFor(reqFor('GET', '/api/v1/internal/drill-items/search', BEARER))),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('never trusts x-service-name as identity', async () => {
    const { guard } = guardReturning(userWith(['internal:speakasap-api-gateway:proxy']));
    const req = reqFor('GET', '/api/v1/internal/salary/x', {
      ...BEARER,
      'x-service-name': 'spoofed-caller',
    });
    await expect(guard.canActivate(ctxFor(req))).resolves.toBe(true);
    expect((req as { serviceActor?: { serviceName: string } }).serviceActor?.serviceName).toBe(
      'user-1',
    );
  });
});

describe('GatewayAuthGuard — role enforcement modes', () => {
  const STUDENT = ['app:speakasap:user'];

  afterEach(() => {
    delete process.env.GATEWAY_ROLE_ENFORCEMENT;
  });

  // The default must not change production behaviour on deploy. If this test
  // fails, deploying this commit logs live students out of staff routes they
  // may already be (wrongly) relying on, before anyone has reviewed the data.
  it('defaults to shadow mode and lets a student reach a staff route', async () => {
    const { guard } = guardReturning(userWith(STUDENT));
    await expect(
      guard.canActivate(ctxFor(reqFor('GET', '/api/v1/salary-profiles', BEARER))),
    ).resolves.toBe(true);
  });

  it('denies a student on a staff route once enforcing', async () => {
    process.env.GATEWAY_ROLE_ENFORCEMENT = 'enforce';
    const { guard } = guardReturning(userWith(STUDENT));
    await expect(
      guard.canActivate(ctxFor(reqFor('GET', '/api/v1/salary-profiles', BEARER))),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('still admits an admin on a staff route while enforcing', async () => {
    process.env.GATEWAY_ROLE_ENFORCEMENT = 'enforce';
    const { guard } = guardReturning(userWith(['global:platform_admin']));
    await expect(
      guard.canActivate(ctxFor(reqFor('GET', '/api/v1/salary-profiles', BEARER))),
    ).resolves.toBe(true);
  });

  // The teacher/student overlap is the single most likely way to break a real
  // person: the same human holds both roles.
  it('admits a teacher-and-student account on a teacher route while enforcing', async () => {
    process.env.GATEWAY_ROLE_ENFORCEMENT = 'enforce';
    const { guard } = guardReturning(userWith(['app:speakasap:user', 'app:speakasap:teacher']));
    await expect(guard.canActivate(ctxFor(reqFor('GET', '/api/v1/teachers/9', BEARER)))).resolves.toBe(
      true,
    );
  });

  it('never blocks owner-scoped student routes, in any mode', async () => {
    for (const mode of ['shadow', 'enforce', 'strict']) {
      process.env.GATEWAY_ROLE_ENFORCEMENT = mode;
      const { guard } = guardReturning(userWith(STUDENT));
      await expect(
        guard.canActivate(ctxFor(reqFor('GET', '/api/v1/drill-assignments/mine', BEARER))),
      ).resolves.toBe(true);
    }
  });

  // An unclassified route must not start 403ing mid-rollout just because a new
  // upstream prefix appeared; only strict mode makes it fatal.
  it('allows an undeclared route unless strict', async () => {
    const { guard } = guardReturning(userWith(STUDENT));
    for (const mode of ['shadow', 'enforce']) {
      process.env.GATEWAY_ROLE_ENFORCEMENT = mode;
      await expect(
        guard.canActivate(ctxFor(reqFor('GET', '/api/v1/brand-new-thing', BEARER))),
      ).resolves.toBe(true);
    }
    process.env.GATEWAY_ROLE_ENFORCEMENT = 'strict';
    await expect(
      guard.canActivate(ctxFor(reqFor('GET', '/api/v1/brand-new-thing', BEARER))),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  // A service credential is not a user role. If normalization ever let
  // internal:* through, a leaked service token would satisfy staff routes.
  it('does not let an internal service scope satisfy a staff route', async () => {
    process.env.GATEWAY_ROLE_ENFORCEMENT = 'enforce';
    const { guard } = guardReturning(userWith(['internal:some-service:admin']));
    await expect(
      guard.canActivate(ctxFor(reqFor('GET', '/api/v1/revenue', BEARER))),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
