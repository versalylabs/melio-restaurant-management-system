import axios from 'axios';
import type { ApiResponse, User } from '../types';
import {
  getCacheKey,
  getCachedResponse,
  setCachedResponse,
  handleMutationInvalidation,
  invalidateCache,
} from '../utils/apiCache';
import { compressImage } from '../utils/imageCompressor';

export { invalidateCache };

export const api = axios.create({
  baseURL: import.meta.env.DEV
    ? '/api'
    : (import.meta.env.VITE_API_URL || 'https://melio-restaurant-management-system.vercel.app/api'),
  timeout: 15000,
  headers: {
    'Content-Type': 'application/json',
  },
});

api.interceptors.request.use((config) => {
  const customerToken = localStorage.getItem('customer_token');
  const staffToken = localStorage.getItem('token');
  const isPublicEndpoint =
    config.url === '/auth/login' ||
    config.url === '/auth/setup' ||
    config.url?.startsWith('/customer/login') ||
    config.url?.startsWith('/customer/register') ||
    config.url?.startsWith('/public') ||
    config.url?.startsWith('/orders/public');

  if (config.url?.startsWith('/customer') && !isPublicEndpoint && customerToken) {
    config.headers.Authorization = `Bearer ${customerToken}`;
  } else if (!isPublicEndpoint && staffToken) {
    config.headers.Authorization = `Bearer ${staffToken}`;
  }
  const branchId = localStorage.getItem('rms-active-branch');
  if (branchId) {
    config.headers['X-Branch-Id'] = branchId;
  }
  return config;
});

api.interceptors.response.use(
  (response) => {
    // Invalidate stale caches when mutations succeed
    const method = response.config?.method?.toUpperCase();
    const url = response.config?.url || '';
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method || '')) {
      handleMutationInvalidation(url);
    }
    return response;
  },
  (error) => {
    if (error.response?.status === 401) {
      const requestUrl = String(error.config?.url || '');
      const isPublicEndpoint =
        requestUrl === '/auth/login' ||
        requestUrl === '/auth/setup' ||
        requestUrl.startsWith('/customer/login') ||
        requestUrl.startsWith('/customer/register');

      if (!isPublicEndpoint) {
        if (requestUrl.startsWith('/customer')) {
          localStorage.removeItem('customer_token');
          window.dispatchEvent(new Event('customer-auth-expired'));
        } else {
          localStorage.removeItem('token');
          localStorage.removeItem('user');
          window.dispatchEvent(new Event('staff-auth-expired'));
        }
      }
    }
    return Promise.reject(error);
  }
);

/**
 * High-performance Stale-While-Revalidate GET fetcher.
 * Returns cached responses instantly (0ms) while silently revalidating in the background.
 */
export const cachedGet = async <T = any>(
  url: string,
  config?: any
): Promise<{ data: T; status: number; statusText: string; headers: any; config: any }> => {
  const isRefresh =
    config?.headers?.['x-refresh'] === 'true' ||
    config?.headers?.['x-cache-bypass'] === 'true' ||
    Boolean(config?.params?._refresh);

  const branchId = localStorage.getItem('rms-active-branch');
  const cacheKey = getCacheKey(url, config?.params, branchId);

  if (!isRefresh) {
    const cached = getCachedResponse(cacheKey);
    if (cached) {
      if (cached.isStale) {
        // Trigger background revalidation asynchronously
        api.get<T>(url, {
          ...config,
          headers: { ...config?.headers, 'x-cache-bypass': 'true' },
        })
          .then((res) => setCachedResponse(cacheKey, res))
          .catch((err) => console.warn('Background cache revalidation failed:', err));
      }
      return {
        data: cached.data.data,
        status: cached.data.status,
        statusText: cached.data.statusText,
        headers: cached.data.headers,
        config: config || {},
      };
    }
  }

  const res = await api.get<T>(url, config);
  setCachedResponse(cacheKey, res);
  return res;
};

