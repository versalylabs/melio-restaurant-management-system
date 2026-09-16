import { useEffect, useMemo, useState } from 'react';
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
  Calendar
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
  CountUp
} from '../../components/react-bits';

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
type Branch = { id: string; name: string; code: string; address?: string; city?: string; phone?: string };
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

  useEffect(() => {
    publicOrderingApi
      .getRestaurants()
      .then((res) => {
        const data = res.data.data?.restaurants || [];
        setRestaurants(data);
        const first = data[0];
        if (first) {
          setRestaurantId(first.id);
          setBranchId(first.branches?.[0]?.id || '');
        } else setError('Online ordering is not available yet.');
      })
      .catch((err) => setError(err.response?.data?.message || 'Unable to load restaurants.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const selected = restaurants.find((r) => r.id === restaurantId) || null;
    setRestaurant(selected);
    if (selected && !selected.branches.some((b) => b.id === branchId)) {
      setBranchId(selected.branches[0]?.id || '');
    }
  }, [restaurantId, restaurants]);

  useEffect(() => {
    setBranch(restaurant?.branches.find((b) => b.id === branchId) || null);
    if (!restaurantId || !branchId) return;
    setMenuLoading(true);
    setError('');
    publicOrderingApi
      .getMenu({ restaurantId, branchId })
      .then((res) => {
        setCategories(res.data.data?.categories || []);
        setItems(res.data.data?.items || []);
        if (res.data.data?.restaurant) {
          setRestaurant((current) => (current ? { ...current, ...res.data.data.restaurant } : current));
        }
      })
      .catch((err) => setError(err.response?.data?.message || 'Unable to load this menu.'))
      .finally(() => setMenuLoading(false));
  }, [restaurantId, branchId]);

  useEffect(() => {
    if (!pendingItemId || !items.length) return;
    const item = items.find((candidate) => candidate.id === pendingItemId);
    if (item) { addItem(item); setPendingItemId(null); navigate('/order-online', { replace: true }); }
  }, [items, pendingItemId]);

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
      setError(err.response?.data?.message || 'Unable to place your order.');
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
    <div className="min-h-screen bg-[#faf9f7] text-slate-800 dark:bg-[#0d0d11] dark:text-gray-100 antialiased pb-24">
      {/* Top Header */}
      <header className="sticky top-0 z-30 border-b border-orange-500/10 bg-black/65 backdrop-blur-xl text-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3.5 sm:px-6">
          <Link to="/" className="flex items-center gap-3 group">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-orange-500 text-white shadow-lg shadow-orange-500/25 group-hover:scale-105 transition">
              <UtensilsCrossed size={20} />
            </div>
            <div>
              <div className="text-lg font-serif font-bold tracking-tight text-white flex items-center gap-2">
                <span>{restaurant?.name || 'Melio'}</span>
                <span className="hidden sm:inline-block text-[10px] uppercase tracking-widest text-orange-400 font-sans font-bold bg-orange-500/10 border border-orange-500/30 px-2 py-0.5 rounded-full">
                  <ShinyText text="Online Menu" />
                </span>
              </div>
              <div className="text-xs text-gray-400 flex items-center gap-2">
                <span>{branch?.name || 'Craft Kitchen'}</span>
                {branch?.city && <span>• {branch.city}</span>}
              </div>
            </div>
          </Link>

          {/* Branch & Location Selector */}
          <div className="hidden md:flex items-center gap-3 text-sm">
            {restaurants.length > 1 && (
              <select
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
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setDarkMode((current) => !current)}
              className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-white/15 bg-white/10 text-gray-300 shadow-sm transition hover:bg-white/20 hover:text-white"
              title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
              aria-label={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {darkMode ? <Sun size={18} /> : <Moon size={18} />}
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

            {/* Cart Trigger Button with Magnet */}
            <Magnet padding={20} magnetStrength={0.2}>
              <button
                onClick={() => setCheckoutOpen(true)}
                className="relative inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-orange-500 to-amber-500 px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-white shadow-lg shadow-orange-500/25 transition hover:from-orange-600 hover:to-amber-600"
              >
                <ShoppingBag size={16} />
                <span>Cart ({totalItems})</span>
                {totalItems > 0 && (
                  <span className="ml-1 rounded-md bg-black/30 px-1.5 py-0.5 text-[11px] font-extrabold text-orange-200">
                    {money(subtotal, currency)}
                  </span>
                )}
              </button>
            </Magnet>
          </div>
        </div>
      </header>

      {/* Main Order Layout */}
      <main className="mx-auto grid max-w-7xl gap-8 px-4 py-8 lg:grid-cols-[1fr_360px] sm:px-6">
        <section className="space-y-6">
          {/* Top Hero Banner with React Bits SpotlightCard */}
          <SpotlightCard className="p-6 sm:p-8 bg-zinc-950 border-orange-500/20 text-white shadow-2xl">
            <div className="flex flex-col justify-between gap-6 md:flex-row md:items-center relative z-10">
              <div>
                <div className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-orange-400 mb-1">
                  <Sparkles size={14} /> Fresh Kitchen Selection
                </div>
                <h1 className="font-serif text-3xl font-bold sm:text-4xl">
                  What are you craving today?
                </h1>
                <p className="mt-1 text-xs text-gray-400 max-w-md">
                  Handcrafted artisanal courses prepared fresh to order. Available for express pickup or direct delivery.
                </p>
              </div>

              {/* Search input */}
              <div className="relative w-full md:max-w-xs">
                <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search dishes, ingredients..."
                  className="w-full rounded-xl bg-zinc-900 border border-white/10 pl-10 pr-4 py-2.5 text-sm text-white placeholder:text-gray-500 focus:border-orange-500 focus:outline-none"
                />
              </div>
            </div>

            {/* Quick Glass Badges (Consistent Orange Glow) */}
            <div className="mt-6 pt-6 border-t border-white/10 grid grid-cols-3 gap-3">
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

            {/* Category Pills Bar */}
            <div className="mt-6 flex gap-2 overflow-x-auto pb-1 scrollbar-none">
              <button
                onClick={() => setActiveCategory('ALL')}
                className={`whitespace-nowrap rounded-xl px-4 py-2 text-xs font-bold uppercase tracking-wider transition ${
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
                  className={`whitespace-nowrap rounded-xl px-4 py-2 text-xs font-bold uppercase tracking-wider transition ${
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
            <div className="flex items-center gap-2 rounded-2xl border border-red-500/40 bg-red-950/60 p-4 text-xs text-red-200">
              <AlertCircle size={18} className="text-red-400 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Menu Items Grid with React Bits SpotlightCard */}
          {menuLoading ? (
            <div className="py-24 text-center text-gray-400 flex flex-col items-center justify-center gap-3">
              <div className="h-8 w-8 animate-spin rounded-full border-3 border-orange-500 border-t-transparent" />
              <span className="text-xs uppercase tracking-widest">Refreshing Branch Menu...</span>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3">
              {filteredItems.map((item) => {
                const inCart = cart.find((line) => line.id === item.id);
                return (
                  <SpotlightCard
                    key={item.id}
                    className="group flex flex-col justify-between overflow-hidden rounded-3xl border border-orange-500/10 bg-white shadow-sm dark:bg-zinc-900/80 dark:border-white/5 transition hover:-translate-y-1 hover:shadow-xl"
                  >
                    <div>
                      {/* Image Container */}
                      <div className="relative h-48 overflow-hidden bg-zinc-950">
                        {item.image ? (
                          <img
                            src={item.image}
                            alt={item.name}
                            className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-orange-500/10 to-transparent text-5xl">
                            🍽️
                          </div>
                        )}
                        <span className="absolute right-3.5 top-3.5 rounded-full bg-black/60 px-3 py-1 text-xs font-extrabold text-orange-400 backdrop-blur-md border border-orange-500/20">
                          {money(item.sellingPrice, currency)}
                        </span>
                      </div>

                      {/* Content */}
                      <div className="p-5">
                        <h2 className="font-serif text-lg font-bold text-slate-950 dark:text-white group-hover:text-orange-500 transition">
                          {item.name}
                        </h2>
                        <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-slate-500 dark:text-gray-400">
                          {item.description || 'Artisanal recipe prepared fresh using premium local ingredients.'}
                        </p>
                      </div>
                    </div>

                    {/* Footer Actions */}
                    <div className="flex items-center justify-between border-t border-slate-100 p-5 pt-3 dark:border-white/5">
                      <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-400 dark:text-gray-400">
                        <Clock3 size={13} className="text-orange-500" />
                        {item.preparationTime ? `${item.preparationTime} mins` : 'Freshly made'}
                      </span>

                      {inCart ? (
                        <div className="flex items-center gap-2 rounded-xl bg-orange-500/10 border border-orange-500/30 p-1">
                          <button
                            onClick={() => setQuantity(item.id, inCart.quantity - 1)}
                            className="h-6 w-6 rounded-lg bg-orange-500 text-white flex items-center justify-center hover:bg-orange-600 transition"
                            aria-label="Decrease quantity"
                          >
                            <Minus size={12} />
                          </button>
                          <span className="w-5 text-center text-xs font-bold text-orange-400">
                            {inCart.quantity}
                          </span>
                          <button
                            onClick={() => setQuantity(item.id, inCart.quantity + 1)}
                            className="h-6 w-6 rounded-lg bg-orange-500 text-white flex items-center justify-center hover:bg-orange-600 transition"
                            aria-label="Increase quantity"
                          >
                            <Plus size={12} />
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => addItem(item)}
                          className="inline-flex items-center gap-1.5 rounded-xl bg-orange-500 px-3.5 py-2 text-xs font-bold text-white shadow-md shadow-orange-500/25 hover:bg-orange-600 transition"
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
            <div className="py-20 text-center text-gray-400">
              <p className="text-sm">No dishes found matching your search.</p>
            </div>
          )}
        </section>

        {/* Sidebar Cart Summary with React Bits SpotlightCard */}
        <aside className="h-fit sticky top-24 space-y-6">
          <SpotlightCard className="p-6 bg-zinc-950 border-orange-500/20 text-white shadow-2xl">
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

      <ReservationModal isOpen={reservationOpen} onClose={() => setReservationOpen(false)} branches={restaurant?.branches || []} selectedBranchId={branchId} restaurantId={restaurantId} />

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

      {/* Checkout Modal */}
      {checkoutOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/85 backdrop-blur-md p-4 flex items-center justify-center animate-in fade-in duration-200">
          <div className="relative my-6 w-full max-w-xl rounded-3xl bg-zinc-950 border border-orange-500/20 p-6 sm:p-8 text-white shadow-2xl">
            <button
              onClick={() => setCheckoutOpen(false)}
              className="absolute top-5 right-5 text-gray-400 hover:text-white p-1"
            >
              <X size={20} />
            </button>

            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-orange-400 mb-1">
              <Sparkles size={14} /> Finalize Order
            </div>
            <h2 className="font-serif text-2xl font-bold text-white">Order Checkout</h2>
            <p className="text-xs text-gray-400 mt-1">
              Provide your details to dispatch order to kitchen and receive live status updates.
            </p>

            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-gray-300 mb-1">Full Name</label>
                <input
                  required
                  placeholder="e.g. Lady Sarah"
                  value={form.customerName}
                  onChange={(e) => setForm({ ...form, customerName: e.target.value })}
                  className="w-full rounded-xl bg-zinc-900 border border-white/10 px-3.5 py-2.5 text-sm text-white placeholder:text-gray-500 focus:border-orange-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-300 mb-1">Contact Phone</label>
                <input
                  required
                  placeholder="e.g. 0712345678"
                  value={form.contactPhone}
                  onChange={(e) => setForm({ ...form, contactPhone: e.target.value })}
                  className="w-full rounded-xl bg-zinc-900 border border-white/10 px-3.5 py-2.5 text-sm text-white placeholder:text-gray-500 focus:border-orange-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-300 mb-1">Email (Optional)</label>
                <input
                  type="email"
                  placeholder="e.g. guest@example.com"
                  value={form.contactEmail}
                  onChange={(e) => setForm({ ...form, contactEmail: e.target.value })}
                  className="w-full rounded-xl bg-zinc-900 border border-white/10 px-3.5 py-2.5 text-sm text-white placeholder:text-gray-500 focus:border-orange-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-300 mb-1">Fulfillment Type</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, fulfillmentType: 'PICKUP' })}
                    className={`flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-bold border transition ${
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
                    className={`flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-bold border transition ${
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
                        className={`flex flex-col items-center justify-center py-2 rounded-xl text-[11px] font-bold border transition ${
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
                    className="w-full rounded-xl bg-zinc-900 border border-white/10 px-3.5 py-2.5 text-sm text-white placeholder:text-gray-500 focus:border-orange-500 focus:outline-none"
                  />
                </div>
              )}

              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-gray-300 mb-1">Special Chef Notes</label>
                <input
                  placeholder="e.g. Dressing on side, extra napkins..."
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  className="w-full rounded-xl bg-zinc-900 border border-white/10 px-3.5 py-2.5 text-sm text-white placeholder:text-gray-500 focus:border-orange-500 focus:outline-none"
                />
              </div>
            </div>

            {/* Total Estimate summary */}
            <div className="mt-6 rounded-2xl bg-zinc-900/90 border border-white/10 p-4 text-xs flex items-center justify-between">
              <div>
                <span className="text-gray-400">Total payable:</span>
                <div className="text-lg font-serif font-bold text-orange-400">
                  {money(subtotal, currency)}
                </div>
              </div>
              <div className="text-[11px] text-gray-400 text-right">
                <span>{totalItems} items</span>
                <div className="text-emerald-400 font-semibold flex items-center gap-1 justify-end">
                  <CheckCircle2 size={12} /> Real-time Live Tracking
                </div>
              </div>
            </div>

            <button
              disabled={submitting || !cart.length}
              onClick={placeOrder}
              className="mt-5 w-full flex items-center justify-center gap-2 rounded-xl bg-orange-500 py-3.5 text-xs font-bold uppercase tracking-wider text-white shadow-xl shadow-orange-500/25 transition hover:bg-orange-600 disabled:opacity-50"
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
        <div className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-zinc-950/95 backdrop-blur-xl border-t border-orange-500/20 p-3.5 shadow-2xl safe-area-pb animate-in slide-in-from-bottom duration-200">
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
              className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-orange-500 to-amber-500 px-5 py-3 text-xs font-bold text-white shadow-lg shadow-orange-500/30 transition active:scale-95 hover:from-orange-600 hover:to-amber-600"
            >
              <span>View Order & Checkout</span>
              <ArrowRight size={15} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
