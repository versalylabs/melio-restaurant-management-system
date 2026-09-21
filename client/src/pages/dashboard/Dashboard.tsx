import { useState, useEffect, useMemo } from 'react';
import { ArrowUpRight, CalendarDays, ChefHat, ClipboardList, CreditCard, LayoutGrid, Package, RefreshCw, ShoppingBag, Users, UtensilsCrossed, CircleDollarSign, Clock3 } from 'lucide-react';
import { dashboardApi } from '../../services/api';
import type { DashboardMetrics } from '../../types';
import { useAuth } from '../../contexts/AuthContext';
import { LiquidGlass } from '../../components/react-bits';

const money = (value: number) => `KSh ${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function TrendChart({ points }: { points: DashboardMetrics['salesTrend'] }) {
  const { path, area, max } = useMemo(() => {
    const values = points.map((p) => p.sales);
    const maximum = Math.max(...values, 1);
    const width = 640;
    const height = 210;
    const step = points.length > 1 ? width / (points.length - 1) : width;
    const coords = points.map((p, index) => {
      const x = index * step;
      const y = height - (p.sales / maximum) * (height - 28) - 12;
      return [x, y];
    });
    const line = coords.map(([x, y], i) => `${i === 0 ? 'M' : 'L'} ${x} ${y}`).join(' ');
    const fill = `${line} L ${width} ${height} L 0 ${height} Z`;
    return { path: line, area: fill, max: maximum };
  }, [points]);

  const hasSales = points.some((point) => point.sales > 0);
  return (
    <div className="h-72">
      <div className="flex h-56 items-stretch gap-3">
        <div className="flex flex-col justify-between text-[10px] text-gray-400 dark:text-gray-500 py-1">
          {[max, max * 0.66, max * 0.33, 0].map((value, index) => <span key={index}>{value >= 1000 ? `${(value / 1000).toFixed(1)}k` : Math.round(value)}</span>)}
        </div>
        <div className="relative flex-1">
          {!hasSales && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center rounded-xl border border-dashed border-orange-100 bg-orange-50/40 dark:border-gray-800 dark:bg-[#111116]/40">
              <CircleDollarSign className="h-7 w-7 text-orange-400" />
              <p className="mt-2 text-sm font-medium text-gray-600 dark:text-gray-300">No completed sales yet</p>
              <p className="mt-1 text-xs text-gray-400">Sales performance will appear here once completed sales are recorded.</p>
            </div>
          )}
          <div className="absolute inset-0 flex flex-col justify-between py-2 pointer-events-none">
            {[0, 1, 2, 3].map((line) => <div key={line} className="border-t border-dashed border-gray-100 dark:border-gray-700/70" />)}
          </div>
          <svg viewBox="0 0 640 210" preserveAspectRatio="none" className="relative h-full w-full overflow-visible">
            <defs>
              <linearGradient id="dashboardSalesFill" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="#f97316" stopOpacity="0.22" />
                <stop offset="100%" stopColor="#f97316" stopOpacity="0.01" />
              </linearGradient>
            </defs>
            <path d={area} fill="url(#dashboardSalesFill)" />
            <path d={path} fill="none" stroke="#f97316" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      </div>
      <div className="ml-7 grid grid-cols-7 gap-1 pt-2 text-center text-[11px] text-gray-400 dark:text-gray-500">
        {points.map((point) => <span key={point.date}>{new Date(`${point.date}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short' })}</span>)}
      </div>
    </div>
  );
}


type DonutSegment = { label: string; value: number; color: string };