export const authApi = {
  login: (email: string, password: string) =>
    api.post<ApiResponse<{ token: string; user: User }>>('/auth/login', { email, password }),

  setup: (data: {
    restaurantName: string;
    ownerFirstName: string;
    ownerLastName: string;
    ownerEmail: string;
    ownerPassword: string;
    ownerPhone?: string;
  }) => api.post('/auth/setup', data),

  getMe: () => api.get<ApiResponse<User>>('/auth/me'),
  logout: () => api.post('/auth/logout'),
};

export const restaurantApi = {
  get: () => cachedGet('/restaurant'),
  update: (data: any) => api.put('/restaurant', data),
};

export const promotionApi = {
  getPromotions: () => cachedGet('/promotions'),
  getActive: (customerId?: string) =>
    cachedGet('/promotions/active', { params: customerId ? { customerId } : undefined }),
  create: (data: any) => api.post('/promotions', data),
  update: (id: string, data: any) => api.put(`/promotions/${id}`, data),
  remove: (id: string) => api.delete(`/promotions/${id}`),
};

export const branchApi = {
  getBranches: () => cachedGet('/branches'),
  getTransfers: (params?: any) => cachedGet('/branches/transfers', { params }),
  createTransfer: (data: any) => api.post('/branches/transfers', data),
  completeTransfer: (id: string) => api.post(`/branches/transfers/${id}/complete`),
  cancelTransfer: (id: string) => api.post(`/branches/transfers/${id}/cancel`),
};

export const dashboardApi = {
  getMetrics: (options?: { refresh?: boolean }) =>
    cachedGet<ApiResponse>('/dashboard', options?.refresh ? { headers: { 'x-refresh': 'true' } } : undefined),
};

export const auditLogApi = {
  getLogs: (params?: any) => cachedGet('/audit-logs', { params }),
};

export const categoryApi = {
  getCategories: (params?: any) => cachedGet('/categories', { params }),
  getCategory: (id: string) => cachedGet(`/categories/${id}`),
  createCategory: (data: any) => api.post('/categories', data),
  updateCategory: (id: string, data: any) => api.put(`/categories/${id}`, data),
  deleteCategory: (id: string) => api.delete(`/categories/${id}`),
};

