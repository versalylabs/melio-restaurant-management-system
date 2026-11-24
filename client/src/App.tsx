import React, { Suspense, lazy } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import AppShell from './components/layout/AppShell';

import { getDefaultRoute, hasPermission, permissionForPath } from './lib/access';
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
const LossPrevention = lazy(() => import('./pages/reports/LossPrevention'));
const TaxSummary = lazy(() => import('./pages/reports/TaxSummary'));
const ChannelReport = lazy(() => import('./pages/reports/ChannelReport'));
const PayLink = lazy(() => import('./pages/pay/PayLink'));
const QuickPurchase = lazy(() => import('./pages/inventory/QuickPurchase'));
const FoodCost = lazy(() => import('./pages/inventory/FoodCost'));
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
const DeliveryDashboard = lazy(() => import('./pages/delivery/DeliveryDashboard'));
const AutomatedMessaging = lazy(() => import('./pages/settings/AutomatedMessaging'));

const PageLoader = () => (
  <div className="min-h-screen flex items-center justify-center bg-[#faf9f7] dark:bg-[#0d0d11]">
    <div className="flex flex-col items-center gap-3">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-orange-500 border-t-transparent" />
      <span className="text-xs font-medium uppercase tracking-widest text-gray-400">Loading...</span>
    </div>
  </div>
);

function ProtectedRoute({ children, allowedRoles, requiredPermission }: { children: React.ReactNode; allowedRoles?: string[]; requiredPermission?: string }) {
  const { isAuthenticated, isLoading, user } = useAuth();
  const location = useLocation();
  if (isLoading) return <PageLoader />;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  const allowed =
    !allowedRoles ||
    !user ||
    allowedRoles.includes(user.roleName) ||
    hasPermission(user, requiredPermission || permissionForPath(location.pathname));
  if (!allowed) {
    const fallback = getDefaultRoute(user);
    // Never redirect to the page we're already on (custom roles used to loop).
    if (fallback !== location.pathname) return <Navigate to={fallback} replace />;
    return <Navigate to="/notifications" replace />;
  }
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

const ROUTE_TITLES: Record<string, string> = {
  '/': 'Melio — Fine Dining & Restaurant Management',
  '/order-online': 'Order Online — Melio',
  '/account': 'Customer Account — Melio',
  '/login': 'Staff Login — Melio',
  '/setup': 'System Setup — Melio',
  '/dashboard': 'Dashboard — Melio',
  '/deliveries': 'Deliveries — Melio',
  '/delivery': 'Deliveries — Melio',
  '/automated-messaging': 'Automated Messaging — Melio',
  '/pos': 'Point of Sale — Melio',
  '/orders': 'Orders Management — Melio',
  '/kitchen': 'Kitchen Display System — Melio',
  '/tables': 'Floor Plan & Tables — Melio',
  '/floor-plan': 'Floor Plan & Tables — Melio',
  '/sections': 'Dining Sections — Melio',
  '/reservations': 'Reservations — Melio',
  '/menu-items': 'Menu Items — Melio',
  '/menu/items': 'Menu Items — Melio',
  '/categories': 'Menu Categories — Melio',
  '/menu/categories': 'Menu Categories — Melio',
  '/menu-preview': 'Digital Menu Preview — Melio',
  '/menu/preview': 'Digital Menu Preview — Melio',
  '/inventory': 'Inventory & Stock — Melio',
  '/customers': 'Customer CRM — Melio',
  '/loyalty': 'Loyalty Program — Melio',
  '/promotions': 'Promotions & Discounts — Melio',
  '/payments': 'Payments & Receipts — Melio',
  '/expenses': 'Expenses — Melio',
  '/reports': 'Financial Reports — Melio',
  '/loss-prevention': 'Loss Prevention — Melio',
  '/tax-summary': 'Tax Summary — Melio',
  '/channel-report': 'Sales by Channel — Melio',
  '/quick-purchase': 'Quick Purchase — Melio',
  '/food-cost': 'Food Cost — Melio',
  '/analytics': 'Business Analytics — Melio',
  '/shifts': 'Shift Management — Melio',
  '/branches': 'Branch Management — Melio',
  '/users': 'Staff & Users — Melio',
  '/roles': 'Roles & Permissions — Melio',
  '/settings': 'Restaurant Settings — Melio',
  '/website-management': 'Website Management — Melio',
  '/website_management': 'Website Management — Melio',
  '/notifications': 'Notifications — Melio',
  '/audit-log': 'Audit Trail — Melio',
};

function TitleAndFaviconUpdater() {
  const location = useLocation();

  React.useEffect(() => {
    const path = location.pathname;
    let title = ROUTE_TITLES[path];
    if (!title) {
      if (path.startsWith('/customers/')) title = 'Customer Details — Melio';
      else if (path.startsWith('/online-order/')) title = 'Order Tracking — Melio';
      else if (path.startsWith('/pay/')) title = 'Pay your bill';
      else title = 'Melio — Restaurant Management';
    }
    document.title = title;

    let link = document.querySelector<HTMLLinkElement>("link[rel~='icon']");
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.getElementsByTagName('head')[0].appendChild(link);
    }
    link.type = 'image/svg+xml';
    link.href = '/favicon.svg';
  }, [location.pathname]);

  return null;
}

