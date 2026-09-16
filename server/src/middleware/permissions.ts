import type { AuthRequest } from './auth';
import type { Response, NextFunction } from 'express';

export const PERMISSIONS = [
  { key: 'dashboard.view', label: 'View Dashboard', group: 'Dashboard' },
  { key: 'pos.use', label: 'Use POS', group: 'Operations' },
  { key: 'orders.view', label: 'View Orders', group: 'Operations' },
  { key: 'orders.manage', label: 'Manage Orders', group: 'Operations' },
  { key: 'kitchen.view', label: 'View Kitchen', group: 'Operations' },
  { key: 'kitchen.manage', label: 'Manage Kitchen', group: 'Operations' },
  { key: 'reservations.view', label: 'View Reservations', group: 'Operations' },
  { key: 'reservations.manage', label: 'Manage Reservations', group: 'Operations' },
  { key: 'menu.view', label: 'View Menu', group: 'Menu' },
  { key: 'menu.manage', label: 'Manage Menu', group: 'Menu' },
  { key: 'inventory.view', label: 'View Inventory', group: 'Inventory' },
  { key: 'inventory.manage', label: 'Manage Inventory', group: 'Inventory' },
  { key: 'purchases.manage', label: 'Manage Purchases', group: 'Inventory' },
  { key: 'customers.view', label: 'View Customers', group: 'Customers' },
  { key: 'customers.manage', label: 'Manage Customers', group: 'Customers' },
  { key: 'loyalty.manage', label: 'Manage Loyalty', group: 'Customers' },
  { key: 'payments.view', label: 'View Payments', group: 'Finance' },
  { key: 'payments.manage', label: 'Manage Payments', group: 'Finance' },
  { key: 'shifts.view', label: 'View Shifts', group: 'Staff' },
  { key: 'shifts.manage', label: 'Manage Shifts', group: 'Staff' },
  { key: 'expenses.view', label: 'View Expenses', group: 'Finance' },
  { key: 'expenses.manage', label: 'Manage Expenses', group: 'Finance' },
  { key: 'reports.view', label: 'View Reports', group: 'Finance' },
  { key: 'users.view', label: 'View Staff', group: 'Administration' },
  { key: 'users.manage', label: 'Manage Staff', group: 'Administration' },
  { key: 'roles.manage', label: 'Manage Roles & Permissions', group: 'Administration' },
  { key: 'audit.view', label: 'View Audit Log', group: 'Administration' },
  { key: 'settings.manage', label: 'Manage Settings', group: 'Administration' },
  { key: 'promotions.view', label: 'View Promotions', group: 'Finance' },
  { key: 'promotions.manage', label: 'Manage Promotions', group: 'Finance' },
] as const;

export const PERMISSION_KEYS = PERMISSIONS.map((p) => p.key);

export function parsePermissions(value: string | undefined | null): string[] {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed.filter((p) => typeof p === 'string') : [];
  } catch {
    return [];
  }
}

export function hasPermission(req: AuthRequest, permission: string): boolean {
  const permissions = req.user?.permissions || [];
  return permissions.includes('*') || permissions.includes(permission);
}


// Backward-compatible middleware name used by newer route modules.
export const requirePermission = (permission: string) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    if (req.user.permissions.includes('*') || req.user.permissions.includes(permission)) {
      return next();
    }

    return res.status(403).json({ success: false, message: 'Insufficient permissions' });
  };
};