export const menuItemApi = {
  getMenuItems: (params?: any) => cachedGet('/menu-items', { params }),
  getMenuItem: (id: string) => cachedGet(`/menu-items/${id}`),
  createMenuItem: (data: any) => api.post('/menu-items', data),
  updateMenuItem: (id: string, data: any) => api.put(`/menu-items/${id}`, data),
  deleteMenuItem: (id: string) => api.delete(`/menu-items/${id}`),
  duplicateMenuItem: (id: string, data: any) => api.post(`/menu-items/${id}/duplicate`, data),
  uploadImage: async (id: string, file: File) => {
    const compressed = await compressImage(file);
    const formData = new FormData();
    formData.append('image', compressed);
    return api.post(`/menu-items/${id}/image`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  removeImage: (id: string) => api.delete(`/menu-items/${id}/image`),
};

export const modifierGroupApi = {
  getModifierGroups: (params?: any) => cachedGet('/modifier-groups', { params }),
  getModifierGroup: (id: string) => cachedGet(`/modifier-groups/${id}`),
  createModifierGroup: (data: any) => api.post('/modifier-groups', data),
  updateModifierGroup: (id: string, data: any) => api.put(`/modifier-groups/${id}`, data),
  deleteModifierGroup: (id: string) => api.delete(`/modifier-groups/${id}`),
};

export const sectionApi = {
  getSections: (params?: any) => cachedGet('/sections', { params }),
  getSection: (id: string) => cachedGet(`/sections/${id}`),
  createSection: (data: any) => api.post('/sections', data),
  updateSection: (id: string, data: any) => api.put(`/sections/${id}`, data),
  deleteSection: (id: string) => api.delete(`/sections/${id}`),
};

export const tableApi = {
  getTables: (params?: any) => cachedGet('/tables', { params }),
  getTable: (id: string) => cachedGet(`/tables/${id}`),
  createTable: (data: any) => api.post('/tables', data),
  updateTable: (id: string, data: any) => api.put(`/tables/${id}`, data),
  updateTablePosition: (id: string, data: any) => api.put(`/tables/${id}/position`, data),
  updateTableStatus: (id: string, data: any) => api.put(`/tables/${id}/status`, data),
  deleteTable: (id: string) => api.delete(`/tables/${id}`),
  getFloorLayout: (params?: any) => cachedGet('/tables/floor', { params }),
  createTableCombination: (data: any) => api.post('/table-combinations', data),
  getTableCombinations: (params?: any) => cachedGet('/table-combinations', { params }),
  updateTableCombination: (id: string, data: any) => api.put(`/table-combinations/${id}`, data),
  deleteTableCombination: (id: string) => api.delete(`/table-combinations/${id}`),
};

export const orderApi = {
  getOrders: (params?: any) => cachedGet('/orders', { params }),
  getOrder: (id: string) => cachedGet(`/orders/${id}`),
  createOrder: (data: any) => api.post('/orders', data),
  updateOrder: (id: string, data: any) => api.patch(`/orders/${id}`, data),
  holdOrder: (id: string) => api.post(`/orders/${id}/hold`),
  resumeOrder: (id: string) => api.post(`/orders/${id}/resume`),
  submitOrder: (id: string) => api.post(`/orders/${id}/submit`),
  cancelOrder: (id: string, data: any) => api.post(`/orders/${id}/cancel`, data),
  getPosMenu: () => cachedGet('/orders/pos/menu'),
  getPosTables: () => cachedGet('/orders/pos/tables'),
};

export const kitchenApi = {
  getStations: (params?: any) => cachedGet('/kitchen/stations', { params }),
  getStation: (id: string) => cachedGet(`/kitchen/stations/${id}`),
  createStation: (data: any) => api.post('/kitchen/stations', data),
  updateStation: (id: string, data: any) => api.patch(`/kitchen/stations/${id}`, data),
  deleteStation: (id: string) => api.delete(`/kitchen/stations/${id}`),
  assignMenuItem: (stationId: string, data: any) => api.post(`/kitchen/stations/${stationId}/items`, data),
  removeMenuItem: (stationId: string, menuItemId: string) => api.delete(`/kitchen/stations/${stationId}/items/${menuItemId}`),
  getTickets: (params?: any) => cachedGet('/kitchen/tickets', { params }),
  getTicket: (id: string) => cachedGet(`/kitchen/tickets/${id}`),
  updateTicketStatus: (id: string, data: any) => api.patch(`/kitchen/tickets/${id}/status`, data),
  updateTicketItemStatus: (ticketId: string, itemId: string, data: any) => api.patch(`/kitchen/tickets/${ticketId}/items/${itemId}/status`, data),
};

export const tableCombinationApi = {
  getTableCombinations: (params?: any) => cachedGet('/table-combinations', { params }),
  createTableCombination: (data: any) => api.post('/table-combinations', data),
  updateTableCombination: (id: string, data: any) => api.put(`/table-combinations/${id}`, data),
  deleteTableCombination: (id: string) => api.delete(`/table-combinations/${id}`),
};

export const inventoryApi = {
  // Ingredient Categories
  getIngredientCategories: () => cachedGet('/inventory/categories'),
  createIngredientCategory: (data: any) => api.post('/inventory/categories', data),
  updateIngredientCategory: (id: string, data: any) => api.put(`/inventory/categories/${id}`, data),
  deleteIngredientCategory: (id: string) => api.delete(`/inventory/categories/${id}`),

  // Ingredients
  getIngredients: (params?: any) => cachedGet('/inventory/ingredients', { params }),
  getIngredient: (id: string) => cachedGet(`/inventory/ingredients/${id}`),
  createIngredient: (data: any) => api.post('/inventory/ingredients', data),
  updateIngredient: (id: string, data: any) => api.put(`/inventory/ingredients/${id}`, data),
  deleteIngredient: (id: string) => api.delete(`/inventory/ingredients/${id}`),

  // Stock
  getInventoryStock: (params?: any) => cachedGet('/inventory/stock', { params }),
  getStockLevel: (ingredientId: string) => cachedGet(`/inventory/stock/${ingredientId}`),
  updateStockLevel: (ingredientId: string, data: any) => api.put(`/inventory/stock/${ingredientId}`, data),
  adjustStock: (ingredientId: string, data: any) => api.post(`/inventory/stock/${ingredientId}/adjust`, data),
  getStockMovements: (params?: any) => cachedGet('/inventory/stock/movements', { params }),

  // Wastage
  getWastageRecords: (params?: any) => cachedGet('/inventory/wastage', { params }),
  createWastageRecord: (data: any) => api.post('/inventory/wastage', data),

  // Recipes
  getRecipes: () => cachedGet('/inventory/recipes'),
  getRecipe: (menuItemId: string) => cachedGet(`/inventory/recipes/${menuItemId}`),
  createRecipe: (data: any) => api.post('/inventory/recipes', data),
  updateRecipe: (menuItemId: string, data: any) => api.put(`/inventory/recipes/${menuItemId}`, data),
  deleteRecipe: (menuItemId: string) => api.delete(`/inventory/recipes/${menuItemId}`),
  getRecipeIngredients: (recipeId: string) => cachedGet(`/inventory/recipes/${recipeId}/ingredients`),
  addRecipeIngredient: (recipeId: string, data: any) => api.post(`/inventory/recipes/${recipeId}/ingredients`, data),
  updateRecipeIngredient: (recipeId: string, ingredientId: string, data: any) => api.put(`/inventory/recipes/${recipeId}/ingredients/${ingredientId}`, data),
  removeRecipeIngredient: (recipeId: string, ingredientId: string) => api.delete(`/inventory/recipes/${recipeId}/ingredients/${ingredientId}`),

  // Food Cost
  getFoodCost: (menuItemId: string) => cachedGet(`/inventory/food-cost/${menuItemId}`),

  // Dashboard
  getInventoryDashboard: () => cachedGet('/inventory/dashboard'),
  getInventoryBatches: (params?: any) => cachedGet('/inventory/batches', { params }),
  createInventoryBatch: (data: any) => api.post('/inventory/batches', data),
  getStocktakes: (params?: any) => cachedGet('/inventory/stocktakes', { params }),
  createStocktake: (data: any) => api.post('/inventory/stocktakes', data),
  updateStocktake: (id: string, data: any) => api.put(`/inventory/stocktakes/${id}`, data),
  completeStocktake: (id: string) => api.post(`/inventory/stocktakes/${id}/complete`),

  // Suppliers
  getSuppliers: (params?: any) => cachedGet('/inventory/suppliers', { params }),
  getSupplier: (id: string) => cachedGet(`/inventory/suppliers/${id}`),
  createSupplier: (data: any) => api.post('/inventory/suppliers', data),
  updateSupplier: (id: string, data: any) => api.put(`/inventory/suppliers/${id}`, data),
  deleteSupplier: (id: string) => api.delete(`/inventory/suppliers/${id}`),

  // Supplier Ingredients
  getSupplierIngredients: (params?: any) => cachedGet('/inventory/supplier-ingredients', { params }),
  createSupplierIngredient: (data: any) => api.post('/inventory/supplier-ingredients', data),
  updateSupplierIngredient: (id: string, data: any) => api.put(`/inventory/supplier-ingredients/${id}`, data),
  deleteSupplierIngredient: (id: string) => api.delete(`/inventory/supplier-ingredients/${id}`),

  // Purchase Orders
  getPurchaseOrders: (params?: any) => cachedGet('/inventory/purchase-orders', { params }),
  getPurchaseOrder: (id: string) => cachedGet(`/inventory/purchase-orders/${id}`),
  createPurchaseOrder: (data: any) => api.post('/inventory/purchase-orders', data),
  updatePurchaseOrder: (id: string, data: any) => api.put(`/inventory/purchase-orders/${id}`, data),
  receivePurchaseOrder: (id: string, data?: any) => api.post(`/inventory/purchase-orders/${id}/receive`, data),
  submitPurchaseOrder: (id: string) => api.post(`/inventory/purchase-orders/${id}/submit`),
  approvePurchaseOrder: (id: string) => api.post(`/inventory/purchase-orders/${id}/approve`),
  cancelPurchaseOrder: (id: string, data?: any) => api.post(`/inventory/purchase-orders/${id}/cancel`, data),
  deletePurchaseOrder: (id: string) => api.delete(`/inventory/purchase-orders/${id}`),
  createPurchaseCorrection: (id: string, data: any) => api.post(`/inventory/purchase-orders/${id}/corrections`, data),
};

export const customerApi = {
  getCustomers: (params?: any) => cachedGet('/customers', { params }),
  getCustomer: (id: string) => cachedGet('/customers/' + id),
  createCustomer: (data: any) => api.post('/customers', data),
  updateCustomer: (id: string, data: any) => api.put('/customers/' + id, data),
  deactivateCustomer: (id: string) => api.delete('/customers/' + id),
  getLoyaltyRules: () => cachedGet('/customers/loyalty/rules'),
  adjustLoyalty: (id: string, data: { points: number; note?: string }) => api.post(`/customers/${id}/loyalty/adjust`, data),
  redeemLoyalty: (id: string, data: { points: number; note?: string }) => api.post(`/customers/${id}/loyalty/redeem`, data),
};

export const paymentApi = {
  getPayments: (params?: any) => cachedGet('/payments', { params }),
  getOrderPayments: (orderId: string) => cachedGet(`/payments/order/${orderId}`),
  recordPayment: (orderId: string, data: any) => api.post(`/payments/orders/${orderId}`, data),
  refundPayment: (id: string, data: any) => api.post(`/payments/${id}/refund`, data),
  getReceipt: (orderId: string) => cachedGet(`/payments/orders/${orderId}/receipt`),
};

export const reportApi = {
  getSalesReport: (params?: any) => cachedGet('/reports/sales', { params }),
  exportSalesReport: (params?: any) => api.get('/reports/sales/export', { params, responseType: 'blob' }),
};

export const reservationApi = {
  getReservations: (params?: any) => cachedGet('/reservations', { params }),
  getReservation: (id: string) => cachedGet(`/reservations/${id}`),
  createReservation: (data: any) => api.post('/reservations', data),
  updateReservation: (id: string, data: any) => api.put(`/reservations/${id}`, data),
  updateStatus: (id: string, data: any) => api.patch(`/reservations/${id}/status`, data),
  cancel: (id: string) => api.delete(`/reservations/${id}`),
};

export const publicOrderingApi = {
  getRestaurants: () => cachedGet('/public/restaurants'),
  getMenu: (params: { restaurantId: string; branchId: string }) => cachedGet('/public/menu', { params }),
  placeOrder: (data: any) => api.post('/public/orders', data),
  getOrder: (trackingToken: string) => cachedGet(`/public/orders/${trackingToken}`),
  confirmPayment: (trackingToken: string, data?: { reference?: string }) => api.post(`/public/orders/${trackingToken}/pay/confirm`, data || {}),
  createReservation: (data: any) => api.post('/public/reservations', data),
  getReservation: (codeOrId: string) => cachedGet(`/public/reservations/${codeOrId}`),
  checkAvailability: (params: { restaurantId: string; branchId: string; date: string; partySize?: number }) => cachedGet('/public/reservations/availability', { params }),
};

export const publicPaymentsApi = {
  initiateMpesaStkPush: (data: { trackingToken: string; phoneNumber: string; amount?: number }) =>
    api.post('/public/payments/mpesa/stk-push', data),
  confirmMpesaPayment: (data: { checkoutRequestId: string; mpesaReceiptNumber?: string }) =>
    api.post('/public/payments/mpesa/confirm', data),
  getMpesaStatus: (checkoutRequestId: string) =>
    cachedGet(`/public/payments/mpesa/status/${checkoutRequestId}`),
  processCardPayment: (data: {
    trackingToken: string;
    cardNumber?: string;
    cardExp?: string;
    cardCvc?: string;
    cardName?: string;
    amount?: number;
  }) => api.post('/public/payments/card/process', data),
  getRecentNotifications: () => cachedGet('/public/payments/notifications/recent'),
};

export const customerPortalApi = {
  register: (data: any) => api.post('/customer/register', data),
  login: (data: any) => api.post('/customer/login', data),
  getProfile: () => cachedGet('/customer/me'),
  updateProfile: (data: any) => api.put('/customer/profile', data),
  getOrders: () => cachedGet('/customer/orders'),
  getReservations: () => cachedGet('/customer/reservations'),
  getLoyalty: () => cachedGet('/customer/loyalty'),
  toggleFavorite: (menuItemId: string) => api.post(`/customer/favorites/${menuItemId}`),
};

export const websiteApi = {
  get: () => cachedGet('/website'),
  getPublic: (restaurantId: string) => cachedGet('/website/public', { params: { restaurantId } }),
  updateSettings: (data: any) => api.put('/website/settings', data),
  addGallery: (data: any) => api.post('/website/gallery', data),
  uploadGallery: async (data: FormData) => {
    const file = data.get('image') || data.get('file');
    if (file instanceof File) {
      const compressed = await compressImage(file);
      data.set('image', compressed);
    }
    return api.post('/website/gallery/upload', data, { headers: { 'Content-Type': 'multipart/form-data' } });
  },
  updateGallery: (id: string, data: any) => api.put(`/website/gallery/${id}`, data),
  removeGallery: (id: string) => api.delete(`/website/gallery/${id}`),
  addTestimonial: (data: any) => api.post('/website/testimonials', data),
  updateTestimonial: (id: string, data: any) => api.put(`/website/testimonials/${id}`, data),
  removeTestimonial: (id: string) => api.delete(`/website/testimonials/${id}`),
  updateBranch: (id: string, data: any) => api.put(`/website/branches/${id}`, data),
};

export const notificationApi = {
  getAll: (unreadOnly?: boolean) => cachedGet('/notifications', { params: unreadOnly ? { unreadOnly: true } : undefined }),
  markRead: (id: string) => api.post(`/notifications/${id}/read`),
  markAllRead: () => api.post('/notifications/read-all'),
  getPreferences: () => cachedGet('/notifications/preferences'),
  updatePreferences: (data: any) => api.put('/notifications/preferences', data),
};

export const analyticsApi = {
  getAdvanced: (params?: any) => cachedGet('/analytics', { params }),
};

export const shiftApi = {
  getShifts: (params?: any) => cachedGet('/shifts', { params }),
  getCurrent: () => cachedGet('/shifts/current'),
  open: (data: any) => api.post('/shifts', data),
  close: (id: string, data: any) => api.post(`/shifts/${id}/close`, data),
};

export const expenseApi = {
  getExpenses: (params?: any) => cachedGet('/expenses', { params }),
  create: (data: any) => api.post('/expenses', data),
  update: (id: string, data: any) => api.put(`/expenses/${id}`, data),
  remove: (id: string) => api.delete(`/expenses/${id}`),
  setStatus: (id: string, status: string) => api.patch(`/expenses/${id}/status`, { status }),
};
