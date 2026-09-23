import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import { useAuth } from '../../contexts/AuthContext';
import { useEffect, useRef, useState } from 'react';
import { Moon, Sun, Building2, Bell, ChevronDown, Check, ExternalLink, Menu as MenuIcon, X } from 'lucide-react';
import { notificationApi, branchApi } from '../../services/api';

export default function AppShell({ children }: { children?: React.ReactNode }) {
  const { user } = useAuth();
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem('rms-theme') !== 'light');
  const [branches, setBranches] = useState<Array<{id:string; name:string; code:string}>>([]);
  const [hasNotifications, setHasNotifications] = useState(false);
  const [branchMenuOpen, setBranchMenuOpen] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [activeBranchId, setActiveBranchId] = useState(() => localStorage.getItem('rms-active-branch') || user?.branchId || '');
  const branchMenuRef = useRef<HTMLDivElement>(null);
  const canSwitchBranch = ['OWNER','ADMIN','MANAGER'].includes(user?.roleName || '');
  const activeBranch = branches.find((b) => b.id === activeBranchId);

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
    check(); const t=setInterval(check,30000); return()=>clearInterval(t);
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
    <div className="relative flex h-screen bg-[#faf9f7] dark:bg-[#0b0b0f] text-gray-900 dark:text-gray-100 overflow-hidden">
      {/* Liquid Glass Background Ambient Glows */}
      <div className="pointer-events-none fixed -top-40 -right-40 h-96 w-96 rounded-full bg-orange-500/10 dark:bg-orange-500/5 blur-[140px] z-0" />
      <div className="pointer-events-none fixed top-1/2 -left-40 h-96 w-96 rounded-full bg-amber-500/10 dark:bg-amber-500/5 blur-[140px] z-0" />
      <div className="pointer-events-none fixed -bottom-40 right-1/4 h-96 w-96 rounded-full bg-orange-600/10 dark:bg-rose-500/5 blur-[140px] z-0" />

      {/* Desktop Stationary Sidebar */}
      <aside className="relative z-10 hidden lg:block w-64 bg-white/80 dark:bg-[#0e0e13]/85 backdrop-blur-2xl border-r border-orange-500/10 dark:border-white/10 flex-shrink-0 overflow-hidden shadow-sm">
        <Sidebar />
      </aside>

      {/* Mobile Drawer Sidebar */}
      {mobileSidebarOpen && (
        <div
          className="fixed inset-0 z-50 flex lg:hidden bg-black/80 backdrop-blur-md animate-in fade-in duration-200"
          onClick={() => setMobileSidebarOpen(false)}
        >
          <div
            className="relative w-64 max-w-[80vw] h-full bg-white/95 dark:bg-[#111116]/95 backdrop-blur-2xl border-r border-orange-500/10 dark:border-white/10 shadow-2xl flex flex-col"
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
        </div>
      )}

      <main className="relative z-10 flex-1 flex flex-col overflow-hidden">
        <header className="min-h-[4.25rem] bg-white/75 dark:bg-[#0e0e13]/80 backdrop-blur-xl border-b border-orange-500/10 dark:border-white/10 flex items-center justify-between px-3.5 sm:px-5 flex-shrink-0 py-3 gap-2">
          {/* Top edge sheen reflection */}
          <div className="absolute inset-x-0 top-0 h-[1px] bg-gradient-to-r from-transparent via-orange-400/30 dark:via-white/15 to-transparent pointer-events-none" />

          <div className="flex items-center gap-2 sm:gap-3">
            <button
              onClick={() => setMobileSidebarOpen(true)}
              className="lg:hidden flex h-9 w-9 items-center justify-center rounded-xl bg-orange-500/10 text-orange-500 hover:bg-orange-500/20"
              aria-label="Toggle navigation menu"
            >
              <MenuIcon size={18} />
            </button>
            <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400 font-medium truncate max-w-[120px] sm:max-w-none">
              {user?.restaurantName || 'Melio'}
            </p>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2.5">
            <a href="/" target="_blank" rel="noopener noreferrer" className="hidden md:inline-flex items-center gap-1.5 rounded-xl border border-orange-200/80 bg-white px-2.5 py-1.5 text-xs font-semibold text-gray-700 shadow-sm transition hover:border-orange-400 hover:bg-orange-50 hover:text-orange-700 dark:border-white/10 dark:bg-[#0d0d11] dark:text-gray-200" title="Open public live website">
              <ExternalLink className="h-3.5 w-3.5 text-orange-500" /> Live Site
            </a>

            {canSwitchBranch && branches.length > 0 && (
              <div className="relative" ref={branchMenuRef}>
                <button
                  type="button"
                  onClick={() => setBranchMenuOpen((open) => !open)}
                  className="inline-flex min-w-[110px] sm:min-w-[190px] items-center justify-between gap-1.5 sm:gap-2.5 rounded-xl border border-orange-200/80 bg-white px-2.5 sm:px-3.5 py-1.5 sm:py-2 text-xs sm:text-sm font-semibold text-gray-800 shadow-sm transition hover:border-orange-400 hover:bg-orange-50/60 dark:border-white/10 dark:bg-[#0d0d11] dark:text-gray-100"
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
                  <div className="absolute right-0 z-50 mt-2 w-[280px] sm:w-[310px] overflow-hidden rounded-2xl border border-orange-200/80 bg-white p-1.5 shadow-2xl dark:border-white/10 dark:bg-[#111116]" role="listbox">
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
                          className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-xs sm:text-sm transition ${selected ? 'bg-orange-50 text-orange-700 dark:bg-orange-500/10 dark:text-orange-300' : 'text-gray-700 hover:bg-orange-50/70 dark:text-gray-200 dark:hover:bg-[#1a1a20]'}`}
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

            <button onClick={()=>window.location.href='/notifications'} className="relative rounded-xl border border-transparent p-1.5 sm:p-2 text-gray-500 dark:text-gray-400 hover:bg-orange-50 dark:hover:bg-[#1a1a20] transition" title="Notifications">
              <Bell className="w-4 h-4" />
              {hasNotifications&&<span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-orange-500 ring-2 ring-white dark:ring-[#111116]"/>}
            </button>

            <button onClick={() => setDarkMode(!darkMode)} className="rounded-xl border border-transparent p-1.5 sm:p-2 text-gray-500 dark:text-gray-400 hover:bg-orange-50 dark:hover:bg-[#1a1a20] transition" title="Toggle theme">
              {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>

            <div className="hidden sm:block h-5 w-px bg-gray-200 dark:bg-white/10" />
            <span className="hidden sm:inline text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300 truncate max-w-[100px] sm:max-w-none">{user?.firstName}</span>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto">{children || <Outlet />}</div>
      </main>
    </div>
  );
}
