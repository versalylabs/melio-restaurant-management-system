/**
 * High-performance In-Memory SWR (Stale-While-Revalidate) Cache for Melio RMS.
 * Enables instant (0ms) page loads across navigation, background syncing,
 * and automatic cache invalidation on data updates.
 */

interface CacheEntry {
  data: any;
  status: number;
  statusText: string;
  headers: any;
  timestamp: number;
  isFetching?: boolean;
}

const memoryCache = new Map<string, CacheEntry>();

// Cache TTL configuration
export const CACHE_CONFIG = {
  // Duration in ms where cached data is considered 100% fresh (no background revalidation)
  FRESH_TTL: 15_000, // 15 seconds
  // Duration in ms where cached data is stale but returned immediately (0ms) while revalidating
  STALE_TTL: 10 * 60_000, // 10 minutes
  // Maximum number of entries in memory
  MAX_ENTRIES: 100,
};

export const getCacheKey = (url: string, params?: any, branchId?: string | null): string => {
  const paramStr = params ? JSON.stringify(params) : '';
  const branch = branchId || '';
  return `${url}::${paramStr}::${branch}`;
};

export const getCachedResponse = (key: string): { data: any; isStale: boolean } | null => {
  const entry = memoryCache.get(key);
  if (!entry) return null;

  const now = Date.now();
  const age = now - entry.timestamp;

  if (age > CACHE_CONFIG.STALE_TTL) {
    memoryCache.delete(key);
    return null;
  }

  const isStale = age > CACHE_CONFIG.FRESH_TTL;
  return {
    data: {
      data: entry.data,
      status: entry.status,
      statusText: entry.statusText,
      headers: entry.headers,
    },
    isStale,
  };
};

export const setCachedResponse = (
  key: string,
  response: { data: any; status: number; statusText: string; headers: any }
) => {
  // Enforce cache size limit
  if (memoryCache.size >= CACHE_CONFIG.MAX_ENTRIES) {
    const oldestKey = memoryCache.keys().next().value;
    if (oldestKey) memoryCache.delete(oldestKey);
  }

  memoryCache.set(key, {
    data: response.data,
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
    timestamp: Date.now(),
    isFetching: false,
  });

  // Notify active listeners of fresh data
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('api-cache-updated', { detail: { key, data: response.data } }));
  }
};

/**
 * Invalidate cache entries matching specific endpoint prefixes or patterns
 */
export const invalidateCache = (pattern?: string | RegExp) => {
  if (!pattern) {
    memoryCache.clear();
    return;
  }

  const regex = typeof pattern === 'string' ? new RegExp(pattern) : pattern;
  for (const key of memoryCache.keys()) {
    if (regex.test(key)) {
      memoryCache.delete(key);
    }
  }
};

/**
 * Automatic mutation invalidation rules:
 * When a mutation occurs on an entity, invalidate all related cached queries.
 */
export const handleMutationInvalidation = (url: string) => {
  if (url.includes('/menu-items') || url.includes('/categories') || url.includes('/modifier-groups')) {
    invalidateCache(/(\/menu-items|\/categories|\/modifier-groups|\/orders\/pos\/menu|\/dashboard|\/website)/);
  } else if (url.includes('/orders') || url.includes('/payments')) {
    invalidateCache(/(\/orders|\/dashboard|\/kitchen\/tickets|\/analytics|\/reports)/);
  } else if (url.includes('/kitchen')) {
    invalidateCache(/(\/kitchen|\/orders|\/dashboard)/);
  } else if (url.includes('/inventory') || url.includes('/purchases')) {
    invalidateCache(/(\/inventory|\/dashboard|\/reports)/);
  } else if (url.includes('/branches') || url.includes('/restaurant')) {
    invalidateCache(/(\/branches|\/restaurant|\/dashboard)/);
  } else if (url.includes('/tables') || url.includes('/sections')) {
    invalidateCache(/(\/tables|\/sections|\/orders\/pos\/tables|\/dashboard)/);
  } else if (url.includes('/promotions')) {
    invalidateCache(/(\/promotions|\/orders\/pos\/menu)/);
  } else if (url.includes('/customers') || url.includes('/loyalty')) {
    invalidateCache(/(\/customers|\/loyalty|\/dashboard)/);
  } else if (url.includes('/shifts') || url.includes('/users')) {
    invalidateCache(/(\/shifts|\/users|\/dashboard)/);
  }
};