function DonutChart({ segments, centerLabel, centerValue }: { segments: DonutSegment[]; centerLabel: string; centerValue: string }) {
  const total = Math.max(segments.reduce((sum, segment) => sum + Math.max(0, segment.value), 0), 1);
  const radius = 43;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <div className="relative flex h-32 w-32 shrink-0 items-center justify-center">
      <svg viewBox="0 0 110 110" className="h-full w-full -rotate-90">
        <circle cx="55" cy="55" r={radius} fill="none" stroke="currentColor" className="text-orange-50 dark:text-gray-800" strokeWidth="10" />
        {segments.map((segment) => {
          const value = Math.max(0, segment.value);
          if (!value) return null;
          const length = (value / total) * circumference;
          const dash = `${Math.max(length - 2, 0)} ${circumference}`;
          const currentOffset = -offset;
          offset += length;
          return <circle key={segment.label} cx="55" cy="55" r={radius} fill="none" stroke={segment.color} strokeWidth="10" strokeLinecap="round" strokeDasharray={dash} strokeDashoffset={currentOffset} />;
        })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="text-lg font-bold tracking-tight text-gray-900 dark:text-white">{centerValue}</span>
        <span className="mt-0.5 max-w-[74px] text-[9px] font-medium uppercase tracking-wide text-gray-400">{centerLabel}</span>
      </div>
    </div>
  );
}

function Legend({ segments }: { segments: DonutSegment[] }) {
  return (
    <div className="grid min-w-0 flex-1 grid-cols-2 gap-x-3 gap-y-2">
      {segments.map((segment) => (
        <div key={segment.label} className="min-w-0">
          <div className="flex items-center gap-1.5"><span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: segment.color }} /><span className="truncate text-[10px] text-gray-400">{segment.label}</span></div>
          <p className="mt-0.5 pl-3.5 text-sm font-semibold text-gray-800 dark:text-gray-200">{segment.value}</p>
        </div>
      ))}
    </div>
  );
}

const statusClass = (status: string) => {
  if (status === 'COMPLETED') return 'bg-green-50 text-green-700 dark:bg-green-900/25 dark:text-green-300';
  if (status === 'CANCELLED') return 'bg-red-50 text-red-700 dark:bg-red-900/25 dark:text-red-300';
  return 'bg-orange-50 text-orange-700 dark:bg-orange-900/25 dark:text-orange-300';
};

