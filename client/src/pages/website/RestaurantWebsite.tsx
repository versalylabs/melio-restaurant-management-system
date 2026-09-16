import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  Clock3,
  MapPin,
  Moon,
  Phone,
  Search,
  ShoppingBag,
  Star,
  Sun,
  UtensilsCrossed,
  Calendar,
  Sparkles,
  Award,
  Mail,
  Send,
  CheckCircle2,
  Menu as MenuIcon,
  X,
  Instagram,
  Facebook,
  Quote,
  Eye,
  User,
  ShieldCheck,
  Utensils,
  BookOpen,
  Image as ImageIcon,
  Wine,
  Leaf,
  Home as HomeIcon
} from 'lucide-react';
import { publicOrderingApi, websiteApi } from '../../services/api';
import { useCustomerAuth } from '../../contexts/CustomerAuthContext';
import { useAuth } from '../../contexts/AuthContext';
import GalleryLightbox, { GalleryItem } from './components/GalleryLightbox';
import ReservationModal from './components/ReservationModal';
import CustomerAuthModal from './components/CustomerAuthModal';
import { Dock, GlassIcon, SpotlightCard, ShinyText, Magnet, CountUp } from '../../components/react-bits';

type Branch = { id: string; name: string; code: string; address?: string; city?: string; phone?: string; email?: string; callPhone?: string; diningHours?: string };
type Restaurant = {
  id: string;
  name: string;
  description?: string;
  phone?: string;
  email?: string;
  address?: string;
  city?: string;
  currency?: string;
  logo?: string;
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

const money = (value: number, currency = 'KES') =>
  new Intl.NumberFormat('en-KE', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value);

// Supabase-backed fallback gallery. These are the existing public files in the `menu-images` bucket.
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

const GALLERY_ITEMS: GalleryItem[] = [
  { id: 'g1', title: 'Grilled Chicken', category: 'dishes', image: supabaseImage('Grilled Chicken.jpg'), description: 'Melio signature grilled chicken.' },
  { id: 'g2', title: 'Beef Steak', category: 'dishes', image: supabaseImage('Beef Steak.jpg'), description: 'Tender beef steak served with chips and salad.' },
  { id: 'g3', title: 'Beef Burger', category: 'dishes', image: supabaseImage('Beef Burger.jpg'), description: 'Melio gourmet beef burger.' },
  { id: 'g4', title: 'Chicken Burger', category: 'dishes', image: supabaseImage('Chicken Burger.jpg'), description: 'Grilled chicken burger with house sauce.' },
  { id: 'g5', title: 'Chicken Wings', category: 'dishes', image: supabaseImage('Chicken Wings.jpg'), description: 'Spicy grilled chicken wings.' },
  { id: 'g6', title: 'Chocolate Cake', category: 'dishes', image: supabaseImage('Chocolate Cake.jpg'), description: 'Rich chocolate layer cake.' },
];

// Curated Testimonials
const TESTIMONIALS = [
  {
    name: 'Victoria Montgomery',
    role: 'Food & Wine Critic',
    rating: 5,
    text: 'An exceptional gastronomic experience. The flavours are layered with exquisite finesse, and the ambience balances luxury and warmth flawlessly.',
    date: 'February 2026',
  },
  {
    name: 'David Kimani',
    role: 'Verified Guest',
    rating: 5,
    text: 'Hands down the best dining experience in town. From seamless table booking to impeccable table service and fast online delivery, they never miss.',
    date: 'January 2026',
  },
  {
    name: 'Elena Rostova',
    role: 'Private Event Host',
    rating: 5,
    text: 'We celebrated our anniversary here and were treated like royalty. The signature dishes and cocktail pairings are world-class.',
    date: 'December 2025',
  },
];

export default function RestaurantWebsite() {
  const navigate = useNavigate();
  const { customer, isAuthenticated: isCustomerAuth } = useCustomerAuth();
  const { isAuthenticated: isStaffAuth } = useAuth();
  const [, setRestaurants] = useState<Restaurant[]>([]);
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null);
  const [branchId, setBranchId] = useState('');
  const [categories, setCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [activeCategory, setActiveCategory] = useState('ALL');
  const [search, setSearch] = useState('');
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem('rms-theme') !== 'light');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [websiteConfig, setWebsiteConfig] = useState<any>(null);
  const [websiteGallery, setWebsiteGallery] = useState<any[]>([]);
  const [websiteTestimonials, setWebsiteTestimonials] = useState<any[]>([]);

  // Customer Auth Modal state
  const [customerAuthOpen, setCustomerAuthOpen] = useState(false);

  // Gallery state
  const [galleryFilter, setGalleryFilter] = useState<'all' | 'dishes' | 'cocktails' | 'ambience' | 'culinary'>('all');
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);

  // Reservation Modal state
  const [reservationOpen, setReservationOpen] = useState(false);

  // Contact form state
  const [contactForm, setContactForm] = useState({ name: '', email: '', phone: '', subject: 'General Enquiry', message: '' });
  const [contactSubmitted, setContactSubmitted] = useState(false);
  const [contactLoading, setContactLoading] = useState(false);

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
        if (data[0]) {
          setRestaurant(data[0]);
          setBranchId(data[0].branches?.[0]?.id || '');
          websiteApi.getPublic(data[0].id).then((r:any)=>{const w=r.data.data;setWebsiteConfig(w);setWebsiteGallery(w.gallery||[]);setWebsiteTestimonials(w.testimonials||[])}).catch(()=>{});
        } else {
          setError('No restaurant is currently configured.');
        }
      })
      .catch((err) => setError(err.response?.data?.message || 'Unable to load restaurant.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!restaurant || !branchId) return;
    publicOrderingApi
      .getMenu({ restaurantId: restaurant.id, branchId })
      .then((res) => {
        setCategories(res.data.data?.categories || []);
        setItems(res.data.data?.items || []);
        if (res.data.data?.restaurant) {
          setRestaurant((current) => (current ? { ...current, ...res.data.data.restaurant } : current));
        }
      })
      .catch((err) => setError(err.response?.data?.message || 'Unable to load menu.'));
  }, [restaurant?.id, branchId]);

  const filteredItems = useMemo(
    () =>
      items.filter(
        (item) =>
          (activeCategory === 'ALL' || item.categoryId === activeCategory) &&
          `${item.name} ${item.description || ''}`.toLowerCase().includes(search.toLowerCase())
      ),
    [items, activeCategory, search]
  );

  const featuredId =
    websiteConfig?.settings?.featuredMenuItemId ||
    websiteConfig?.featuredMenuItemId ||
    websiteConfig?.featuredMenuItem?.id;
  const heroItem =
    (featuredId && items.find((item) => item.id === featuredId)) ||
    websiteConfig?.featuredMenuItem ||
    items.find((item) => menuImage(item)) ||
    items[0];
  const heroImage = menuImage(heroItem);

  const getBranchHours = (raw: any) => {
    if (!raw) return { mondayThursday: '11:30 AM – 10:30 PM', fridaySaturday: '11:30 AM – 11:30 PM', sunday: '10:00 AM – 09:00 PM' };
    if (typeof raw === 'object') return {
      mondayThursday: raw.mondayThursday || '11:30 AM – 10:30 PM',
      fridaySaturday: raw.fridaySaturday || '11:30 AM – 11:30 PM',
      sunday: raw.sunday || '10:00 AM – 09:00 PM',
    };
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        return {
          mondayThursday: parsed.mondayThursday || '11:30 AM – 10:30 PM',
          fridaySaturday: parsed.fridaySaturday || '11:30 AM – 11:30 PM',
          sunday: parsed.sunday || '10:00 AM – 09:00 PM',
        };
      }
    } catch {}
    return { mondayThursday: '11:30 AM – 10:30 PM', fridaySaturday: '11:30 AM – 11:30 PM', sunday: '10:00 AM – 09:00 PM' };
  };

  const filteredGallery = useMemo(() => {
    const source=websiteGallery.length?websiteGallery:GALLERY_ITEMS;
    if (galleryFilter === 'all') return source;
    return source.filter((g) => g.category === galleryFilter);
  }, [galleryFilter, websiteGallery]);

  const handleContactSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setContactLoading(true);
    setTimeout(() => {
      setContactLoading(false);
      setContactSubmitted(true);
      setContactForm({ name: '', email: '', phone: '', subject: 'General Enquiry', message: '' });
    }, 600);
  };

  const openLightbox = (index: number) => {
    setLightboxIndex(index);
    setLightboxOpen(true);
  };

  const scrollToSection = (e: React.MouseEvent<HTMLAnchorElement> | React.MouseEvent<HTMLButtonElement>, targetId: string) => {
    e.preventDefault();
    if (targetId === '#home' || targetId === 'home') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      const cleanId = targetId.replace('#', '');
      const el = document.getElementById(cleanId);
      if (el) {
        const offset = 75; // Account for fixed navigation header
        const bodyRect = document.body.getBoundingClientRect().top;
        const elementRect = el.getBoundingClientRect().top;
        const elementPosition = elementRect - bodyRect;
        const offsetPosition = elementPosition - offset;
        window.scrollTo({
          top: offsetPosition,
          behavior: 'smooth',
        });
      }
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen grid place-items-center bg-[#0d0d11] text-orange-400">
        <div className="flex flex-col items-center gap-3">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-orange-500 border-t-transparent" />
          <span className="text-sm font-serif tracking-widest uppercase text-gray-300">Curating Experience...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#faf9f7] text-slate-800 antialiased dark:bg-[#0d0d11] dark:text-gray-100 selection:bg-orange-500 selection:text-white">
      {/* ======================= NAVIGATION HEADER ======================= */}
      <header className="fixed inset-x-0 top-0 z-40 border-b border-white/10 bg-black/40 backdrop-blur-xl transition-all duration-300">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-4 sm:px-8">
          {/* Logo & Brand */}
          <a
            href="#home"
            onClick={(e) => scrollToSection(e, '#home')}
            className="flex items-center gap-3 group cursor-pointer"
          >
            {restaurant?.logo ? (
              <img src={restaurant.logo} alt="" className="h-10 w-10 rounded-xl object-cover ring-1 ring-orange-500/30 group-hover:ring-orange-500 transition" />
            ) : (
              <div className="grid h-10 w-10 place-items-center rounded-xl bg-orange-500 text-white shadow-lg shadow-orange-500/25 group-hover:scale-105 transition">
                <UtensilsCrossed size={20} />
              </div>
            )}
            <div>
              <div className="truncate text-lg font-serif font-extrabold tracking-wide text-white">
                {restaurant?.name || 'Melio'}
              </div>
              <div className="hidden text-[10px] uppercase tracking-[0.2em] text-orange-400 sm:block">
                Fine Dining & Craft
              </div>
            </div>
          </a>

          {/* Desktop Navigation Links */}
          <nav className="hidden items-center gap-7 text-sm font-medium text-gray-200 lg:flex">
            {[
              { label: 'Home', href: '#home' },
              { label: 'Menu', href: '#menu' },
              { label: 'Our Story', href: '#about' },
              { label: 'Gallery', href: '#gallery' },
              { label: 'Locations', href: '#locations' },
              { label: 'Reviews', href: '#testimonials' },
              { label: 'Contact', href: '#contact' },
            ].map((item) => (
              <a
                key={item.href}
                href={item.href}
                onClick={(e) => scrollToSection(e, item.href)}
                className="hover:text-orange-400 transition cursor-pointer"
              >
                {item.label}
              </a>
            ))}
          </nav>

          {/* Header Action Controls */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => setDarkMode((v) => !v)}
              className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 text-white backdrop-blur-md transition hover:bg-white/20 hover:text-orange-400"
              aria-label="Toggle theme"
            >
              {darkMode ? <Sun size={18} /> : <Moon size={18} />}
            </button>

            {/* Customer or Staff Account Button */}
            {isStaffAuth ? (
              <Link
                to="/dashboard"
                className="hidden md:inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 px-3.5 py-2 text-xs font-bold uppercase tracking-wider text-white shadow-lg shadow-orange-500/25 transition"
              >
                <ShieldCheck size={14} /> Dashboard
              </Link>
            ) : isCustomerAuth ? (
              <Link
                to="/account"
                className="hidden md:inline-flex items-center gap-2 rounded-xl bg-white/10 hover:bg-white/20 border border-white/10 px-3.5 py-2 text-xs font-semibold text-white transition"
              >
                <div className="h-6 w-6 rounded-full bg-gradient-to-tr from-orange-500 to-amber-400 flex items-center justify-center text-[11px] font-bold text-white shadow-sm">
                  {customer?.name?.charAt(0).toUpperCase() || 'C'}
                </div>
                <div className="flex flex-col text-left">
                  <span className="truncate max-w-[90px] leading-tight">{customer?.name?.split(' ')[0] || 'Member'}</span>
                  <span className="text-[10px] text-orange-400 font-bold leading-tight">{customer?.loyaltyBalance ?? 0} pts</span>
                </div>
              </Link>
            ) : (
              <button
                onClick={() => setCustomerAuthOpen(true)}
                className="hidden md:inline-flex items-center gap-1.5 rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-xs font-semibold text-gray-200 hover:bg-white/10 hover:text-white transition"
              >
                <User size={14} className="text-orange-400" />
                Sign In
              </button>
            )}

            <button
              onClick={() => setReservationOpen(true)}
              className="hidden sm:inline-flex items-center gap-2 rounded-xl border border-orange-500/30 bg-orange-500/10 px-4 py-2 text-xs font-bold uppercase tracking-wider text-orange-400 hover:bg-orange-500 hover:text-white transition"
            >
              <Calendar size={14} /> Book Table
            </button>

            <Link
              to="/order-online"
              className="inline-flex items-center rounded-xl bg-orange-500 px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-white shadow-lg shadow-orange-500/25 transition hover:bg-orange-600 hover:shadow-orange-500/40"
            >
              Order Online <ArrowRight size={15} className="ml-1.5" />
            </Link>

            {/* Mobile Menu Hamburger */}
            <button
              onClick={() => setMobileMenuOpen(true)}
              className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 text-white lg:hidden"
              aria-label="Open menu"
            >
              <MenuIcon size={20} />
            </button>
          </div>
        </div>
      </header>

      {/* Mobile Navigation Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/80 backdrop-blur-sm lg:hidden">
          <div className="w-4/5 max-w-sm h-full bg-zinc-950 border-l border-white/10 p-6 flex flex-col justify-between text-white shadow-2xl animate-in slide-in-from-right">
            <div>
              <div className="flex items-center justify-between pb-6 border-b border-white/10">
                <span className="font-serif text-lg font-bold">{restaurant?.name || 'Melio'}</span>
                <button
                  onClick={() => setMobileMenuOpen(false)}
                  className="p-2 text-gray-400 hover:text-white"
                >
                  <X size={20} />
                </button>
              </div>
              <nav className="mt-6 flex flex-col gap-4 text-base font-medium">
                {[
                  { label: 'Home', href: '#home' },
                  { label: 'Full Menu', href: '#menu' },
                  { label: 'Our Story & Philosophy', href: '#about' },
                  { label: 'Culinary Gallery', href: '#gallery' },
                  { label: 'Locations & Hours', href: '#locations' },
                  { label: 'Guest Reviews', href: '#testimonials' },
                  { label: 'Contact & Enquiries', href: '#contact' },
                ].map((item) => (
                  <a
                    key={item.href}
                    href={item.href}
                    onClick={(e) => {
                      setMobileMenuOpen(false);
                      scrollToSection(e, item.href);
                    }}
                    className="py-2 hover:text-orange-400 transition border-b border-white/5 cursor-pointer"
                  >
                    {item.label}
                  </a>
                ))}
              </nav>
            </div>

            <div className="space-y-3 pt-6 border-t border-white/10">
              {isStaffAuth ? (
                <Link
                  to="/dashboard"
                  onClick={() => setMobileMenuOpen(false)}
                  className="w-full flex items-center justify-between rounded-xl bg-gradient-to-r from-orange-500 to-amber-500 border border-orange-500/30 px-4 py-3 text-sm font-bold text-white shadow-lg shadow-orange-500/25"
                >
                  <div className="flex items-center gap-2.5">
                    <ShieldCheck size={20} />
                    <span>Staff / Owner Dashboard</span>
                  </div>
                  <ArrowRight size={16} />
                </Link>
              ) : isCustomerAuth ? (
                <Link
                  to="/account"
                  onClick={() => setMobileMenuOpen(false)}
                  className="w-full flex items-center justify-between rounded-xl bg-white/10 border border-white/10 px-4 py-3 text-sm font-bold text-white"
                >
                  <div className="flex items-center gap-3">
                    <div className="h-8 w-8 rounded-full bg-gradient-to-tr from-orange-500 to-amber-400 flex items-center justify-center text-xs font-bold text-white">
                      {customer?.name?.charAt(0).toUpperCase() || 'C'}
                    </div>
                    <div>
                      <div>{customer?.name || 'Member'}</div>
                      <div className="text-xs text-orange-400 font-normal">{customer?.loyaltyBalance ?? 0} Loyalty Points</div>
                    </div>
                  </div>
                  <ArrowRight size={16} />
                </Link>
              ) : (
                <button
                  onClick={() => {
                    setMobileMenuOpen(false);
                    setCustomerAuthOpen(true);
                  }}
                  className="w-full flex items-center justify-center gap-2 rounded-xl border border-white/20 bg-white/5 py-3 text-sm font-bold text-white"
                >
                  <User size={16} className="text-orange-400" /> Sign In / Portal Access
                </button>
              )}

              <button
                onClick={() => {
                  setMobileMenuOpen(false);
                  setReservationOpen(true);
                }}
                className="w-full flex items-center justify-center gap-2 rounded-xl border border-orange-500/40 bg-orange-500/10 py-3 text-sm font-bold text-orange-400"
              >
                <Calendar size={16} /> Reserve a Table
              </button>
              <Link
                to="/order-online"
                onClick={() => setMobileMenuOpen(false)}
                className="w-full flex items-center justify-center gap-2 rounded-xl bg-orange-500 py-3 text-sm font-bold text-white shadow-lg shadow-orange-500/25"
              >
                Order Online <ArrowRight size={16} />
              </Link>
              <Link
                to="/login"
                onClick={() => setMobileMenuOpen(false)}
                className="w-full block text-center text-xs text-gray-400 hover:text-white py-1"
              >
                Staff Portal Login →
              </Link>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 w-full max-w-xl px-4">
          <div className="rounded-2xl border border-red-500/30 bg-red-950/90 p-4 text-sm text-red-200 backdrop-blur-md shadow-2xl">
            {error}
          </div>
        </div>
      )}

      <main>
        {/* ======================= HERO SECTION ======================= */}
        <section id="home" className="relative isolate min-h-screen flex items-center justify-center overflow-hidden bg-zinc-950 pt-20">
          {/* Dynamic Background */}
          {heroImage ? (
            <img
              src={heroImage}
              alt=""
              aria-hidden="true"
              className="absolute inset-0 -z-20 h-full w-full object-cover object-center scale-105 animate-pulse duration-[8000ms]"
            />
          ) : (
            <div className="absolute inset-0 -z-20 bg-[radial-gradient(circle_at_70%_35%,rgba(249,115,22,.25),transparent_40%),linear-gradient(135deg,#0d0d11,#1a1512)]" />
          )}

          {/* Luxury Dark Layered Overlays */}
          <div className="absolute inset-0 -z-10 bg-black/65 backdrop-blur-[1px]" />
          <div className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_center,rgba(0,0,0,0.4)_0%,rgba(0,0,0,0.85)_100%)]" />
          <div className="absolute inset-x-0 bottom-0 -z-10 h-40 bg-gradient-to-t from-black via-black/70 to-transparent" />

          <div className="mx-auto flex w-full max-w-7xl flex-col items-center justify-center px-5 py-24 sm:px-8 lg:py-32">
            <div className="max-w-4xl flex flex-col items-center text-center text-white">
              <div className="mb-6 inline-flex items-center gap-2.5 rounded-full border border-orange-500/30 bg-black/40 px-4 py-1.5 text-xs font-bold uppercase tracking-[0.25em] text-orange-300 backdrop-blur-md shadow-lg shadow-orange-500/10">
                <span className="h-2 w-2 rounded-full bg-orange-500 animate-ping" />
                {restaurant?.name || 'Fine Dining & Craft'}
              </div>

              <h1 className="font-serif text-4xl font-bold leading-[1.1] tracking-tight sm:text-6xl md:text-7xl lg:text-8xl text-center">
                An experience worth{' '}
                <ShinyText text="savouring." className="font-serif italic font-bold" />
              </h1>

              <p className="mt-5 max-w-2xl text-sm leading-relaxed text-gray-300 sm:text-base md:text-lg text-center mx-auto px-2">
                {restaurant?.description ||
                  'Thoughtfully prepared artisanal dishes, warm hospitality, and an unforgettable table experience — crafted fresh with passionate precision.'}
              </p>

              {/* Action Buttons */}
              <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3.5 w-full sm:w-auto px-4">
                <Link
                  to="/order-online"
                  className="w-full sm:w-auto inline-flex items-center justify-center rounded-2xl bg-gradient-to-r from-orange-500 to-amber-500 px-7 py-3.5 text-sm font-bold text-white shadow-xl shadow-orange-500/30 transition hover:from-orange-600 hover:to-amber-600 active:scale-95"
                >
                  Order Online <ArrowRight size={18} className="ml-2" />
                </Link>

                <button
                  onClick={() => setReservationOpen(true)}
                  className="w-full sm:w-auto inline-flex items-center justify-center rounded-2xl border border-white/20 bg-white/10 px-7 py-3.5 text-sm font-bold text-white backdrop-blur-md transition hover:bg-white/20 hover:border-orange-400 active:scale-95"
                >
                  <Calendar size={18} className="mr-2 text-orange-400" /> Book a Table
                </button>

                <a
                  href="#menu"
                  onClick={(e) => scrollToSection(e, '#menu')}
                  className="inline-flex items-center rounded-2xl px-5 py-4 text-sm font-semibold text-gray-300 hover:text-white transition cursor-pointer"
                >
                  Explore Menu ↓
                </a>
              </div>

              {/* Luxury React Bits Glass Icons Emblems (Consistent Orange Glow) */}
              <div className="mt-12 pt-8 border-t border-white/10 grid grid-cols-3 gap-3 sm:gap-6 max-w-2xl w-full mx-auto">
                <GlassIcon
                  icon={<Award size={22} />}
                  label="Michelin Craft"
                  sublabel="Master Chefs"
                  color="orange"
                  size="md"
                />
                <GlassIcon
                  icon={<Leaf size={22} />}
                  label="100% Organic"
                  sublabel="Local Harvest"
                  color="orange"
                  size="md"
                />
                <GlassIcon
                  icon={<Wine size={22} />}
                  label="Sommelier Cellar"
                  sublabel="Curated Pairings"
                  color="orange"
                  size="md"
                />
              </div>
            </div>
          </div>

          {/* Floating Featured Dish Card with React Bits SpotlightCard */}
          {heroItem && (
            <div className="absolute bottom-10 right-8 hidden w-80 lg:block">
              <SpotlightCard className="p-5 text-white border-white/15 bg-black/50 shadow-2xl">
                <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-[0.2em] text-orange-400">
                  <span>Featured Signature</span>
                  <Sparkles size={14} />
                </div>
                <div className="mt-2 text-lg font-serif font-bold truncate">{heroItem.name}</div>
                <div className="mt-1 text-sm font-semibold text-orange-300">
                  {money(heroItem.sellingPrice, restaurant?.currency)}
                </div>
                <Link
                  to={`/order-online?addItem=${heroItem.id}`}
                  className="mt-3 inline-flex items-center text-xs font-bold text-white hover:text-orange-400 transition"
                >
                  Order this dish →
                </Link>
              </SpotlightCard>
            </div>
          )}
        </section>

        {/* ======================= FULL MENU SECTION ======================= */}
        <section id="menu" className="relative border-y border-orange-500/10 bg-[#faf9f7] py-24 dark:bg-[#111116] transition-colors duration-300">
          <div className="mx-auto max-w-7xl px-5 sm:px-8">
            <div className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
              <div>
                <div className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.25em] text-orange-600 dark:text-orange-400">
                  <Sparkles size={14} /> Master Culinary Selection
                </div>
                <h2 className="mt-2 font-serif text-4xl font-bold text-slate-950 dark:text-white sm:text-5xl">
                  Made Fresh. Worth The Craving.
                </h2>
                <p className="mt-2 text-sm text-slate-600 dark:text-gray-400 max-w-xl">
                  Explore our seasonal courses prepared from fine local ingredients and traditional artisanal recipes.
                </p>
              </div>

              {/* Branch & Search Filter Controls */}
              <div className="flex flex-wrap items-center gap-3">
                {restaurant && restaurant.branches.length > 1 && (
                  <select
                    value={branchId}
                    onChange={(e) => setBranchId(e.target.value)}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-800 shadow-sm focus:border-orange-500 focus:outline-none dark:border-zinc-800 dark:bg-zinc-900 dark:text-gray-200"
                  >
                    {restaurant.branches.map((b) => (
                      <option key={b.id} value={b.id}>
                        📍 {b.name}
                      </option>
                    ))}
                  </select>
                )}

                <div className="relative">
                  <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search dishes..."
                    className="w-48 sm:w-64 rounded-xl border border-slate-200 bg-white pl-10 pr-4 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 shadow-sm focus:border-orange-500 focus:outline-none dark:border-zinc-800 dark:bg-zinc-900 dark:text-gray-200"
                  />
                </div>
              </div>
            </div>

            {/* Category Navigation Pills */}
            <div className="mt-10 flex gap-2.5 overflow-x-auto pb-2 scrollbar-none">
              <button
                onClick={() => setActiveCategory('ALL')}
                className={`whitespace-nowrap rounded-2xl px-5 py-2.5 text-xs font-bold uppercase tracking-wider transition ${
                  activeCategory === 'ALL'
                    ? 'bg-orange-500 text-white shadow-lg shadow-orange-500/25'
                    : 'bg-white text-slate-600 hover:bg-orange-50 dark:bg-zinc-900 dark:text-gray-300 dark:hover:bg-zinc-800'
                }`}
              >
                All Courses ({items.length})
              </button>
              {categories.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setActiveCategory(c.id)}
                  className={`whitespace-nowrap rounded-2xl px-5 py-2.5 text-xs font-bold uppercase tracking-wider transition ${
                    activeCategory === c.id
                      ? 'bg-orange-500 text-white shadow-lg shadow-orange-500/25'
                      : 'bg-white text-slate-600 hover:bg-orange-50 dark:bg-zinc-900 dark:text-gray-300 dark:hover:bg-zinc-800'
                  }`}
                >
                  {c.name}
                </button>
              ))}
            </div>

            {/* Menu Cards Grid with React Bits SpotlightCard */}
            <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {filteredItems.slice(0, 9).map((item) => (
                <SpotlightCard
                  key={item.id}
                  className="group flex flex-col justify-between overflow-hidden rounded-3xl border border-orange-500/10 bg-white shadow-sm transition duration-300 hover:-translate-y-1 hover:shadow-xl dark:bg-zinc-900/80 dark:border-white/5"
                >
                  <div>
                    {/* Item Image */}
                    <div className="relative h-56 overflow-hidden bg-zinc-900">
                      {menuImage(item) ? (
                        <img
                          src={menuImage(item)}
                          alt={item.name}
                          className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-orange-500/10 to-transparent text-5xl">
                          🍽️
                        </div>
                      )}
                      <span className="absolute right-4 top-4 rounded-full bg-black/60 px-3.5 py-1.5 text-sm font-extrabold text-orange-400 backdrop-blur-md border border-orange-500/20">
                        {money(item.sellingPrice, restaurant?.currency)}
                      </span>
                    </div>

                    {/* Item Details */}
                    <div className="p-6">
                      <h3 className="font-serif text-xl font-bold text-slate-950 dark:text-white group-hover:text-orange-500 transition">
                        {item.name}
                      </h3>
                      <p className="mt-2.5 line-clamp-2 text-sm leading-relaxed text-slate-500 dark:text-gray-400">
                        {item.description || 'Prepared fresh to order using premium artisanal ingredients.'}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center justify-between border-t border-slate-100 p-6 pt-4 dark:border-white/5">
                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-400 dark:text-gray-400">
                      <Clock3 size={14} className="text-orange-500" />
                      {item.preparationTime ? `${item.preparationTime} mins` : 'Freshly made'}
                    </span>
                    <Link
                      to={`/order-online?addItem=${item.id}`}
                      className="inline-flex items-center text-xs font-bold uppercase tracking-wider text-orange-600 hover:text-orange-500 dark:text-orange-400"
                    >
                      Order Now <ArrowRight size={14} className="ml-1" />
                    </Link>
                  </div>
                </SpotlightCard>
              ))}
            </div>

            {!filteredItems.length && (
              <div className="py-16 text-center text-slate-500 dark:text-gray-400">
                No dishes found matching your search or category selection.
              </div>
            )}

            {filteredItems.length > 9 && (
              <div className="mt-12 text-center">
                <Link to="/order-online" className="inline-flex items-center rounded-2xl bg-orange-500 px-8 py-4 text-sm font-bold text-white shadow-xl shadow-orange-500/25 transition hover:bg-orange-600 hover:scale-105">
                  Explore Complete Full Menu ({items.length} dishes) <ArrowRight size={17} className="ml-2" />
                </Link>
              </div>
            )}
            <div className="mt-8 text-center">
              <Link to="/order-online" className="inline-flex items-center rounded-2xl border border-orange-500/30 bg-orange-500/10 px-8 py-3.5 text-sm font-bold text-orange-600 transition hover:bg-orange-500 hover:text-white dark:text-orange-400">
                Explore More <ArrowRight size={17} className="ml-2" />
              </Link>
            </div>
          </div>
        </section>

        {/* ======================= ABOUT US & STORY SECTION ======================= */}
        <section id="about" className="relative overflow-hidden bg-white py-24 dark:bg-[#0d0d11]">
          <div className="mx-auto max-w-7xl px-5 sm:px-8">
            <div className="grid gap-12 lg:grid-cols-2 lg:items-center">
              {/* Left Column: Visual Highlight Box */}
              <div className="relative overflow-hidden rounded-3xl bg-zinc-950 border border-orange-500/20 p-8 sm:p-12 text-white shadow-2xl">
                <div className="absolute -right-10 -bottom-10 h-64 w-64 rounded-full bg-orange-500/10 blur-3xl pointer-events-none" />
                <div className="relative">
                  <div className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-orange-400">
                    <Award size={16} /> Heritage & Culinary Craft
                  </div>
                  <h3 className="mt-3 font-serif text-3xl font-bold sm:text-4xl text-white">
                    Rooted in tradition. Refined for modern palates.
                  </h3>
                  <p className="mt-5 text-sm leading-relaxed text-gray-300">
                    Every dish is born from respect for natural ingredients, time-honoured techniques, and relentless culinary curiosity. We partner with local farmers and purveyors to bring pure flavor straight to your table.
                  </p>

                  <div className="mt-8 grid grid-cols-2 gap-4">
                    <div className="rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur-sm">
                      <div className="font-serif text-3xl font-bold text-orange-400">
                        <CountUp to={100} suffix="%" />
                      </div>
                      <div className="mt-1 text-xs font-semibold uppercase tracking-wider text-gray-300">
                        Fresh Daily Catch
                      </div>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur-sm">
                      <div className="font-serif text-3xl font-bold text-orange-400">
                        <CountUp to={4.9} decimals={1} prefix="★ " />
                      </div>
                      <div className="mt-1 text-xs font-semibold uppercase tracking-wider text-gray-300">
                        Dining Hospitality
                      </div>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur-sm">
                      <div className="font-serif text-3xl font-bold text-orange-400">
                        <CountUp to={18} suffix="+" />
                      </div>
                      <div className="mt-1 text-xs font-semibold uppercase tracking-wider text-gray-300">
                        Culinary Awards
                      </div>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur-sm">
                      <div className="font-serif text-3xl font-bold text-orange-400">
                        <CountUp to={28500} suffix="+" />
                      </div>
                      <div className="mt-1 text-xs font-semibold uppercase tracking-wider text-gray-300">
                        Delighted Diners
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Right Column: Narrative & Philosophy */}
              <div className="space-y-6">
                <div className="text-xs font-bold uppercase tracking-[0.25em] text-orange-600 dark:text-orange-400">
                  Our Philosophy
                </div>
                <h2 className="font-serif text-4xl font-bold text-slate-950 dark:text-white sm:text-5xl">
                  Where Passion Meets The Plate.
                </h2>
                <p className="text-base leading-relaxed text-slate-600 dark:text-gray-300">
                  Whether you are joining us for an intimate anniversary dinner, entertaining executive guests, or savoring your favorite comfort meal at home, our dedicated kitchen and floor team ensure every detail exceeds expectation.
                </p>
                <div className="space-y-3 pt-2">
                  <div className="flex items-start gap-3">
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-orange-500/10 text-orange-500 mt-0.5">
                      ✓
                    </div>
                    <p className="text-sm text-slate-600 dark:text-gray-300">
                      <strong className="text-slate-900 dark:text-white">Artisanal Precision:</strong> Sauces simmered for hours, doughs fermented slowly, and meats aged in-house.
                    </p>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-orange-500/10 text-orange-500 mt-0.5">
                      ✓
                    </div>
                    <p className="text-sm text-slate-600 dark:text-gray-300">
                      <strong className="text-slate-900 dark:text-white">Sustainable Sourcing:</strong> Ingredients ethically harvested from local producers and green markets.
                    </p>
                  </div>
                </div>

                <div className="pt-4 flex flex-wrap gap-4">
                  <button
                    onClick={() => setReservationOpen(true)}
                    className="inline-flex items-center rounded-2xl bg-slate-950 px-6 py-3.5 text-sm font-bold text-white transition duration-300 hover:-translate-y-0.5 hover:bg-orange-500 hover:shadow-lg hover:shadow-orange-500/25 dark:bg-white dark:text-slate-950 dark:hover:bg-orange-500 dark:hover:text-white"
                  >
                    Reserve an Experience <ArrowRight size={16} className="ml-2" />
                  </button>
                  <Link
                    to="/order-online"
                    className="inline-flex items-center rounded-2xl border border-orange-500/30 bg-orange-500/10 px-6 py-3.5 text-sm font-bold text-orange-500 hover:bg-orange-500 hover:text-white transition"
                  >
                    Order Takeout
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ======================= GALLERY SECTION ======================= */}
        <section id="gallery" className="relative border-t border-orange-500/10 bg-[#faf9f7] py-24 dark:bg-[#111116]">
          <div className="mx-auto max-w-7xl px-5 sm:px-8">
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
              <div>
                <div className="text-xs font-bold uppercase tracking-[0.25em] text-orange-600 dark:text-orange-400">
                  Visual Feast
                </div>
                <h2 className="mt-2 font-serif text-4xl font-bold text-slate-950 dark:text-white sm:text-5xl">
                  Ambience & Culinary Gallery
                </h2>
                <p className="mt-2 text-sm text-slate-600 dark:text-gray-400">
                  Catch a glimpse of our artisanal dishes, master bar mixology, and dining atmospheres.
                </p>
              </div>

              {/* Gallery Filter Tabs */}
              <div className="flex flex-wrap gap-2">
                {[{id:'all',label:'All Photos'},...(websiteConfig?.filters||[{id:'dishes',label:'Signature Dishes'},{id:'cocktails',label:'Bar & Cocktails'},{id:'ambience',label:'Interior & Ambience'}])].slice(0,7).map((tab:any) => (
                  <button
                    key={tab.id}
                    onClick={() => setGalleryFilter(tab.id as any)}
                    className={`rounded-xl px-4 py-2 text-xs font-bold uppercase tracking-wider transition ${
                      galleryFilter === tab.id
                        ? 'bg-orange-500 text-white'
                        : 'bg-white text-slate-600 hover:bg-orange-50 dark:bg-zinc-900 dark:text-gray-300 dark:hover:bg-zinc-800'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Gallery Grid */}
            <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {filteredGallery.map((item, idx) => (
                <div
                  key={item.id}
                  onClick={() => openLightbox(idx)}
                  className="group relative h-72 cursor-pointer overflow-hidden rounded-3xl bg-zinc-900 shadow-md transition duration-300 hover:-translate-y-1 hover:shadow-2xl"
                >
                  <img
                    src={item.image}
                    alt={item.title}
                    className="h-full w-full object-cover transition duration-700 group-hover:scale-110"
                  />
                  {/* Hover Overlay */}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-transparent opacity-0 group-hover:opacity-100 transition duration-300 flex flex-col justify-end p-6 text-white">
                    <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-orange-400">
                      {item.category}
                    </span>
                    <h4 className="mt-1 font-serif text-lg font-bold">{item.title}</h4>
                    <div className="mt-2 flex items-center gap-1 text-xs text-gray-300">
                      <Eye size={14} className="text-orange-400" /> Click to view
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ======================= LOCATIONS & OPENING HOURS ======================= */}
        <section id="locations" className="relative border-t border-orange-500/10 bg-white py-24 dark:bg-[#0d0d11]">
          <div className="mx-auto max-w-7xl px-5 sm:px-8">
            <div className="text-center max-w-2xl mx-auto">
              <div className="text-xs font-bold uppercase tracking-[0.25em] text-orange-600 dark:text-orange-400">
                Our Establishments
              </div>
              <h2 className="mt-2 font-serif text-4xl font-bold text-slate-950 dark:text-white sm:text-5xl">
                Locations & Dining Hours
              </h2>
              <p className="mt-3 text-sm text-slate-600 dark:text-gray-400">
                Visit our branches for dine-in elegance or order direct for express pickup and delivery.
              </p>
            </div>

            <div className="mt-12 grid gap-8 md:grid-cols-2 lg:grid-cols-3">
              {(restaurant?.branches || [{ id: 'b1', name: 'Main Flagship', city: 'Nairobi', address: 'Riverside Drive, Westlands', phone: '+254 700 123456', code: 'NBO-1' }]).map((b) => (
                <div
                  key={b.id}
                  className="rounded-3xl border border-orange-500/10 bg-[#faf9f7] p-8 dark:bg-zinc-900/90 dark:border-white/5 shadow-sm transition hover:shadow-xl flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-center justify-between">
                      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-orange-500/10 text-orange-500">
                        <MapPin size={24} />
                      </div>
                      <span className="rounded-full bg-orange-500/10 px-3 py-1 text-xs font-bold text-orange-500">
                        {b.city || 'Open Daily'}
                      </span>
                    </div>

                    <h3 className="mt-6 font-serif text-2xl font-bold text-slate-950 dark:text-white">
                      {b.name}
                    </h3>
                    <p className="mt-2 text-sm text-slate-600 dark:text-gray-400">
                      {b.address || 'Flagship Culinary Venue'}{b.city ? `, ${b.city}` : ''}
                    </p>

                    <div className="mt-6 space-y-3 border-t border-slate-200/80 dark:border-white/10 pt-5 text-xs text-slate-600 dark:text-gray-300">
                      {(() => {
                        const h = getBranchHours(b.diningHours);
                        return (
                          <>
                            <div className="flex items-center justify-between">
                              <span className="font-semibold text-slate-900 dark:text-white">Monday – Thursday:</span>
                              <span>{h.mondayThursday}</span>
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="font-semibold text-slate-900 dark:text-white">Friday – Saturday:</span>
                              <span>{h.fridaySaturday}</span>
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="font-semibold text-slate-900 dark:text-white">Sunday Brunch:</span>
                              <span>{h.sunday}</span>
                            </div>
                          </>
                        );
                      })()}
                    </div>
                  </div>

                  <div className="mt-8 flex items-center gap-3 pt-4 border-t border-slate-200/80 dark:border-white/10">
                    <a
                      href={`tel:${b.callPhone || b.phone || restaurant?.phone || '+254700000000'}`}
                      className="flex-1 flex items-center justify-center gap-2 rounded-xl border border-orange-500/30 bg-white py-2.5 text-xs font-bold text-orange-600 hover:bg-orange-50 dark:bg-zinc-800 dark:text-orange-400 transition"
                    >
                      <Phone size={14} /> Call Branch
                    </a>
                    <button
                      onClick={() => {
                        setBranchId(b.id);
                        setReservationOpen(true);
                      }}
                      className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-orange-500 py-2.5 text-xs font-bold text-white hover:bg-orange-600 transition shadow-md shadow-orange-500/20"
                    >
                      <Calendar size={14} /> Book Table
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ======================= TESTIMONIALS & REVIEWS SECTION ======================= */}
        <section id="testimonials" className="relative border-t border-orange-500/10 bg-[#faf9f7] py-24 dark:bg-[#111116]">
          <div className="mx-auto max-w-7xl px-5 sm:px-8">
            <div className="text-center max-w-2xl mx-auto">
              <div className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.25em] text-orange-600 dark:text-orange-400">
                <Star size={14} className="fill-orange-500 text-orange-500" /> Guest Accolades
              </div>
              <h2 className="mt-2 font-serif text-4xl font-bold text-slate-950 dark:text-white sm:text-5xl">
                Cherished By Discerning Diners
              </h2>
              <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-orange-500/10 px-4 py-1 text-xs font-bold text-orange-500">
                <span>★★★★★</span> 4.9 / 5.0 Average Rating (500+ Verified Diners)
              </div>
            </div>

            <div className="mt-12 grid gap-6 md:grid-cols-3">
              {(websiteTestimonials.length ? websiteTestimonials.map((t: any) => ({
                name: t.name,
                role: t.role || 'Verified Guest',
                rating: t.rating || 5,
                text: t.text,
                date: t.dateLabel || 'Recent Visit'
              })) : TESTIMONIALS).map((review, i) => (
                <div
                  key={i}
                  className="relative rounded-3xl border border-orange-500/10 bg-white p-8 shadow-sm transition hover:shadow-xl dark:bg-zinc-900/90 dark:border-white/5 flex flex-col justify-between"
                >
                  <div>
                    <div className="flex text-orange-400 mb-4">
                      {Array.from({ length: review.rating }).map((_, r) => (
                        <Star key={r} size={16} className="fill-orange-400" />
                      ))}
                    </div>
                    <Quote className="text-orange-500/20 mb-2" size={32} />
                    <p className="text-sm italic leading-relaxed text-slate-600 dark:text-gray-300">
                      "{review.text}"
                    </p>
                  </div>

                  <div className="mt-6 pt-4 border-t border-slate-100 dark:border-white/5 flex items-center justify-between">
                    <div>
                      <div className="font-serif font-bold text-slate-950 dark:text-white text-sm">
                        {review.name}
                      </div>
                      <div className="text-xs text-orange-500 font-medium">{review.role}</div>
                    </div>
                    <span className="text-[11px] text-slate-400 dark:text-gray-400">{review.date}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ======================= CONTACT & ENQUIRY FORM ======================= */}
        <section id="contact" className="relative border-t border-orange-500/10 bg-white py-24 dark:bg-[#0d0d11]">
          <div className="mx-auto max-w-7xl px-5 sm:px-8">
            <div className="grid gap-12 lg:grid-cols-2">
              {/* Left Details */}
              <div>
                <div className="text-xs font-bold uppercase tracking-[0.25em] text-orange-600 dark:text-orange-400">
                  Get In Touch
                </div>
                <h2 className="mt-2 font-serif text-4xl font-bold text-slate-950 dark:text-white sm:text-5xl">
                  We'd Love To Hear From You
                </h2>
                <p className="mt-3 text-sm leading-relaxed text-slate-600 dark:text-gray-300">
                  For private dining rooms, corporate catering, celebration events, or general inquiries, our concierge desk is ready to assist.
                </p>

                <div className="mt-8 space-y-6">
                  <div className="flex items-start gap-4">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-orange-500/10 text-orange-500">
                      <MapPin size={22} />
                    </div>
                    <div>
                      <div className="text-xs font-bold uppercase tracking-wider text-slate-400">Main Office</div>
                      <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">
                        {restaurant?.address || 'Fine Dining Boulevard'}{restaurant?.city ? `, ${restaurant.city}` : ''}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-start gap-4">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-orange-500/10 text-orange-500">
                      <Phone size={22} />
                    </div>
                    <div>
                      <div className="text-xs font-bold uppercase tracking-wider text-slate-400">Direct Reservations Line</div>
                      <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">
                        0704611033 / 0792986825
                      </div>
                    </div>
                  </div>

                  <div className="flex items-start gap-4">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-orange-500/10 text-orange-500">
                      <Mail size={22} />
                    </div>
                    <div>
                      <div className="text-xs font-bold uppercase tracking-wider text-slate-400">Private Events Email</div>
                      <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">
                        {restaurant?.email || 'events@restaurant.com'}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Right: Contact / Enquiry Form */}
              <div className="rounded-3xl border border-orange-500/10 bg-[#faf9f7] p-8 dark:bg-zinc-900/90 dark:border-white/5 shadow-xl">
                {contactSubmitted ? (
                  <div className="text-center py-12">
                    <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-orange-500/20 text-orange-500">
                      <CheckCircle2 size={36} />
                    </div>
                    <h3 className="mt-4 font-serif text-2xl font-bold text-slate-950 dark:text-white">
                      Message Received
                    </h3>
                    <p className="mt-2 text-sm text-slate-600 dark:text-gray-300">
                      Thank you for reaching out. Our events concierge will review your message and reply within 2 hours.
                    </p>
                    <button
                      onClick={() => setContactSubmitted(false)}
                      className="mt-6 rounded-xl bg-orange-500 px-6 py-2.5 text-xs font-bold uppercase tracking-wider text-white hover:bg-orange-600 transition"
                    >
                      Send Another Message
                    </button>
                  </div>
                ) : (
                  <form onSubmit={handleContactSubmit} className="space-y-4">
                    <h3 className="font-serif text-2xl font-bold text-slate-950 dark:text-white">
                      Send Us An Enquiry
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 dark:text-gray-300 mb-1">
                          Your Name
                        </label>
                        <input
                          type="text"
                          required
                          value={contactForm.name}
                          onChange={(e) => setContactForm({ ...contactForm, name: e.target.value })}
                          placeholder="e.g. Lady Sarah"
                          className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:border-orange-500 focus:outline-none dark:border-zinc-800 dark:bg-zinc-950 dark:text-gray-200"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 dark:text-gray-300 mb-1">
                          Phone Number
                        </label>
                        <input
                          type="tel"
                          required
                          value={contactForm.phone}
                          onChange={(e) => setContactForm({ ...contactForm, phone: e.target.value })}
                          placeholder="+254 700 000 000"
                          className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:border-orange-500 focus:outline-none dark:border-zinc-800 dark:bg-zinc-950 dark:text-gray-200"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 dark:text-gray-300 mb-1">
                          Email Address
                        </label>
                        <input
                          type="email"
                          required
                          value={contactForm.email}
                          onChange={(e) => setContactForm({ ...contactForm, email: e.target.value })}
                          placeholder="sarah@example.com"
                          className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:border-orange-500 focus:outline-none dark:border-zinc-800 dark:bg-zinc-950 dark:text-gray-200"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 dark:text-gray-300 mb-1">
                          Enquiry Type
                        </label>
                        <select
                          value={contactForm.subject}
                          onChange={(e) => setContactForm({ ...contactForm, subject: e.target.value })}
                          className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-800 focus:border-orange-500 focus:outline-none dark:border-zinc-800 dark:bg-zinc-950 dark:text-gray-200"
                        >
                          <option value="General Enquiry">General Enquiry</option>
                          <option value="Private Dining & Events">Private Dining & Events</option>
                          <option value="Corporate Catering">Corporate Catering</option>
                          <option value="Press & Media">Press & Media</option>
                        </select>
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 dark:text-gray-300 mb-1">
                        Message Details
                      </label>
                      <textarea
                        required
                        rows={4}
                        value={contactForm.message}
                        onChange={(e) => setContactForm({ ...contactForm, message: e.target.value })}
                        placeholder="Tell us about your event, preferred dates, or questions..."
                        className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:border-orange-500 focus:outline-none dark:border-zinc-800 dark:bg-zinc-950 dark:text-gray-200"
                      />
                    </div>

                    <button
                      type="submit"
                      disabled={contactLoading}
                      className="w-full flex items-center justify-center gap-2 rounded-xl bg-orange-500 py-3.5 text-sm font-bold text-white hover:bg-orange-600 transition shadow-lg shadow-orange-500/25 disabled:opacity-50"
                    >
                      {contactLoading ? (
                        'Sending Enquiry...'
                      ) : (
                        <>
                          <Send size={16} /> Submit Message
                        </>
                      )}
                    </button>
                  </form>
                )}
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* ======================= LUXURY FOOTER ======================= */}
      <footer className="border-t border-orange-500/10 bg-[#0d0d11] text-gray-300 py-16">
        <div className="mx-auto max-w-7xl px-5 sm:px-8">
          <div className="grid gap-10 md:grid-cols-2 lg:grid-cols-4 pb-12 border-b border-white/10">
            {/* Col 1: Brand Info */}
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="grid h-10 w-10 place-items-center rounded-xl bg-orange-500 text-white shadow-lg shadow-orange-500/25">
                  <UtensilsCrossed size={20} />
                </div>
                <span className="font-serif text-xl font-bold text-white">
                  {restaurant?.name || 'Melio'}
                </span>
              </div>
              <p className="text-xs leading-relaxed text-gray-400">
                Experience unparalleled gastronomic craft, warm hospitality, and unforgettable fine dining.
              </p>
              <div className="flex items-center gap-3 pt-2 text-gray-400">
                <a href="#home" className="h-8 w-8 rounded-full bg-white/5 flex items-center justify-center hover:text-orange-400 hover:bg-white/10 transition">
                  <Instagram size={15} />
                </a>
                <a href="#home" className="h-8 w-8 rounded-full bg-white/5 flex items-center justify-center hover:text-orange-400 hover:bg-white/10 transition">
                  <Facebook size={15} />
                </a>
                <a href="#home" className="h-8 w-8 rounded-full bg-white/5 flex items-center justify-center hover:text-orange-400 hover:bg-white/10 transition">
                  <span className="text-sm font-black leading-none">𝕏</span>
                </a>
              </div>
            </div>

            {/* Col 2: Navigation Links */}
            <div>
              <div className="text-xs font-bold uppercase tracking-widest text-orange-400 mb-4">
                Explore
              </div>
              <ul className="space-y-2 text-xs">
                <li><a href="#home" onClick={(e) => scrollToSection(e, '#home')} className="hover:text-white transition cursor-pointer">Home</a></li>
                <li><a href="#menu" onClick={(e) => scrollToSection(e, '#menu')} className="hover:text-white transition cursor-pointer">Full Menu & Ordering</a></li>
                <li><a href="#about" onClick={(e) => scrollToSection(e, '#about')} className="hover:text-white transition cursor-pointer">Story & Philosophy</a></li>
                <li><a href="#gallery" onClick={(e) => scrollToSection(e, '#gallery')} className="hover:text-white transition cursor-pointer">Culinary Gallery</a></li>
                <li><a href="#locations" onClick={(e) => scrollToSection(e, '#locations')} className="hover:text-white transition cursor-pointer">Locations & Hours</a></li>
                <li><a href="#testimonials" onClick={(e) => scrollToSection(e, '#testimonials')} className="hover:text-white transition cursor-pointer">Guest Reviews</a></li>
              </ul>
            </div>

            {/* Col 3: Direct Services */}
            <div>
              <div className="text-xs font-bold uppercase tracking-widest text-orange-400 mb-4">
                Services
              </div>
              <ul className="space-y-2 text-xs">
                <li>
                  <Link to="/order-online" className="text-orange-400 font-semibold hover:underline">
                    Order Online (Delivery & Pickup)
                  </Link>
                </li>
                <li>
                  <button onClick={() => setReservationOpen(true)} className="hover:text-white text-left transition">
                    Book Table Reservation
                  </button>
                </li>
                <li>
                  <Link to="/account" className="hover:text-white transition">
                    Customer Account & Loyalty
                  </Link>
                </li>
                <li><a href="#contact" onClick={(e) => scrollToSection(e, '#contact')} className="hover:text-white transition cursor-pointer">Private Event Inquiries</a></li>
                <li><a href="#contact" onClick={(e) => scrollToSection(e, '#contact')} className="hover:text-white transition cursor-pointer">Executive Corporate Catering</a></li>
              </ul>
            </div>

            {/* Col 4: Operations & Staff */}
            <div>
              <div className="text-xs font-bold uppercase tracking-widest text-orange-400 mb-4">
                Management
              </div>
              <p className="text-xs text-gray-400 mb-3">
                Authorized restaurant staff, waitstaff, chefs, cashiers, and management portal.
              </p>
              <Link
                to="/login"
                className="inline-flex items-center gap-2 rounded-xl bg-white/10 px-4 py-2.5 text-xs font-bold text-white hover:bg-orange-500 transition"
              >
                Staff Portal Login <ArrowRight size={14} />
              </Link>
            </div>
          </div>

          <div className="mt-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-gray-400">
            <div>
              © {new Date().getFullYear()} {restaurant?.name || 'Restaurant Management System'}. All rights reserved.
            </div>
            <div className="flex items-center gap-6">
              <a href="#home" className="hover:text-white transition">Privacy Policy</a>
              <a href="#home" className="hover:text-white transition">Terms of Service</a>
              <a href="#home" className="hover:text-white transition">Cookie Settings</a>
            </div>
          </div>
        </div>
      </footer>

      {/* ======================= LIGHTBOX MODAL ======================= */}
      <GalleryLightbox
        isOpen={lightboxOpen}
        items={filteredGallery}
        currentIndex={lightboxIndex}
        onClose={() => setLightboxOpen(false)}
        onNavigate={(index) => setLightboxIndex(index)}
      />

      {/* ======================= RESERVATION MODAL ======================= */}
      <ReservationModal
        isOpen={reservationOpen}
        onClose={() => setReservationOpen(false)}
        branches={restaurant?.branches || []}
        selectedBranchId={branchId}
        restaurantId={restaurant?.id || ''}
      />

      {/* ======================= CUSTOMER AUTH MODAL ======================= */}
      <CustomerAuthModal
        isOpen={customerAuthOpen}
        onClose={() => setCustomerAuthOpen(false)}
        restaurantId={restaurant?.id || ''}
      />

      {/* ======================= REACT BITS FLOATING DOCK (Desktop) ======================= */}
      <Dock
        className="hidden md:flex"
        items={[
          {
            icon: <HomeIcon size={20} />,
            label: 'Home',
            onClick: () => window.scrollTo({ top: 0, behavior: 'smooth' }),
          },
          {
            icon: <Utensils size={20} />,
            label: 'Full Menu',
            onClick: () => document.getElementById('menu')?.scrollIntoView({ behavior: 'smooth' }),
          },
          {
            icon: <BookOpen size={20} />,
            label: 'Our Story',
            onClick: () => document.getElementById('about')?.scrollIntoView({ behavior: 'smooth' }),
          },
          {
            icon: <ImageIcon size={20} />,
            label: 'Gallery',
            onClick: () => document.getElementById('gallery')?.scrollIntoView({ behavior: 'smooth' }),
          },
          {
            icon: <MapPin size={20} />,
            label: 'Locations',
            onClick: () => document.getElementById('locations')?.scrollIntoView({ behavior: 'smooth' }),
          },
          {
            icon: <Calendar size={20} />,
            label: 'Book Table',
            onClick: () => setReservationOpen(true),
            active: reservationOpen,
          },
          {
            icon: <ShoppingBag size={20} />,
            label: 'Order Online',
            onClick: () => navigate('/order-online'),
          },
          {
            icon: <User size={20} />,
            label: isStaffAuth
              ? 'Staff Dashboard'
              : isCustomerAuth
              ? `${customer?.name?.split(' ')[0] || 'Member'} (${customer?.loyaltyBalance ?? 0} pts)`
              : 'Sign In',
            onClick: () => {
              if (isStaffAuth) navigate('/dashboard');
              else if (isCustomerAuth) navigate('/account');
              else setCustomerAuthOpen(true);
            },
            badge: isCustomerAuth && (customer?.loyaltyBalance ?? 0) > 0 ? `${customer?.loyaltyBalance}` : undefined,
          },
        ]}
      />

      {/* ======================= MOBILE BOTTOM QUICK ACTION BAR ======================= */}
      <nav aria-label="Mobile Navigation" className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-zinc-950/95 backdrop-blur-xl border-t border-orange-500/20 px-2 py-2 flex items-center justify-around text-center shadow-2xl safe-area-pb">
        <button
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          className="flex flex-col items-center gap-1 p-1.5 text-gray-400 hover:text-orange-400 active:text-orange-500 transition"
        >
          <HomeIcon size={18} />
          <span className="text-[10px] font-semibold">Home</span>
        </button>

        <button
          onClick={() => document.getElementById('menu')?.scrollIntoView({ behavior: 'smooth' })}
          className="flex flex-col items-center gap-1 p-1.5 text-gray-400 hover:text-orange-400 active:text-orange-500 transition"
        >
          <Utensils size={18} />
          <span className="text-[10px] font-semibold">Menu</span>
        </button>

        <button
          onClick={() => setReservationOpen(true)}
          className="flex flex-col items-center gap-1 p-1.5 text-orange-400 font-bold active:scale-95 transition"
        >
          <div className="h-9 w-9 -mt-4 rounded-full bg-gradient-to-tr from-orange-500 to-amber-500 flex items-center justify-center text-white shadow-lg shadow-orange-500/40">
            <Calendar size={18} />
          </div>
          <span className="text-[10px] text-orange-400">Book Table</span>
        </button>

        <button
          onClick={() => navigate('/order-online')}
          className="flex flex-col items-center gap-1 p-1.5 text-gray-400 hover:text-orange-400 active:text-orange-500 transition"
        >
          <ShoppingBag size={18} />
          <span className="text-[10px] font-semibold">Order</span>
        </button>

        <button
          onClick={() => {
            if (isStaffAuth) navigate('/dashboard');
            else if (isCustomerAuth) navigate('/account');
            else setCustomerAuthOpen(true);
          }}
          className="flex flex-col items-center gap-1 p-1.5 text-gray-400 hover:text-orange-400 active:text-orange-500 transition"
        >
          <User size={18} />
          <span className="text-[10px] font-semibold">
            {isStaffAuth ? 'Portal' : isCustomerAuth ? 'Profile' : 'Sign In'}
          </span>
        </button>
      </nav>
    </div>
  );
}
