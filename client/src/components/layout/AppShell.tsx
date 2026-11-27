import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import Sidebar from './Sidebar';
import { useAuth } from '../../contexts/AuthContext';
import { Suspense, useEffect, useRef, useState } from 'react';
import { Moon, Sun, Building2, Bell, ChevronDown, Check, ExternalLink, Menu as MenuIcon, X, UtensilsCrossed, WifiOff } from 'lucide-react';
import { notificationApi, branchApi } from '../../services/api';
import DialogOverlay from '../ui/DialogOverlay';

/** All-day work screens get solid surfaces instead of live blur (see index.css). */
const WORK_SCREENS = ['/pos', '/kitchen'];

export default function AppShell({ children }: { children?: React.ReactNode }) {
  const location = useLocation();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem('rms-theme') !== 'light');
  const [branches, setBranches] = useState<Array<{id:string; name:string; code:string}>>([]);
  const [hasNotifications, setHasNotifications] = useState(false);
  const [branchMenuOpen, setBranchMenuOpen] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [activeBranchId, setActiveBranchId] = useState(() => localStorage.getItem('rms-active-branch') || user?.branchId || '');
  const [isOnline, setIsOnline] = useState(() => typeof navigator !== 'undefined' ? navigator.onLine : true);
  const branchMenuRef = useRef<HTMLDivElement>(null);
  const canSwitchBranch = ['OWNER','ADMIN','MANAGER'].includes(user?.roleName || '');
  const activeBranch = branches.find((b) => b.id === activeBranchId);

  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  useEffect(() => {
    const saved = localStorage.getItem('rms-active-branch');
    if (saved) setActiveBranchId(saved);
    else if (user?.branchId) setActiveBranchId(user.branchId);
  }, [user?.branchId]);

  useEffect(() => {
    if (!canSwitchBranch) return;
    branchApi.getBranches().then((r:any) => {
      const list = r.data?.data?.branches || [];
      setBranches(list);
      const saved = localStorage.getItem('rms-active-branch');
      if (saved && list.length && !list.some((b:any) => b.id === saved)) {
        const fallback = user?.branchId && list.some((b:any) => b.id === user.branchId) ? user.branchId : list[0].id;
        localStorage.setItem('rms-active-branch', fallback);
        setActiveBranchId(fallback);
        window.dispatchEvent(new Event('rms-branch-changed'));
      } else if (!saved && list.length) {
        localStorage.setItem('rms-active-branch', list[0].id);
        setActiveBranchId(list[0].id);
        window.dispatchEvent(new Event('rms-branch-changed'));
      }
    }).catch(() => setBranches([]));
  }, [canSwitchBranch, user?.branchId]);

  useEffect(() => {
    if (!user || !localStorage.getItem('token')) {
      setHasNotifications(false);
      return;
    }
    const check=()=>notificationApi.getAll(true).then((r:any)=>setHasNotifications(Boolean((r.data.data?.notifications||[]).length))).catch(()=>{});
    check(); const t=setInterval(()=>{ if (document.visibilityState==='visible') check(); },60000); return()=>clearInterval(t);
  }, [user?.id]);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
    localStorage.setItem('rms-theme', darkMode ? 'dark' : 'light');
  }, [darkMode]);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (branchMenuRef.current && !branchMenuRef.current.contains(event.target as Node)) setBranchMenuOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const selectBranch = (branchId: string) => {
    localStorage.setItem('rms-active-branch', branchId);
    setActiveBranchId(branchId);
    window.dispatchEvent(new Event('rms-branch-changed'));
    setBranchMenuOpen(false);
    window.location.reload();
  };

  return (
    <div className={`rms-glass glass-backdrop relative flex h-screen text-gray-900 dark:text-gray-100 overflow-hidden ${WORK_SCREENS.some((p) => location.pathname.startsWith(p)) ? 'solid-surfaces' : ''}`}>
      {/* Desktop sidebar: a floating glass panel */}
      <aside className="glass-raised relative z-10 hidden lg:block w-64 m-3 mr-0 rounded-3xl flex-shrink-0 overflow-hidden">
        <Sidebar />
      </aside>

      {/* Mobile Drawer Sidebar */}
      {mobileSidebarOpen && (
        <DialogOverlay
          onClose={() => setMobileSidebarOpen(false)}
          label="Navigation"
          className="fixed inset-0 z-50 flex lg:hidden bg-black/80 backdrop-blur-md animate-in fade-in duration-200"
          onClick={() => setMobileSidebarOpen(false)}
        >
          <div
            className="glass-raised relative w-64 max-w-[80vw] h-full rounded-r-3xl flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setMobileSidebarOpen(false)}
              className="absolute top-4 right-4 p-1.5 rounded-lg text-gray-400 hover:text-white bg-white/5"
              aria-label="Close menu"
            >
              <X size={18} />
            </button>
            <div className="h-full overflow-y-auto">
              <Sidebar onNavigate={() => setMobileSidebarOpen(false)} />
            </div>
          </div>
        </DialogOverlay>
      )}

      <main className="relative z-10 flex-1 flex flex-col overflow-hidden">
        <header className="glass-raised relative z-30 m-3 mb-0 min-h-[3.75rem] rounded-2xl flex items-center justify-between px-3 sm:px-4 flex-shrink-0 py-2.5 gap-2">

          <div className="flex items-center gap-2 sm:gap-3">
            <button
              onClick={() => setMobileSidebarOpen(true)}
              className="lg:hidden flex h-9 w-9 items-center justify-center rounded-xl bg-orange-500/10 text-orange-500 hover:bg-orange-500/20"
              aria-label="Toggle navigation menu"
            >
              <MenuIcon size={18} />
            </button>
            <div className="flex items-center gap-2.5">
              <div className="glass-btn-primary grid h-8 w-8 place-items-center rounded-xl text-white shrink-0">
                <UtensilsCrossed size={16} />
              </div>
              <div className="min-w-0">
                <p className="text-xs sm:text-sm font-bold text-gray-900 dark:text-gray-100 truncate max-w-[120px] sm:max-w-none leading-tight">
                  {user?.restaurantName || 'Melio'}
                </p>
                <p className="text-[10px] uppercase tracking-wider text-orange-500 font-semibold hidden sm:block leading-tight">
                  Management System
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2.5">
            {!isOnline && (
              <span className="inline-flex items-center gap-1.5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-xs font-bold text-amber-600 dark:text-amber-400" title="Operating offline: transactions will sync automatically when reconnected">
                <WifiOff className="h-3.5 w-3.5 text-amber-500 animate-pulse" />
                <span className="hidden sm:inline">Offline Mode</span>
              </span>
            )}

            <a href="/" target="_blank" rel="noopener noreferrer" className="glass-panel hidden md:inline-flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-xs font-semibold text-gray-700 transition hover:text-orange-700 dark:text-gray-200 dark:hover:text-white" title="Open public live website">
              <ExternalLink className="h-3.5 w-3.5 text-orange-500" /> Live Site
            </a>

            {canSwitchBranch && branches.length > 0 && (
              <div className="relative z-50" ref={branchMenuRef}>
                <button
                  type="button"
                  onClick={() => setBranchMenuOpen((open) => !open)}
                  className="glass-panel inline-flex min-w-[110px] sm:min-w-[190px] items-center justify-between gap-1.5 sm:gap-2.5 rounded-xl px-2.5 sm:px-3.5 py-1.5 sm:py-2 text-xs sm:text-sm font-semibold text-gray-800 transition hover:border-orange-400/60 dark:text-gray-100"
                  aria-haspopup="listbox"
                  aria-expanded={branchMenuOpen}
                  title="Active branch"
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    <Building2 className="h-3.5 w-3.5 sm:h-4 sm:w-4 shrink-0 text-orange-500" />
                    <span className="truncate max-w-[80px] sm:max-w-none">{activeBranch ? activeBranch.name : 'Branch'}</span>
                  </span>
                  <ChevronDown className={`h-3.5 w-3.5 text-gray-400 transition-transform ${branchMenuOpen ? 'rotate-180' : ''}`} />
                </button>
                {branchMenuOpen && (
                  <div className="glass-raised absolute right-0 z-50 mt-2 w-[280px] sm:w-[310px] overflow-hidden rounded-2xl p-1.5" role="listbox">
                    <div className="border-b border-orange-100 px-3 py-2 dark:border-white/10">
                      <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-orange-500">Locations</div>
                    </div>
                    <div className="mt-1 space-y-0.5 max-h-60 overflow-y-auto">
                    {branches.map((branch) => {
                      const selected = branch.id === activeBranchId;
                      return (
                        <button
                          key={branch.id}
                          type="button"
                          onClick={() => selectBranch(branch.id)}
                          className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-xs sm:text-sm transition ${selected ? 'glass-active text-orange-800 dark:text-orange-300' : 'border border-transparent text-gray-700 hover:bg-orange-50/70 dark:text-gray-200 dark:hover:bg-white/5'}`}
                          role="option"
                          aria-selected={selected}
                        >
                          <span className="flex min-w-0 items-center gap-2"><Building2 className="h-4 w-4 shrink-0 text-orange-500/80" /><span className="min-w-0 font-semibold truncate">{branch.name}</span></span>
                          {selected && <Check className="h-4 w-4 text-orange-500" />}
                        </button>
                      );
                    })}
                    </div>
                  </div>
                )}
              </div>
            )}

            <button onClick={() => navigate('/notifications')} className="relative rounded-xl border border-transparent p-1.5 sm:p-2 text-gray-500 dark:text-gray-400 hover:bg-orange-50 dark:hover:bg-white/10 transition" title="Notifications">
              <Bell className="w-4 h-4" />
              {hasNotifications&&<span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-orange-500 shadow-[0_0_10px_rgba(249,115,22,0.8)]"/>}
            </button>

            <button onClick={() => setDarkMode(!darkMode)} className="rounded-xl border border-transparent p-1.5 sm:p-2 text-gray-500 dark:text-gray-400 hover:bg-orange-50 dark:hover:bg-white/10 transition" title="Toggle theme">
              {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>

            <div className="hidden sm:block h-5 w-px bg-gray-200 dark:bg-white/10" />
            <span className="hidden sm:inline text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300 truncate max-w-[100px] sm:max-w-none">{user?.firstName}</span>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto">
          {/* Page-level loading boundary: switching pages keeps the sidebar and
              header on screen instead of blanking the whole app. */}
          <Suspense
            fallback={
              <div className="flex h-full min-h-[50vh] items-center justify-center" role="status" aria-live="polite">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-orange-500 border-t-transparent" />
                <span className="sr-only">Loading page</span>
              </div>
            }
          >
            {children || <Outlet />}
          </Suspense>
        </div>
      </main>
    </div>
  );
}
