import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Truck,
  MapPin,
  Phone,
  MessageCircle,
  Navigation,
  CheckCircle,
  Clock,
  Search,
  RefreshCw,
  ExternalLink,
  ChevronRight,
  PackageCheck,
  AlertCircle,
  DollarSign,
  User,
  ShoppingBag,
  Compass,
} from 'lucide-react';
import { orderApi } from '../../services/api';
import DeliveryMapViewer from '../../components/common/DeliveryMapViewer';
import { useAuth } from '../../contexts/AuthContext';

interface DeliveryOrder {
  id: string;
  orderNumber: string;
  orderType: string;
  customerName?: string | null;
  status: string;
  paymentStatus: string;
  totalAmount: number;
  notes?: string | null;
  createdAt: string;
  branch?: {
    id: string;
    name: string;
    phone?: string;
    address?: string;
  };
  onlineOrder?: {
    deliveryAddress?: string | null;
    contactPhone?: string | null;
    contactEmail?: string | null;
    fulfillmentType?: string;
    paymentMethod?: string;
    trackingToken?: string;
  } | null;
  items: Array<{
    id: string;
    quantity: number;
    itemNameSnapshot: string;
    unitPrice: number;
    notes?: string | null;
  }>;
}

export default function DeliveryDashboard() {
  const { user } = useAuth();
  const [orders, setOrders] = useState<DeliveryOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<'ALL' | 'READY' | 'OUT_FOR_DELIVERY' | 'COMPLETED'>('ALL');
  const [search, setSearch] = useState('');
  const [selectedOrder, setSelectedOrder] = useState<DeliveryOrder | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [error, setError] = useState<string>('');
  const [successMsg, setSuccessMsg] = useState<string>('');

  const fetchDeliveries = useCallback(async (isManual = false) => {
    if (isManual) setRefreshing(true);
    try {
      const res = await orderApi.getOrders({ limit: 100 });
      if (res.data?.success) {
        const allOrders: DeliveryOrder[] = (res.data.data?.orders || []).map((o: any) => ({
          ...o,
          items: Array.isArray(o.items) ? o.items : [],
        }));
        // Filter for orders that have delivery fulfillment or orderType === 'DELIVERY'
        const deliveryOnly = allOrders.filter(
          (o) =>
            o.orderType === 'DELIVERY' ||
            o.onlineOrder?.fulfillmentType === 'DELIVERY' ||
            !!o.onlineOrder?.deliveryAddress ||
            o.status === 'OUT_FOR_DELIVERY'
        );
        setOrders(deliveryOnly);
        if (selectedOrder) {
          const fresh = deliveryOnly.find((o) => o.id === selectedOrder.id);
          if (fresh) setSelectedOrder(fresh);
        }
      }
      setError('');
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to load delivery orders');
    } finally {
      setLoading(false);
      if (isManual) setRefreshing(false);
    }
  }, [selectedOrder]);

  useEffect(() => {
    fetchDeliveries();
    const interval = setInterval(() => fetchDeliveries(), 20000);
    return () => clearInterval(interval);
  }, [fetchDeliveries]);

  const handleUpdateStatus = async (orderId: string, nextStatus: string) => {
    setUpdatingId(orderId);
    setError('');
    // Optimistic update
    setOrders((prev) =>
      prev.map((o) => (o.id === orderId ? { ...o, status: nextStatus } : o))
    );
    if (selectedOrder?.id === orderId) {
      setSelectedOrder((prev) => (prev ? { ...prev, status: nextStatus } : null));
    }

    try {
      await orderApi.updateOrderStatus(orderId, nextStatus);
      setSuccessMsg(`Order updated to ${nextStatus.replace(/_/g, ' ')}`);
      setTimeout(() => setSuccessMsg(''), 4000);
      fetchDeliveries().catch(() => {});
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to update order status');
      fetchDeliveries().catch(() => {});
    } finally {
      setUpdatingId(null);
    }
  };

  const filteredOrders = useMemo(() => {
    return orders.filter((o) => {
      const matchesFilter =
        filter === 'ALL' ||
        (filter === 'READY' && (o.status === 'READY' || o.status === 'SUBMITTED' || o.status === 'PREPARING')) ||
        (filter === 'OUT_FOR_DELIVERY' && o.status === 'OUT_FOR_DELIVERY') ||
        (filter === 'COMPLETED' && (o.status === 'COMPLETED' || o.status === 'SERVED'));

      const q = search.toLowerCase().trim();
      const matchesSearch =
        !q ||
        o.orderNumber.toLowerCase().includes(q) ||
        (o.customerName && o.customerName.toLowerCase().includes(q)) ||
        (o.onlineOrder?.deliveryAddress && o.onlineOrder.deliveryAddress.toLowerCase().includes(q)) ||
        (o.onlineOrder?.contactPhone && o.onlineOrder.contactPhone.includes(q));

      return matchesFilter && matchesSearch;
    });
  }, [orders, filter, search]);

  const stats = useMemo(() => {
    const readyCount = orders.filter(
      (o) => o.status === 'READY' || o.status === 'SUBMITTED' || o.status === 'PREPARING'
    ).length;
    const transitCount = orders.filter((o) => o.status === 'OUT_FOR_DELIVERY').length;
    const completedCount = orders.filter(
      (o) => o.status === 'COMPLETED' || o.status === 'SERVED'
    ).length;
    return { readyCount, transitCount, completedCount, total: orders.length };
  }, [orders]);

  return (
    <div className="min-h-full space-y-6 p-4 sm:p-6 pb-20">
      {/* Top Banner & Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-gradient-to-tr from-orange-500 to-amber-500 text-white shadow-lg shadow-orange-500/25">
              <Truck size={24} />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100 flex items-center gap-2">
                Delivery Portal
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-orange-500/10 border border-orange-500/30 text-orange-500">
                  LIVE GPS & OSM
                </span>
              </h1>
              <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400">
                Logged in as <span className="font-semibold text-orange-600 dark:text-orange-400">{user?.email}</span> ({user?.roleName})
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={() => fetchDeliveries(true)}
            disabled={refreshing}
            className="inline-flex items-center gap-2 rounded-xl bg-white/10 dark:bg-white/5 border border-white/20 dark:border-white/10 px-4 py-2 text-xs sm:text-sm font-semibold text-gray-700 dark:text-gray-200 hover:bg-white/20 dark:hover:bg-white/10 transition shadow-sm backdrop-blur-md disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 text-orange-500 ${refreshing ? 'animate-spin' : ''}`} />
            {refreshing ? 'Refreshing...' : 'Refresh Orders'}
          </button>
        </div>
      </div>

      {/* Notifications / Alerts */}
      {error && (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-xs sm:text-sm text-red-600 dark:text-red-400 flex items-center gap-2.5 backdrop-blur-md">
          <AlertCircle size={16} className="shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {successMsg && (
        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-xs sm:text-sm text-emerald-600 dark:text-emerald-400 flex items-center gap-2.5 backdrop-blur-md animate-fadeIn">
          <CheckCircle size={16} className="shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* Metric Cards with Liquid Glass Effect */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {[
          {
            label: 'All Deliveries',
            value: stats.total,
            icon: ShoppingBag,
            color: 'from-blue-500/20 to-indigo-500/20 text-blue-500',
            active: filter === 'ALL',
            onClick: () => setFilter('ALL'),
          },
          {
            label: 'Ready for Courier',
            value: stats.readyCount,
            icon: Clock,
            color: 'from-amber-500/20 to-orange-500/20 text-amber-500',
            active: filter === 'READY',
            onClick: () => setFilter('READY'),
          },
          {
            label: 'Out for Delivery',
            value: stats.transitCount,
            icon: Navigation,
            color: 'from-orange-500/20 to-red-500/20 text-orange-500',
            active: filter === 'OUT_FOR_DELIVERY',
            onClick: () => setFilter('OUT_FOR_DELIVERY'),
          },
          {
            label: 'Delivered Today',
            value: stats.completedCount,
            icon: PackageCheck,
            color: 'from-emerald-500/20 to-teal-500/20 text-emerald-500',
            active: filter === 'COMPLETED',
            onClick: () => setFilter('COMPLETED'),
          },
        ].map((card, i) => {
          const Icon = card.icon;
          return (
            <button
              key={i}
              type="button"
              onClick={card.onClick}
              className={`p-4 rounded-2xl border text-left transition-all backdrop-blur-xl relative overflow-hidden group ${
                card.active
                  ? 'border-orange-500 bg-white/80 dark:bg-zinc-900/90 shadow-lg shadow-orange-500/15 scale-[1.02]'
                  : 'border-white/20 dark:border-white/10 bg-white/40 dark:bg-black/30 hover:border-orange-500/40'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">{card.label}</span>
                <div className={`p-2 rounded-xl bg-gradient-to-br ${card.color}`}>
                  <Icon size={16} />
                </div>
              </div>
              <div className="text-2xl font-black text-gray-900 dark:text-gray-100 mt-2 font-mono">
                {card.value}
              </div>
            </button>
          );
        })}
      </div>

      {/* Filter Tabs & Search */}
      <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
        <div className="relative flex-1 max-w-md">
          <input
            type="text"
            placeholder="Search by order #, customer, address or phone..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-2xl bg-white/50 dark:bg-zinc-900/50 backdrop-blur-md border border-white/20 dark:border-white/10 px-4 py-2.5 pl-10 text-xs sm:text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:border-orange-500 focus:outline-none transition shadow-sm"
          />
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
        </div>

        <div className="flex items-center gap-1.5 p-1 rounded-2xl bg-white/40 dark:bg-black/30 border border-white/15 dark:border-white/10 backdrop-blur-md overflow-x-auto">
          {[
            { id: 'ALL', label: 'All' },
            { id: 'READY', label: 'Pending / Ready' },
            { id: 'OUT_FOR_DELIVERY', label: 'In Transit' },
            { id: 'COMPLETED', label: 'Delivered' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setFilter(tab.id as any)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition whitespace-nowrap ${
                filter === tab.id
                  ? 'bg-orange-500 text-white shadow-md shadow-orange-500/25'
                  : 'text-gray-600 dark:text-gray-400 hover:text-orange-500'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Deliveries Grid */}
      {loading ? (
        <div className="py-20 text-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-orange-500 border-t-transparent mx-auto mb-3" />
          <p className="text-xs uppercase tracking-widest text-gray-400">Loading delivery map orders...</p>
        </div>
      ) : filteredOrders.length === 0 ? (
        <div className="py-16 text-center rounded-3xl border border-white/15 dark:border-white/10 bg-white/30 dark:bg-black/20 backdrop-blur-xl">
          <Truck size={40} className="text-gray-400 mx-auto mb-3 opacity-60" />
          <h3 className="text-base font-bold text-gray-900 dark:text-gray-100">No Delivery Orders Found</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 max-w-md mx-auto">
            {search
              ? 'No deliveries match your search query.'
              : 'There are currently no delivery orders assigned in this view.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {filteredOrders.map((order) => {
            const rawAddress =
              order.onlineOrder?.deliveryAddress || order.notes || 'Nairobi Area [geo:-1.286389,36.817223]';
            const cleanAddress = rawAddress.replace(/\s*\[geo:[-\d.]+,\s*[-\d.]+\]/, '');
            const phone = order.onlineOrder?.contactPhone;
            const isUpdating = updatingId === order.id;

            return (
              <div
                key={order.id}
                className="rounded-3xl border border-white/20 dark:border-white/10 bg-white/70 dark:bg-zinc-900/80 backdrop-blur-2xl shadow-xl overflow-hidden flex flex-col transition hover:shadow-2xl hover:border-orange-500/40"
              >
                {/* Order Top Bar */}
                <div className="p-4 sm:p-5 border-b border-orange-500/10 dark:border-white/5 flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-lg font-black text-gray-900 dark:text-gray-100 font-mono">
                        {order.orderNumber}
                      </span>
                      <span
                        className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full uppercase tracking-wider ${
                          order.status === 'OUT_FOR_DELIVERY'
                            ? 'bg-orange-500/20 text-orange-600 dark:text-orange-400 border border-orange-500/40 animate-pulse'
                            : order.status === 'COMPLETED' || order.status === 'SERVED'
                            ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/40'
                            : 'bg-amber-500/20 text-amber-600 dark:text-amber-400 border border-amber-500/40'
                        }`}
                      >
                        {order.status.replace(/_/g, ' ')}
                      </span>
                    </div>

                    <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400 mt-1">
                      <span className="flex items-center gap-1 font-semibold text-gray-800 dark:text-gray-200">
                        <User size={13} className="text-orange-500" />
                        {order.customerName || 'Customer'}
                      </span>
                      <span>•</span>
                      <span>{new Date(order.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      <span>•</span>
                      <span className="font-bold text-orange-600 dark:text-orange-400">
                        KES {order.totalAmount.toLocaleString()}
                      </span>
                    </div>
                  </div>

                  {/* Call & WhatsApp Quick Buttons */}
                  {phone && (
                    <div className="flex items-center gap-1.5 shrink-0">
                      <a
                        href={`tel:${phone}`}
                        className="p-2 rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/25 transition"
                        title={`Call ${phone}`}
                      >
                        <Phone size={15} />
                      </a>
                      <a
                        href={`https://wa.me/${phone.replace(/[^0-9]/g, '')}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-2 rounded-xl bg-emerald-600 text-white shadow-md shadow-emerald-600/30 hover:bg-emerald-700 transition"
                        title="Chat on WhatsApp"
                      >
                        <MessageCircle size={15} />
                      </a>
                    </div>
                  )}
                </div>

                {/* Embedded Live OpenStreetMap Viewer */}
                <div className="p-4 sm:p-5">
                  <DeliveryMapViewer
                    address={rawAddress}
                    customerName={order.customerName || undefined}
                    orderNumber={order.orderNumber}
                    branchName={order.branch?.name || (order as any).branchName || 'Melio Kitchen'}
                  />
                </div>

                {/* Items & Delivery Address Details */}
                <div className="px-4 sm:px-5 pb-4 space-y-3 flex-1 flex flex-col justify-between">
                  <div className="p-3 rounded-2xl bg-orange-500/5 dark:bg-white/5 border border-orange-500/10 dark:border-white/5 text-xs space-y-1">
                    <div className="flex items-start gap-1.5 text-gray-700 dark:text-gray-300">
                      <MapPin size={14} className="text-orange-500 shrink-0 mt-0.5" />
                      <span className="font-medium leading-relaxed">{cleanAddress}</span>
                    </div>
                    {phone && (
                      <div className="text-[11px] text-gray-500 dark:text-gray-400 pl-5">
                        Contact: <span className="font-mono font-semibold">{phone}</span>
                      </div>
                    )}
                  </div>

                  {/* Items summary */}
                  <div className="space-y-1">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Order Items</span>
                    <div className="space-y-1 max-h-24 overflow-y-auto pr-1">
                      {(order.items || []).map((item, idx) => (
                        <div key={idx} className="flex items-center justify-between text-xs text-gray-700 dark:text-gray-300">
                          <span>
                            <span className="font-bold text-orange-500">{item.quantity}×</span> {item.itemNameSnapshot}
                          </span>
                          <span className="font-mono text-gray-500">KES {(item.unitPrice * item.quantity).toLocaleString()}</span>
                        </div>
                      ))}
                      {(!order.items || order.items.length === 0) && (
                        <p className="text-[11px] text-gray-400 italic">No specific items detailed</p>
                      )}
                    </div>
                  </div>

                  {/* Workflow Action Buttons */}
                  <div className="pt-2 flex flex-col sm:flex-row gap-2">
                    {order.status !== 'OUT_FOR_DELIVERY' && order.status !== 'COMPLETED' && order.status !== 'SERVED' && (
                      <button
                        type="button"
                        onClick={() => handleUpdateStatus(order.id, 'OUT_FOR_DELIVERY')}
                        disabled={isUpdating}
                        className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-2xl bg-gradient-to-r from-orange-500 to-amber-500 text-white text-xs font-bold shadow-lg shadow-orange-500/25 hover:from-orange-600 hover:to-amber-600 transition disabled:opacity-50"
                      >
                        <Navigation size={14} />
                        <span>Pick Up & Start Delivery</span>
                      </button>
                    )}

                    {order.status === 'OUT_FOR_DELIVERY' && (
                      <button
                        type="button"
                        onClick={() => handleUpdateStatus(order.id, 'COMPLETED')}
                        disabled={isUpdating}
                        className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-500 text-white text-xs font-bold shadow-lg shadow-emerald-500/25 hover:from-emerald-600 hover:to-teal-600 transition disabled:opacity-50"
                      >
                        <CheckCircle size={14} />
                        <span>Confirm Delivered to Customer</span>
                      </button>
                    )}

                    {(order.status === 'COMPLETED' || order.status === 'SERVED') && (
                      <div className="w-full py-2 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-500 text-center text-xs font-bold flex items-center justify-center gap-1.5">
                        <CheckCircle size={14} /> Delivered Successfully
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
