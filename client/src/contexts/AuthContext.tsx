import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import type { User } from '../types';
import { authApi } from '../services/api';

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
      setToken(null);
      setUser(null);
      localStorage.removeItem('token');
      localStorage.removeItem('user');
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
            // Preserve the active branch for roles that are allowed to switch branches.
            const canSwitchBranch = ['OWNER', 'ADMIN', 'MANAGER'].includes(me.roleName || '');
            if (!canSwitchBranch && me.branchId) {
              localStorage.setItem('rms-active-branch', me.branchId);
            } else if (!localStorage.getItem('rms-active-branch') && me.branchId) {
              localStorage.setItem('rms-active-branch', me.branchId);
            }
          }
        } catch (err: any) {
          if (err.response?.status === 401) {
            localStorage.removeItem('token');
            localStorage.removeItem('user');
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
    localStorage.setItem('token', newToken);
    localStorage.setItem('user', JSON.stringify(newUser));
    const canSwitchBranch = ['OWNER', 'ADMIN', 'MANAGER'].includes(newUser.roleName || '');
    if (newUser.branchId && (!canSwitchBranch || !localStorage.getItem('rms-active-branch'))) {
      localStorage.setItem('rms-active-branch', newUser.branchId);
    }
    setToken(newToken);
    setUser(newUser);
  };

  const logout = async () => {
    try { if (localStorage.getItem('token')) await authApi.logout(); } catch {}
    localStorage.removeItem('token');
    localStorage.removeItem('user');
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
