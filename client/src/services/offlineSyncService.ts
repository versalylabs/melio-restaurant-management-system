/**
 * Melio Offline-First Sync Service
 * Uses browser IndexedDB to safely store menu caches and queue offline transactions.
 * Syncs idempotently to Neon PostgreSQL when connectivity is restored.
 */

const DB_NAME = 'MelioOfflineDB';
const DB_VERSION = 1;

export interface OfflineOrderItem {
  menuItemId: string;
  itemNameSnapshot: string;
  unitPrice: number;
  quantity: number;
  notes?: string;
  modifiers: Array<{
    modifierOptionId: string;
    optionNameSnapshot: string;
    priceAdjustment: number;
  }>;
}

export interface OfflineOrder {
  id: string; // Client-generated UUID idempotency key: off_<timestamp>_<random>
  offlineOrderNumber: string; // e.g. OFF-1001
  branchId: string;
  branchName?: string;
  restaurantId: string;
  orderType: string;
  tableId?: string;
  tableNumber?: string;
  customerName?: string;
  customerId?: string;
  notes?: string;
  status: 'SUBMITTED' | 'HELD';
  items: OfflineOrderItem[];
  subtotal: number;
  discountAmount: number;
  discountType?: 'FIXED' | 'PERCENTAGE';
  promotionId?: string;
  discountReason?: string;
  taxAmount: number;
  serviceChargeAmount: number;
  totalAmount: number;
  createdAt: string; // ISO string
  syncStatus: 'PENDING' | 'SYNCING' | 'SYNCED' | 'FAILED';
  syncError?: string;
  serverOrderNumber?: string;
  syncedAt?: string;
}

class OfflineSyncService {
  private dbPromise: Promise<IDBDatabase> | null = null;

  private getDB(): Promise<IDBDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = new Promise((resolve, reject) => {
        if (typeof window === 'undefined' || !window.indexedDB) {
          return reject(new Error('IndexedDB not supported in this environment'));
        }

        const request = window.indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = (event) => {
          const db = (event.target as IDBOpenDBRequest).result;
          if (!db.objectStoreNames.contains('menu_cache')) {
            db.createObjectStore('menu_cache', { keyPath: 'branchId' });
          }
          if (!db.objectStoreNames.contains('tables_cache')) {
            db.createObjectStore('tables_cache', { keyPath: 'branchId' });
          }
          if (!db.objectStoreNames.contains('offline_orders')) {
            const store = db.createObjectStore('offline_orders', { keyPath: 'id' });
            store.createIndex('syncStatus', 'syncStatus', { unique: false });
            store.createIndex('createdAt', 'createdAt', { unique: false });
          }
          if (!db.objectStoreNames.contains('offline_meta')) {
            db.createObjectStore('offline_meta', { keyPath: 'key' });
          }
        };

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    }
    return this.dbPromise;
  }

  // --- Menu & Table Cache ---
  async saveMenuCache(branchId: string, categories: any[]): Promise<void> {
    try {
      const db = await this.getDB();
      const tx = db.transaction('menu_cache', 'readwrite');
      tx.objectStore('menu_cache').put({
        branchId,
        categories,
        cachedAt: new Date().toISOString(),
      });
    } catch (e) {
      console.warn('[OfflineDB] Could not save menu cache', e);
    }
  }

  async getMenuCache(branchId: string): Promise<any[] | null> {
    try {
      const db = await this.getDB();
      const tx = db.transaction('menu_cache', 'readonly');
      return new Promise((resolve) => {
        const req = tx.objectStore('menu_cache').get(branchId);
        req.onsuccess = () => resolve(req.result ? req.result.categories : null);
        req.onerror = () => resolve(null);
      });
    } catch {
      return null;
    }
  }

  async saveTablesCache(branchId: string, tables: any[]): Promise<void> {
    try {
      const db = await this.getDB();
      const tx = db.transaction('tables_cache', 'readwrite');
      tx.objectStore('tables_cache').put({
        branchId,
        tables,
        cachedAt: new Date().toISOString(),
      });
    } catch (e) {
      console.warn('[OfflineDB] Could not save tables cache', e);
    }
  }

  async getTablesCache(branchId: string): Promise<any[] | null> {
    try {
      const db = await this.getDB();
      const tx = db.transaction('tables_cache', 'readonly');
      return new Promise((resolve) => {
        const req = tx.objectStore('tables_cache').get(branchId);
        req.onsuccess = () => resolve(req.result ? req.result.tables : null);
        req.onerror = () => resolve(null);
      });
    } catch {
      return null;
    }
  }