function App() {
  const { isAuthenticated, isLoading, user } = useAuth();

  if (isLoading) {
    return <PageLoader />;
  }

  return (
    <Suspense fallback={<PageLoader />}>
      <TitleAndFaviconUpdater />
      <Routes>
        <Route path="/order-online" element={<OnlineOrdering />} />
        <Route path="/online-order/:trackingToken" element={<OnlineOrderTracking />} />
        <Route path="/pay/:token" element={<PayLink />} />
        <Route path="/account" element={<CustomerAccount />} />
        <Route path="/customer/login" element={<Navigate to="/account" replace />} />
        <Route path="/customer/account" element={<Navigate to="/account" replace />} />
        <Route path="/login" element={isAuthenticated ? <Navigate to={getDefaultRoute(user)} replace /> : <Login />} />
        <Route path="/setup" element={<Setup />} />
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute allowedRoles={['OWNER', 'ADMIN', 'MANAGER', 'CASHIER', 'WAITER', 'CHEF', 'INVENTORY_MANAGER']}>
              <Dashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/deliveries"
          element={
            <ProtectedRoute allowedRoles={['OWNER', 'ADMIN', 'MANAGER', 'DELIVERY', 'CASHIER', 'WAITER']}>
              <DeliveryDashboard />
            </ProtectedRoute>
          }
        />
        <Route path="/delivery" element={<Navigate to="/deliveries" replace />} />
        <Route
          path="/automated-messaging"
          element={
            <ProtectedRoute allowedRoles={['OWNER', 'ADMIN']}>
              <AutomatedMessaging />
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
        <Route path="/floor-plan" element={<Navigate to="/tables" replace />} />
        <Route path="/sections" element={
          <ProtectedRoute allowedRoles={['OWNER', 'ADMIN', 'MANAGER']}>
            <Sections />
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
        <Route path="/menu/items" element={<Navigate to="/menu-items" replace />} />
        <Route path="/categories" element={
          <ProtectedRoute allowedRoles={['OWNER', 'ADMIN', 'MANAGER']}>
            <Categories />
          </ProtectedRoute>
        } />
        <Route path="/menu/categories" element={<Navigate to="/categories" replace />} />
        <Route path="/menu-preview" element={
          <ProtectedRoute allowedRoles={['OWNER', 'ADMIN', 'MANAGER', 'CASHIER', 'WAITER', 'CHEF']}>
            <MenuPreview />
          </ProtectedRoute>
        } />
        <Route path="/menu/preview" element={<Navigate to="/menu-preview" replace />} />
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
        <Route path="/loss-prevention" element={<ProtectedRoute allowedRoles={['OWNER','ADMIN','MANAGER']}><LossPrevention /></ProtectedRoute>} />
        <Route path="/tax-summary" element={<ProtectedRoute allowedRoles={['OWNER','ADMIN','MANAGER']}><TaxSummary /></ProtectedRoute>} />
        <Route path="/channel-report" element={<ProtectedRoute allowedRoles={['OWNER','ADMIN','MANAGER']}><ChannelReport /></ProtectedRoute>} />
        <Route path="/quick-purchase" element={<ProtectedRoute allowedRoles={['OWNER','ADMIN','MANAGER','INVENTORY_MANAGER','CASHIER']}><QuickPurchase /></ProtectedRoute>} />
        <Route path="/food-cost" element={<ProtectedRoute allowedRoles={['OWNER','ADMIN','MANAGER','INVENTORY_MANAGER']}><FoodCost /></ProtectedRoute>} />
        {/* Public landing page: visiting localhost:5173 always opens the Melio website. */}
        <Route path="/" element={<RestaurantWebsite />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}

export default App;
