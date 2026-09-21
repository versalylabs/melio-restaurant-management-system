import React, { Suspense, lazy } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import AppShell from './components/layout/AppShell';

// Code-split pages with React.lazy for blazingly fast initial load and snappy route transitions
const Login = lazy(() => import('./pages/auth/Login'));
const Dashboard = lazy(() => import('./pages/dashboard/Dashboard'));
const Settings = lazy(() => import('./pages/settings/Settings'));
const Users = lazy(() => import('./pages/users/Users'));
const Roles = lazy(() => import('./pages/roles/Roles'));
const AuditLog = lazy(() => import('./pages/audit-log/AuditLog'));
const MenuItems = lazy(() => import('./pages/menu-items/MenuItems'));
const Categories = lazy(() => import('./pages/categories/Categories'));
const MenuPreview = lazy(() => import('./pages/menu-preview/MenuPreview'));
const FloorPlan = lazy(() => import('./pages/tables/FloorPlan'));
const Sections = lazy(() => import('./pages/sections/Sections'));
const TableCombinations = lazy(() => import('./pages/table-combinations/TableCombinations'));
const POS = lazy(() => import('./pages/pos/POS'));
const Orders = lazy(() => import('./pages/orders/Orders'));
const KitchenDisplay = lazy(() => import('./pages/kitchen/KitchenDisplay'));
const Inventory = lazy(() => import('./pages/inventory/Inventory'));
const Setup = lazy(() => import('./pages/auth/Setup'));
const Customers = lazy(() => import('./pages/customers/Customers'));
const CustomerDetails = lazy(() => import('./pages/customers/CustomerDetails'));
const Loyalty = lazy(() => import('./pages/customers/Loyalty'));
const Payments = lazy(() => import('./pages/payments/Payments'));
const Reports = lazy(() => import('./pages/reports/Reports'));
const Reservations = lazy(() => import('./pages/reservations/Reservations'));
const Branches = lazy(() => import('./pages/branches/Branches'));
const Promotions = lazy(() => import('./pages/promotions/Promotions'));
const OnlineOrdering = lazy(() => import('./pages/online-ordering/OnlineOrdering'));
const RestaurantWebsite = lazy(() => import('./pages/website/RestaurantWebsite'));
const OnlineOrderTracking = lazy(() => import('./pages/online-ordering/OnlineOrderTracking'));
const Notifications = lazy(() => import('./pages/notifications/Notifications'));
const Analytics = lazy(() => import('./pages/analytics/Analytics'));
const Shifts = lazy(() => import('./pages/shifts/Shifts'));
const Expenses = lazy(() => import('./pages/expenses/Expenses'));
const CustomerAccount = lazy(() => import('./pages/customer-portal/CustomerAccount'));
const WebsiteManagement = lazy(() => import('./pages/website/WebsiteManagement'));

const PageLoader = () => (
  <div className="min-h-screen flex items-center justify-center bg-[#faf9f7] dark:bg-[#0d0d11]">
    <div className="flex flex-col items-center gap-3">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-orange-500 border-t-transparent" />
      <span className="text-xs font-medium uppercase tracking-widest text-gray-400">Loading...</span>
    </div>
  </div>
);

const permissionForPath = (path: string) => {
  if (path === '/users' || path === '/staff') return 'users.view';
  if (path === '/roles') return 'roles.manage';
  if (path === '/audit-log') return 'audit.view';
  if (path === '/reports' || path === '/analytics') return 'reports.view';
  if (path === '/promotions') return 'promotions.view';
  if (path === '/payments') return 'payments.view';
  if (path === '/shifts') return 'shifts.view';
  if (path === '/expenses') return 'expenses.view';
  if (path === '/inventory' || path === '/suppliers' || path === '/purchases') return 'inventory.view';
  if (path === '/menu-items' || path === '/categories') return 'menu.view';
  if (path.startsWith('/customers') || path === '/loyalty') return 'customers.view';
  if (path === '/orders') return 'orders.view';
  if (path === '/kitchen') return 'kitchen.view';
  if (path === '/reservations') return 'reservations.view';
  if (path === '/branches') return 'inventory.view';
  if (path === '/pos') return 'pos.use';
  if (path === '/tables' || path === '/sections' || path === '/table-combinations') return 'tables.view';
  if (path === '/website-management' || path === '/website_management') return 'dashboard.view';
  if (path === '/notifications') return 'dashboard.view';
  if (path === '/dashboard' || path === '/settings') return 'dashboard.view';
  return null;
};

