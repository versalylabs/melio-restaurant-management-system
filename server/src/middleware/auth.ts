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

const viewOrManage = (method: string, view: string, manage: string) => (method === 'GET' ? view : manage);

/**
 * Maps a staff API request to the permission key (see middleware/permissions.ts)
 * that grants it to custom roles. `authorize(...roles)` allows the listed
 * system roles OR any role holding this permission.
 *
 * Every router mounted in routes/index.ts that uses authorize() must have an
 * entry here; src/__tests__/platform.test.ts enforces that.
 */
export const permissionForPath = (rawPath: string, rawMethod: string): string | null => {
  // req.baseUrl includes the app-level "/api" mount; strip it before matching.
  const path = rawPath.replace(/\/+/g, '/').replace(/^\/api(?=\/|$)/, '');
  const method = rawMethod.toUpperCase();
  const is = (prefix: string) => path === prefix || path.startsWith(`${prefix}/`);

  if (is('/users')) return viewOrManage(method, 'users.view', 'users.manage');
  if (is('/roles')) return 'roles.manage';
  if (is('/audit-logs')) return 'audit.view';
  if (is('/reports') || is('/analytics')) return 'reports.view';
  if (is('/promotions')) return viewOrManage(method, 'promotions.view', 'promotions.manage');
  if (is('/payments')) return viewOrManage(method, 'payments.view', 'payments.manage');
  if (is('/shifts/hours')) return 'reports.view';
  if (is('/shifts')) return viewOrManage(method, 'shifts.view', 'shifts.manage');
  if (is('/licences') || is('/etims')) return 'settings.manage';
  if (is('/expenses')) return viewOrManage(method, 'expenses.view', 'expenses.manage');
  if (is('/inventory/purchase-orders') || is('/purchases')) return method === 'GET' ? 'inventory.view' : 'purchases.manage';
  if (is('/inventory')) return viewOrManage(method, 'inventory.view', 'inventory.manage');
  if (is('/menu-items') || is('/categories') || is('/modifier-groups')) return viewOrManage(method, 'menu.view', 'menu.manage');
  if (/^\/customers\/[^/]+\/loyalty(\/|$)/.test(path)) return method === 'GET' ? 'customers.view' : 'loyalty.manage';
  if (is('/customers')) return viewOrManage(method, 'customers.view', 'customers.manage');
  if (is('/orders/pos') || is('/orders/sync-offline')) return 'pos.use';
  if (is('/orders')) return viewOrManage(method, 'orders.view', 'orders.manage');
  if (is('/kitchen')) return viewOrManage(method, 'kitchen.view', 'kitchen.manage');
  if (is('/reservations')) return viewOrManage(method, 'reservations.view', 'reservations.manage');
  if (/^\/tables\/[^/]+\/service$/.test(path)) return 'pos.use';
  if (is('/tables') || is('/sections') || is('/table-combinations')) return viewOrManage(method, 'orders.view', 'settings.manage');
  if (is('/branches')) return viewOrManage(method, 'dashboard.view', 'settings.manage');
  if (is('/settings') || is('/restaurant') || is('/website') || is('/automated-messaging')) return 'settings.manage';
  if (is('/dashboard')) return 'dashboard.view';
  // Setting or clearing approval PINs; only owner/admin/manager PINs can approve anything.
  if (is('/approvals')) return 'users.manage';
  if (is('/public/payments/notifications')) return 'payments.view';
  return null;
};

const permissionForRequest = (req: AuthRequest): string | null => permissionForPath(`${req.baseUrl}${req.path}`, req.method);

export const authenticate = async (req: AuthRequest, res: ExpressResponse, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization;
    // Server-Sent Events/EventSource cannot attach custom Authorization headers.
    // The staff realtime stream therefore accepts a 60-second, stream-only
    // ticket (POST /api/realtime/ticket) as a query parameter. The long-lived
    // login token is never accepted in a URL, where it would end up in logs.
    const isStaffRealtimeStream = req.baseUrl.endsWith('/realtime') && req.path === '/stream';
    const ticket = isStaffRealtimeStream && typeof req.query.ticket === 'string' ? req.query.ticket : undefined;
    const bearer = authHeader?.startsWith('Bearer ') ? authHeader.split(' ')[1] : undefined;
    const token = bearer || ticket;
    if (!token) {
      return res.status(401).json({ success: false, message: 'Access token required' });
    }
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as { userId: string; restaurantId: string; tokenVersion?: number; purpose?: string };
    // Stream tickets only work on the stream; login tokens only in the header.
    if ((bearer && decoded.purpose === 'sse') || (!bearer && decoded.purpose !== 'sse')) {
      return res.status(401).json({ success: false, message: 'Invalid or expired token' });
    }

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
