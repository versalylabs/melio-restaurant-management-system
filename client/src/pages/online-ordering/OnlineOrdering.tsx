import { useEffect, useLayoutEffect, useMemo, useState, useCallback, useRef } from 'react';
import { newRequestId } from '../../lib/utils';
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
  MessageCircle,
  Check,
} from 'lucide-react';
import { publicOrderingApi } from '../../services/api';
import ReservationModal from '../website/components/ReservationModal';
import { useCustomerAuth } from '../../contexts/CustomerAuthContext';
import { usePaymentOptions } from '../../hooks/usePaymentOptions';
import { useAuth } from '../../contexts/AuthContext';
import {
  Dock,
  GlassIcon,
  SpotlightCard,
  ShinyText,
  Magnet,
  CountUp,
} from '../../components/react-bits';
import { OptimizedImage } from '../../components/common/OptimizedImage';
import DeliveryLocationPicker from '../../components/common/DeliveryLocationPicker';
import { preloadImages } from '../../utils/imagePreloader';

type Branch = { id: string; name: string; code: string; address?: string; city?: string; phone?: string };
type Restaurant = {
  id: string;
  name: string;
  description?: string;
  phone?: string;
  address?: string;
  city?: string;
  currency?: string;
  whatsappNumber?: string | null;
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
  modifierGroups?: ModifierGroup[];
};
type ModifierOption = { id: string; name: string; priceAdjustment: number };
type ModifierGroup = { id: string; name: string; selectionType: string; isRequired: boolean; options: ModifierOption[] };
/** One cart line per dish + chosen options, so "burger, extra cheese" and "burger" stay separate. */
type CartLine = MenuItem & { quantity: number; key: string; options: ModifierOption[]; unitPrice: number };

const lineKey = (itemId: string, optionIds: string[]) => [itemId, ...[...optionIds].sort()].join('|');
const makeLine = (item: MenuItem, options: ModifierOption[], quantity: number): CartLine => ({
  ...item,
  quantity,
  options,
  key: lineKey(item.id, options.map((o) => o.id)),
  unitPrice: item.sellingPrice + options.reduce((t, o) => t + Math.max(0, o.priceAdjustment), 0),
});
const optionText = (line: CartLine) => line.options.map((o) => o.name).join(', ');

interface OrderQuote {
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  serviceChargeAmount: number;
  totalAmount: number;
  taxInclusive?: boolean;
}

// The cart survives a refresh: only ids, options and quantities are stored, and
// lines are rebuilt from the freshly loaded menu so prices are always current.
const cartStorageKey = (branchId: string) => `melio-online-cart:${branchId}`;
const readStoredCart = (branchId: string): Array<{ id: string; quantity: number; options?: string[] }> => {
  try {
    const raw = localStorage.getItem(cartStorageKey(branchId));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((l) => l && typeof l.id === 'string' && Number(l.quantity) > 0) : [];
  } catch {
    return [];
  }
};

const money = (value: number, currency = 'KES') =>
  new Intl.NumberFormat('en-KE', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value);

import { resolveImageUrl } from '../../utils/imageUtils';
import DialogOverlay from '../../components/ui/DialogOverlay';

const menuImage = (item?: Pick<MenuItem, 'name' | 'image'> | null) =>
  resolveImageUrl(item?.image, item?.name);

