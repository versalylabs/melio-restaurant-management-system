import prisma from '../config/database';
import { AuthRequest } from '../middleware/auth';
import { PERMISSIONS, parsePermissions } from '../middleware/permissions';
import { sendResponse, sendError } from '../utils/response';
import { Response as ExpressResponse } from 'express';
import { createAuditLog } from '../services/auditLogService';

const normalizePermissions = (value: unknown): string[] => {
  if (Array.isArray(value)) return [...new Set(value.filter((p): p is string => typeof p === 'string'))];
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? [...new Set(parsed.filter((p): p is string => typeof p === 'string'))] : [];
    } catch { return []; }
  }
  return [];
};

export const getPermissionCatalog = async (_req: AuthRequest, res: ExpressResponse) =>
  sendResponse(res, true, 'Permission catalog retrieved', { permissions: PERMISSIONS });

export const getRoles = async (req: AuthRequest, res: ExpressResponse) => {
  const roles = await prisma.role.findMany({ orderBy: { name: 'asc' }, include: { _count: { select: { users: true } } } });
  return sendResponse(res, true, 'Roles retrieved', { roles: roles.map((r) => ({
    id: r.id, name: r.name, description: r.description, permissions: parsePermissions(r.permissions), maxDiscountPercent: r.maxDiscountPercent, maxDiscountAmount: r.maxDiscountAmount,
    isSystem: r.isSystem, userCount: r._count.users, createdAt: r.createdAt, updatedAt: r.updatedAt,
  })) });
};

export const createRole = async (req: AuthRequest, res: ExpressResponse) => {
  const { name, description, permissions, maxDiscountPercent, maxDiscountAmount } = req.body as { name: string; description?: string; permissions?: unknown; maxDiscountPercent?: number; maxDiscountAmount?: number };
  if (!name?.trim()) return sendError(res, 'Role name is required');
  const existing = await prisma.role.findUnique({ where: { name: name.trim() } });
  if (existing) return sendError(res, 'Role with this name already exists');
  const normalized = normalizePermissions(permissions);
  const role = await prisma.role.create({ data: { name: name.trim(), description, permissions: JSON.stringify(normalized), isSystem: false, maxDiscountPercent: typeof maxDiscountPercent === 'number' && Number.isFinite(maxDiscountPercent) ? Math.max(0, Math.min(100, maxDiscountPercent!)) : 100, maxDiscountAmount: typeof maxDiscountAmount === 'number' && Number.isFinite(maxDiscountAmount) ? Math.max(0, maxDiscountAmount!) : 1000000 } });
  await createAuditLog(req.user!.restaurantId, req.user!.id, 'CREATE', 'Role', role.id, `Created role ${role.name}`, { permissions: normalized });
  return sendResponse(res, true, 'Role created successfully', { id: role.id, name: role.name, description: role.description, permissions: normalized, maxDiscountPercent: role.maxDiscountPercent, maxDiscountAmount: role.maxDiscountAmount, isSystem: role.isSystem, createdAt: role.createdAt }, 201);
};

export const updateRole = async (req: AuthRequest, res: ExpressResponse) => {
  const { id } = req.params;
  const role = await prisma.role.findUnique({ where: { id } });
  if (!role) return sendError(res, 'Role not found', undefined, 404);
  const { name, description, permissions, maxDiscountPercent, maxDiscountAmount } = req.body as { name?: string; description?: string; permissions?: unknown; maxDiscountPercent?: number; maxDiscountAmount?: number };
  if (role.isSystem && name && name !== role.name) return sendError(res, 'System role names cannot be changed');
  const normalized = permissions === undefined ? parsePermissions(role.permissions) : normalizePermissions(permissions);
  const updated = await prisma.role.update({ where: { id }, data: { name: role.isSystem ? role.name : (name?.trim() || role.name), description, permissions: JSON.stringify(normalized), maxDiscountPercent: typeof maxDiscountPercent === 'number' && Number.isFinite(maxDiscountPercent) ? Math.max(0, Math.min(100, maxDiscountPercent!)) : role.maxDiscountPercent, maxDiscountAmount: typeof maxDiscountAmount === 'number' && Number.isFinite(maxDiscountAmount) ? Math.max(0, maxDiscountAmount!) : role.maxDiscountAmount } });
  await createAuditLog(req.user!.restaurantId, req.user!.id, 'UPDATE', 'Role', id, `Updated role ${updated.name}`, { permissions: normalized });
  return sendResponse(res, true, 'Role updated successfully', { id: updated.id, name: updated.name, description: updated.description, permissions: normalized, maxDiscountPercent: updated.maxDiscountPercent, maxDiscountAmount: updated.maxDiscountAmount, isSystem: updated.isSystem, createdAt: updated.createdAt, updatedAt: updated.updatedAt });
};

export const deleteRole = async (req: AuthRequest, res: ExpressResponse) => {
  const { id } = req.params;
  const role = await prisma.role.findUnique({ where: { id }, include: { _count: { select: { users: true } } } });
  if (!role) return sendError(res, 'Role not found', undefined, 404);
  if (role.isSystem) return sendError(res, 'Cannot delete system roles');
  if (role._count.users > 0) return sendError(res, 'Cannot delete a role assigned to users. Reassign those users first.');
  await prisma.role.delete({ where: { id } });
  await createAuditLog(req.user!.restaurantId, req.user!.id, 'DELETE', 'Role', id, `Deleted role ${role.name}`);
  return sendResponse(res, true, 'Role deleted successfully');
};
