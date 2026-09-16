import { useEffect, useMemo, useState, useCallback } from 'react';
import { useNavigate, Link, useLocation } from 'react-router-dom';
import {
  Moon,
  Sun,
  ShoppingBag,
  Clock3,
  Search,
  ArrowRight,
  Sparkles,
  UtensilsCrossed,
  X,
  Plus,
  Minus,
  CheckCircle2,
  AlertCircle,
  Truck,
  Store,
  CreditCard,
  Banknote,
  Smartphone,
  Home,
  User,
  Calendar,
  RefreshCw,
  MapPin,
} from 'lucide-react';
import { publicOrderingApi } from '../../services/api';
import ReservationModal from '../website/components/ReservationModal';
import { useCustomerAuth } from '../../contexts/CustomerAuthContext';
import { useAuth } from '../../contexts/AuthContext';
import {
  Dock,
  GlassIcon,
  SpotlightCard,
  ShinyText,
  Magnet,
  CountUp,
} from '../../components/react-bits';

type Branch = { id: string; name: string; code: string; address?: string; city?: string; phone?: string };
type Restaurant = {
  id: string;
  name: string;
  description?: string;
  phone?: string;
  address?: string;
  city?: string;
  currency?: string;
  branches: Branch[];
};
type Category = { id: string; name: string };
type MenuItem = {
  id: string;
  categoryId: string;
  name: string;
  description?: string;
  image?: string;
  sellingPrice: number;
  preparationTime?: number;
};
type CartLine = MenuItem & { quantity: number };

const money = (value: number, currency = 'KES') =>
  new Intl.NumberFormat('en-KE', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value);

const SUPABASE_PUBLIC_BASE = 'https://czqznpcgyhcntlpsecla.supabase.co/storage/v1/object/public/menu-images';
const supabaseImage = (filename: string) => `${SUPABASE_PUBLIC_BASE}/${encodeURIComponent(filename)}`;
const SUPABASE_MENU_FILENAMES: Record<string, string> = {
  'Samosa': 'Samosa.jpg',
  'Chicken Wings': 'Chicken Wings.jpg',
  'Grilled Chicken': 'Grilled Chicken.jpg',
  'Beef Steak': 'Beef Steak.jpg',
  'Chicken Burger': 'Chicken Burger.jpg',
  'Beef Burger': 'Beef Burger.jpg',
  'Coke': 'Coke.jpg',
  'Fresh Passion Juice': 'Passion Juice.jpg',
  'Chocolate Cake': 'Chocolate Cake.jpg',
};
const menuImage = (item?: Pick<MenuItem, 'name' | 'image'> | null) =>
  item?.image || (item?.name && SUPABASE_MENU_FILENAMES[item.name] ? supabaseImage(SUPABASE_MENU_FILENAMES[item.name]) : '');