export default function Dashboard() {
  const { user } = useAuth();
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchMetrics = async () => {
    setError('');
    try {
      const response = await dashboardApi.getMetrics();
      if (response.data.success) setMetrics(response.data.data);
      else setError(response.data.message || 'Failed to load dashboard');
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchMetrics(); }, []);

  if (loading) return <div className="flex h-full items-center justify-center text-sm text-gray-500 dark:text-gray-400">Loading your dashboard...</div>;
  if (error) return <div className="flex h-full items-center justify-center text-red-600 dark:text-red-400">{error}</div>;

  const data = metrics?.metrics;
  const orderTypes = metrics?.orderTypes || [];
  const maxOrderType = Math.max(...orderTypes.map((x) => x.count), 1);

  const cards = [
    { label: 'Total Sales', value: money(data?.todaySales || 0), detail: 'Completed today', icon: CircleDollarSign, glow: 'orange' as const },
    { label: 'Total Orders', value: data?.todayOrders || 0, detail: `${data?.pendingOrders || 0} active now`, icon: ClipboardList, glow: 'amber' as const },
    { label: 'Customers', value: data?.totalCustomers || 0, detail: 'Registered customers', icon: Users, glow: 'orange' as const },
    { label: 'Avg. Order Value', value: money(data?.averageOrderValue || 0), detail: 'Completed orders', icon: CreditCard, glow: 'neutral' as const },
  ];

  return (
    <div className="min-h-full bg-[#faf9f7] dark:bg-[#0b0b0f] px-5 py-5 md:px-7 md:py-6">
      <div className="mx-auto max-w-[1600px] space-y-5">
        <section className="relative flex flex-col gap-4 rounded-2xl md:rounded-3xl border border-orange-500/15 bg-white/80 p-5 shadow-[0_8px_30px_rgb(0,0,0,0.04)] backdrop-blur-xl dark:border-white/10 dark:bg-[#121218]/85 dark:shadow-[0_8px_32px_0_rgba(0,0,0,0.35)] liquid-glass-card lg:flex-row lg:items-center lg:justify-between">
          <div className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-orange-400/40 dark:via-white/20 to-transparent pointer-events-none" />
          <div className="relative z-10">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-orange-500"><LayoutGrid className="h-3.5 w-3.5" /> Restaurant overview</div>
            <h1 className="mt-2 text-2xl font-bold tracking-tight text-gray-900 dark:text-white">Hello, {user?.firstName || 'there'} <span className="inline-block">👋</span></h1>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Here is what is happening across your restaurant today.</p>
          </div>
          <div className="relative z-10 flex items-center gap-3 self-start lg:self-auto">
            <div className="hidden rounded-xl border border-orange-500/10 bg-white/60 px-4 py-2 text-right dark:border-white/10 dark:bg-white/[0.03] backdrop-blur-md sm:block">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Today</div>
              <div className="text-sm font-semibold text-gray-800 dark:text-gray-200">{new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}</div>
            </div>
            <button onClick={fetchMetrics} className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-orange-500 to-amber-500 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-orange-500/20 transition hover:from-orange-600 hover:to-amber-600">
              <RefreshCw className="h-4 w-4" /> Refresh
            </button>
          </div>
        </section>

        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {cards.map(({ label, value, detail, icon: Icon, glow }) => (
            <LiquidGlass key={label} glowColor={glow} blur="xl" className="p-5">
              <div className="flex items-start justify-between">
                <div className="rounded-xl p-2.5 bg-gradient-to-br from-orange-500 to-amber-500 text-white shadow-sm shadow-orange-500/30"><Icon className="h-5 w-5" /></div>
                <ArrowUpRight className="h-4 w-4 text-gray-300 transition group-hover:text-orange-500" />
              </div>
              <div className="mt-6">
                <p className="text-xs font-medium text-gray-500 dark:text-gray-400">{label}</p>
                <p className="mt-1 text-2xl font-bold tracking-tight text-gray-900 dark:text-white">{value}</p>
                <p className="mt-2 text-xs text-gray-400 dark:text-gray-500">{detail}</p>
              </div>
            </LiquidGlass>
          ))}
        </section>

        <section className="grid grid-cols-1 gap-5 xl:grid-cols-12">
          <div className="xl:col-span-8 relative overflow-hidden rounded-2xl md:rounded-3xl border border-orange-500/15 bg-white/80 p-5 shadow-[0_8px_30px_rgb(0,0,0,0.04)] backdrop-blur-xl dark:border-white/10 dark:bg-[#121218]/85 dark:shadow-[0_8px_32px_0_rgba(0,0,0,0.35)] liquid-glass-card">
            <div className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-orange-400/40 dark:via-white/20 to-transparent pointer-events-none" />
            <div className="relative z-10 mb-3 flex items-center justify-between">
              <div><h2 className="font-semibold text-gray-900 dark:text-white">Sales performance</h2><p className="text-xs text-gray-500 dark:text-gray-400">Completed sales over the last 7 days</p></div>
              <div className="inline-flex items-center gap-1.5 rounded-xl border border-orange-500/20 bg-orange-50/80 px-3 py-1.5 text-xs font-semibold text-orange-600 dark:bg-orange-500/10 dark:text-orange-300"><CalendarDays className="h-3.5 w-3.5" /> This week</div>
            </div>
            <div className="relative z-10"><TrendChart points={metrics?.salesTrend || []} /></div>
          </div>

          <div className="xl:col-span-4 relative overflow-hidden rounded-2xl md:rounded-3xl border border-orange-500/15 bg-white/80 p-5 shadow-[0_8px_30px_rgb(0,0,0,0.04)] backdrop-blur-xl dark:border-white/10 dark:bg-[#121218]/85 dark:shadow-[0_8px_32px_0_rgba(0,0,0,0.35)] liquid-glass-card">
            <div className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-orange-400/40 dark:via-white/20 to-transparent pointer-events-none" />
            <div className="relative z-10 flex items-center justify-between"><div><h2 className="font-semibold text-gray-900 dark:text-white">Order flow</h2><p className="text-xs text-gray-500 dark:text-gray-400">Orders by type this week</p></div><ShoppingBag className="h-5 w-5 text-orange-500" /></div>
            <div className="relative z-10 mt-6 space-y-5">
              {orderTypes.length ? orderTypes.map((row) => (
                <div key={row.type}>
                  <div className="mb-2 flex justify-between text-xs"><span className="font-medium text-gray-700 dark:text-gray-300">{row.type.replace(/_/g, ' ')}</span><span className="text-gray-400">{row.count} orders</span></div>
                  <div className="h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-white/10"><div className="h-full rounded-full bg-gradient-to-r from-orange-500 to-amber-500" style={{ width: `${Math.max((row.count / maxOrderType) * 100, 8)}%` }} /></div>
                </div>
              )) : <div className="py-12 text-center text-sm text-gray-400">No orders in this period yet.</div>}
            </div>
            <div className="relative z-10 mt-7 grid grid-cols-3 gap-2 border-t border-orange-500/10 pt-4 dark:border-white/10">
              <div><p className="text-[10px] uppercase tracking-wider text-gray-400">Available tables</p><p className="mt-1 text-lg font-bold text-gray-900 dark:text-white">{data?.availableTables || 0}</p></div>
              <div><p className="text-[10px] uppercase tracking-wider text-gray-400">Occupied</p><p className="mt-1 text-lg font-bold text-gray-900 dark:text-white">{data?.occupiedTables || 0}</p></div>
              <div><p className="text-[10px] uppercase tracking-wider text-gray-400">Reserved</p><p className="mt-1 text-lg font-bold text-gray-900 dark:text-white">{data?.reservedTables || 0}</p></div>
            </div>
          </div>
        </section>

        <section className="grid grid-cols-1 gap-5 xl:grid-cols-12">
          <div className="xl:col-span-7 relative overflow-hidden rounded-2xl md:rounded-3xl border border-orange-500/15 bg-white/80 p-5 shadow-[0_8px_30px_rgb(0,0,0,0.04)] backdrop-blur-xl dark:border-white/10 dark:bg-[#121218]/85 dark:shadow-[0_8px_32px_0_rgba(0,0,0,0.35)] liquid-glass-card">
            <div className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-orange-400/40 dark:via-white/20 to-transparent pointer-events-none" />
            <div className="relative z-10 flex items-center justify-between"><div><h2 className="font-semibold text-gray-900 dark:text-white">Recent orders</h2><p className="text-xs text-gray-500 dark:text-gray-400">The latest activity from your POS and kitchen flow</p></div><a href="/orders" className="text-xs font-semibold text-orange-600 hover:text-orange-700">View all</a></div>
            <div className="relative z-10 mt-4 overflow-x-auto">
              <table className="w-full min-w-[620px] text-left text-sm">
                <thead className="text-[10px] uppercase tracking-wider text-gray-400"><tr className="border-b border-orange-500/10 dark:border-white/10"><th className="pb-3 font-medium">Order</th><th className="pb-3 font-medium">Items</th><th className="pb-3 font-medium">Type</th><th className="pb-3 font-medium">Amount</th><th className="pb-3 text-right font-medium">Status</th></tr></thead>
                <tbody>{(metrics?.recentOrders || []).map((order) => <tr key={order.id} className="border-b border-orange-500/5 last:border-0 dark:border-white/5"><td className="py-4"><div className="font-semibold text-gray-800 dark:text-gray-200">{order.orderNumber}</div><div className="mt-0.5 text-xs text-gray-400">{order.customerName || 'Walk-in customer'}</div></td><td className="py-4 text-xs text-gray-500 dark:text-gray-400">{order.items.map((i) => `${i.quantity}× ${i.itemNameSnapshot}`).join(', ') || '—'}</td><td className="py-4 text-xs text-gray-500 dark:text-gray-400">{order.orderType.replace(/_/g, ' ')}</td><td className="py-4 font-semibold text-gray-800 dark:text-gray-200">{money(order.totalAmount)}</td><td className="py-4 text-right"><span className={`rounded-md px-2 py-1 text-[10px] font-semibold ${statusClass(order.status)}`}>{order.status}</span></td></tr>)}</tbody>
              </table>
              {!metrics?.recentOrders?.length && <div className="py-12 text-center text-sm text-gray-400">No recent orders yet.</div>}
            </div>
          </div>

          <div className="xl:col-span-5 relative overflow-hidden rounded-2xl md:rounded-3xl border border-orange-500/15 bg-white/80 p-5 shadow-[0_8px_30px_rgb(0,0,0,0.04)] backdrop-blur-xl dark:border-white/10 dark:bg-[#121218]/85 dark:shadow-[0_8px_32px_0_rgba(0,0,0,0.35)] liquid-glass-card">
            <div className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-orange-400/40 dark:via-white/20 to-transparent pointer-events-none" />
            <div className="relative z-10 flex items-center justify-between"><div><h2 className="font-semibold text-gray-900 dark:text-white">Trending menu</h2><p className="text-xs text-gray-500 dark:text-gray-400">Best-performing items this week</p></div><ChefHat className="h-5 w-5 text-orange-500" /></div>
            <div className="relative z-10 mt-4 space-y-3">{(metrics?.topMenuItems || []).map((item, index) => <div key={item.id} className="flex items-center gap-3 rounded-2xl border border-orange-500/10 bg-white/50 p-3 transition hover:border-orange-500/30 hover:bg-orange-500/5 dark:border-white/10 dark:bg-white/[0.02] dark:hover:border-white/20"><div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-xl bg-orange-50 text-xs font-bold text-orange-500 dark:bg-orange-500/10">{item.image ? <img src={item.image} alt="" className="h-full w-full object-cover" /> : `#${index + 1}`}</div><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-gray-800 dark:text-gray-200">{item.name}</p><p className="text-xs text-gray-400">{item.quantity} sold</p></div><p className="text-sm font-semibold text-orange-600 dark:text-orange-400">{money(item.price)}</p></div>)}</div>
            {!metrics?.topMenuItems?.length && <div className="py-10 text-center text-sm text-gray-400">Complete some orders to see menu trends.</div>}
          </div>
        </section>

        <section className="grid grid-cols-1 gap-5 xl:grid-cols-3">
          {(() => {
            const tableSegments: DonutSegment[] = [
              { label: 'Available', value: data?.availableTables || 0, color: '#f97316' },
              { label: 'Occupied', value: data?.occupiedTables || 0, color: '#334155' },
              { label: 'Reserved', value: data?.reservedTables || 0, color: '#fb923c' },
              { label: 'Cleaning', value: data?.cleaningTables || 0, color: '#cbd5e1' },
              { label: 'Out of service', value: data?.outOfServiceTables || 0, color: '#ef4444' },
            ];
            const menuSegments: DonutSegment[] = [
              { label: 'Available', value: data?.activeMenuItems || 0, color: '#f97316' },
              { label: 'Unavailable', value: data?.unavailableItems || 0, color: '#cbd5e1' },
            ];
            const pulse = (metrics?.salesTrend || []).slice(-7);
            const maxPulse = Math.max(...pulse.map((point) => point.orders), 1);
            return <>
              <div className="relative overflow-hidden rounded-2xl md:rounded-3xl border border-orange-500/15 bg-white/80 p-5 shadow-[0_8px_30px_rgb(0,0,0,0.04)] backdrop-blur-xl dark:border-white/10 dark:bg-[#121218]/85 dark:shadow-[0_8px_32px_0_rgba(0,0,0,0.35)] liquid-glass-card">
                <div className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-orange-400/40 dark:via-white/20 to-transparent pointer-events-none" />
                <div className="relative z-10 flex items-center gap-3"><div className="rounded-xl bg-orange-50 p-2.5 text-orange-500 dark:bg-orange-500/10"><UtensilsCrossed className="h-5 w-5" /></div><div><p className="text-xs text-gray-500">Table status</p><p className="text-lg font-bold text-gray-900 dark:text-white">{data?.totalTables || 0} tables</p></div></div>
                <div className="relative z-10 mt-4 flex items-center gap-4"><DonutChart segments={tableSegments} centerValue={`${data?.totalTables || 0}`} centerLabel="Total tables" /><Legend segments={tableSegments} /></div>
              </div>

              <div className="relative overflow-hidden rounded-2xl md:rounded-3xl border border-orange-500/15 bg-white/80 p-5 shadow-[0_8px_30px_rgb(0,0,0,0.04)] backdrop-blur-xl dark:border-white/10 dark:bg-[#121218]/85 dark:shadow-[0_8px_32px_0_rgba(0,0,0,0.35)] liquid-glass-card">
                <div className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-orange-400/40 dark:via-white/20 to-transparent pointer-events-none" />
                <div className="relative z-10 flex items-center gap-3"><div className="rounded-xl bg-orange-50 p-2.5 text-orange-500 dark:bg-orange-500/10"><Package className="h-5 w-5" /></div><div><p className="text-xs text-gray-500">Menu availability</p><p className="text-lg font-bold text-gray-900 dark:text-white">{data?.activeMenuItems || 0} ready to sell</p></div></div>
                <div className="relative z-10 mt-4 flex items-center gap-5"><DonutChart segments={menuSegments} centerValue={`${data?.totalMenuItems || 0}`} centerLabel="Menu items" /><div className="flex-1"><Legend segments={menuSegments} /><div className="mt-4 rounded-xl bg-orange-50/70 px-3 py-2.5 text-xs text-orange-700 dark:bg-orange-500/10 dark:text-orange-300"><span className="font-semibold">Menu health:</span> {data?.totalMenuItems ? Math.round(((data?.activeMenuItems || 0) / data.totalMenuItems) * 100) : 0}% of items are available.</div></div></div>
              </div>

              <div className="relative overflow-hidden rounded-2xl md:rounded-3xl border border-orange-500/15 bg-white/80 p-5 shadow-[0_8px_30px_rgb(0,0,0,0.04)] backdrop-blur-xl dark:border-white/10 dark:bg-[#121218]/85 dark:shadow-[0_8px_32px_0_rgba(0,0,0,0.35)] liquid-glass-card">
                <div className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-orange-400/40 dark:via-white/20 to-transparent pointer-events-none" />
                <div className="relative z-10 flex items-center justify-between"><div><h2 className="font-semibold text-gray-900 dark:text-white">Service pulse</h2><p className="text-xs text-gray-500 dark:text-gray-400">A quick read on restaurant activity</p></div><Clock3 className="h-5 w-5 text-orange-500" /></div>
                <div className="relative z-10 mt-5 grid grid-cols-2 gap-3"><div className="rounded-xl border border-orange-100 bg-orange-50/60 p-3 dark:border-orange-500/10 dark:bg-orange-500/5"><p className="text-[10px] font-semibold uppercase tracking-wider text-orange-500">Active orders</p><p className="mt-1 text-2xl font-bold text-gray-900 dark:text-white">{data?.pendingOrders || 0}</p><p className="mt-1 text-[10px] text-gray-400">Currently in flow</p></div><div className="rounded-xl border border-orange-500/10 bg-white/40 p-3 dark:border-white/10 dark:bg-white/[0.02]"><p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Low stock</p><p className="mt-1 text-2xl font-bold text-gray-900 dark:text-white">{data?.lowStock || 0}</p><p className="mt-1 text-[10px] text-gray-400">Items to review</p></div></div>
                <div className="relative z-10 mt-5"><div className="mb-2 flex items-center justify-between"><p className="text-xs font-medium text-gray-700 dark:text-gray-300">Order activity</p><span className="text-[10px] text-gray-400">Last 7 days</span></div><div className="flex h-20 items-end gap-2">{pulse.map((point) => <div key={point.date} className="flex flex-1 flex-col items-center gap-1.5"><div className="flex h-14 w-full items-end rounded-lg bg-orange-50 px-1 dark:bg-orange-500/5"><div className="w-full rounded-md bg-orange-500/85" style={{ height: `${Math.max((point.orders / maxPulse) * 100, point.orders ? 12 : 0)}%` }} /></div><span className="text-[9px] text-gray-400">{new Date(`${point.date}T00:00:00`).toLocaleDateString(undefined, { weekday: 'narrow' })}</span></div>)}</div></div>
              </div>
            </>;
          })()}
        </section>
      </div>
    </div>
  );
}
