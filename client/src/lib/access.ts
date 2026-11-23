import type { User } from '../types';

type AccessUser = Pick<User, 'roleName'> & { permissions?: string[] } | null | undefined;

/**
 * Built-in roles allowed on each staff page. Custom roles get in through the
 * permission in `permissionForPath` instead. Keep in step with the
 * `allowedRoles` on the routes in App.tsx.
 */
export const ROUTE_ROLES: Record<string, string[] | undefined> = {
  '/dashboard': ['OWNER', 'ADMIN', 'MANAGER', 'CASHIER', 'WAITER', 'CHEF', 'INVENTORY_MANAGER'],
  '/pos': ['OWNER', 'ADMIN', 'MANAGER', 'CASHIER', 'WAITER'],
  '/orders': ['OWNER', 'ADMIN', 'MANAGER', 'CASHIER', 'WAITER'],
  '/deliveries': ['OWNER', 'ADMIN', 'MANAGER', 'DELIVERY', 'CASHIER', 'WAITER'],
  '/tables': ['OWNER', 'ADMIN', 'MANAGER', 'CASHIER', 'WAITER'],
  '/sections': ['OWNER', 'ADMIN', 'MANAGER'],
  '/kitchen': ['OWNER', 'ADMIN', 'MANAGER', 'CASHIER', 'WAITER', 'CHEF'],
  '/reservations': ['OWNER', 'ADMIN', 'MANAGER', 'CASHIER', 'WAITER'],
  '/branches': ['OWNER', 'ADMIN', 'MANAGER'],
  '/menu-items': ['OWNER', 'ADMIN', 'MANAGER'],
  '/categories': ['OWNER', 'ADMIN', 'MANAGER'],
  '/menu-preview': ['OWNER', 'ADMIN', 'MANAGER', 'CASHIER', 'WAITER', 'CHEF'],
  '/inventory': ['OWNER', 'ADMIN', 'MANAGER', 'INVENTORY_MANAGER', 'CHEF'],
  '/suppliers': ['OWNER', 'ADMIN', 'MANAGER', 'INVENTORY_MANAGER'],
  '/purchases': ['OWNER', 'ADMIN', 'MANAGER', 'INVENTORY_MANAGER'],
  '/quick-purchase': ['OWNER', 'ADMIN', 'MANAGER', 'INVENTORY_MANAGER', 'CASHIER'],
  '/food-cost': ['OWNER', 'ADMIN', 'MANAGER', 'INVENTORY_MANAGER'],
  '/customers': ['OWNER', 'ADMIN', 'MANAGER', 'CASHIER', 'WAITER'],
  '/loyalty': ['OWNER', 'ADMIN', 'MANAGER', 'CASHIER', 'WAITER'],
  '/staff': ['OWNER', 'ADMIN', 'MANAGER'],
  '/shifts': ['OWNER', 'ADMIN', 'MANAGER', 'CASHIER'],
  '/payments': ['OWNER', 'ADMIN', 'MANAGER', 'CASHIER'],
  '/expenses': ['OWNER', 'ADMIN', 'MANAGER'],
  '/reports': ['OWNER', 'ADMIN', 'MANAGER'],
  '/loss-prevention': ['OWNER', 'ADMIN', 'MANAGER'],
  '/tax-summary': ['OWNER', 'ADMIN', 'MANAGER'],
  '/analytics': ['OWNER', 'ADMIN', 'MANAGER'],
  '/promotions': ['OWNER', 'ADMIN', 'MANAGER'],
  '/users': ['OWNER', 'ADMIN', 'MANAGER'],
  '/roles': ['OWNER', 'ADMIN'],
  '/automated-messaging': ['OWNER', 'ADMIN'],
  '/settings': ['OWNER', 'ADMIN', 'MANAGER'],
  '/website-management': ['OWNER', 'ADMIN', 'MANAGER'],
  '/audit-log': ['OWNER', 'ADMIN'],
  // Every signed-in staff member may open notifications.
  '/notifications': undefined,
};

