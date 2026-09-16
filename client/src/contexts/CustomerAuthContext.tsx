import React, { createContext, useContext, useState, useEffect } from 'react';
import { customerPortalApi } from '../services/api';

export type CustomerProfile = {
  id: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  loyaltyBalance: number;
  loyaltyPoints?: number;
  favoriteItemIds?: string[];
};

interface CustomerAuthContextType {
  customer: CustomerProfile | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (identifier: string, password: string, restaurantId: string) => Promise<void>;
  register: (data: { restaurantId: string; name: string; email?: string; phone?: string; password: string; address?: string }) => Promise<void>;
  logout: () => void;
  updateProfile: (data: Partial<CustomerProfile>) => Promise<void>;
  toggleFavorite: (menuItemId: string) => Promise<boolean>;
  refreshProfile: () => Promise<void>;
}

const CustomerAuthContext = createContext<CustomerAuthContextType | undefined>(undefined);

export function CustomerAuthProvider({ children }: { children: React.ReactNode }) {
  const [customer, setCustomer] = useState<CustomerProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refreshProfile = async () => {
    const token = localStorage.getItem('customer_token');
    if (!token) {
      setCustomer(null);
      setIsLoading(false);
      return;
    }

    try {
      const res = await customerPortalApi.getProfile();
      if (res.data?.success && res.data.data) {
        setCustomer(res.data.data);
      } else {
        localStorage.removeItem('customer_token');
        setCustomer(null);
      }
    } catch {
      localStorage.removeItem('customer_token');
      setCustomer(null);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    const handleAuthExpired = () => {
      localStorage.removeItem('customer_token');
      setCustomer(null);
      setIsLoading(false);
    };
    window.addEventListener('customer-auth-expired', handleAuthExpired);
    refreshProfile();
    return () => window.removeEventListener('customer-auth-expired', handleAuthExpired);
  }, []);

  const login = async (identifier: string, password: string, restaurantId: string) => {
    const res = await customerPortalApi.login({ identifier, password, restaurantId });
    const data = res.data.data;
    if (data.token) {
      localStorage.setItem('customer_token', data.token);
      setCustomer(data.customer);
    }
  };

  const register = async (data: { restaurantId: string; name: string; email?: string; phone?: string; password: string; address?: string }) => {
    const res = await customerPortalApi.register(data);
    const resData = res.data.data;
    if (resData.token) {
      localStorage.setItem('customer_token', resData.token);
      setCustomer(resData.customer);
    }
  };

  const logout = () => {
    localStorage.removeItem('customer_token');
    setCustomer(null);
  };

  const updateProfile = async (data: Partial<CustomerProfile>) => {
    const res = await customerPortalApi.updateProfile(data);
    if (res.data?.success && res.data.data) {
      setCustomer(res.data.data);
    }
  };

  const toggleFavorite = async (menuItemId: string): Promise<boolean> => {
    if (!customer) return false;
    const res = await customerPortalApi.toggleFavorite(menuItemId);
    const isFav = res.data?.data?.isFavorite ?? false;
    const newFavorites = res.data?.data?.favoriteItemIds || [];
    setCustomer((prev) => (prev ? { ...prev, favoriteItemIds: newFavorites } : prev));
    return isFav;
  };

  return (
    <CustomerAuthContext.Provider
      value={{
        customer,
        isAuthenticated: !!customer,
        isLoading,
        login,
        register,
        logout,
        updateProfile,
        toggleFavorite,
        refreshProfile,
      }}
    >
      {children}
    </CustomerAuthContext.Provider>
  );
}

export function useCustomerAuth() {
  const context = useContext(CustomerAuthContext);
  if (!context) {
    throw new Error('useCustomerAuth must be used within a CustomerAuthProvider');
  }
  return context;
}
