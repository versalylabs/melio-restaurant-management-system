import { NavLink, useLocation } from 'react-router-dom';
import { useState } from 'react';
import {
  LayoutDashboard,
  CreditCard,
  UtensilsCrossed,
  BookOpen,
  Package,
  Users,
  UserCog,
  Wallet,
  Shield,
  Bell,
  ChevronDown,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';

interface NavChild {
  title: string;
  href: string;
  disabled?: boolean;
  roles?: string[];
}

interface NavItem {
  title: string;
  href?: string;
  roles?: string[];
  icon: React.ComponentType<{ className?: string }>;
  children?: NavChild[];
}

const navigation: NavItem[] = [
  { title: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { title: 'Operations', icon: CreditCard, roles: ['OWNER','ADMIN','MANAGER','CASHIER','WAITER','CHEF'], children: [
    { title: 'POS', href: '/pos', roles: ['OWNER','ADMIN','MANAGER','CASHIER','WAITER'] },
    { title: 'Orders', href: '/orders', roles: ['OWNER','ADMIN','MANAGER','CASHIER','WAITER'] },
    { title: 'Tables', href: '/tables', roles: ['OWNER','ADMIN','MANAGER','CASHIER','WAITER'] },
    { title: 'Sections', href: '/sections', roles: ['OWNER','ADMIN','MANAGER'] },
    { title: 'Kitchen', href: '/kitchen', roles: ['OWNER','ADMIN','MANAGER','CASHIER','WAITER','CHEF'] },
    { title: 'Reservations', href: '/reservations', roles: ['OWNER','ADMIN','MANAGER','CASHIER','WAITER'] },
    { title: 'Branches', href: '/branches', roles: ['OWNER','ADMIN','MANAGER'] },
  ]},
  { title: 'Menu', icon: BookOpen, roles: ['OWNER','ADMIN','MANAGER'], children: [
    { title: 'Menu Items', href: '/menu-items' }, { title: 'Categories', href: '/categories' },
  ]},
  { title: 'Inventory', icon: Package, roles: ['OWNER','ADMIN','MANAGER','INVENTORY_MANAGER'], children: [
    { title: 'Inventory', href: '/inventory' }, { title: 'Suppliers', href: '/suppliers' }, { title: 'Purchases', href: '/purchases' },
  ]},
  { title: 'Customers', icon: Users, roles: ['OWNER','ADMIN','MANAGER','CASHIER','WAITER'], children: [
    { title: 'Customers', href: '/customers' }, { title: 'Loyalty', href: '/loyalty' },
  ]},
  { title: 'Staff', icon: UserCog, roles: ['OWNER','ADMIN','MANAGER','CASHIER'], children: [
    { title: 'Staff', href: '/staff', roles: ['OWNER','ADMIN','MANAGER'] }, { title: 'Shifts', href: '/shifts' },
  ]},
  { title: 'Finance', icon: Wallet, roles: ['OWNER','ADMIN','MANAGER','CASHIER'], children: [
    { title: 'Payments', href: '/payments' }, { title: 'Expenses', href: '/expenses', roles: ['OWNER','ADMIN','MANAGER'] },
    { title: 'Reports', href: '/reports', roles: ['OWNER','ADMIN','MANAGER'] }, { title: 'Analytics', href: '/analytics', roles: ['OWNER','ADMIN','MANAGER'] },
    { title: 'Discounts & Promotions', href: '/promotions', roles: ['OWNER','ADMIN','MANAGER'] },
  ]},
  { title: 'Notifications', href: '/notifications', icon: Bell, roles: ['OWNER','ADMIN','MANAGER','CASHIER','WAITER','CHEF','INVENTORY_MANAGER'] },
  { title: 'Administration', icon: Shield, roles: ['OWNER','ADMIN','MANAGER'], children: [
    { title: 'User Accounts', href: '/users', roles: ['OWNER','ADMIN','MANAGER'] }, { title: 'Roles', href: '/roles', roles: ['OWNER','ADMIN'] },
    { title: 'Settings', href: '/settings', roles: ['OWNER','ADMIN','MANAGER'] }, { title: 'Website Management', href: '/website-management', roles: ['OWNER','ADMIN','MANAGER'] }, { title: 'Audit Log', href: '/audit-log', roles: ['OWNER','ADMIN'] },
  ]},
];

export default function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { user, logout } = useAuth();
  const location = useLocation();
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({ Operations: true });
  const role = user?.roleName || '';
  const canSee = (roles?: string[]) => !roles || roles.includes(role);
  const visibleNavigation = navigation.filter((item) => canSee(item.roles)).map((item) => ({ ...item, children: item.children?.filter((child) => canSee(child.roles)) })).filter((item) => !item.children || item.children.length > 0);

  const renderNavItem = (item: NavItem) => {
    const Icon = item.icon;
    if (item.children) {
      const isOpen = openGroups[item.title] ?? (item.children?.some((child) => location.pathname === child.href) || false);
      return (
        <div key={item.title} className="mb-1">
          <button type="button" onClick={() => setOpenGroups((current) => ({ ...current, [item.title]: !isOpen }))} className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-400 transition hover:bg-orange-500/10 hover:text-orange-600 dark:hover:bg-white/5 dark:hover:text-gray-200">
            <Icon className="w-4 h-4 text-orange-500/80" />
            <span className="flex-1 text-left">{item.title}</span><ChevronDown className={`h-4 w-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
          </button>
          {isOpen && <div className="ml-2 pl-2 border-l border-orange-500/15 dark:border-white/10 space-y-1 my-1">
            {item.children.map((child) => (
              <NavLink
                key={child.href}
                to={child.disabled ? '#' : child.href}
                onClick={(event) => {
                  if (child.disabled) {
                    event.preventDefault();
                    return;
                  }
                  onNavigate?.();
                }}
                className={({ isActive }) =>
                  `flex items-center justify-between px-3 py-2 text-xs sm:text-sm rounded-xl transition-all duration-200 ${
                    isActive
                      ? 'bg-gradient-to-r from-orange-500/15 to-amber-500/10 text-orange-600 dark:text-orange-400 font-semibold shadow-sm border border-orange-500/20 dark:border-orange-500/30'
                      : child.disabled
                      ? 'text-gray-300 dark:text-gray-600 cursor-not-allowed'
                      : 'text-gray-600 dark:text-gray-400 hover:bg-orange-500/10 dark:hover:bg-white/5 hover:text-orange-600 dark:hover:text-gray-200'
                  }`
                }
              >
                {child.title}
                {child.disabled && (
                  <span className="text-[10px] text-gray-400 dark:text-gray-600 uppercase tracking-widest font-bold">Soon</span>
                )}
              </NavLink>
            ))}
          </div>}
        </div>
      );
    }

    return (
      <NavLink
        key={item.href}
        to={item.href!}
        onClick={() => onNavigate?.()}
        className={({ isActive }) =>
          `flex items-center gap-3 px-3 py-2.5 text-xs sm:text-sm font-medium rounded-xl transition-all duration-200 ${
            isActive
              ? 'bg-gradient-to-r from-orange-500/15 to-amber-500/10 text-orange-600 dark:text-orange-400 font-semibold shadow-sm border border-orange-500/20 dark:border-orange-500/30'
              : 'text-gray-600 dark:text-gray-400 hover:bg-orange-500/10 dark:hover:bg-white/5 hover:text-orange-600 dark:hover:text-gray-200'
          }`
        }
      >
        <Icon className="w-4 h-4 text-orange-500" />
        {item.title}
      </NavLink>
    );
  };

  return (
    <div className="flex h-full flex-col bg-white/40 dark:bg-black/20 backdrop-blur-xl">
      {/* Logo / Brand */}
      <div className="relative flex items-center gap-3 px-5 py-4 border-b border-orange-500/10 dark:border-white/10">
        <div className="w-8 h-8 bg-gradient-to-tr from-orange-600 to-amber-500 rounded-xl flex items-center justify-center flex-shrink-0 shadow-sm shadow-orange-500/20">
          <UtensilsCrossed className="w-4 h-4 text-white" />
        </div>
        <div className="min-w-0">
          <h1 className="text-sm font-bold text-gray-900 dark:text-gray-100 leading-tight whitespace-nowrap">Melio Management System</h1>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-1">
        {visibleNavigation.map((item) => renderNavItem(item))}
      </nav>

      {/* User footer */}
      <div className="border-t border-orange-500/10 dark:border-white/10 p-3.5 m-2 rounded-2xl bg-white/60 dark:bg-white/[0.03] border backdrop-blur-md shadow-sm">
        <div className="flex items-center gap-3 mb-2.5">
          <div className="w-8 h-8 bg-gradient-to-br from-orange-500/20 to-amber-500/20 border border-orange-500/30 rounded-xl flex items-center justify-center flex-shrink-0">
            <span className="text-xs font-bold text-orange-600 dark:text-orange-400">
              {user?.firstName?.[0]}{user?.lastName?.[0]}
            </span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-gray-900 dark:text-gray-100 truncate">
              {user?.firstName} {user?.lastName}
            </p>
            <p className="text-[10px] uppercase font-bold tracking-wider text-orange-500 truncate">{user?.roleName}</p>
          </div>
        </div>
        <button
          onClick={logout}
          className="w-full text-center px-3 py-1.5 text-xs font-semibold text-red-600 dark:text-red-400 hover:bg-red-500/10 rounded-xl transition-colors"
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
