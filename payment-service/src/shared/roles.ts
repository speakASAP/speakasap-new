import type { AuthContextUser } from './auth.types';

function userRoles(u: AuthContextUser): string[] {
  if (!u.roles) {
    return [];
  }
  if (Array.isArray(u.roles)) {
    return u.roles.map(String);
  }
  if (typeof u.roles === 'object') {
    return Object.values(u.roles as Record<string, unknown>).map(String);
  }
  return [];
}

export function isAdmin(u: AuthContextUser): boolean {
  return u.userType === 'admin' || userRoles(u).includes('admin');
}
