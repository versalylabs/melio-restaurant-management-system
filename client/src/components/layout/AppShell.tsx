import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import { useAuth } from '../../contexts/AuthContext';
import { useEffect, useRef, useState } from 'react';
import { Moon, Sun, Building2, Bell, ChevronDown, Check, ExternalLink } from 'lucide-react';
import { notificationApi, branchApi } from '../../services/api';

export default function AppShell({ children }: { children?: React.ReactNode }) {
  const { user } = useAuth();
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem('rms-theme') !== 'light');
  const [branches, setBranches] = useState<Array<{id:string; name:string; code:string}>>([]);
  const [hasNotifications, setHasNotifications] = useState(false);
  const [branchMenuOpen, setBranchMenuOpen] = useState(false);
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
    <div className="flex h-screen bg-[#faf9f7] dark:bg-[#0d0d11] text-gray-900 dark:text-gray-100">
      <aside className="w-60 bg-white/95 dark:bg-[#111116] border-r border-orange-100 dark:border-white/10 flex-shrink-0 overflow-hidden">
        <Sidebar />
      </aside>

      <main className="flex-1 flex flex-col overflow-hidden">
        <header className="min-h-[4.25rem] bg-white/95 dark:bg-[#111116] border-b border-orange-100 dark:border-white/10 flex items-center justify-between px-5 flex-shrink-0 py-3">
          <p className="text-sm text-gray-500 dark:text-gray-400 font-medium">
            {user?.restaurantName || 'Melio'}
          </p>
          <div className="flex items-center gap-2.5">
            <a href="/" target="_blank" rel="noopener noreferrer" className="hidden sm:inline-flex items-center gap-2 rounded-xl border border-orange-200/80 bg-white px-3 py-2 text-xs font-semibold text-gray-700 shadow-sm transition hover:border-orange-400 hover:bg-orange-50 hover:text-orange-700 dark:border-white/10 dark:bg-[#0d0d11] dark:text-gray-200 dark:hover:border-orange-500/60 dark:hover:bg-[#16161c] dark:hover:text-orange-300" title="Open the public Melio website in a new tab">
              <ExternalLink className="h-3.5 w-3.5 text-orange-500" /> View Live Site
            </a>
            {canSwitchBranch && branches.length > 0 && (
              <div className="relative" ref={branchMenuRef}>
                <button
                  type="button"
                  onClick={() => setBranchMenuOpen((open) => !open)}
                  className="inline-flex min-w-[235px] items-center justify-between gap-3 rounded-xl border border-orange-200/80 bg-white px-3.5 py-2 text-sm font-semibold text-gray-800 shadow-sm transition hover:border-orange-400 hover:bg-orange-50/60 focus:outline-none focus:ring-4 focus:ring-orange-100 dark:border-white/10 dark:bg-[#0d0d11] dark:text-gray-100 dark:hover:border-orange-500/60 dark:hover:bg-[#16161c] dark:focus:ring-orange-500/15"
                  aria-haspopup="listbox"
                  aria-expanded={branchMenuOpen}
                  title="Active branch"
                >
                  <span className="flex min-w-0 items-center gap-2.5">
                    <Building2 className="h-4 w-4 shrink-0 text-orange-500" />
                    <span className="truncate">{activeBranch ? `${activeBranch.name} (${activeBranch.code})` : 'Select branch'}</span>
                  </span>
                  <ChevronDown className={`h-4 w-4 shrink-0 text-gray-400 transition-transform ${branchMenuOpen ? 'rotate-180' : ''}`} />
                </button>
                {branchMenuOpen && (
                  <div className="absolute right-0 z-50 mt-2 w-[310px] overflow-hidden rounded-2xl border border-orange-200/80 bg-white p-1.5 shadow-2xl shadow-black/10 dark:border-white/10 dark:bg-[#111116]" role="listbox">
                    <div className="border-b border-orange-100 px-3 py-2.5 dark:border-white/10">
                      <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-orange-500">Melio locations</div>
                      <div className="mt-0.5 text-xs text-gray-400">Choose the branch you are operating</div>
                    </div>
                    <div className="mt-1 space-y-0.5">
                    {branches.map((branch) => {
                      const selected = branch.id === activeBranchId;
                      return (
                        <button
                          key={branch.id}
                          type="button"
                          onClick={() => selectBranch(branch.id)}
                          className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-sm transition ${selected ? 'bg-orange-50 text-orange-700 dark:bg-orange-500/10 dark:text-orange-300' : 'text-gray-700 hover:bg-orange-50/70 dark:text-gray-200 dark:hover:bg-[#1a1a20]'}`}
                          role="option"
                          aria-selected={selected}
                        >
                          <span className="flex min-w-0 items-center gap-2"><Building2 className="h-4 w-4 shrink-0 text-orange-500/80" /><span className="min-w-0"><span className="block truncate font-semibold">{branch.name}</span><span className="block text-[11px] text-gray-400">Branch code: {branch.code}</span></span></span>
                          {selected && <Check className="h-4 w-4 text-orange-500" />}
                        </button>
                      );
                    })}
                    </div>
                  </div>
                )}
              </div>
            )}
            <button onClick={()=>window.location.href='/notifications'} className="relative rounded-xl border border-transparent p-2 text-gray-500 dark:text-gray-400 hover:border-orange-100 hover:bg-orange-50 dark:hover:border-white/10 dark:hover:bg-[#1a1a20] transition" title="Notifications"><Bell className="w-4 h-4" />{hasNotifications&&<span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-orange-500 ring-2 ring-white dark:ring-[#111116]"/>}</button>
            <button onClick={() => setDarkMode(!darkMode)} className="rounded-xl border border-transparent p-2 text-gray-500 dark:text-gray-400 hover:border-orange-100 hover:bg-orange-50 dark:hover:border-white/10 dark:hover:bg-[#1a1a20] transition-colors" title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}>
              {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
            <div className="h-5 w-px bg-gray-200 dark:bg-white/10" />
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{user?.firstName} {user?.lastName}</span>
          </div>
        </header>
        <div className="flex-1 overflow-y-auto">{children || <Outlet />}</div>
      </main>
    </div>
  );
}
