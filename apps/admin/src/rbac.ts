import type { AdminRole } from './auth.js';

const roleRank: Record<AdminRole, number> = {
  read_only: 1,
  ops: 2,
  admin: 3
};

export function isAllowedByRole(requiredRole: AdminRole, actualRole: AdminRole, method: string): boolean {
  if (actualRole === 'read_only' && method.toUpperCase() !== 'GET') {
    return false;
  }

  return roleRank[actualRole] >= roleRank[requiredRole];
}
