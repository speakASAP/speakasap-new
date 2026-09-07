import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthClientService } from '../auth-client/auth-client.service';
import { JwtOrInternalGuard } from './jwt-or-internal.guard';
import { ROLES_KEY } from './roles.decorator';

const contextFor = (
  headers: Record<string, string>,
  rolesMeta?: { roles: string[] },
): ExecutionContext => {
  const req = { headers, header: (n: string) => headers[n.toLowerCase()], authUser: undefined };
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext;
};

describe('JwtOrInternalGuard', () => {
  const authClient = {
    validateAccessToken: jest.fn(),
    attachRequestContext: jest.fn(),
  } as unknown as AuthClientService;
  const reflector = {
    getAllAndOverride: jest.fn(),
  } as unknown as Reflector;
  const guard = new JwtOrInternalGuard(authClient, reflector);

  beforeEach(() => {
    jest.resetAllMocks();
    (reflector.getAllAndOverride as jest.Mock).mockImplementation((key: string) => {
      if (key === ROLES_KEY) {
        return { roles: ['internal:notification-service:dispatch'] };
      }
      return undefined;
    });
  });

  it('rejects x-internal-token (static path deleted)', async () => {
    await expect(
      guard.canActivate(contextFor({ 'x-internal-token': 'internal-secret' })),
    ).rejects.toThrow(UnauthorizedException);
    expect(authClient.validateAccessToken).not.toHaveBeenCalled();
  });

  it('rejects a request with neither credential despite @Public() on the controller', async () => {
    await expect(guard.canActivate(contextFor({}))).rejects.toThrow(UnauthorizedException);
  });

  it('validates a human bearer token', async () => {
    (authClient.validateAccessToken as jest.Mock).mockResolvedValue({
      id: 'u1',
      roles: ['app:speakasap:user'],
    });

    await expect(
      guard.canActivate(contextFor({ authorization: 'Bearer jwt-1' })),
    ).resolves.toBe(true);
    expect(authClient.validateAccessToken).toHaveBeenCalledWith('jwt-1');
  });

  it('admits a service JWT with the dispatch role', async () => {
    (authClient.validateAccessToken as jest.Mock).mockResolvedValue({
      id: 'svc-1',
      roles: ['internal:notification-service:dispatch'],
    });

    await expect(
      guard.canActivate(contextFor({ authorization: 'Bearer rs256-service' })),
    ).resolves.toBe(true);
  });

  it('rejects a service JWT missing the required role', async () => {
    (authClient.validateAccessToken as jest.Mock).mockResolvedValue({
      id: 'svc-1',
      roles: ['internal:notification-service:other'],
    });

    await expect(
      guard.canActivate(contextFor({ authorization: 'Bearer rs256-service' })),
    ).rejects.toThrow(ForbiddenException);
  });

  it('rejects an invalid bearer token', async () => {
    (authClient.validateAccessToken as jest.Mock).mockRejectedValue(
      new UnauthorizedException('Invalid token'),
    );

    await expect(
      guard.canActivate(contextFor({ authorization: 'Bearer bad' })),
    ).rejects.toThrow(UnauthorizedException);
  });
});
