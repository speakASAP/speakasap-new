import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';

/** Required Auth roles (OR). Used with InternalAuthGuard / JwtOrInternalGuard. */
export const Roles = (...roles: readonly string[]) => SetMetadata(ROLES_KEY, { roles });