export default function OnlineOrdering() {
  const navigate = useNavigate();
  const location = useLocation();
  const { customer, isAuthenticated: isCustomerAuth } = useCustomerAuth();
  const { isAuthenticated: isStaffAuth } = useAuth();

  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [restaurantId, setRestaurantId] = useState('');
  const [branchId, setBranchId] = useState('');
  const hydratedBranchRef = useRef<string>('');
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null);
  const [branch, setBranch] = useState<Branch | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [activeCategory, setActiveCategory] = useState('ALL');
  // The category tabs pin directly under the header, whose height differs
  // between phone (with the branch row) and desktop.
  const [headerHeight, setHeaderHeight] = useState(64);
  const headerObserver = useRef<ResizeObserver | null>(null);
  const headerEl = useRef<HTMLElement | null>(null);
  const headerRef = useCallback((el: HTMLElement | null) => {
    headerObserver.current?.disconnect();
    headerObserver.current = null;
    headerEl.current = el;
    if (!el) return;
    setHeaderHeight(el.offsetHeight);
    if (typeof ResizeObserver === 'undefined') return;
    headerObserver.current = new ResizeObserver(() => setHeaderHeight(el.offsetHeight));
    headerObserver.current.observe(el);
  }, []);
  const [search, setSearch] = useState('');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [loading, setLoading] = useState(true);
  // Re-measure when the header's content changes (e.g. the branch row
  // appears once restaurants load); ResizeObserver covers window resizes.
  useLayoutEffect(() => {
    if (headerEl.current) setHeaderHeight(headerEl.current.offsetHeight);
  }, [loading, restaurant, branchId]);
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

  const paymentOptions = usePaymentOptions();
  useEffect(() => {
    if (!paymentOptions.card && form.paymentMethod === 'CARD') setForm((f) => ({ ...f, paymentMethod: 'CASH' }));
  }, [paymentOptions.card, form.paymentMethod]);

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

  useEffect(() => {
    setBranch(restaurant?.branches.find((b) => b.id === branchId) || null);
  }, [restaurant, branchId]);

  const loadMenu = useCallback(async (rId?: string, bId?: string) => {
    const targetRestaurantId = rId || restaurantId;
    const targetBranchId = bId || branchId;
    if (!targetRestaurantId || !targetBranchId) return;
    setMenuLoading(true);
    setError('');
    try {
      const res = await publicOrderingApi.getMenu({ restaurantId: targetRestaurantId, branchId: targetBranchId });
      const menuItems = res.data.data?.items || [];
      setCategories(res.data.data?.categories || []);
      setItems(menuItems);
      const stored = readStoredCart(targetBranchId);
      hydratedBranchRef.current = targetBranchId;
      if (stored.length) {
        const byId = new Map<string, MenuItem>(menuItems.map((m: MenuItem) => [m.id, m]));
        setCart((current) =>
          current.length
            ? current
            : stored.flatMap((line) => {
                const item = byId.get(line.id);
                if (!item) return [];
                // Drop a line whose options have since been removed from the menu...
                const all = (item.modifierGroups || []).flatMap((g) => g.options);
                const ids = Array.isArray(line.options) ? line.options.filter((o) => typeof o === 'string') : [];
                const options = ids.map((id) => all.find((o) => o.id === id)).filter(Boolean) as ModifierOption[];
                if (options.length !== ids.length) return [];
                // ...or one saved before a required choice (size, spice level) existed.
                if ((item.modifierGroups || []).some((g) => {
                  const picked = g.options.filter((o) => ids.includes(o.id)).length;
                  return (g.isRequired && !picked) || (g.selectionType === 'SINGLE' && picked > 1);
                })) return [];
                return [makeLine(item, options, Math.min(50, Math.floor(Number(line.quantity))))];
              })
        );
      }
      // Preload images in background for instant viewing
      preloadImages(menuItems.map((i: any) => menuImage(i)));
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
    if (restaurantId && branchId) {
      loadMenu(restaurantId, branchId);
    }
  }, [restaurantId, branchId, loadMenu]);

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

  const subtotal = cart.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
  const totalItems = cart.reduce((sum, item) => sum + item.quantity, 0);
  const currency = restaurant?.currency || 'KES';

  // Dishes with options open the picker first; the rest go straight in.
  const [optionItem, setOptionItem] = useState<MenuItem | null>(null);
  const addLine = (item: MenuItem, options: ModifierOption[]) =>
    setCart((current) => {
      const key = lineKey(item.id, options.map((o) => o.id));
      const existing = current.find((line) => line.key === key);
      return existing
        ? current.map((line) => (line.key === key ? { ...line, quantity: Math.min(50, line.quantity + 1) } : line))
        : [...current, makeLine(item, options, 1)];
    });
  const addItem = (item: MenuItem) => {
    if (item.modifierGroups?.length) setOptionItem(item);
    else addLine(item, []);
  };

  const setQuantity = (key: string, quantity: number) =>
    setCart((current) =>
      quantity <= 0
        ? current.filter((line) => line.key !== key)
        : current.map((line) => (line.key === key ? { ...line, quantity: Math.min(50, quantity) } : line))
    );

  // "Order on WhatsApp": opens a chat with the restaurant, with the cart typed in.
  const whatsappHref = (() => {
    const number = restaurant?.whatsappNumber;
    if (!number) return '';
    const lines = cart.map((l) => `${l.quantity} x ${l.name}${l.options.length ? ` (${optionText(l)})` : ''}`);
    const text = lines.length
      ? `Hi ${restaurant?.name || ''}, I'd like to order${branch ? ` from ${branch.name}` : ''}:\n${lines.join('\n')}`
      : `Hi ${restaurant?.name || ''}, I'd like to place an order${branch ? ` from ${branch.name}` : ''}.`;
    return `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
  })();

  // One idempotency key per checkout: kept across retries of the same cart so a
  // double tap or a dropped connection can't place (and charge) two orders.
  const checkoutRequestId = useRef<string | null>(null);
  useEffect(() => { checkoutRequestId.current = null; }, [cart, branchId, form]);

  useEffect(() => {
    // Don't write until this branch's saved cart has been read back, or the
    // empty cart on first render would erase it.
    if (!branchId || hydratedBranchRef.current !== branchId) return;
    try {
      if (cart.length) localStorage.setItem(cartStorageKey(branchId), JSON.stringify(cart.map((l) => ({ id: l.id, quantity: l.quantity, options: l.options.map((o) => o.id) }))));
      else localStorage.removeItem(cartStorageKey(branchId));
    } catch {
      // Storage unavailable: the cart just won't survive a refresh.
    }
  }, [cart, branchId]);

  // Exact price from the server (tax, service charge, promotion) so the total
  // shown before paying is the amount on the M-Pesa prompt.
  const [quote, setQuote] = useState<OrderQuote | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState('');
  const cartKey = cart.map((l) => `${l.key}:${l.quantity}`).join(',');
  useEffect(() => {
    if (!checkoutOpen || !cart.length || !restaurantId || !branchId) {
      setQuote(null);
      setQuoteError('');
      return;
    }
    let cancelled = false;
    // Never show (or submit against) a total for a different cart or code.
    setQuote(null);
    setQuoteLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res = await publicOrderingApi.quoteOrder({
          restaurantId,
          branchId,
          promoCode: form.promoCode || undefined,
          items: cart.map((item) => ({ menuItemId: item.id, quantity: item.quantity, modifiers: item.options.map((o) => o.id) })),
        });
        if (!cancelled) {
          setQuote(res.data.data);
          setQuoteError('');
        }
      } catch (err: any) {
        if (!cancelled) {
          setQuote(null);
          setQuoteError(err.response?.data?.message || 'Could not calculate the final total. Any tax is added when the order is placed.');
        }
      } finally {
        if (!cancelled) setQuoteLoading(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkoutOpen, cartKey, restaurantId, branchId, form.promoCode]);

  const placeOrder = async () => {
    if (!cart.length || submitting) return;
    if (form.fulfillmentType === 'DELIVERY' && !form.deliveryAddress.trim()) {
      setError('Please add a delivery address.');
      return;
    }
    setSubmitting(true);
    setError('');
    if (!checkoutRequestId.current) checkoutRequestId.current = newRequestId();
    try {
      const response = await publicOrderingApi.placeOrder({
        clientRequestId: checkoutRequestId.current,
        restaurantId,
        branchId,
        ...form,
        items: cart.map((item) => ({ menuItemId: item.id, quantity: item.quantity, modifiers: item.options.map((o) => o.id) })),
      });
      const data = response.data.data;
      setCart([]);
      try { localStorage.removeItem(cartStorageKey(branchId)); } catch { /* ignore */ }
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
    <div className="site-glass glass-backdrop glass-backdrop-fixed relative min-h-screen w-full max-w-full overflow-x-clip text-slate-800 dark:text-gray-100 antialiased pb-28 md:pb-24 selection:bg-orange-500 selection:text-white">
      {/* Top Header */}
      <header ref={headerRef} className="glass-raised glass-dark sticky top-0 z-30 w-full max-w-full border-x-0 border-t-0 text-white">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-3 px-3.5 py-3 sm:px-6">
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
          <div className="md:hidden w-full max-w-full min-w-0 px-3.5 pb-2.5 flex items-center gap-2 overflow-x-auto scrollbar-none">
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
      <main className="mx-auto w-full max-w-7xl gap-6 sm:gap-8 px-3.5 py-4 sm:px-6 sm:py-8 lg:grid lg:grid-cols-[1fr_360px] min-w-0">
        <section className="w-full max-w-full min-w-0 space-y-4 sm:space-y-6">
          {/* Top Hero Banner with SpotlightCard */}
          <SpotlightCard className="w-full max-w-full min-w-0 p-4 sm:p-7 bg-zinc-950 border-orange-500/20 text-white shadow-2xl rounded-2xl sm:rounded-3xl">
            <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center relative z-10 w-full min-w-0">
              <div className="min-w-0">
                <div className="inline-flex items-center gap-1.5 text-[11px] sm:text-xs font-bold uppercase tracking-widest text-orange-400 mb-1">
                  <Sparkles size={13} /> Order online
                </div>
                <h1 className="font-serif text-2xl sm:text-4xl font-bold tracking-tight break-words">
                  What are you craving today?
                </h1>
                <p className="mt-1 text-xs text-gray-400 max-w-md hidden sm:block">
                  Order ahead for pickup, or have it delivered. Pay by M-Pesa.
                </p>
              </div>

              {/* Search input */}
              <div className="relative w-full md:max-w-xs min-w-0">
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
            <div className="mt-4 pt-4 border-t border-white/10 w-full min-w-0">
              {/* Mobile Quick Row */}
              <div className="sm:hidden flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-gray-300 font-medium">
                <span className="inline-flex items-center gap-1 text-orange-400">
                  <Clock3 size={13} /> ~20-35 mins
                </span>
                <span className="inline-flex items-center gap-1 text-amber-400">
                  <Truck size={13} /> Express Delivery
                </span>
                <span className="inline-flex items-center gap-1 text-emerald-400">
                  <Sparkles size={13} /> Rewards
                </span>
              </div>

              {/* Desktop 3-column Glass Badges */}
              <div className="hidden sm:grid grid-cols-3 gap-3 w-full">
                <GlassIcon
                  icon={<Clock3 size={18} />}
                  label="Express Kitchen"
                  sublabel="~20-35 mins"
                  color="orange"
                  size="sm"
                />
                <GlassIcon
                  icon={<Truck size={18} />}
                  label="Delivery"
                  sublabel="To your door"
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

          </SpotlightCard>

          {/* Category tabs stay pinned under the header while scrolling the menu */}
          <nav aria-label="Menu categories" style={{ top: headerHeight }} className="glass-raised sticky z-20 -mx-3.5 px-3.5 py-2.5 sm:mx-0 sm:px-3 rounded-none sm:rounded-2xl">
            <div className="w-full max-w-full min-w-0 flex gap-2 overflow-x-auto scrollbar-none">
              <button
                type="button"
                aria-pressed={activeCategory === 'ALL'}
                onClick={() => setActiveCategory('ALL')}
                className={`whitespace-nowrap rounded-xl px-3.5 py-2 text-xs font-bold uppercase tracking-wider transition shrink-0 ${
                  activeCategory === 'ALL'
                    ? 'bg-orange-500 text-white shadow-lg shadow-orange-500/25'
                    : 'bg-black/5 text-slate-600 hover:bg-black/10 dark:bg-white/10 dark:text-gray-300 dark:hover:bg-white/20 dark:hover:text-white'
                }`}
              >
                All Dishes ({items.length})
              </button>
              {categories.map((category) => (
                <button
                  key={category.id}
                  type="button"
                  aria-pressed={activeCategory === category.id}
                  onClick={() => setActiveCategory(category.id)}
                  className={`whitespace-nowrap rounded-xl px-3.5 py-2 text-xs font-bold uppercase tracking-wider transition shrink-0 ${
                    activeCategory === category.id
                      ? 'bg-orange-500 text-white shadow-lg shadow-orange-500/25'
                      : 'bg-black/5 text-slate-600 hover:bg-black/10 dark:bg-white/10 dark:text-gray-300 dark:hover:bg-white/20 dark:hover:text-white'
                  }`}
                >
                  {category.name}
                </button>
              ))}
            </div>
          </nav>

          {error && (
            <div className="flex items-center justify-between gap-2 rounded-2xl border border-red-500/40 bg-red-950/60 p-4 text-xs text-red-200 w-full min-w-0">
              <div className="flex items-center gap-2">
                <AlertCircle size={18} className="text-red-400 shrink-0" />
                <span>{error}</span>
              </div>
              <button
                onClick={() => loadMenu()}
                className="px-3 py-1.5 rounded-lg bg-red-500/20 border border-red-500/40 text-red-200 hover:bg-red-500/30 flex items-center gap-1.5 font-bold uppercase text-[10px] shrink-0"
              >
                <RefreshCw size={12} /> Retry
              </button>
            </div>
          )}

          {/* Menu Items Grid with Responsive Cards */}
          {menuLoading ? (
            <div className="py-20 text-center text-gray-400 flex flex-col items-center justify-center gap-3 w-full">
              <div className="h-8 w-8 animate-spin rounded-full border-3 border-orange-500 border-t-transparent" />
              <span className="text-xs uppercase tracking-widest font-sans">Refreshing Branch Menu...</span>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:gap-6 sm:grid-cols-2 xl:grid-cols-3 w-full min-w-0">
              {filteredItems.map((item) => {
                const hasOptions = !!item.modifierGroups?.length;
                const inCart = hasOptions ? undefined : cart.find((line) => line.key === item.id);
                const optionCount = hasOptions ? cart.filter((line) => line.id === item.id).reduce((t, l) => t + l.quantity, 0) : 0;
                const resolvedImage = menuImage(item);
                return (
                  <SpotlightCard
                    key={item.id}
                    className="w-full max-w-full min-w-0 group flex flex-col justify-between overflow-hidden rounded-2xl sm:rounded-3xl border border-orange-500/10 bg-white shadow-sm dark:bg-zinc-900/80 dark:border-white/5 transition hover:-translate-y-1 hover:shadow-xl"
                  >
                    <div className="w-full min-w-0 flex gap-3 p-3 sm:block sm:p-0">
                      {/* Image: small thumbnail on phones, full width from sm up */}
                      <div className="relative h-24 w-24 shrink-0 rounded-xl sm:rounded-none sm:h-48 sm:w-full overflow-hidden bg-zinc-950">
                        <OptimizedImage
                          src={resolvedImage}
                          alt={item.name}
                          containerClassName="h-full w-full"
                          className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
                          fallbackIcon={<div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-orange-500/10 to-transparent text-5xl">🍽️</div>}
                        />
                        <span className="hidden sm:inline absolute right-3 top-3 rounded-full bg-black/75 px-3 py-1 text-xs font-extrabold text-orange-400 backdrop-blur-md border border-orange-500/30 shadow-md">
                          {money(item.sellingPrice, currency)}
                        </span>
                      </div>

                      {/* Content */}
                      <div className="flex-1 sm:p-5 w-full min-w-0">
                        <h2 className="font-serif text-base sm:text-lg font-bold text-slate-950 dark:text-white group-hover:text-orange-500 transition line-clamp-1 break-words">
                          {item.name}
                        </h2>
                        <p className="sm:hidden mt-0.5 text-sm font-extrabold text-orange-500">{money(item.sellingPrice, currency)}</p>
                        <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-slate-500 dark:text-gray-400 break-words">
                          {item.description || ''}
                        </p>
                      </div>
                    </div>

                    {/* Footer Actions with Touch Targets */}
                    <div className="flex items-center justify-between border-t border-slate-100 px-3 py-2 sm:p-4 sm:pt-3 dark:border-white/5 w-full min-w-0">
                      <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-400 dark:text-gray-400">
                        <Clock3 size={13} className="text-orange-500 shrink-0" />
                        <span>{item.preparationTime ? `${item.preparationTime} mins` : ''}</span>
                      </span>

                      {inCart ? (
                        <div className="flex items-center gap-1.5 sm:gap-2 rounded-xl bg-orange-500/10 border border-orange-500/30 p-1">
                          <button
                            type="button"
                            onClick={() => setQuantity(inCart.key, inCart.quantity - 1)}
                            className="h-10 w-10 sm:h-8 sm:w-8 rounded-lg bg-orange-500 text-white flex items-center justify-center hover:bg-orange-600 active:scale-95 transition"
                            aria-label={`Remove one ${item.name}`}
                          >
                            <Minus size={13} />
                          </button>
                          <span className="w-6 text-center text-xs font-bold text-orange-400">
                            {inCart.quantity}
                          </span>
                          <button
                            type="button"
                            onClick={() => setQuantity(inCart.key, inCart.quantity + 1)}
                            className="h-10 w-10 sm:h-8 sm:w-8 rounded-lg bg-orange-500 text-white flex items-center justify-center hover:bg-orange-600 active:scale-95 transition"
                            aria-label={`Add one ${item.name}`}
                          >
                            <Plus size={13} />
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => addItem(item)}
                          aria-label={`Add ${item.name} to order`}
                          className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl bg-orange-500 px-3.5 py-2 text-xs font-bold text-white shadow-md shadow-orange-500/25 active:scale-95 hover:bg-orange-600 transition"
                        >
                          <Plus size={14} /> {hasOptions ? (optionCount ? `Add (${optionCount} in order)` : 'Choose') : 'Add'}
                        </button>
                      )}
                    </div>
                  </SpotlightCard>
                );
              })}
            </div>
          )}

          {!filteredItems.length && !menuLoading && (
            <div className="py-16 text-center text-gray-400 w-full">
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
                    key={line.key}
                    className="flex items-center justify-between gap-3 rounded-2xl bg-white/5 border border-white/5 p-3"
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-bold truncate">{line.name}</div>
                      {line.options.length > 0 && <div className="text-[11px] text-gray-400 truncate">{optionText(line)}</div>}
                      <div className="text-[11px] text-orange-400 font-semibold">
                        {money(line.unitPrice, currency)}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={() => setQuantity(line.key, line.quantity - 1)}
                        className="h-6 w-6 rounded-lg bg-white/10 hover:bg-white/20 text-white flex items-center justify-center text-xs"
                      >
                        −
                      </button>
                      <span className="w-5 text-center text-xs font-bold">{line.quantity}</span>
                      <button
                        onClick={() => setQuantity(line.key, line.quantity + 1)}
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
              {whatsappHref && (
                <a
                  href={whatsappHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full flex items-center justify-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500/10 py-3 text-xs font-bold text-emerald-300 hover:bg-emerald-500/20 transition"
                >
                  <MessageCircle size={15} /> Order on WhatsApp instead
                </a>
              )}
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
        <DialogOverlay onClose={() => setCheckoutOpen(false)} label="Order checkout" className="fixed inset-0 z-50 overflow-y-auto bg-black/85 backdrop-blur-md flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-200">
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
                  <div key={c.key} className="flex items-center justify-between text-xs text-gray-300">
                    <span className="truncate pr-2">{c.quantity}x {c.name}{c.options.length > 0 && <span className="text-gray-500"> ({optionText(c)})</span>}</span>
                    <span className="shrink-0 font-mono text-gray-400">{money(c.unitPrice * c.quantity, currency)}</span>
                  </div>
                ))}
              </div>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                placeOrder();
              }}
            >
            <div className="mt-5 grid gap-3.5 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label htmlFor="checkout-name" className="block text-xs font-semibold text-gray-300 mb-1">Full Name</label>
                <input
                  id="checkout-name"
                  required
                  autoComplete="name"
                  maxLength={120}
                  placeholder="e.g. Sarah Mwangi"
                  value={form.customerName}
                  onChange={(e) => setForm({ ...form, customerName: e.target.value })}
                  className="w-full rounded-xl bg-zinc-900 border border-white/10 px-3.5 py-2.5 text-base sm:text-sm text-white placeholder:text-gray-500 focus:border-orange-500 focus:outline-none"
                />
              </div>

              <div>
                <label htmlFor="checkout-phone" className="block text-xs font-semibold text-gray-300 mb-1">Contact Phone</label>
                <input
                  id="checkout-phone"
                  required
                  type="tel"
                  autoComplete="tel"
                  inputMode="tel"
                  pattern="[+]?[0-9][0-9 ]{8,15}"
                  title="Enter a phone number such as 0712345678 or +254712345678"
                  placeholder="e.g. 0712345678"
                  value={form.contactPhone}
                  onChange={(e) => setForm({ ...form, contactPhone: e.target.value })}
                  className="w-full rounded-xl bg-zinc-900 border border-white/10 px-3.5 py-2.5 text-base sm:text-sm text-white placeholder:text-gray-500 focus:border-orange-500 focus:outline-none"
                />
              </div>

              <div>
                <label htmlFor="checkout-email" className="block text-xs font-semibold text-gray-300 mb-1">Email (Optional)</label>
                <input
                  id="checkout-email"
                  type="email"
                  autoComplete="email"
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
                <div className={`grid ${paymentOptions.card ? 'grid-cols-3' : 'grid-cols-2'} gap-1.5`}>
                  {[
                    { id: 'MOBILE_MONEY', label: 'M-Pesa', icon: Smartphone },
                    { id: 'CARD', label: paymentOptions.simulation ? 'Card (test)' : 'Card', icon: CreditCard },
                    { id: 'CASH', label: 'Cash', icon: Banknote },
                  ].filter((pm) => pm.id !== 'CARD' || paymentOptions.card).map((pm) => {
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
                  <DeliveryLocationPicker
                    value={form.deliveryAddress}
                    onChange={(val) => setForm({ ...form, deliveryAddress: val })}
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

            {/* Total breakdown: the exact amount the customer will be charged */}
            <div className="mt-5 rounded-2xl bg-zinc-900/90 border border-white/10 p-3.5 text-xs" aria-live="polite">
              <dl className="space-y-1.5 text-gray-300">
                <div className="flex justify-between">
                  <dt>Subtotal ({totalItems} {totalItems === 1 ? 'item' : 'items'})</dt>
                  <dd className="font-mono">{money(quote?.subtotal ?? subtotal, currency)}</dd>
                </div>
                {!!quote?.discountAmount && (
                  <div className="flex justify-between text-emerald-400">
                    <dt>Discount</dt>
                    <dd className="font-mono">-{money(quote.discountAmount, currency)}</dd>
                  </div>
                )}
                {!!quote?.taxAmount && (
                  <div className="flex justify-between">
                    <dt>{quote.taxInclusive ? 'VAT (included in prices)' : 'VAT'}</dt>
                    <dd className="font-mono">{money(quote.taxAmount, currency)}</dd>
                  </div>
                )}
                {!!quote?.serviceChargeAmount && (
                  <div className="flex justify-between">
                    <dt>Service charge</dt>
                    <dd className="font-mono">{money(quote.serviceChargeAmount, currency)}</dd>
                  </div>
                )}
              </dl>
              <div className="mt-2.5 pt-2.5 border-t border-white/10 flex items-end justify-between">
                <span className="text-gray-400">{quote ? 'Total to pay' : 'Estimated total'}</span>
                <span className="text-lg font-serif font-bold text-orange-400">
                  {quoteLoading && !quote ? 'Calculating...' : money(quote?.totalAmount ?? subtotal, currency)}
                </span>
              </div>
              {quoteError && <p className="mt-2 text-[11px] text-amber-300">{quoteError}</p>}
            </div>

            {error && (
              <div role="alert" className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-3.5 py-2.5 text-xs text-red-300">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting || !cart.length || quoteLoading}
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
            </form>
          </div>
        </DialogOverlay>
      )}

      {optionItem && (
        <OptionPicker
          item={optionItem}
          currency={currency}
          onClose={() => setOptionItem(null)}
          onAdd={(options) => {
            addLine(optionItem, options);
            setOptionItem(null);
          }}
        />
      )}

      {whatsappHref && !checkoutOpen && (
        <a
          href={whatsappHref}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Order on WhatsApp"
          className={`lg:hidden fixed right-4 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500 text-white shadow-lg shadow-emerald-500/30 active:scale-95 transition ${cart.length ? 'bottom-24' : 'bottom-5'}`}
        >
          <MessageCircle size={22} />
        </a>
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

/** Options for one dish (size, extras, spice level), checked before it goes in the cart. */
function OptionPicker({ item, currency, onClose, onAdd }: { item: MenuItem; currency: string; onClose: () => void; onAdd: (options: ModifierOption[]) => void }) {
  const groups = item.modifierGroups || [];
  const [chosen, setChosen] = useState<Record<string, string[]>>({});
  const toggle = (group: ModifierGroup, optionId: string) =>
    setChosen((current) => {
      const picked = current[group.id] || [];
      if (group.selectionType === 'SINGLE') return { ...current, [group.id]: picked[0] === optionId && !group.isRequired ? [] : [optionId] };
      return { ...current, [group.id]: picked.includes(optionId) ? picked.filter((id) => id !== optionId) : [...picked, optionId] };
    });
  const options = groups.flatMap((g) => g.options.filter((o) => (chosen[g.id] || []).includes(o.id)));
  const missing = groups.filter((g) => g.isRequired && !(chosen[g.id] || []).length);
  const price = item.sellingPrice + options.reduce((t, o) => t + Math.max(0, o.priceAdjustment), 0);

  return (
    <DialogOverlay onClose={onClose} label={`Choose options for ${item.name}`} className="fixed inset-0 z-50 overflow-y-auto bg-black/85 backdrop-blur-md flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="relative w-full max-w-md max-h-[90vh] overflow-y-auto rounded-t-3xl sm:rounded-3xl bg-zinc-950 border border-orange-500/20 p-5 sm:p-6 text-white shadow-2xl">
        <button onClick={onClose} className="absolute top-4 right-4 text-gray-400 hover:text-white p-2 rounded-xl bg-white/5 hover:bg-white/10" aria-label="Close">
          <X size={18} />
        </button>
        <h2 className="font-serif text-xl font-bold pr-10">{item.name}</h2>
        <p className="text-xs text-gray-400 mt-0.5">{money(item.sellingPrice, currency)}</p>

        <div className="mt-5 space-y-5">
          {groups.map((group) => {
            const picked = chosen[group.id] || [];
            return (
              <fieldset key={group.id}>
                <legend className="flex w-full items-center justify-between text-sm font-bold">
                  <span>{group.name}</span>
                  <span className="text-[11px] font-semibold text-gray-400">
                    {group.isRequired ? 'Required' : 'Optional'}{group.selectionType === 'SINGLE' ? ', pick one' : ''}
                  </span>
                </legend>
                <div className="mt-2 space-y-2">
                  {group.options.map((option) => {
                    const on = picked.includes(option.id);
                    return (
                      <button
                        key={option.id}
                        type="button"
                        role={group.selectionType === 'SINGLE' ? 'radio' : 'checkbox'}
                        aria-checked={on}
                        onClick={() => toggle(group, option.id)}
                        className={`w-full flex items-center justify-between gap-3 rounded-xl border px-3.5 py-3 text-left text-sm transition ${on ? 'border-orange-500 bg-orange-500/15' : 'border-white/10 bg-white/5 hover:border-white/25'}`}
                      >
                        <span className="flex items-center gap-2.5">
                          <span className={`grid h-5 w-5 place-items-center border ${group.selectionType === 'SINGLE' ? 'rounded-full' : 'rounded-md'} ${on ? 'border-orange-500 bg-orange-500' : 'border-white/30'}`}>
                            {on && <Check size={12} />}
                          </span>
                          {option.name}
                        </span>
                        {option.priceAdjustment > 0 && <span className="text-xs text-orange-300">+{money(option.priceAdjustment, currency)}</span>}
                      </button>
                    );
                  })}
                </div>
              </fieldset>
            );
          })}
        </div>

        <button
          type="button"
          disabled={missing.length > 0}
          onClick={() => onAdd(options)}
          className="mt-6 w-full rounded-xl bg-gradient-to-r from-orange-500 to-amber-500 py-3.5 text-sm font-bold text-white shadow-lg shadow-orange-500/25 transition hover:from-orange-600 hover:to-amber-600 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {missing.length ? `Choose ${missing[0].name.toLowerCase()}` : `Add to order, ${money(price, currency)}`}
        </button>
      </div>
    </DialogOverlay>
  );
}
