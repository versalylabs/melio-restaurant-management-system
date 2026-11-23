import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import type { User } from '../types';
import { authApi, invalidateCache } from '../services/api';

const LAST_USER_KEY = 'rms-last-user-id';
const ACTIVE_BRANCH_KEY = 'rms-active-branch';

/** Data that must not be visible to whoever uses this terminal next. */
function clearSessionData({ keepBranch }: { keepBranch: boolean }) {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  if (!keepBranch) localStorage.removeItem(ACTIVE_BRANCH_KEY);
  invalidateCache();
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  login: (token: string, user: User) => void;
  logout: () => void;
  isAuthenticated: boolean;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() => {
    try {
      const stored = localStorage.getItem('user');
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  });
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('token'));
  const [isLoading, setIsLoading] = useState<boolean>(() => !localStorage.getItem('token') ? false : true);

  useEffect(() => {
    const handleAuthExpired = () => {
      // Session expired mid-shift: drop cached data, but keep the branch (and
      // the POS cart, which lives under its own key) so the same person can
      // sign back in and carry on.
      clearSessionData({ keepBranch: true });
      setToken(null);
      setUser(null);
    };
    window.addEventListener('staff-auth-expired', handleAuthExpired);

    const initAuth = async () => {
      const storedToken = localStorage.getItem('token');
      if (storedToken) {
        try {
          const response = await authApi.getMe();
          if (response.data.success && response.data.data) {
            const me = response.data.data;
            setUser(me);
            localStorage.setItem('user', JSON.stringify(me));
            localStorage.setItem(LAST_USER_KEY, me.id);
            // Preserve the active branch for roles that are allowed to switch branches.
            const canSwitchBranch = ['OWNER', 'ADMIN', 'MANAGER'].includes(me.roleName || '');
            if (!canSwitchBranch && me.branchId) {
              localStorage.setItem(ACTIVE_BRANCH_KEY, me.branchId);
            } else if (!localStorage.getItem(ACTIVE_BRANCH_KEY) && me.branchId) {
              localStorage.setItem(ACTIVE_BRANCH_KEY, me.branchId);
            }
          }
        } catch (err: any) {
          if (err.response?.status === 401) {
            clearSessionData({ keepBranch: true });
            setToken(null);
            setUser(null);
          }
        }
      }
      setIsLoading(false);
    };

    initAuth();
    return () => window.removeEventListener('staff-auth-expired', handleAuthExpired);
  }, []);

  const login = (newToken: string, newUser: User) => {
    // A different person on this terminal must not inherit the previous
    // user's cached screens or branch selection.
    invalidateCache();
    if (localStorage.getItem(LAST_USER_KEY) !== newUser.id) {
      localStorage.removeItem(ACTIVE_BRANCH_KEY);
      localStorage.removeItem('rms-pos-cart');
    }
    localStorage.setItem(LAST_USER_KEY, newUser.id);
    localStorage.setItem('token', newToken);
    localStorage.setItem('user', JSON.stringify(newUser));
    const canSwitchBranch = ['OWNER', 'ADMIN', 'MANAGER'].includes(newUser.roleName || '');
    if (newUser.branchId && (!canSwitchBranch || !localStorage.getItem(ACTIVE_BRANCH_KEY))) {
      localStorage.setItem(ACTIVE_BRANCH_KEY, newUser.branchId);
    }
    setToken(newToken);
    setUser(newUser);
  };

  const logout = async () => {
    try { if (localStorage.getItem('token')) await authApi.logout(); } catch {}
    clearSessionData({ keepBranch: false });
    localStorage.removeItem('rms-pos-cart');
    setToken(null);
    setUser(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        login,
        logout,
        isAuthenticated: !!token && !!user,
        isLoading,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
