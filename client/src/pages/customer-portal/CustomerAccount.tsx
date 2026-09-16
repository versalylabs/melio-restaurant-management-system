import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  User,
  ShoppingBag,
  Calendar,
  Heart,
  Award,
  MapPin,
  Phone,
  Mail,
  ArrowRight,
  LogOut,
  UtensilsCrossed,
  Sparkles,
  RotateCcw,
  CheckCircle2,
  AlertCircle
} from 'lucide-react';
import { useCustomerAuth } from '../../contexts/CustomerAuthContext';
import { customerPortalApi, publicOrderingApi } from '../../services/api';
import { GlassIcon, SpotlightCard, ShinyText, CountUp } from '../../components/react-bits';

const money = (val: number, currency = 'KES') =>
  new Intl.NumberFormat('en-KE', { style: 'currency', currency, maximumFractionDigits: 0 }).format(val);

type TabType = 'overview' | 'orders' | 'reservations' | 'favorites' | 'profile';

export default function CustomerAccount() {
  const { customer, isAuthenticated, isLoading, logout, updateProfile } = useCustomerAuth();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<TabType>('overview');

  const [orders, setOrders] = useState<any[]>([]);
  const [reservations, setReservations] = useState<any[]>([]);
  const [loyalty, setLoyalty] = useState<{ balance: number; tier: string; transactions: any[] }>({
    balance: 0,
    tier: 'Bronze',
    transactions: [],
  });
  const [menuItems, setMenuItems] = useState<any[]>([]);
  const [restaurant, setRestaurant] = useState<any>(null);

  // Profile Form state
  const [profileForm, setProfileForm] = useState({ name: '', phone: '', email: '', address: '' });
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileSuccess, setProfileSuccess] = useState(false);
  const [profileError, setProfileError] = useState('');

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      navigate('/');
    }
  }, [isLoading, isAuthenticated, navigate]);

  useEffect(() => {
    if (customer) {
      setProfileForm({
        name: customer.name || '',
        phone: customer.phone || '',
        email: customer.email || '',
        address: customer.address || '',
      });
    }
  }, [customer]);

  useEffect(() => {
    if (!isAuthenticated) return;

    // Load orders
    customerPortalApi.getOrders().then((res) => {
      if (res.data?.success) setOrders(res.data.data?.orders || []);
    }).catch(() => {});

    // Load reservations
    customerPortalApi.getReservations().then((res) => {
      if (res.data?.success) setReservations(res.data.data?.reservations || []);
    }).catch(() => {});

    // Load loyalty
    customerPortalApi.getLoyalty().then((res) => {
      if (res.data?.success) setLoyalty(res.data.data || { balance: 0, tier: 'Bronze', transactions: [] });
    }).catch(() => {});

    // Load restaurant menu for favorites
    publicOrderingApi.getRestaurants().then((res) => {
      const first = res.data.data?.restaurants?.[0];
      if (first) {
        setRestaurant(first);
        const branchId = first.branches?.[0]?.id;
        if (branchId) {
          publicOrderingApi.getMenu({ restaurantId: first.id, branchId }).then((mRes) => {
            setMenuItems(mRes.data.data?.items || []);
          }).catch(() => {});
        }
      }
    }).catch(() => {});
  }, [isAuthenticated]);

  const handleProfileSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileSaving(true);
    setProfileSuccess(false);
    setProfileError('');

    try {
      await updateProfile(profileForm);
      setProfileSuccess(true);
      setTimeout(() => setProfileSuccess(false), 3000);
    } catch (err: any) {
      setProfileError(err.response?.data?.message || 'Failed to save profile changes.');
    } finally {
      setProfileSaving(false);
    }
  };

  const handleReorder = (_order?: any) => {
    // Navigate to online ordering
    navigate('/order-online');
  };

  const favoriteDishes = menuItems.filter((item) =>
    (customer?.favoriteItemIds || []).includes(item.id)
  );

  if (isLoading) {
    return (
      <div className="min-h-screen grid place-items-center bg-[#0d0d11] text-orange-400">
        <div className="flex flex-col items-center gap-3">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-orange-500 border-t-transparent" />
          <span className="text-sm font-serif tracking-widest uppercase text-gray-300">Loading Diners Hub...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#faf9f7] text-slate-800 dark:bg-[#0d0d11] dark:text-gray-100 antialiased">
      {/* Top Header */}
      <header className="sticky top-0 z-30 border-b border-orange-500/10 bg-black/60 backdrop-blur-xl text-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-4 sm:px-8">
          <Link to="/" className="flex items-center gap-3 group">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-orange-500 text-white shadow-lg shadow-orange-500/25">
              <UtensilsCrossed size={20} />
            </div>
            <div>
              <div className="font-serif text-lg font-bold">{restaurant?.name || 'Melio'}</div>
              <div className="text-[10px] uppercase tracking-[0.2em] text-orange-400">Guest Experience Hub</div>
            </div>
          </Link>

          <div className="flex items-center gap-3">
            <Link
              to="/order-online"
              className="hidden sm:inline-flex items-center gap-1.5 rounded-xl bg-orange-500 px-4 py-2 text-xs font-bold uppercase tracking-wider text-white hover:bg-orange-600 transition shadow-md shadow-orange-500/20"
            >
              <ShoppingBag size={14} /> Order Menu
            </Link>

            <button
              onClick={logout}
              className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3.5 py-2 text-xs font-semibold text-gray-300 hover:bg-red-500/20 hover:text-red-300 hover:border-red-500/30 transition"
            >
              <LogOut size={14} /> <span className="hidden sm:inline">Sign Out</span>
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-5 py-8 sm:px-8">
        {/* Welcome & Loyalty Card with React Bits SpotlightCard */}
        <SpotlightCard className="p-6 sm:p-8 text-white shadow-2xl mb-8 border-orange-500/20 bg-zinc-950">
          <div className="absolute -right-10 -bottom-10 h-48 w-48 rounded-full bg-orange-500/10 blur-3xl pointer-events-none" />
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 relative z-10">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-orange-500/30 bg-orange-500/10 px-3.5 py-1 text-xs font-bold uppercase tracking-widest text-orange-400 mb-2">
                <Sparkles size={13} /> <ShinyText text={`${loyalty.tier} Member`} />
              </div>
              <h1 className="font-serif text-3xl font-bold sm:text-4xl text-white">
                Welcome, {customer?.name || 'Valued Guest'}
              </h1>
              <p className="mt-1 text-xs text-gray-400">
                Member since {customer ? new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : '2026'} • Scoped to {restaurant?.name || 'Restaurant'}
              </p>
            </div>

            {/* Loyalty Balance Card with React Bits GlassIcon & CountUp */}
            <div className="flex items-center gap-4 rounded-2xl bg-zinc-900/90 border border-white/10 p-4 sm:p-5 backdrop-blur-sm shadow-xl">
              <GlassIcon
                icon={<Award size={22} />}
                color="gold"
                size="sm"
              />
              <div>
                <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400">Loyalty Balance</div>
                <div className="text-2xl font-serif font-bold text-orange-400">
                  <CountUp to={loyalty.balance} /> <span className="text-xs font-normal text-white">pts</span>
                </div>
                <div className="text-[10px] text-gray-400">Worth {money(loyalty.balance * 10, restaurant?.currency)} in rewards</div>
              </div>
            </div>
          </div>
        </SpotlightCard>

        {/* Tab Navigation Navigation Bar */}
        <div className="flex gap-2 overflow-x-auto pb-2 mb-8 border-b border-orange-500/10 dark:border-white/10 scrollbar-none">
          {[
            { id: 'overview', label: 'Overview & Wallet', icon: Award },
            { id: 'orders', label: `Orders (${orders.length})`, icon: ShoppingBag },
            { id: 'reservations', label: `Table Bookings (${reservations.length})`, icon: Calendar },
            { id: 'favorites', label: `Saved Favourites (${favoriteDishes.length})`, icon: Heart },
            { id: 'profile', label: 'Profile & Address', icon: User },
          ].map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as TabType)}
                className={`flex items-center gap-2 whitespace-nowrap rounded-2xl px-5 py-3 text-xs font-bold uppercase tracking-wider transition ${
                  active
                    ? 'bg-orange-500 text-white shadow-lg shadow-orange-500/25'
                    : 'bg-white text-slate-600 hover:bg-orange-50 dark:bg-zinc-900/90 dark:text-gray-300 dark:hover:bg-zinc-800'
                }`}
              >
                <Icon size={15} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Tab Content 1: Overview & Wallet */}
        {activeTab === 'overview' && (
          <div className="grid gap-6 lg:grid-cols-3">
            {/* Rewards Tier Status */}
            <div className="rounded-3xl border border-orange-500/10 bg-white p-6 dark:bg-zinc-900/90 dark:border-white/5 shadow-sm space-y-4">
              <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-orange-500">
                <span>Tier Status</span>
                <Award size={18} />
              </div>
              <h3 className="font-serif text-2xl font-bold text-slate-950 dark:text-white">
                {loyalty.tier} Level
              </h3>
              <p className="text-xs text-slate-600 dark:text-gray-400">
                Enjoy complimentary chef tastings, priority table booking, and discount redemption at online checkout.
              </p>

              <div className="space-y-2 pt-2 text-xs">
                <div className="flex justify-between font-semibold">
                  <span>Current Points:</span>
                  <span className="text-orange-500">{loyalty.balance} pts</span>
                </div>
                <div className="w-full h-2 rounded-full bg-slate-100 dark:bg-zinc-800 overflow-hidden">
                  <div
                    className="h-full bg-orange-500 rounded-full"
                    style={{ width: `${Math.min(100, (loyalty.balance / 3000) * 100)}%` }}
                  />
                </div>
                <div className="flex justify-between text-[10px] text-gray-400">
                  <span>Bronze (0)</span>
                  <span>Silver (500)</span>
                  <span>Gold (1500)</span>
                  <span>Platinum (3000)</span>
                </div>
              </div>
            </div>

            {/* Loyalty Transactions */}
            <div className="lg:col-span-2 rounded-3xl border border-orange-500/10 bg-white p-6 dark:bg-zinc-900/90 dark:border-white/5 shadow-sm">
              <h3 className="font-serif text-xl font-bold text-slate-950 dark:text-white mb-4">
                Points Activity Ledger
              </h3>
              {loyalty.transactions.length === 0 ? (
                <div className="py-12 text-center text-xs text-slate-400">
                  No points activity recorded yet. Points are automatically awarded upon completed dining orders!
                </div>
              ) : (
                <div className="divide-y dark:divide-white/5">
                  {loyalty.transactions.map((tx: any) => (
                    <div key={tx.id} className="py-3 flex items-center justify-between text-xs">
                      <div>
                        <div className="font-semibold text-slate-900 dark:text-white">{tx.note || 'Order Reward'}</div>
                        <div className="text-[11px] text-gray-400">{new Date(tx.createdAt).toLocaleDateString()}</div>
                      </div>
                      <span className={`font-bold font-mono ${tx.type === 'EARN' ? 'text-green-500' : 'text-orange-500'}`}>
                        {tx.type === 'EARN' ? `+${tx.points} pts` : `-${tx.points} pts`}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Tab Content 2: Order History */}
        {activeTab === 'orders' && (
          <div className="space-y-4">
            {orders.length === 0 ? (
              <div className="rounded-3xl border border-orange-500/10 bg-white p-12 text-center dark:bg-zinc-900 dark:border-white/5 shadow-sm">
                <ShoppingBag className="w-12 h-12 mx-auto text-orange-500/40 mb-3" />
                <h3 className="font-serif text-xl font-bold text-slate-950 dark:text-white">No Orders Yet</h3>
                <p className="text-xs text-slate-500 dark:text-gray-400 mt-1 max-w-sm mx-auto">
                  Your past takeout and delivery orders will appear here for instant tracking and 1-click re-ordering.
                </p>
                <Link
                  to="/order-online"
                  className="mt-5 inline-flex items-center rounded-xl bg-orange-500 px-6 py-2.5 text-xs font-bold uppercase tracking-wider text-white hover:bg-orange-600 transition shadow-md shadow-orange-500/25"
                >
                  Start an Order <ArrowRight size={14} className="ml-1.5" />
                </Link>
              </div>
            ) : (
              orders.map((order) => (
                <div
                  key={order.id}
                  className="rounded-3xl border border-orange-500/10 bg-white p-6 dark:bg-zinc-900/90 dark:border-white/5 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-6"
                >
                  <div className="space-y-2">
                    <div className="flex items-center gap-3">
                      <span className="font-serif font-bold text-lg text-slate-950 dark:text-white">
                        {order.orderNumber}
                      </span>
                      <span className="rounded-full bg-orange-500/10 px-3 py-0.5 text-xs font-bold text-orange-500">
                        {order.status}
                      </span>
                      <span className="text-xs text-gray-400">
                        {new Date(order.placedAt).toLocaleDateString()} at {new Date(order.placedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>

                    <div className="text-xs text-slate-600 dark:text-gray-300">
                      <strong>Branch:</strong> {order.branch?.name || 'Main Flagship'} • <strong>Fulfillment:</strong> {order.fulfillmentType}
                    </div>

                    <div className="text-xs text-gray-400">
                      {order.items.map((i: any) => `${i.quantity}x ${i.name}`).join(', ')}
                    </div>
                  </div>

                  <div className="flex flex-col sm:flex-row items-end sm:items-center gap-4">
                    <div className="text-right">
                      <div className="text-xs text-gray-400">Total Amount</div>
                      <div className="font-serif font-bold text-lg text-orange-600 dark:text-orange-400">
                        {money(order.totalAmount, restaurant?.currency)}
                      </div>
                    </div>

                    {order.trackingToken && (
                      <Link
                        to={`/online-order/${order.trackingToken}`}
                        className="rounded-xl border border-orange-500/30 bg-orange-500/10 px-4 py-2 text-xs font-bold text-orange-500 hover:bg-orange-500 hover:text-white transition"
                      >
                        Live Tracker
                      </Link>
                    )}

                    <button
                      onClick={() => handleReorder(order)}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-orange-500 px-4 py-2 text-xs font-bold text-white hover:bg-orange-600 transition shadow-md shadow-orange-500/20"
                    >
                      <RotateCcw size={13} /> Re-order
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* Tab Content 3: Table Reservations */}
        {activeTab === 'reservations' && (
          <div className="space-y-4">
            {reservations.length === 0 ? (
              <div className="rounded-3xl border border-orange-500/10 bg-white p-12 text-center dark:bg-zinc-900 dark:border-white/5 shadow-sm">
                <Calendar className="w-12 h-12 mx-auto text-orange-500/40 mb-3" />
                <h3 className="font-serif text-xl font-bold text-slate-950 dark:text-white">No Reservations</h3>
                <p className="text-xs text-slate-500 dark:text-gray-400 mt-1 max-w-sm mx-auto">
                  Book a table in advance on our website to ensure an unforgettable dining experience.
                </p>
                <Link
                  to="/"
                  className="mt-5 inline-flex items-center rounded-xl bg-orange-500 px-6 py-2.5 text-xs font-bold uppercase tracking-wider text-white hover:bg-orange-600 transition shadow-md shadow-orange-500/25"
                >
                  Reserve a Table <ArrowRight size={14} className="ml-1.5" />
                </Link>
              </div>
            ) : (
              reservations.map((res) => (
                <div
                  key={res.id}
                  className="rounded-3xl border border-orange-500/10 bg-white p-6 dark:bg-zinc-900/90 dark:border-white/5 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-6"
                >
                  <div>
                    <div className="flex items-center gap-3">
                      <span className="font-serif font-bold text-lg text-slate-950 dark:text-white">
                        {res.reservationCode}
                      </span>
                      <span className="rounded-full bg-orange-500/10 px-3 py-0.5 text-xs font-bold text-orange-500">
                        {res.status}
                      </span>
                    </div>

                    <div className="mt-2 text-xs text-slate-600 dark:text-gray-300">
                      <strong>Date & Time:</strong> {new Date(res.startAt).toLocaleDateString()} at {new Date(res.startAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} • <strong>Party:</strong> {res.partySize} Guests
                    </div>

                    <div className="text-xs text-gray-400">
                      <strong>Branch:</strong> {res.branch?.name} {res.tableNumber ? `• Pre-assigned Table #${res.tableNumber}` : ''}
                    </div>

                    {res.notes && (
                      <div className="mt-1 text-xs text-amber-500">
                        {res.notes}
                      </div>
                    )}
                  </div>

                  <div className="text-xs font-semibold text-gray-400">
                    Source: {res.source}
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* Tab Content 4: Favourite Dishes */}
        {activeTab === 'favorites' && (
          <div>
            {favoriteDishes.length === 0 ? (
              <div className="rounded-3xl border border-orange-500/10 bg-white p-12 text-center dark:bg-zinc-900 dark:border-white/5 shadow-sm">
                <Heart className="w-12 h-12 mx-auto text-orange-500/40 mb-3" />
                <h3 className="font-serif text-xl font-bold text-slate-950 dark:text-white">No Favourites Saved Yet</h3>
                <p className="text-xs text-slate-500 dark:text-gray-400 mt-1 max-w-sm mx-auto">
                  Browse our full menu and bookmark your favourite dishes for lightning-fast cart re-ordering.
                </p>
                <Link
                  to="/order-online"
                  className="mt-5 inline-flex items-center rounded-xl bg-orange-500 px-6 py-2.5 text-xs font-bold uppercase tracking-wider text-white hover:bg-orange-600 transition shadow-md shadow-orange-500/25"
                >
                  Explore Menu <ArrowRight size={14} className="ml-1.5" />
                </Link>
              </div>
            ) : (
              <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {favoriteDishes.map((dish) => (
                  <div
                    key={dish.id}
                    className="rounded-3xl border border-orange-500/10 bg-white dark:bg-zinc-900/90 dark:border-white/5 overflow-hidden shadow-sm flex flex-col justify-between"
                  >
                    <div>
                      <div className="relative h-44 bg-zinc-900 overflow-hidden">
                        {dish.image ? (
                          <img src={dish.image} alt={dish.name} className="h-full w-full object-cover" />
                        ) : (
                          <div className="grid h-full place-items-center text-4xl">🍽️</div>
                        )}
                        <span className="absolute right-3 top-3 rounded-full bg-black/60 px-3 py-1 text-xs font-bold text-orange-400 backdrop-blur-md">
                          {money(dish.sellingPrice, restaurant?.currency)}
                        </span>
                      </div>
                      <div className="p-5">
                        <h4 className="font-serif font-bold text-lg text-slate-950 dark:text-white">{dish.name}</h4>
                        <p className="mt-1 line-clamp-2 text-xs text-slate-500 dark:text-gray-400">
                          {dish.description || 'Prepared fresh with signature artisanal ingredients.'}
                        </p>
                      </div>
                    </div>

                    <div className="p-5 pt-0">
                      <Link
                        to="/order-online"
                        className="w-full flex items-center justify-center gap-1.5 rounded-xl bg-orange-500 py-2.5 text-xs font-bold text-white hover:bg-orange-600 transition shadow-md shadow-orange-500/20"
                      >
                        <ShoppingBag size={14} /> Add to Cart
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Tab Content 5: Profile & Saved Address */}
        {activeTab === 'profile' && (
          <div className="max-w-2xl rounded-3xl border border-orange-500/10 bg-white p-6 sm:p-8 dark:bg-zinc-900/90 dark:border-white/5 shadow-sm">
            <h3 className="font-serif text-2xl font-bold text-slate-950 dark:text-white mb-2">
              Personal Profile & Delivery Address
            </h3>
            <p className="text-xs text-slate-500 dark:text-gray-400 mb-6">
              Keep your contact and address details updated for rapid checkout on all orders.
            </p>

            {profileSuccess && (
              <div className="mb-4 flex items-center gap-2 rounded-xl border border-green-500/30 bg-green-500/10 p-3 text-xs text-green-600 dark:text-green-300">
                <CheckCircle2 size={16} />
                <span>Profile details saved successfully!</span>
              </div>
            )}

            {profileError && (
              <div className="mb-4 flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-600 dark:text-red-300">
                <AlertCircle size={16} />
                <span>{profileError}</span>
              </div>
            )}

            <form onSubmit={handleProfileSave} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-gray-300 mb-1">Full Name</label>
                <div className="relative flex items-center">
                  <User size={16} className="absolute left-3.5 text-gray-400 pointer-events-none" />
                  <input
                    type="text"
                    required
                    value={profileForm.name}
                    onChange={(e) => setProfileForm({ ...profileForm, name: e.target.value })}
                    className="w-full rounded-xl border border-slate-200 bg-white pl-10 pr-4 py-2.5 text-sm text-slate-800 focus:border-orange-500 focus:outline-none dark:border-zinc-800 dark:bg-zinc-950 dark:text-gray-200"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-gray-300 mb-1">Phone Number</label>
                  <div className="relative flex items-center">
                    <Phone size={16} className="absolute left-3.5 text-gray-400 pointer-events-none" />
                    <input
                      type="tel"
                      value={profileForm.phone}
                      onChange={(e) => setProfileForm({ ...profileForm, phone: e.target.value })}
                      className="w-full rounded-xl border border-slate-200 bg-white pl-10 pr-4 py-2.5 text-sm text-slate-800 focus:border-orange-500 focus:outline-none dark:border-zinc-800 dark:bg-zinc-950 dark:text-gray-200"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-gray-300 mb-1">Email Address</label>
                  <div className="relative flex items-center">
                    <Mail size={16} className="absolute left-3.5 text-gray-400 pointer-events-none" />
                    <input
                      type="email"
                      value={profileForm.email}
                      onChange={(e) => setProfileForm({ ...profileForm, email: e.target.value })}
                      className="w-full rounded-xl border border-slate-200 bg-white pl-10 pr-4 py-2.5 text-sm text-slate-800 focus:border-orange-500 focus:outline-none dark:border-zinc-800 dark:bg-zinc-950 dark:text-gray-200"
                    />
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-gray-300 mb-1">Default Delivery Address</label>
                <div className="relative flex items-start">
                  <MapPin size={16} className="absolute left-3.5 top-3 text-gray-400 pointer-events-none" />
                  <textarea
                    rows={3}
                    value={profileForm.address}
                    onChange={(e) => setProfileForm({ ...profileForm, address: e.target.value })}
                    placeholder="e.g. Penthouse 4B, Acacia Avenue, Westlands, Nairobi"
                    className="w-full rounded-xl border border-slate-200 bg-white pl-10 pr-4 py-2.5 text-sm text-slate-800 focus:border-orange-500 focus:outline-none dark:border-zinc-800 dark:bg-zinc-950 dark:text-gray-200"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={profileSaving}
                className="mt-4 rounded-xl bg-orange-500 px-6 py-3 text-xs font-bold uppercase tracking-wider text-white hover:bg-orange-600 transition shadow-lg shadow-orange-500/25 disabled:opacity-50"
              >
                {profileSaving ? 'Saving...' : 'Save Profile Changes'}
              </button>
            </form>
          </div>
        )}
      </main>
    </div>
  );
}