export default function OnlineOrdering() {
  const navigate = useNavigate();
  const location = useLocation();
  const { customer, isAuthenticated: isCustomerAuth } = useCustomerAuth();
  const { isAuthenticated: isStaffAuth } = useAuth();

  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [restaurantId, setRestaurantId] = useState('');
  const [branchId, setBranchId] = useState('');
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null);
  const [branch, setBranch] = useState<Branch | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [activeCategory, setActiveCategory] = useState('ALL');
  const [search, setSearch] = useState('');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [menuLoading, setMenuLoading] = useState(false);
  const [error, setError] = useState('');
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem('rms-theme') !== 'light');
  const [reservationOpen, setReservationOpen] = useState(false);
  const [pendingItemId, setPendingItemId] = useState<string | null>(() => new URLSearchParams(location.search).get('addItem'));

  const [form, setForm] = useState({
    customerName: '',
    contactPhone: '',
    contactEmail: '',
    fulfillmentType: 'PICKUP',
    deliveryAddress: '',
    paymentMethod: 'CASH',
    notes: '',
    promoCode: '',
  });

  // Pre-fill form from logged-in customer profile
  useEffect(() => {
    if (customer) {
      setForm((prev) => ({
        ...prev,
        customerName: customer.name || prev.customerName,
        contactPhone: customer.phone || prev.contactPhone,
        contactEmail: customer.email || prev.contactEmail,
        deliveryAddress: customer.address || prev.deliveryAddress,
      }));
    }
  }, [customer]);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
    localStorage.setItem('rms-theme', darkMode ? 'dark' : 'light');
  }, [darkMode]);

  const loadRestaurants = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await publicOrderingApi.getRestaurants();
      const data = res.data.data?.restaurants || [];
      setRestaurants(data);
      const first = data[0];
      if (first) {
        setRestaurantId(first.id);
        setBranchId(first.branches?.[0]?.id || '');
      } else {
        setError('Online ordering is not available yet.');
      }
    } catch (err: any) {
      console.warn('Online ordering restaurant load error:', err);
      setError(err.response?.data?.message || 'Unable to load restaurants. Please check your connection.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRestaurants();
  }, [loadRestaurants]);

  useEffect(() => {
    const selected = restaurants.find((r) => r.id === restaurantId) || null;
    setRestaurant(selected);
    if (selected && !selected.branches.some((b) => b.id === branchId)) {
      setBranchId(selected.branches[0]?.id || '');
    }
  }, [restaurantId, restaurants, branchId]);

  const loadMenu = useCallback(async () => {
    if (!restaurantId || !branchId) return;
    setMenuLoading(true);
    setError('');
    try {
      const res = await publicOrderingApi.getMenu({ restaurantId, branchId });
      setCategories(res.data.data?.categories || []);
      setItems(res.data.data?.items || []);
      if (res.data.data?.restaurant) {
        setRestaurant((current) => (current ? { ...current, ...res.data.data.restaurant } : current));
      }
    } catch (err: any) {
      console.warn('Online ordering menu load error:', err);
      setError(err.response?.data?.message || 'Unable to load the selected branch menu.');
    } finally {
      setMenuLoading(false);
    }
  }, [restaurantId, branchId]);

  useEffect(() => {
    setBranch(restaurant?.branches.find((b) => b.id === branchId) || null);
    loadMenu();
  }, [restaurant, branchId, loadMenu]);

  useEffect(() => {
    if (!pendingItemId || !items.length) return;
    const item = items.find((candidate) => candidate.id === pendingItemId);
    if (item) {
      addItem(item);
      setPendingItemId(null);
      navigate('/order-online', { replace: true });
    }
  }, [items, pendingItemId, navigate]);

  const filteredItems = useMemo(
    () =>
      items.filter(
        (item) =>
          (activeCategory === 'ALL' || item.categoryId === activeCategory) &&
          `${item.name} ${item.description || ''}`.toLowerCase().includes(search.toLowerCase())
      ),
    [items, activeCategory, search]
  );

  const subtotal = cart.reduce((sum, item) => sum + item.sellingPrice * item.quantity, 0);
  const totalItems = cart.reduce((sum, item) => sum + item.quantity, 0);
  const currency = restaurant?.currency || 'KES';

  const addItem = (item: MenuItem) =>
    setCart((current) => {
      const existing = current.find((line) => line.id === item.id);
      return existing
        ? current.map((line) => (line.id === item.id ? { ...line, quantity: line.quantity + 1 } : line))
        : [...current, { ...item, quantity: 1 }];
    });

  const setQuantity = (id: string, quantity: number) =>
    setCart((current) =>
      quantity <= 0
        ? current.filter((line) => line.id !== id)
        : current.map((line) => (line.id === id ? { ...line, quantity } : line))
    );

  const placeOrder = async () => {
    if (!cart.length) return;
    setSubmitting(true);
    setError('');
    try {
      const response = await publicOrderingApi.placeOrder({
        restaurantId,
        branchId,
        ...form,
        items: cart.map((item) => ({ menuItemId: item.id, quantity: item.quantity })),
      });
      const data = response.data.data;
      setCart([]);
      setCheckoutOpen(false);
      navigate(`/online-order/${data.trackingToken}`);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Unable to place your order. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0d0d11] text-orange-400 flex flex-col items-center justify-center gap-3">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-orange-500 border-t-transparent" />
        <span className="text-sm font-serif tracking-widest uppercase text-gray-300">
          Loading Online Kitchen...
        </span>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#faf9f7] text-slate-800 dark:bg-[#0d0d11] dark:text-gray-100 antialiased pb-28 md:pb-24 selection:bg-orange-500 selection:text-white">
      {/* Top Header */}
      <header className="sticky top-0 z-30 border-b border-orange-500/15 bg-black/75 backdrop-blur-xl text-white shadow-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-3.5 py-3 sm:px-6">
          <Link to="/" className="flex items-center gap-2.5 sm:gap-3 group shrink-0">
            <div className="grid h-9 w-9 sm:h-10 sm:w-10 place-items-center rounded-xl bg-orange-500 text-white shadow-lg shadow-orange-500/25 group-hover:scale-105 transition">
              <UtensilsCrossed size={18} className="sm:size-5" />
            </div>
            <div>
              <div className="text-base sm:text-lg font-serif font-bold tracking-tight text-white flex items-center gap-2">
                <span>{restaurant?.name || 'Melio'}</span>
                <span className="hidden sm:inline-block text-[10px] uppercase tracking-widest text-orange-400 font-sans font-bold bg-orange-500/10 border border-orange-500/30 px-2 py-0.5 rounded-full">
                  <ShinyText text="Menu" />
                </span>
              </div>
              <div className="text-[11px] sm:text-xs text-gray-400 flex items-center gap-1.5 truncate max-w-[140px] sm:max-w-none">
                <MapPin size={10} className="text-orange-400 shrink-0" />
                <span className="truncate">{branch?.name || 'Craft Kitchen'}</span>
              </div>
            </div>
          </Link>

          {/* Branch & Location Selector (Desktop) */}
          <div className="hidden md:flex items-center gap-2.5 text-sm">
            {restaurants.length > 1 && (
              <select
                aria-label="Select Restaurant"
                className="rounded-xl border border-white/15 bg-white/10 px-3 py-1.5 text-xs text-white focus:border-orange-500 focus:outline-none backdrop-blur-md"
                value={restaurantId}
                onChange={(e) => setRestaurantId(e.target.value)}
              >
                {restaurants.map((r) => (
                  <option key={r.id} value={r.id} className="bg-zinc-900 text-white">
                    {r.name}
                  </option>
                ))}
              </select>
            )}
            {restaurant && restaurant.branches.length > 1 && (
              <select
                aria-label="Select Branch"
                className="rounded-xl border border-white/15 bg-white/10 px-3 py-1.5 text-xs text-white focus:border-orange-500 focus:outline-none backdrop-blur-md"
                value={branchId}
                onChange={(e) => setBranchId(e.target.value)}
              >
                {restaurant.branches.map((b) => (
                  <option key={b.id} value={b.id} className="bg-zinc-900 text-white">
                    {b.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Header Action Controls */}
          <div className="flex items-center gap-2 sm:gap-3">
            <button
              type="button"
              onClick={() => setDarkMode((current) => !current)}
              className="inline-flex h-9 w-9 sm:h-10 sm:w-10 items-center justify-center rounded-xl border border-white/15 bg-white/10 text-gray-300 shadow-sm transition hover:bg-white/20 hover:text-white"
              title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
              aria-label={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {darkMode ? <Sun size={17} /> : <Moon size={17} />}
            </button>

            {isCustomerAuth ? (
              <Link
                to="/account"
                className="hidden sm:inline-flex items-center gap-2 rounded-xl bg-white/10 border border-white/15 px-3 py-2 text-xs font-semibold text-white hover:bg-white/20 transition"
              >
                <div className="h-5 w-5 rounded-full bg-gradient-to-tr from-orange-500 to-amber-400 flex items-center justify-center text-[10px] font-bold text-white">
                  {customer?.name?.charAt(0).toUpperCase() || 'C'}
                </div>
                <span>{customer?.name?.split(' ')[0] || 'Account'}</span>
              </Link>
            ) : null}

            {/* Cart Trigger Button */}
            <button
              onClick={() => setCheckoutOpen(true)}
              className="relative inline-flex items-center gap-1.5 sm:gap-2 rounded-xl bg-gradient-to-r from-orange-500 to-amber-500 px-3 py-2 sm:px-4 sm:py-2.5 text-xs font-bold uppercase tracking-wider text-white shadow-lg shadow-orange-500/25 transition active:scale-95 hover:from-orange-600 hover:to-amber-600"
            >
              <ShoppingBag size={15} />
              <span className="hidden xs:inline">Cart</span>
              <span className="rounded-md bg-black/30 px-1.5 py-0.5 text-[11px] font-extrabold text-orange-200">
                {totalItems}
              </span>
              {totalItems > 0 && (
                <span className="hidden sm:inline text-[11px] font-extrabold text-orange-100">
                  • {money(subtotal, currency)}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Mobile Branch Selector Strip (if multi-branch) */}
        {restaurant && restaurant.branches.length > 1 && (
          <div className="md:hidden px-3.5 pb-2.5 flex items-center gap-2 overflow-x-auto scrollbar-none">
            <span className="text-[10px] uppercase font-bold text-orange-400 shrink-0">Branch:</span>
            {restaurant.branches.map((b) => (
              <button
                key={b.id}
                onClick={() => setBranchId(b.id)}
                className={`text-xs px-2.5 py-1 rounded-lg shrink-0 whitespace-nowrap transition ${
                  branchId === b.id
                    ? 'bg-orange-500 text-white font-bold shadow-sm'
                    : 'bg-white/10 text-gray-300 font-medium'
                }`}
              >
                {b.name}
              </button>
            ))}
          </div>
        )}
      </header>

      {/* Main Order Layout */}
      <main className="mx-auto grid max-w-7xl gap-6 sm:gap-8 px-3.5 py-4 sm:px-6 sm:py-8 lg:grid-cols-[1fr_360px]">
        <section className="space-y-4 sm:space-y-6 min-w-0">
          {/* Top Hero Banner with SpotlightCard */}
          <SpotlightCard className="p-4 sm:p-7 bg-zinc-950 border-orange-500/20 text-white shadow-2xl rounded-2xl sm:rounded-3xl">
            <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center relative z-10">
              <div>
                <div className="inline-flex items-center gap-1.5 text-[11px] sm:text-xs font-bold uppercase tracking-widest text-orange-400 mb-1">
                  <Sparkles size={13} /> Fresh Kitchen Selection
                </div>
                <h1 className="font-serif text-2xl sm:text-4xl font-bold tracking-tight">
                  What are you craving today?
                </h1>
                <p className="mt-1 text-xs text-gray-400 max-w-md hidden sm:block">
                  Handcrafted artisanal courses prepared fresh to order. Available for express pickup or direct delivery.
                </p>
              </div>

              {/* Search input */}
              <div className="relative w-full md:max-w-xs">
                <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search dishes, ingredients..."
                  className="w-full rounded-xl bg-zinc-900 border border-white/10 pl-9 pr-8 py-2.5 text-sm text-white placeholder:text-gray-500 focus:border-orange-500 focus:outline-none transition"
                />
                {search && (
                  <button
                    onClick={() => setSearch('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white p-1"
                    aria-label="Clear search"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
            </div>

            {/* Quick Micro Badges on Mobile / Full Glass on Desktop */}
            <div className="mt-4 pt-4 border-t border-white/10">
              {/* Mobile Quick Row */}
              <div className="sm:hidden flex items-center justify-between text-[11px] text-gray-300 font-medium px-1">
                <span className="flex items-center gap-1 text-orange-400">
                  <Clock3 size={13} /> ~20-35 mins
                </span>
                <span className="flex items-center gap-1 text-amber-400">
                  <Truck size={13} /> Express Delivery
                </span>
                <span className="flex items-center gap-1 text-emerald-400">
                  <Sparkles size={13} /> Rewards
                </span>
              </div>

              {/* Desktop 3-column Glass Badges */}
              <div className="hidden sm:grid grid-cols-3 gap-3">
                <GlassIcon
                  icon={<Clock3 size={18} />}
                  label="Express Kitchen"
                  sublabel="~20-35 mins"
                  color="orange"
                  size="sm"
                />
                <GlassIcon
                  icon={<Truck size={18} />}
                  label="Fast Delivery"
                  sublabel="Fresh & Hot"
                  color="orange"
                  size="sm"
                />
                <GlassIcon
                  icon={<Sparkles size={18} />}
                  label="Reward Points"
                  sublabel="Earn with every order"
                  color="orange"
                  size="sm"
                />
              </div>
            </div>

            {/* Category Pills Bar (Edge-to-edge scrollable on mobile) */}
            <div className="mt-4 sm:mt-6 -mx-4 px-4 sm:mx-0 sm:px-0 flex gap-2 overflow-x-auto pb-1 scrollbar-none">
              <button
                onClick={() => setActiveCategory('ALL')}
                className={`whitespace-nowrap rounded-xl px-3.5 py-2 text-xs font-bold uppercase tracking-wider transition shrink-0 ${
                  activeCategory === 'ALL'
                    ? 'bg-orange-500 text-white shadow-lg shadow-orange-500/25'
                    : 'bg-white/10 text-gray-300 hover:bg-white/20 hover:text-white'
                }`}
              >
                All Dishes ({items.length})
              </button>
              {categories.map((category) => (
                <button
                  key={category.id}
                  onClick={() => setActiveCategory(category.id)}
                  className={`whitespace-nowrap rounded-xl px-3.5 py-2 text-xs font-bold uppercase tracking-wider transition shrink-0 ${
                    activeCategory === category.id
                      ? 'bg-orange-500 text-white shadow-lg shadow-orange-500/25'
                      : 'bg-white/10 text-gray-300 hover:bg-white/20 hover:text-white'
                  }`}
                >
                  {category.name}
                </button>
              ))}
            </div>
          </SpotlightCard>

          {error && (
            <div className="flex items-center justify-between gap-2 rounded-2xl border border-red-500/40 bg-red-950/60 p-4 text-xs text-red-200">
              <div className="flex items-center gap-2">
                <AlertCircle size={18} className="text-red-400 shrink-0" />
                <span>{error}</span>
              </div>
              <button
                onClick={loadMenu}
                className="px-3 py-1.5 rounded-lg bg-red-500/20 border border-red-500/40 text-red-200 hover:bg-red-500/30 flex items-center gap-1.5 font-bold uppercase text-[10px] shrink-0"
              >
                <RefreshCw size={12} /> Retry
              </button>
            </div>
          )}

          {/* Menu Items Grid with Responsive Cards */}
          {menuLoading ? (
            <div className="py-20 text-center text-gray-400 flex flex-col items-center justify-center gap-3">
              <div className="h-8 w-8 animate-spin rounded-full border-3 border-orange-500 border-t-transparent" />
              <span className="text-xs uppercase tracking-widest font-sans">Refreshing Branch Menu...</span>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:gap-6 sm:grid-cols-2 xl:grid-cols-3">
              {filteredItems.map((item) => {
                const inCart = cart.find((line) => line.id === item.id);
                const resolvedImage = menuImage(item);
                return (
                  <SpotlightCard
                    key={item.id}
                    className="group flex flex-col justify-between overflow-hidden rounded-2xl sm:rounded-3xl border border-orange-500/10 bg-white shadow-sm dark:bg-zinc-900/80 dark:border-white/5 transition hover:-translate-y-1 hover:shadow-xl"
                  >
                    <div>
                      {/* Image Container */}
                      <div className="relative h-44 sm:h-48 overflow-hidden bg-zinc-950">
                        {resolvedImage ? (
                          <img
                            src={resolvedImage}
                            alt={item.name}
                            loading="lazy"
                            className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-orange-500/10 to-transparent text-5xl">
                            🍽️
                          </div>
                        )}
                        <span className="absolute right-3 top-3 rounded-full bg-black/75 px-3 py-1 text-xs font-extrabold text-orange-400 backdrop-blur-md border border-orange-500/30 shadow-md">
                          {money(item.sellingPrice, currency)}
                        </span>
                      </div>

                      {/* Content */}
                      <div className="p-4 sm:p-5">
                        <h2 className="font-serif text-base sm:text-lg font-bold text-slate-950 dark:text-white group-hover:text-orange-500 transition line-clamp-1">
                          {item.name}
                        </h2>
                        <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-slate-500 dark:text-gray-400">
                          {item.description || 'Artisanal recipe prepared fresh using premium local ingredients.'}
                        </p>
                      </div>
                    </div>

                    {/* Footer Actions with Touch Targets */}
                    <div className="flex items-center justify-between border-t border-slate-100 p-4 pt-3 dark:border-white/5">
                      <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-400 dark:text-gray-400">
                        <Clock3 size={13} className="text-orange-500" />
                        {item.preparationTime ? `${item.preparationTime} mins` : 'Freshly made'}
                      </span>

                      {inCart ? (
                        <div className="flex items-center gap-1.5 sm:gap-2 rounded-xl bg-orange-500/10 border border-orange-500/30 p-1">
                          <button
                            type="button"
                            onClick={() => setQuantity(item.id, inCart.quantity - 1)}
                            className="h-7 w-7 sm:h-8 sm:w-8 rounded-lg bg-orange-500 text-white flex items-center justify-center hover:bg-orange-600 active:scale-95 transition"
                            aria-label="Decrease quantity"
                          >
                            <Minus size={13} />
                          </button>
                          <span className="w-6 text-center text-xs font-bold text-orange-400">
                            {inCart.quantity}
                          </span>
                          <button
                            type="button"
                            onClick={() => setQuantity(item.id, inCart.quantity + 1)}
                            className="h-7 w-7 sm:h-8 sm:w-8 rounded-lg bg-orange-500 text-white flex items-center justify-center hover:bg-orange-600 active:scale-95 transition"
                            aria-label="Increase quantity"
                          >
                            <Plus size={13} />
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => addItem(item)}
                          className="inline-flex items-center gap-1.5 rounded-xl bg-orange-500 px-3.5 py-2 text-xs font-bold text-white shadow-md shadow-orange-500/25 active:scale-95 hover:bg-orange-600 transition"
                        >
                          <Plus size={14} /> Add
                        </button>
                      )}
                    </div>
                  </SpotlightCard>
                );
              })}
            </div>
          )}

          {!filteredItems.length && !menuLoading && (
            <div className="py-16 text-center text-gray-400">
              <p className="text-sm">No dishes found matching "{search}".</p>
              <button
                onClick={() => { setSearch(''); setActiveCategory('ALL'); }}
                className="mt-3 text-xs text-orange-400 underline font-bold"
              >
                Reset Search & Filters
              </button>
            </div>
          )}
        </section>

        {/* Desktop Sidebar Cart Summary (Hidden on Mobile) */}
        <aside className="hidden lg:block h-fit sticky top-24 space-y-6">
          <SpotlightCard className="p-6 bg-zinc-950 border-orange-500/20 text-white shadow-2xl rounded-3xl">
            <div className="flex items-center justify-between border-b border-white/10 pb-4">
              <div className="flex items-center gap-2">
                <ShoppingBag size={18} className="text-orange-400" />
                <h2 className="font-serif text-lg font-bold">Your Order</h2>
              </div>
              <span className="rounded-full bg-orange-500/20 border border-orange-500/40 px-2.5 py-0.5 text-xs font-bold text-orange-300">
                {totalItems} items
              </span>
            </div>

            {cart.length === 0 ? (
              <div className="py-12 text-center flex flex-col items-center justify-center gap-3">
                <GlassIcon
                  icon={<ShoppingBag size={24} />}
                  color="amber"
                  size="md"
                />
                <p className="text-xs text-gray-400">
                  Your cart is waiting for something delicious.
                </p>
              </div>
            ) : (
              <div className="mt-4 space-y-3 max-h-[340px] overflow-y-auto pr-1">
                {cart.map((line) => (
                  <div
                    key={line.id}
                    className="flex items-center justify-between gap-3 rounded-2xl bg-white/5 border border-white/5 p-3"
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-bold truncate">{line.name}</div>
                      <div className="text-[11px] text-orange-400 font-semibold">
                        {money(line.sellingPrice, currency)}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={() => setQuantity(line.id, line.quantity - 1)}
                        className="h-6 w-6 rounded-lg bg-white/10 hover:bg-white/20 text-white flex items-center justify-center text-xs"
                      >
                        −
                      </button>
                      <span className="w-5 text-center text-xs font-bold">{line.quantity}</span>
                      <button
                        onClick={() => setQuantity(line.id, line.quantity + 1)}
                        className="h-6 w-6 rounded-lg bg-white/10 hover:bg-white/20 text-white flex items-center justify-center text-xs"
                      >
                        +
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Subtotal & Checkout Action */}
            <div className="mt-6 border-t border-white/10 pt-4 space-y-3">
              <div className="flex items-center justify-between text-xs text-gray-400">
                <span>Estimated Subtotal</span>
                <span className="text-sm font-bold text-white font-serif">
                  <CountUp to={subtotal} prefix={`${currency} `} />
                </span>
              </div>
              <p className="text-[10px] text-gray-400 leading-tight">
                Taxes & packing charges calculated seamlessly at checkout.
              </p>

              <Magnet className="w-full" padding={20} magnetStrength={0.15}>
                <button
                  disabled={!cart.length}
                  onClick={() => setCheckoutOpen(true)}
                  className="w-full flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-orange-500 to-amber-500 py-3.5 text-xs font-bold uppercase tracking-wider text-white shadow-xl shadow-orange-500/25 transition hover:from-orange-600 hover:to-amber-600 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Proceed to Checkout <ArrowRight size={15} />
                </button>
              </Magnet>
            </div>
          </SpotlightCard>
        </aside>
      </main>

      <ReservationModal
        isOpen={reservationOpen}
        onClose={() => setReservationOpen(false)}
        branches={restaurant?.branches || []}
        selectedBranchId={branchId}
        restaurantId={restaurantId}
      />

      {/* Floating Desktop React Bits Dock for Quick Jump */}
      <Dock
        className="hidden md:flex"
        items={[
          {
            icon: <Home size={20} />,
            label: 'Back to Website',
            onClick: () => navigate('/'),
          },
          {
            icon: <UtensilsCrossed size={20} />,
            label: 'Explore Menu',
            onClick: () => window.scrollTo({ top: 0, behavior: 'smooth' }),
            active: true,
          },
          {
            icon: <ShoppingBag size={20} />,
            label: `Review Cart (${totalItems})`,
            onClick: () => setCheckoutOpen(true),
            badge: totalItems > 0 ? totalItems : undefined,
          },
          {
            icon: <Calendar size={20} />,
            label: 'Book Table',
            onClick: () => setReservationOpen(true),
          },
          {
            icon: <User size={20} />,
            label: isStaffAuth
              ? 'Staff Dashboard'
              : isCustomerAuth
              ? `${customer?.name?.split(' ')[0] || 'Member'} (${customer?.loyaltyBalance ?? 0} pts)`
              : 'Sign In',
            onClick: () => navigate(isStaffAuth ? '/dashboard' : '/account'),
          },
        ]}
      />

      {/* Checkout Modal & Mobile Bottom Sheet */}
      {checkoutOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/85 backdrop-blur-md flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-200">
          <div className="relative w-full max-w-xl max-h-[92vh] sm:max-h-[88vh] overflow-y-auto rounded-t-3xl sm:rounded-3xl bg-zinc-950 border border-orange-500/20 p-5 sm:p-8 text-white shadow-2xl">
            <button
              onClick={() => setCheckoutOpen(false)}
              className="absolute top-4 right-4 sm:top-5 sm:right-5 text-gray-400 hover:text-white p-2 rounded-xl bg-white/5 hover:bg-white/10"
              aria-label="Close checkout"
            >
              <X size={18} />
            </button>

            <div className="flex items-center gap-2 text-[11px] sm:text-xs font-bold uppercase tracking-widest text-orange-400 mb-1">
              <Sparkles size={14} /> Finalize Order
            </div>
            <h2 className="font-serif text-xl sm:text-2xl font-bold text-white">Order Checkout</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              Dispatched directly to the kitchen with live preparation tracking.
            </p>

            {/* Cart summary in modal */}
            <div className="mt-4 rounded-2xl bg-zinc-900/80 border border-white/10 p-3.5">
              <div className="text-xs font-bold text-gray-300 mb-2 flex items-center justify-between">
                <span>Selected Items ({totalItems})</span>
                <span className="text-orange-400">{money(subtotal, currency)}</span>
              </div>
              <div className="space-y-2 max-h-36 overflow-y-auto pr-1">
                {cart.map((c) => (
                  <div key={c.id} className="flex items-center justify-between text-xs text-gray-300">
                    <span className="truncate pr-2">{c.quantity}x {c.name}</span>
                    <span className="shrink-0 font-mono text-gray-400">{money(c.sellingPrice * c.quantity, currency)}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-5 grid gap-3.5 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-gray-300 mb-1">Full Name</label>
                <input
                  required
                  placeholder="e.g. Sarah Mwangi"
                  value={form.customerName}
                  onChange={(e) => setForm({ ...form, customerName: e.target.value })}
                  className="w-full rounded-xl bg-zinc-900 border border-white/10 px-3.5 py-2.5 text-base sm:text-sm text-white placeholder:text-gray-500 focus:border-orange-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-300 mb-1">Contact Phone</label>
                <input
                  required
                  type="tel"
                  placeholder="e.g. 0712345678"
                  value={form.contactPhone}
                  onChange={(e) => setForm({ ...form, contactPhone: e.target.value })}
                  className="w-full rounded-xl bg-zinc-900 border border-white/10 px-3.5 py-2.5 text-base sm:text-sm text-white placeholder:text-gray-500 focus:border-orange-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-300 mb-1">Email (Optional)</label>
                <input
                  type="email"
                  placeholder="e.g. guest@example.com"
                  value={form.contactEmail}
                  onChange={(e) => setForm({ ...form, contactEmail: e.target.value })}
                  className="w-full rounded-xl bg-zinc-900 border border-white/10 px-3.5 py-2.5 text-base sm:text-sm text-white placeholder:text-gray-500 focus:border-orange-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-300 mb-1">Fulfillment Type</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, fulfillmentType: 'PICKUP' })}
                    className={`flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-bold border transition active:scale-95 ${
                      form.fulfillmentType === 'PICKUP'
                        ? 'bg-orange-500 text-white border-orange-400 shadow-md shadow-orange-500/30'
                        : 'bg-zinc-900 text-gray-400 border-white/10 hover:text-white'
                    }`}
                  >
                    <Store size={14} /> Pickup
                  </button>
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, fulfillmentType: 'DELIVERY' })}
                    className={`flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-bold border transition active:scale-95 ${
                      form.fulfillmentType === 'DELIVERY'
                        ? 'bg-orange-500 text-white border-orange-400 shadow-md shadow-orange-500/30'
                        : 'bg-zinc-900 text-gray-400 border-white/10 hover:text-white'
                    }`}
                  >
                    <Truck size={14} /> Delivery
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-300 mb-1">Payment Method</label>
                <div className="grid grid-cols-3 gap-1.5">
                  {[
                    { id: 'MOBILE_MONEY', label: 'M-Pesa', icon: Smartphone },
                    { id: 'CARD', label: 'Card', icon: CreditCard },
                    { id: 'CASH', label: 'Cash', icon: Banknote },
                  ].map((pm) => {
                    const Icon = pm.icon;
                    return (
                      <button
                        key={pm.id}
                        type="button"
                        onClick={() => setForm({ ...form, paymentMethod: pm.id })}
                        className={`flex flex-col items-center justify-center py-2 rounded-xl text-[11px] font-bold border transition active:scale-95 ${
                          form.paymentMethod === pm.id
                            ? 'bg-orange-500 text-white border-orange-400 shadow-md shadow-orange-500/30'
                            : 'bg-zinc-900 text-gray-400 border-white/10 hover:text-white'
                        }`}
                      >
                        <Icon size={14} className="mb-0.5" />
                        <span>{pm.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {form.fulfillmentType === 'DELIVERY' && (
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-gray-300 mb-1">
                    Delivery Address
                  </label>
                  <textarea
                    rows={2}
                    required
                    placeholder="e.g. Apartment 4B, 123 Westlands Road"
                    value={form.deliveryAddress}
                    onChange={(e) => setForm({ ...form, deliveryAddress: e.target.value })}
                    className="w-full rounded-xl bg-zinc-900 border border-white/10 px-3.5 py-2 text-base sm:text-sm text-white placeholder:text-gray-500 focus:border-orange-500 focus:outline-none"
                  />
                </div>
              )}

              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-gray-300 mb-1">Special Chef Notes (Optional)</label>
                <input
                  placeholder="e.g. Dressing on side, extra napkins..."
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  className="w-full rounded-xl bg-zinc-900 border border-white/10 px-3.5 py-2.5 text-base sm:text-sm text-white placeholder:text-gray-500 focus:border-orange-500 focus:outline-none"
                />
              </div>
            </div>

            {/* Total summary */}
            <div className="mt-5 rounded-2xl bg-zinc-900/90 border border-white/10 p-3.5 text-xs flex items-center justify-between">
              <div>
                <span className="text-gray-400">Total payable:</span>
                <div className="text-lg font-serif font-bold text-orange-400">
                  {money(subtotal, currency)}
                </div>
              </div>
              <div className="text-[11px] text-gray-400 text-right">
                <span>{totalItems} items</span>
                <div className="text-emerald-400 font-semibold flex items-center gap-1 justify-end">
                  <CheckCircle2 size={12} /> Live Kitchen Tracking
                </div>
              </div>
            </div>

            <button
              disabled={submitting || !cart.length}
              onClick={placeOrder}
              className="mt-4 w-full flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-orange-500 to-amber-500 py-3.5 text-xs font-bold uppercase tracking-wider text-white shadow-xl shadow-orange-500/25 transition active:scale-95 hover:from-orange-600 hover:to-amber-600 disabled:opacity-50"
            >
              {submitting ? (
                <div className="flex items-center gap-2">
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  <span>Dispatching to Kitchen...</span>
                </div>
              ) : (
                <>
                  {form.paymentMethod === 'CASH' ? 'Confirm & Place Order' : 'Proceed to Payment & Place Order'} <ArrowRight size={15} />
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Mobile Sticky Bottom Cart Bar */}
      {cart.length > 0 && !checkoutOpen && (
        <div className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-zinc-950/95 backdrop-blur-xl border-t border-orange-500/25 p-3 shadow-2xl safe-area-pb animate-in slide-in-from-bottom duration-200">
          <div className="flex items-center justify-between gap-3 max-w-lg mx-auto">
            <div>
              <div className="text-[11px] font-semibold text-gray-400">
                {totalItems} {totalItems === 1 ? 'dish' : 'dishes'} in cart
              </div>
              <div className="text-base font-serif font-bold text-orange-400">
                {money(subtotal, currency)}
              </div>
            </div>

            <button
              onClick={() => setCheckoutOpen(true)}
              className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-orange-500 to-amber-500 px-4 py-2.5 text-xs font-bold text-white shadow-lg shadow-orange-500/30 transition active:scale-95 hover:from-orange-600 hover:to-amber-600"
            >
              <span>View Order & Checkout</span>
              <ArrowRight size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