export const permissionForPath = (path: string): string | null => {
  if (path === '/users' || path === '/staff') return 'users.view';
  if (path === '/roles') return 'roles.manage';
  if (path === '/audit-log') return 'audit.view';
  if (path === '/reports' || path === '/analytics' || path === '/loss-prevention' || path === '/tax-summary') return 'reports.view';
  if (path === '/promotions') return 'promotions.view';
  if (path === '/payments') return 'payments.view';
  if (path === '/shifts') return 'shifts.view';
  if (path === '/expenses') return 'expenses.view';
  if (path === '/inventory' || path === '/suppliers' || path === '/purchases' || path === '/food-cost') return 'inventory.view';
  if (path === '/quick-purchase') return 'inventory.manage';
  if (path === '/menu-items' || path === '/categories' || path === '/menu-preview') return 'menu.view';
  if (path.startsWith('/customers') || path === '/loyalty') return 'customers.view';
  if (path === '/orders') return 'orders.view';
  if (path === '/kitchen') return 'kitchen.view';
  if (path === '/reservations') return 'reservations.view';
  if (path === '/branches') return 'inventory.view';
  if (path === '/pos') return 'pos.use';
  if (path === '/tables' || path === '/sections') return 'tables.view';
  if (path === '/website-management' || path === '/website_management') return 'settings.manage';
  if (path === '/notifications') return 'dashboard.view';
  if (path === '/deliveries') return 'orders.view';
  if (path === '/automated-messaging') return 'settings.manage';
  if (path === '/settings') return 'settings.manage';
  if (path === '/dashboard') return 'dashboard.view';
  return null;
};

export const hasPermission = (user: AccessUser, permission: string | null | undefined): boolean =>
  !!user && !!permission && !!(user.permissions?.includes('*') || user.permissions?.includes(permission));

/** Whether the user may open a staff page, by built-in role or by permission. */
export const canAccessPath = (user: AccessUser, path: string, allowedRoles: string[] | undefined = ROUTE_ROLES[path]): boolean => {
  if (!user) return false;
  if (!allowedRoles) return true;
  if (allowedRoles.includes(user.roleName || '')) return true;
  return hasPermission(user, permissionForPath(path));
};

export const BUILT_IN_ROLES = ['OWNER', 'ADMIN', 'MANAGER', 'CASHIER', 'WAITER', 'CHEF', 'INVENTORY_MANAGER', 'DELIVERY'];

/**
 * Sidebar visibility. Built-in roles see the pages listed for their role
 * (their permissions also include broad codes such as dashboard.view that
 * would otherwise surface unrelated pages); custom roles see the pages their
 * permissions open.
 */
export const showInNavigation = (user: AccessUser, path: string): boolean => {
  if (!user) return false;
  const roles = ROUTE_ROLES[path];
  if (!roles) return true;
  if (BUILT_IN_ROLES.includes(user.roleName || '')) return roles.includes(user.roleName || '');
  return hasPermission(user, permissionForPath(path));
};

const LANDING_ORDER = [
  '/dashboard', '/pos', '/orders', '/kitchen', '/deliveries', '/reservations', '/tables',
  '/inventory', '/menu-items', '/customers', '/payments', '/shifts', '/reports',
];

/**
 * Where to send a staff member after login or when they open a page they
 * can't use. Always returns a page they can open, so custom roles never land
 * in a redirect loop.
 */
export const getDefaultRoute = (user: AccessUser): string => {
  const role = user?.roleName;
  const preferred =
    role === 'DELIVERY' ? '/deliveries' : role === 'CHEF' ? '/kitchen' : role === 'INVENTORY_MANAGER' ? '/inventory' : '/dashboard';
  if (canAccessPath(user, preferred)) return preferred;
  return LANDING_ORDER.find((path) => canAccessPath(user, path)) || '/notifications';
};