  // --- Offline Order Queue ---
  async queueOfflineOrder(orderData: Omit<OfflineOrder, 'id' | 'offlineOrderNumber' | 'createdAt' | 'syncStatus'>): Promise<OfflineOrder> {
    const db = await this.getDB();

    // Generate next offline sequence number
    const seq = await this.getNextOfflineSeq();
    const offlineOrderNumber = `OFF-${String(seq).padStart(4, '0')}`;
    const id = `melio_off_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const fullOrder: OfflineOrder = {
      ...orderData,
      id,
      offlineOrderNumber,
      createdAt: new Date().toISOString(),
      syncStatus: 'PENDING',
    };

    const tx = db.transaction('offline_orders', 'readwrite');
    tx.objectStore('offline_orders').add(fullOrder);

    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    window.dispatchEvent(new CustomEvent('rms-offline-queue-changed'));
    return fullOrder;
  }

  private async getNextOfflineSeq(): Promise<number> {
    const db = await this.getDB();
    const tx = db.transaction('offline_meta', 'readwrite');
    const store = tx.objectStore('offline_meta');
    return new Promise((resolve) => {
      const req = store.get('offline_order_counter');
      req.onsuccess = () => {
        const current = req.result ? Number(req.result.value || 1000) : 1000;
        const next = current + 1;
        store.put({ key: 'offline_order_counter', value: next });
        resolve(next);
      };
      req.onerror = () => resolve(Math.floor(1000 + Math.random() * 9000));
    });
  }

  async getPendingOfflineOrders(): Promise<OfflineOrder[]> {
    try {
      const db = await this.getDB();
      const tx = db.transaction('offline_orders', 'readonly');
      const store = tx.objectStore('offline_orders');
      return new Promise((resolve) => {
        const req = store.getAll();
        req.onsuccess = () => {
          const list: OfflineOrder[] = req.result || [];
          resolve(list.filter((o) => o.syncStatus === 'PENDING' || o.syncStatus === 'FAILED'));
        };
        req.onerror = () => resolve([]);
      });
    } catch {
      return [];
    }
  }

  async getAllOfflineOrders(): Promise<OfflineOrder[]> {
    try {
      const db = await this.getDB();
      const tx = db.transaction('offline_orders', 'readonly');
      return new Promise((resolve) => {
        const req = tx.objectStore('offline_orders').getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve([]);
      });
    } catch {
      return [];
    }
  }

  async markOrderSyncing(id: string): Promise<void> {
    try {
      const db = await this.getDB();
      const tx = db.transaction('offline_orders', 'readwrite');
      const store = tx.objectStore('offline_orders');
      const req = store.get(id);
      req.onsuccess = () => {
        if (req.result) {
          req.result.syncStatus = 'SYNCING';
          store.put(req.result);
        }
      };
    } catch (e) {
      console.warn('[OfflineDB] Error marking order syncing', e);
    }
  }

  async markOrderSynced(id: string, serverOrderNumber: string): Promise<void> {
    try {
      const db = await this.getDB();
      const tx = db.transaction('offline_orders', 'readwrite');
      const store = tx.objectStore('offline_orders');
      const req = store.get(id);
      req.onsuccess = () => {
        if (req.result) {
          req.result.syncStatus = 'SYNCED';
          req.result.serverOrderNumber = serverOrderNumber;
          req.result.syncedAt = new Date().toISOString();
          store.put(req.result);
        }
      };
    } catch (e) {
      console.warn('[OfflineDB] Error marking order synced', e);
    }
  }

  async markOrderFailed(id: string, errorMsg: string): Promise<void> {
    try {
      const db = await this.getDB();
      const tx = db.transaction('offline_orders', 'readwrite');
      const store = tx.objectStore('offline_orders');
      const req = store.get(id);
      req.onsuccess = () => {
        if (req.result) {
          req.result.syncStatus = 'FAILED';
          req.result.syncError = errorMsg;
          store.put(req.result);
        }
      };
    } catch (e) {
      console.warn('[OfflineDB] Error marking order failed', e);
    }
  }

  async clearSyncedOrders(): Promise<void> {
    try {
      const db = await this.getDB();
      const tx = db.transaction('offline_orders', 'readwrite');
      const store = tx.objectStore('offline_orders');
      const req = store.getAll();
      req.onsuccess = () => {
        const list: OfflineOrder[] = req.result || [];
        for (const o of list) {
          if (o.syncStatus === 'SYNCED') {
            store.delete(o.id);
          }
        }
      };
      window.dispatchEvent(new CustomEvent('rms-offline-queue-changed'));
    } catch (e) {
      console.warn('[OfflineDB] Error clearing synced orders', e);
    }
  }

  /**
   * Syncs all pending offline orders to the cloud API safely.
   */
  async syncOfflineOrders(apiClient: any): Promise<{ syncedCount: number; failedCount: number }> {
    const pending = await this.getPendingOfflineOrders();
    if (pending.length === 0) return { syncedCount: 0, failedCount: 0 };

    let syncedCount = 0;
    let failedCount = 0;

    for (const order of pending) {
      await this.markOrderSyncing(order.id);
      try {
        const res = await apiClient.post('/orders/sync-offline', {
          orders: [order],
        });

        if (res.data?.success && res.data.data?.syncedOrders?.length > 0) {
          const result = res.data.data.syncedOrders[0];
          await this.markOrderSynced(order.id, result.serverOrderNumber || 'Synced');
          syncedCount++;
        } else {
          await this.markOrderFailed(order.id, res.data?.message || 'Sync rejected by server');
          failedCount++;
        }
      } catch (err: any) {
        await this.markOrderFailed(order.id, err.response?.data?.message || err.message || 'Network error');
        failedCount++;
      }
    }

    window.dispatchEvent(new CustomEvent('rms-offline-queue-changed'));
    window.dispatchEvent(new CustomEvent('rms-offline-sync-complete', { detail: { syncedCount, failedCount } }));
    return { syncedCount, failedCount };
  }
}

export const offlineSyncService = new OfflineSyncService();