function ProtectedRoute({ children, allowedRoles, requiredPermission }: { children: React.ReactNode; allowedRoles?: string[]; requiredPermission?: string }) {
  const { isAuthenticated, isLoading, user } = useAuth();
  if (isLoading) return <div className="min-h-screen flex items-center justify-center"><div className="text-gray-500">Loading...</div></div>;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  const permission = requiredPermission || permissionForPath(window.location.pathname);
  const roleAllowed = !allowedRoles || !user || allowedRoles.includes(user.roleName);
  const permissionAllowed = !!user && (!!permission && (user.permissions?.includes('*') || user.permissions?.includes(permission)));
  if (allowedRoles && user && !roleAllowed && !permissionAllowed) return <Navigate to="/dashboard" replace />;
  return <AppShell>{children}</AppShell>;
}


class ReportsErrorBoundary extends React.Component<React.PropsWithChildren, { hasError: boolean; message: string }> {
  state = { hasError: false, message: '' };
  static getDerivedStateFromError(error: unknown) {
    return { hasError: true, message: error instanceof Error ? error.message : 'Unknown reports page error' };
  }
  componentDidCatch(error: unknown) {
    console.error('Reports page error:', error);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="p-6">
          <div className="rounded-lg border border-red-200 bg-red-50 p-5 text-red-800">
            <h1 className="text-lg font-semibold">Reports could not be displayed</h1>
            <p className="mt-2 text-sm">{this.state.message}</p>
            <button className="mt-4 rounded-md bg-red-700 px-4 py-2 text-sm font-medium text-white" onClick={() => window.location.reload()}>
              Reload Reports
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function App() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-gray-500">Loading...</div>
      </div>
    );
  }

  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        <Route path="/order-online" element={<OnlineOrdering />} />
        <Route path="/online-order/:trackingToken" element={<OnlineOrderTracking />} />
        <Route path="/account" element={<CustomerAccount />} />
        <Route path="/login" element={isAuthenticated ? <Navigate to="/dashboard" replace /> : <Login />} />
        <Route path="/setup" element={<Setup />} />
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <Dashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/settings"
          element={
            <ProtectedRoute allowedRoles={['OWNER', 'ADMIN', 'MANAGER']}>
              <Settings />
            </ProtectedRoute>
          }
        />
        <Route
          path="/users"
          element={
            <ProtectedRoute allowedRoles={['OWNER', 'ADMIN', 'MANAGER']}>
              <Users />
            </ProtectedRoute>
          }
        />
        <Route
          path="/roles"
          element={
            <ProtectedRoute allowedRoles={['OWNER', 'ADMIN']}>
              <Roles />
            </ProtectedRoute>
          }
        />
        <Route
          path="/audit-log"
          element={
            <ProtectedRoute allowedRoles={['OWNER', 'ADMIN']}>
              <AuditLog />
            </ProtectedRoute>
          }
        />
        <Route path="/pos" element={
          <ProtectedRoute allowedRoles={['OWNER', 'ADMIN', 'MANAGER', 'CASHIER', 'WAITER']}>
            <POS />
          </ProtectedRoute>
        } />
        <Route path="/orders" element={
          <ProtectedRoute allowedRoles={['OWNER', 'ADMIN', 'MANAGER', 'CASHIER', 'WAITER']}>
            <Orders />
          </ProtectedRoute>
        } />
        <Route path="/tables" element={
          <ProtectedRoute allowedRoles={['OWNER', 'ADMIN', 'MANAGER', 'CASHIER', 'WAITER']}>
            <FloorPlan />
          </ProtectedRoute>
        } />
        <Route path="/sections" element={
          <ProtectedRoute allowedRoles={['OWNER', 'ADMIN', 'MANAGER']}>
            <Sections />
          </ProtectedRoute>
        } />
        <Route path="/table-combinations" element={
          <ProtectedRoute allowedRoles={['OWNER', 'ADMIN', 'MANAGER']}>
            <TableCombinations />
          </ProtectedRoute>
        } />
        <Route path="/kitchen" element={
          <ProtectedRoute allowedRoles={['OWNER', 'ADMIN', 'MANAGER', 'CASHIER', 'WAITER', 'CHEF']}>
            <KitchenDisplay />
          </ProtectedRoute>
        } />
        <Route path="/reservations" element={<ProtectedRoute allowedRoles={['OWNER','ADMIN','MANAGER','CASHIER','WAITER']}><Reservations /></ProtectedRoute>} />
        <Route path="/branches" element={<ProtectedRoute allowedRoles={['OWNER','ADMIN','MANAGER']}><Branches /></ProtectedRoute>} />
        <Route path="/promotions" element={<ProtectedRoute allowedRoles={['OWNER','ADMIN','MANAGER']}><Promotions /></ProtectedRoute>} />
        <Route path="/menu-items" element={
          <ProtectedRoute allowedRoles={['OWNER', 'ADMIN', 'MANAGER']}>
            <MenuItems />
          </ProtectedRoute>
        } />
        <Route path="/categories" element={
          <ProtectedRoute allowedRoles={['OWNER', 'ADMIN', 'MANAGER']}>
            <Categories />
          </ProtectedRoute>
        } />
        <Route path="/menu-preview" element={<MenuPreview />} />
        <Route path="/website-management" element={
          <ProtectedRoute allowedRoles={['OWNER', 'ADMIN', 'MANAGER']}>
            <WebsiteManagement />
          </ProtectedRoute>
        } />
        <Route path="/website_management" element={
          <ProtectedRoute allowedRoles={['OWNER', 'ADMIN', 'MANAGER']}>
            <WebsiteManagement />
          </ProtectedRoute>
        } />
        <Route path="/inventory" element={
          <ProtectedRoute allowedRoles={['OWNER', 'ADMIN', 'MANAGER', 'INVENTORY_MANAGER', 'CHEF']}>
            <Inventory />
          </ProtectedRoute>
        } />
        <Route path="/suppliers" element={
          <ProtectedRoute allowedRoles={['OWNER', 'ADMIN', 'MANAGER', 'INVENTORY_MANAGER']}>
            <Inventory />
          </ProtectedRoute>
        } />
        <Route path="/purchases" element={
          <ProtectedRoute allowedRoles={['OWNER', 'ADMIN', 'MANAGER', 'INVENTORY_MANAGER']}>
            <Inventory />
          </ProtectedRoute>
        } />
        <Route path="/customers" element={<ProtectedRoute allowedRoles={['OWNER','ADMIN','MANAGER','CASHIER','WAITER']}><Customers /></ProtectedRoute>} />
        <Route path="/customers/:id" element={<ProtectedRoute allowedRoles={['OWNER','ADMIN','MANAGER','CASHIER','WAITER']}><CustomerDetails /></ProtectedRoute>} />
        <Route path="/loyalty" element={<ProtectedRoute allowedRoles={['OWNER','ADMIN','MANAGER','CASHIER','WAITER']}><Loyalty /></ProtectedRoute>} />
        <Route path="/staff" element={<ProtectedRoute allowedRoles={['OWNER','ADMIN','MANAGER']}><Users /></ProtectedRoute>} />
        <Route path="/shifts" element={<ProtectedRoute allowedRoles={['OWNER','ADMIN','MANAGER','CASHIER']}><Shifts /></ProtectedRoute>} />
        <Route path="/analytics" element={<ProtectedRoute allowedRoles={['OWNER','ADMIN','MANAGER']}><Analytics /></ProtectedRoute>} />
        <Route path="/notifications" element={<ProtectedRoute><Notifications /></ProtectedRoute>} />
        <Route path="/payments" element={<ProtectedRoute allowedRoles={['OWNER','ADMIN','MANAGER','CASHIER']}><Payments /></ProtectedRoute>} />
        <Route path="/expenses" element={<ProtectedRoute allowedRoles={['OWNER','ADMIN','MANAGER']}><Expenses /></ProtectedRoute>} />
        <Route path="/reports" element={<ProtectedRoute allowedRoles={['OWNER','ADMIN','MANAGER']}><ReportsErrorBoundary><Reports /></ReportsErrorBoundary></ProtectedRoute>} />
        {/* Public landing page: visiting localhost:5173 always opens the Melio website. */}
        <Route path="/" element={<RestaurantWebsite />} />
      </Routes>
    </Suspense>
  );
}

export default App;
