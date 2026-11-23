import { PERMISSION_KEYS } from '../middleware/permissions';

/**
 * Who may grant or manage which roles.
 *
 * - Only an OWNER may assign the OWNER or ADMIN role, edit those roles, or
 *   manage (edit, reset password, delete) an OWNER/ADMIN account.
 * - Nobody may change their own role.
 * - Only an OWNER may grant the "*" (everything) permission. Everyone else
 *   can only grant catalog permissions they hold themselves.
 */

export const PRIVILEGED_ROLES = new Set(['OWNER', 'ADMIN']);
export const SYSTEM_ROLE_NAMES = new Set(['OWNER', 'ADMIN', 'MANAGER', 'CASHIER', 'WAITER', 'CHEF', 'INVENTORY_MANAGER', 'DELIVERY']);

export const isOwner = (roleName?: string | null) => roleName === 'OWNER';

/** True if the actor holds every catalog permission (OWNER, ADMIN or a "*" role). */
const holdsAllCatalog = (actorRole: string, actorPermissions: string[]) =>
  isOwner(actorRole) || actorRole === 'ADMIN' || actorPermissions.includes('*');

/**
 * Would giving someone a role with `rolePermissions` hand out more than the
 * actor has? Legacy, non-catalog strings (e.g. "read") grant nothing and are ignored.
 */
export function exceedsActorPermissions(actorRole: string, actorPermissions: string[], rolePermissions: string[]): boolean {
  if (rolePermissions.includes('*')) return !isOwner(actorRole);
  if (holdsAllCatalog(actorRole, actorPermissions)) return false;
  return rolePermissions.some((p) => (PERMISSION_KEYS as readonly string[]).includes(p) && !actorPermissions.includes(p));
}

interface PermissionContext {
  actorPermissions?: string[];
  targetPermissions?: string[];
}

/** Can `actorRole` assign `targetRole` (with its permissions) to someone? */
export function canAssignRole(actorRole: string, targetRole: string, ctx: PermissionContext = {}): boolean {
  if (PRIVILEGED_ROLES.has(targetRole)) return isOwner(actorRole);
  return !exceedsActorPermissions(actorRole, ctx.actorPermissions || [], ctx.targetPermissions || []);
}

/** Can `actorRole` edit/reset/delete an account that currently has `targetRole`? */
export function canManageAccount(actorRole: string, targetRole: string | null | undefined, ctx: PermissionContext = {}): boolean {
  if (targetRole && PRIVILEGED_ROLES.has(targetRole)) return isOwner(actorRole);
  return !exceedsActorPermissions(actorRole, ctx.actorPermissions || [], ctx.targetPermissions || []);
}

/** Can `actorRole` change the definition (permissions, limits) of `roleName`? */
export function canEditRoleDefinition(actorRole: string, roleName: string): boolean {
  if (PRIVILEGED_ROLES.has(roleName)) return isOwner(actorRole);
  return true;
}

/**
 * Drops permissions the actor is not allowed to grant. Returns the kept list
 * and the rejected entries so the caller can report them.
 */
export function filterGrantablePermissions(
  actorRole: string,
  actorPermissions: string[],
  requested: string[],
): { kept: string[]; rejected: string[] } {
  const actorHasAll = holdsAllCatalog(actorRole, actorPermissions);
  const kept: string[] = [];
  const rejected: string[] = [];
  for (const p of requested) {
    if (p === '*') {
      (isOwner(actorRole) ? kept : rejected).push(p);
    } else if (!(PERMISSION_KEYS as readonly string[]).includes(p)) {
      rejected.push(p);
    } else if (actorHasAll || actorPermissions.includes(p)) {
      kept.push(p);
    } else {
      rejected.push(p);
    }
  }
  return { kept, rejected };
}

/** Custom role names must not impersonate system roles (case-insensitive). */
export const isReservedRoleName = (name: string) => SYSTEM_ROLE_NAMES.has(name.trim().toUpperCase());
