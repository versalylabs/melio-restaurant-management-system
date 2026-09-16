import { Request, Response as ExpressResponse, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import prisma from '../config/database';
import { parsePermissions } from './permissions';

export interface AuthRequest extends Request {
  user?: {
    id: string;
    restaurantId: string;
    branchId?: string;
    roleId: string;
    roleName: string;
    permissions: string[];
  };
}

const permissionForRequest = (req: AuthRequest): string | null => {
  const path = `${req.baseUrl}${req.path}`.replace(/\/+/g, '/');
  const method = req.method.toUpperCase();

  if (path.startsWith('/users')) return method === 'GET' ? 'users.view' : 'users.manage';
  if (path.startsWith('/roles')) return 'roles.manage';
  if (path.startsWith('/audit-logs')) return 'audit.view';
  if (path.startsWith('/reports')) return 'reports.view';
  if (path.startsWith('/promotions')) return method === 'GET' ? 'promotions.view' : 'promotions.manage';
  if (path.startsWith('/payments')) return method === 'GET' ? 'payments.view' : 'payments.manage';
  if (path.startsWith('/shifts')) return method === 'GET' ? 'shifts.view' : 'shifts.manage';
  if (path.startsWith('/expenses')) return method === 'GET' ? 'expenses.view' : 'expenses.manage';
  if (path.startsWith('/inventory')) return method === 'GET' ? 'inventory.view' : 'inventory.manage';
  if (path.startsWith('/purchases')) return 'purchases.manage';
  if (path.startsWith('/menu-items') || path.startsWith('/categories') || path.startsWith('/modifier-groups')) return method === 'GET' ? 'menu.view' : 'menu.manage';
  if (path.startsWith('/customers')) return method === 'GET' ? 'customers.view' : 'customers.manage';
  if (path.startsWith('/orders')) return method === 'GET' ? 'orders.view' : 'orders.manage';
  if (path.startsWith('/kitchen')) return method === 'GET' ? 'kitchen.view' : 'kitchen.manage';
  if (path.startsWith('/reservations')) return method === 'GET' ? 'reservations.view' : 'reservations.manage';
  if (path.startsWith('/settings')) return 'settings.manage';
  if (path.startsWith('/dashboard')) return 'dashboard.view';
  return null;
};

export const authenticate = async (req: AuthRequest, res: ExpressResponse, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization;
    // Server-Sent Events/EventSource cannot attach custom Authorization headers.
    // The staff realtime stream therefore accepts the same JWT as a query
    // parameter, while normal API requests remain header-only.
    const isStaffRealtimeStream = req.baseUrl.endsWith('/realtime') && req.path === '/stream';
    const queryToken = isStaffRealtimeStream && typeof req.query.token === 'string' ? req.query.token : undefined;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.split(' ')[1] : queryToken;
    if (!token) {
      return res.status(401).json({ success: false, message: 'Access token required' });
    }
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as { userId: string; restaurantId: string; tokenVersion?: number };

    const user = await prisma.user.findUnique({ where: { id: decoded.userId }, include: { role: true } });
    if (!user || user.status !== 'ACTIVE' || (decoded.tokenVersion ?? 0) !== user.tokenVersion) {
      return res.status(401).json({ success: false, message: 'Invalid or expired token' });
    }

    // Branch context: owners/admins/managers may switch the active branch via
    // X-Branch-Id. Branch-assigned operational staff are always locked to their
    // assigned branch.
    const requestedBranchId = typeof req.headers['x-branch-id'] === 'string'
      ? req.headers['x-branch-id']
      : undefined;
    let effectiveBranchId = user.branchId || undefined;
    const canSwitchBranch = ['OWNER', 'ADMIN', 'MANAGER'].includes(user.role.name);

    if (requestedBranchId && canSwitchBranch) {
      const selectedBranch = await prisma.branch.findFirst({
        where: { id: requestedBranchId, restaurantId: user.restaurantId, status: 'ACTIVE' },
        select: { id: true },
      });
      if (selectedBranch) {
        effectiveBranchId = selectedBranch.id;
      } else {
        const fallback = user.branchId
          ? await prisma.branch.findFirst({ where: { id: user.branchId, restaurantId: user.restaurantId, status: 'ACTIVE' }, select: { id: true } })
          : await prisma.branch.findFirst({ where: { restaurantId: user.restaurantId, status: 'ACTIVE' }, orderBy: { createdAt: 'asc' }, select: { id: true } });
        effectiveBranchId = fallback?.id;
      }
    } else if (requestedBranchId && user.branchId && requestedBranchId !== user.branchId) {
      return res.status(403).json({ success: false, message: 'You can only access your assigned branch' });
    }

    req.user = {
      id: user.id,
      restaurantId: user.restaurantId,
      branchId: effectiveBranchId,
      roleId: user.roleId,
      roleName: user.role.name,
      permissions: parsePermissions(user.role.permissions),
    };
    next();
  } catch {
    return res.status(401).json({ success: false, message: 'Invalid or expired token' });
  }
};

export const authorize = (...allowedRoles: string[]) => {
  return (req: AuthRequest, res: ExpressResponse, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ success: false, message: 'Authentication required' });

    if (allowedRoles.includes(req.user.roleName)) return next();

    const permission = permissionForRequest(req);
    if (permission && (req.user.permissions.includes('*') || req.user.permissions.includes(permission))) return next();

    return res.status(403).json({ success: false, message: 'Insufficient permissions' });
  };
};

export const authorizePermission = (permission: string) => {
  return (req: AuthRequest, res: ExpressResponse, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ success: false, message: 'Authentication required' });
    if (req.user.permissions.includes('*') || req.user.permissions.includes(permission)) return next();
    return res.status(403).json({ success: false, message: 'Insufficient permissions' });
  };
};

export const requireOwnership = (req: AuthRequest, res: ExpressResponse, next: NextFunction) => authorize('OWNER')(req, res, next);
export const requireAdmin = (req: AuthRequest, res: ExpressResponse, next: NextFunction) => authorize('OWNER', 'ADMIN')(req, res, next);
