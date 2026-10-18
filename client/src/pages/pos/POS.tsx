import { useState, useEffect } from 'react';
import { Plus, Search, Minus, X, ShoppingCart, Table as TableIcon, ArrowLeft, Clock, CheckCircle, AlertCircle, UtensilsCrossed, Wifi, WifiOff, UploadCloud, RefreshCw, Trash2 } from 'lucide-react';
import { orderApi, customerApi, promotionApi, restaurantApi, branchApi } from '../../services/api';
import type { PosCategory, PosMenuItem, PosTable, SaleItem, SaleItemModifier } from '../../types';
import { useAuth } from '../../contexts/AuthContext';
import Button from '../../components/ui/Button';
import Badge from '../../components/ui/Badge';
import Modal from '../../components/ui/Modal';
import { getActiveBranchId, listenForBranchChanges } from '../../utils/branch';
import { OptimizedImage } from '../../components/common/OptimizedImage';
import { preloadImages } from '../../utils/imagePreloader';
import { offlineSyncService, type OfflineOrder } from '../../services/offlineSyncService';

const ORDER_TYPES = [
  { value: 'DINE_IN', label: 'Dine In', requiresTable: true },
  { value: 'TAKEAWAY', label: 'Takeaway', requiresTable: false },
  { value: 'DELIVERY', label: 'Delivery', requiresTable: false },
] as const;

interface CartItem extends SaleItem {
  modifiers: SaleItemModifier[];
}

export default function POS() {
  const { user } = useAuth();
  const [categories, setCategories] = useState<PosCategory[]>([]);
  const [tables, setTables] = useState<PosTable[]>([]);
  const [loading, setLoading] = useState(true);
  const [mobileTab, setMobileTab] = useState<'menu' | 'cart'>('menu');
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [search, setSearch] = useState('');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [orderType, setOrderType] = useState<string>('DINE_IN');
  const [selectedTable, setSelectedTable] = useState<PosTable | null>(null);
  const [customerName, setCustomerName] = useState('');
  const [customers, setCustomers] = useState<any[]>([]);
  const [promotions, setPromotions] = useState<any[]>([]);
  const [selectedPromotionId, setSelectedPromotionId] = useState('');
  const [manualDiscountType, setManualDiscountType] = useState<'FIXED'|'PERCENTAGE'>('FIXED');
  const [manualDiscount, setManualDiscount] = useState(0);
  const [taxRate, setTaxRate] = useState(0);
  const [serviceChargeRate, setServiceChargeRate] = useState(0);
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [orderNotes, setOrderNotes] = useState('');
  const [showModifierModal, setShowModifierModal] = useState(false);
  const [modifierError, setModifierError] = useState('');
  const [showTableModal, setShowTableModal] = useState(false);
  const [showOrderTypeModal, setShowOrderTypeModal] = useState(false);
  const [showHeldOrdersModal, setShowHeldOrdersModal] = useState(false);
  const [heldOrders, setHeldOrders] = useState<any[]>([]);
  const [loadingHeld, setLoadingHeld] = useState(false);
  const [submittingHeldId, setSubmittingHeldId] = useState<string | null>(null);
  const [selectedMenuItem, setSelectedMenuItem] = useState<PosMenuItem | null>(null);
  const [itemNotes, setItemNotes] = useState('');
  const [selectedModifiers, setSelectedModifiers] = useState<SaleItemModifier[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [activeBranchName, setActiveBranchName] = useState('');
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [pendingOfflineCount, setPendingOfflineCount] = useState(0);
  const [showOfflineModal, setShowOfflineModal] = useState(false);
  const [offlineOrders, setOfflineOrders] = useState<OfflineOrder[]>([]);
  const [syncingOffline, setSyncingOffline] = useState(false);

  const refreshOfflineQueue = async () => {
    const list = await offlineSyncService.getAllOfflineOrders();
    setOfflineOrders(list);
    const pending = list.filter((o) => o.syncStatus === 'PENDING' || o.syncStatus === 'FAILED');
    setPendingOfflineCount(pending.length);
  };

  useEffect(() => {
    refreshOfflineQueue();

    const handleOnline = () => {
      setIsOnline(true);
      setSuccessMessage('Internet connection restored. Synchronizing offline orders...');
      triggerSync();
    };
    const handleOffline = () => {
      setIsOnline(false);
      setError('You are currently offline. New orders will be safely queued locally.');
    };
    const handleQueueChange = () => {
      refreshOfflineQueue();
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    window.addEventListener('rms-offline-queue-changed', handleQueueChange);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('rms-offline-queue-changed', handleQueueChange);
    };
  }, []);

  const triggerSync = async () => {
    if (!navigator.onLine) {
      setError('Cannot sync while offline. Please check your internet connection.');
      return;
    }
    setSyncingOffline(true);
    try {
      const res = await offlineSyncService.syncOfflineOrders(orderApi);
      if (res.syncedCount > 0) {
        setSuccessMessage(`Synced ${res.syncedCount} offline order(s) to cloud successfully!`);
        setTimeout(() => setSuccessMessage(''), 4500);
      }
      await refreshOfflineQueue();
    } catch {
      // Handled internally in service
    } finally {
      setSyncingOffline(false);
    }
  };

  useEffect(() => {
    fetchData();
    return listenForBranchChanges(fetchData);
  }, [user?.id]);

  const fetchData = async () => {
    const activeBranchId = getActiveBranchId(user);
    try {
      const [menuRes, tablesRes, customersRes, promotionsRes, restaurantRes, branchesRes] = await Promise.all([
        orderApi.getPosMenu(),
        orderApi.getPosTables(),
        customerApi.getCustomers({ status: 'ACTIVE', limit: 200 }),
        promotionApi.getActive(),
        restaurantApi.get(),
        branchApi.getBranches(),
      ]);
      if (menuRes.data.success) {
        const cats = menuRes.data.data?.categories || [];
        setCategories(cats);
        if (cats.length > 0 && !selectedCategory) {
          setSelectedCategory(cats[0].id);
        }
        if (activeBranchId) {
          offlineSyncService.saveMenuCache(activeBranchId, cats);
        }
        // Preload menu item images in the background for 0ms render
        const allItemImages = cats.flatMap((c: any) => (c.items || []).map((i: any) => i.image));
        preloadImages(allItemImages);
      }
      if (tablesRes.data.success) {
        const tbls = tablesRes.data.data?.tables || [];
        setTables(tbls);
        if (activeBranchId) {
          offlineSyncService.saveTablesCache(activeBranchId, tbls);
        }
      }
      if (customersRes.data.success) setCustomers(customersRes.data.data?.customers || customersRes.data.data || []);
      if (promotionsRes.data.success) setPromotions(promotionsRes.data.data?.promotions || []);
      const activeBranch = (branchesRes.data?.data?.branches || []).find((b:any) => b.id === activeBranchId);
      setActiveBranchName(activeBranch?.name || user?.branchName || 'Active branch');
      if (restaurantRes.data.success) { setTaxRate((restaurantRes.data.data?.taxRate || 0) * 100); setServiceChargeRate((restaurantRes.data.data?.serviceChargeRate || 0) * 100); }
    } catch (err: any) {
      if (!navigator.onLine || !err.response) {
        setIsOnline(false);
        const cachedCats = activeBranchId ? await offlineSyncService.getMenuCache(activeBranchId) : null;
        const cachedTbls = activeBranchId ? await offlineSyncService.getTablesCache(activeBranchId) : null;
        if (cachedCats && cachedCats.length > 0) {
          setCategories(cachedCats);
          if (cachedCats.length > 0 && !selectedCategory) setSelectedCategory(cachedCats[0].id);
          if (cachedTbls) setTables(cachedTbls);
          setSuccessMessage('Loaded cached menu & tables (Offline Mode)');
          setTimeout(() => setSuccessMessage(''), 4500);
          setLoading(false);
          return;
        }
      }
      setError(err.response?.data?.message || 'Failed to load POS data');
    } finally {
      setLoading(false);
    }
  };

  const getFilteredItems = (): PosMenuItem[] => {
    if (search.trim()) {
      const allItems = categories.flatMap((c) => c.items || []);
      const uniqueItems = Array.from(new Map(allItems.map((item) => [item.id, item])).values());
      return uniqueItems.filter(
        (item) =>
          item.name.toLowerCase().includes(search.toLowerCase()) ||
          (item.description && item.description.toLowerCase().includes(search.toLowerCase()))
      );
    }
    const category = categories.find((c) => c.id === selectedCategory) || categories[0];
    if (!category) return [];
    return category.items || [];
  };

  const calculateCartTotal = () => {
    return cart.reduce((total, item) => {
      const modifiersTotal = item.modifiers.reduce((sum, mod) => sum + mod.priceAdjustment, 0);
      return total + (item.unitPrice + modifiersTotal) * item.quantity;
    }, 0);
  };

  const getDiscountAmount = () => {
    const subtotal = calculateCartTotal();
    if (selectedPromotionId) {
      const p = promotions.find(x => x.id === selectedPromotionId);
      if (!p || subtotal < Number(p.minSubtotal || 0)) return 0;
      if (p.scope === 'ORDER') return Math.min(subtotal, p.discountType === 'PERCENTAGE' ? subtotal * Number(p.value) / 100 : Number(p.value));
      if (p.menuItemId) {
        const eligible = cart.filter(i => i.menuItemId === p.menuItemId).reduce((sum,i)=>sum + (i.unitPrice + i.modifiers.reduce((m,x)=>m+x.priceAdjustment,0))*i.quantity,0);
        const qty = cart.filter(i=>i.menuItemId===p.menuItemId).reduce((n,i)=>n+i.quantity,0);
        return Math.min(subtotal, p.discountType === 'PERCENTAGE' ? eligible * Number(p.value)/100 : qty * Number(p.value));
      }
    }
    const d = Number(manualDiscount || 0);
    return Math.min(subtotal, manualDiscountType === 'PERCENTAGE' ? subtotal*d/100 : d);
  };

  const handleDiscountChange = (val: number) => {
    const subtotal = calculateCartTotal();
    const cleanVal = isNaN(val) ? 0 : Math.max(0, val);
    if (manualDiscountType === 'PERCENTAGE') {
      setManualDiscount(Math.min(100, cleanVal));
    } else {
      setManualDiscount(Math.min(subtotal, cleanVal));
    }
  };

  const fetchHeldOrders = async () => {
    setLoadingHeld(true);
    try {
      const activeBranchId = getActiveBranchId(user);
      const res = await orderApi.getOrders({ status: 'HELD', limit: 50, ...(activeBranchId ? { branchId: activeBranchId } : {}) });
      if (res.data.success) {
        setHeldOrders(res.data.data?.orders || []);
      }
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to fetch held orders');
    } finally {
      setLoadingHeld(false);
    }
  };

  const submitHeldOrder = async (orderId: string) => {
    setSubmittingHeldId(orderId);
    setError('');
    try {
      await orderApi.submitOrder(orderId);
      setSuccessMessage('Held order submitted to kitchen successfully!');
      setTimeout(() => setSuccessMessage(''), 4000);
      fetchHeldOrders();
      fetchData();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to submit held order');
    } finally {
      setSubmittingHeldId(null);
    }
  };

  const resumeHeldOrder = (order: any) => {
    try {
      const newItems: CartItem[] = (order.items || []).map((item: any) => ({
        id: `cart-${Date.now()}-${Math.random()}`,
        menuItemId: item.menuItemId,
        itemNameSnapshot: item.itemNameSnapshot,
        unitPrice: item.unitPrice,
        quantity: item.quantity,
        subtotal: item.subtotal || item.unitPrice * item.quantity,
        notes: item.notes || undefined,
        modifiers: (item.modifiers || []).map((m: any) => ({
          modifierOptionId: m.modifierOptionId,
          optionNameSnapshot: m.optionNameSnapshot,
          priceAdjustment: m.priceAdjustment,
        })),
      }));
      setCart(newItems);
      setOrderType(order.orderType || 'DINE_IN');
      if (order.tableId) {
        const matchingTable = tables.find((t) => t.id === order.tableId);
        setSelectedTable(matchingTable || { id: order.tableId, tableNumber: order.tableNumber || '', capacity: 0, status: 'OCCUPIED', selectable: true });
      } else {
        setSelectedTable(null);
      }
      setCustomerName(order.customerName || '');
      setSelectedCustomerId(order.customerId || '');
      setOrderNotes(order.notes || '');
      setShowHeldOrdersModal(false);
      setSuccessMessage(`Order #${order.orderNumber} loaded into cart!`);
      setTimeout(() => setSuccessMessage(''), 4000);
    } catch (err: any) {
      setError('Failed to load held order into cart');
    }
  };

  const getPreviewTotals = () => {
    const subtotal = calculateCartTotal(); const discount = getDiscountAmount(); const after = subtotal-discount;
    const tax = Math.round(after*taxRate)/100; const service = Math.round(after*serviceChargeRate)/100;
    return {subtotal,discount,tax,service,total:Math.round((after+tax+service)*100)/100};
  };

  const handleAddItem = (item: PosMenuItem) => {
    setModifierError('');
    const requiredModifiers = item.modifierGroups.filter((mg) => mg.isRequired);
    if (requiredModifiers.length > 0) {
      setSelectedMenuItem(item);
      setSelectedModifiers([]);
      setItemNotes('');
      setShowModifierModal(true);
    } else {
      addToCart(item, [], '');
    }
  };

  const handleConfirmAddToCart = () => {
    if (!selectedMenuItem) return;
    const unfulfilledRequired = selectedMenuItem.modifierGroups.filter(
      (mg) => mg.isRequired && !selectedModifiers.some((sm) => mg.options.some((opt) => opt.id === sm.modifierOptionId))
    );
    if (unfulfilledRequired.length > 0) {
      setModifierError(`Please select required option(s) for: ${unfulfilledRequired.map((g) => g.name).join(', ')}`);
      return;
    }
    setModifierError('');
    addToCart(selectedMenuItem, selectedModifiers, itemNotes);
  };

  const addToCart = (item: PosMenuItem, modifiers: SaleItemModifier[], notes: string) => {
    const existingIndex = cart.findIndex(
      (ci) => ci.menuItemId === item.id && JSON.stringify(ci.modifiers) === JSON.stringify(modifiers) && ci.notes === notes
    );

    if (existingIndex >= 0) {
      setCart((prev) => prev.map((ci, i) => i === existingIndex ? { ...ci, quantity: ci.quantity + 1 } : ci));
    } else {
      setCart((prev) => [
        ...prev,
        {
          id: `cart-${Date.now()}-${Math.random()}`,
          menuItemId: item.id,
          itemNameSnapshot: item.name,
          unitPrice: item.sellingPrice,
          quantity: 1,
          subtotal: item.sellingPrice,
          notes: notes || undefined,
          modifiers,
        },
      ]);
    }
    setShowModifierModal(false);
    setSelectedMenuItem(null);
    setSelectedModifiers([]);
    setItemNotes('');
  };

  const updateCartQuantity = (index: number, delta: number) => {
    setCart((prev) => {
      const newCart = [...prev];
      newCart[index] = { ...newCart[index], quantity: newCart[index].quantity + delta };
      if (newCart[index].quantity <= 0) {
        newCart.splice(index, 1);
      }
      return newCart;
    });
  };

  const removeFromCart = (index: number) => {
    setCart((prev) => prev.filter((_, i) => i !== index));
  };

  const queueOrderLocally = async (status: 'SUBMITTED' | 'HELD') => {
    const activeBranchId = getActiveBranchId(user);
    const totals = getPreviewTotals();
    const offOrder = await offlineSyncService.queueOfflineOrder({
      branchId: activeBranchId || user?.branchId || '',
      branchName: activeBranchName,
      restaurantId: user?.restaurantId || '',
      orderType,
      tableId: selectedTable?.id,
      tableNumber: selectedTable?.tableNumber,
      customerName: customerName || undefined,
      customerId: selectedCustomerId || undefined,
      notes: orderNotes || undefined,
      status,
      items: cart.map((item) => ({
        menuItemId: item.menuItemId,
        itemNameSnapshot: item.itemNameSnapshot,
        unitPrice: item.unitPrice,
        quantity: item.quantity,
        notes: item.notes,
        modifiers: item.modifiers,
      })),
      subtotal: totals.subtotal,
      discountAmount: totals.discount,
      discountType: selectedPromotionId ? 'FIXED' : manualDiscountType,
      discountReason: selectedPromotionId ? 'Promotion' : undefined,
      taxAmount: totals.tax,
      serviceChargeAmount: totals.service,
      totalAmount: totals.total,
    });

    setSuccessMessage(`Order #${offOrder.offlineOrderNumber} saved to Offline Queue! Will auto-sync when online.`);
    setTimeout(() => setSuccessMessage(''), 5000);
    setCart([]);
    setCustomerName('');
    setSelectedCustomerId('');
    setOrderNotes('');
    setSelectedPromotionId('');
    setManualDiscount(0);
    setSelectedTable(null);
    await refreshOfflineQueue();
  };

  const handleSubmitOrder = async () => {
    if (cart.length === 0) return;
    setError('');
    if (orderType === 'DINE_IN' && !selectedTable) {
      setShowTableModal(true);
      return;
    }

    setSubmitting(true);
    if (!navigator.onLine) {
      try {
        await queueOrderLocally('SUBMITTED');
      } catch (err: any) {
        setError('Failed to queue offline order: ' + err.message);
      } finally {
        setSubmitting(false);
      }
      return;
    }

    try {
      const response = await orderApi.createOrder({
        orderType,
        tableId: selectedTable?.id,
        customerName: customerName || undefined,
        customerId: selectedCustomerId || undefined,
        notes: orderNotes || undefined,
        discountAmount: selectedPromotionId ? 0 : Number(manualDiscount || 0),
        discountType: selectedPromotionId ? 'FIXED' : manualDiscountType,
        promotionId: selectedPromotionId || undefined,
        status: 'SUBMITTED',
        items: cart.map((item) => ({
          menuItemId: item.menuItemId,
          itemNameSnapshot: item.itemNameSnapshot,
          unitPrice: item.unitPrice,
          quantity: item.quantity,
          notes: item.notes,
          modifiers: item.modifiers.map((m) => ({
            modifierOptionId: m.modifierOptionId,
            optionNameSnapshot: m.optionNameSnapshot,
            priceAdjustment: m.priceAdjustment,
          })),
        })),
      });

      if (response.data.success) {
        const orderNum = response.data.data?.orderNumber || 'New';
        setSuccessMessage(`Order #${orderNum} submitted to kitchen!`);
        setTimeout(() => setSuccessMessage(''), 4000);
        setCart([]);
        setCustomerName('');
        setSelectedCustomerId('');
        setOrderNotes('');
        setSelectedPromotionId('');
        setManualDiscount(0);
        setSelectedTable(null);
        fetchData();
      }
    } catch (err: any) {
      if (!navigator.onLine || !err.response || err.code === 'ERR_NETWORK') {
        try {
          await queueOrderLocally('SUBMITTED');
        } catch (offErr: any) {
          setError('Network unavailable and offline queueing failed: ' + offErr.message);
        }
      } else {
        setError(err.response?.data?.message || 'Failed to submit order');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleHoldOrder = async () => {
    if (cart.length === 0) return;
    setError('');
    setSubmitting(true);

    if (!navigator.onLine) {
      try {
        await queueOrderLocally('HELD');
      } catch (err: any) {
        setError('Failed to queue offline held order: ' + err.message);
      } finally {
        setSubmitting(false);
      }
      return;
    }

    try {
      const response = await orderApi.createOrder({
        orderType,
        tableId: selectedTable?.id,
        customerName: customerName || undefined,
        customerId: selectedCustomerId || undefined,
        notes: orderNotes || undefined,
        status: 'HELD',
        items: cart.map((item) => ({
          menuItemId: item.menuItemId,
          itemNameSnapshot: item.itemNameSnapshot,
          unitPrice: item.unitPrice,
          quantity: item.quantity,
          notes: item.notes,
          modifiers: item.modifiers.map((m) => ({
            modifierOptionId: m.modifierOptionId,
            optionNameSnapshot: m.optionNameSnapshot,
            priceAdjustment: m.priceAdjustment,
          })),
        })),
      });

      if (response.data.success) {
        const orderNum = response.data.data?.orderNumber || 'Held';
        setSuccessMessage(`Order #${orderNum} held successfully`);
        setTimeout(() => setSuccessMessage(''), 4000);
        setCart([]);
        setCustomerName('');
        setSelectedCustomerId('');
        setOrderNotes('');
        setSelectedTable(null);
      }
    } catch (err: any) {
      if (!navigator.onLine || !err.response || err.code === 'ERR_NETWORK') {
        try {
          await queueOrderLocally('HELD');
        } catch (offErr: any) {
          setError('Network unavailable and offline queueing failed: ' + offErr.message);
        }
      } else {
        setError(err.response?.data?.message || 'Failed to hold order');
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-gray-500 dark:text-gray-400">Loading POS...</div>
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-4.25rem)] flex flex-col bg-[#faf9f7] dark:bg-[#0b0b0f] overflow-hidden">
      {/* Top Header Toolbar */}
      <div className="relative px-3.5 sm:px-5 py-3 border-b border-orange-500/10 dark:border-white/10 flex items-center justify-between bg-white/75 dark:bg-[#0e0e13]/80 backdrop-blur-xl flex-shrink-0 gap-2">
        <div className="absolute inset-x-0 top-0 h-[1px] bg-gradient-to-r from-transparent via-orange-400/30 dark:via-white/15 to-transparent pointer-events-none" />
        <div className="min-w-0">
          <h1 className="text-lg sm:text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100 truncate">Point of Sale</h1>
          <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400 truncate">Branch: <span className="font-semibold text-orange-600 dark:text-orange-400">{activeBranchName || user?.branchName || 'Not assigned'}</span></p>
        </div>

        <div className="flex items-center gap-2">
          {/* Offline/Online Network Indicator */}
          {!isOnline ? (
            <div className="inline-flex items-center gap-1.5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-2.5 sm:px-3 py-1.5 text-xs font-bold text-amber-600 dark:text-amber-400">
              <WifiOff className="w-3.5 h-3.5 text-amber-500 animate-pulse" />
              <span className="hidden sm:inline">Offline Mode</span>
            </div>
          ) : (
            <div className="hidden sm:inline-flex items-center gap-1.5 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400" title="Connected to Neon Cloud">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              <span>Online</span>
            </div>
          )}

          {/* Pending Offline Sync Badge */}
          {pendingOfflineCount > 0 && (
            <button
              onClick={() => { setShowOfflineModal(true); refreshOfflineQueue(); }}
              className="inline-flex items-center gap-1.5 rounded-xl border border-orange-500/30 bg-orange-500/15 px-2.5 sm:px-3 py-1.5 text-xs font-bold text-orange-600 dark:text-orange-400 hover:bg-orange-500/25 transition shadow-sm"
              title="Click to view offline queue"
            >
              <UploadCloud className="w-3.5 h-3.5 text-orange-500" />
              <span>{pendingOfflineCount} Queued</span>
              {isOnline && (
                <span
                  onClick={(e) => { e.stopPropagation(); triggerSync(); }}
                  className="ml-1 rounded-md bg-orange-500 px-1.5 py-0.5 text-[10px] text-white hover:bg-orange-600 transition"
                  title="Sync now"
                >
                  {syncingOffline ? '...' : 'Sync'}
                </span>
              )}
            </button>
          )}

          {/* Mobile Menu / Cart Switcher Toggle */}
          <div className="flex items-center lg:hidden bg-white/60 dark:bg-white/5 p-1 rounded-xl border border-orange-500/15 shadow-sm">
            <button
              type="button"
              onClick={() => setMobileTab('menu')}
              className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${mobileTab === 'menu' ? 'bg-orange-500 text-white shadow-sm' : 'text-gray-600 dark:text-gray-300'}`}
            >
              Menu
            </button>
            <button
              type="button"
              onClick={() => setMobileTab('cart')}
              className={`px-3 py-1 rounded-lg text-xs font-bold transition-all flex items-center gap-1 ${mobileTab === 'cart' ? 'bg-orange-500 text-white shadow-sm' : 'text-gray-600 dark:text-gray-300'}`}
            >
              <ShoppingCart className="h-3 w-3" />
              Cart {cart.length > 0 && <span className="ml-0.5 rounded-full bg-orange-600 px-1 text-[10px] text-white">{cart.reduce((s, i) => s + i.quantity, 0)}</span>}
            </button>
          </div>

          <button
            onClick={() => { setShowHeldOrdersModal(true); fetchHeldOrders(); }}
            className="inline-flex items-center gap-1.5 sm:gap-2 rounded-xl border border-orange-500/20 bg-white/80 dark:bg-[#121218]/80 backdrop-blur-md px-2.5 sm:px-3.5 py-1.5 sm:py-2 text-xs sm:text-sm font-semibold text-gray-800 dark:text-gray-100 shadow-sm hover:border-orange-500/40 hover:bg-orange-50/80 dark:hover:bg-white/5 transition-all liquid-glass-card"
          >
            <Clock className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-orange-500 shrink-0" />
            <span>Held Orders</span>
          </button>

          <button
            onClick={() => setShowOrderTypeModal(true)}
            className="inline-flex items-center gap-1.5 sm:gap-2 rounded-xl border border-orange-500/20 bg-white/80 dark:bg-[#121218]/80 backdrop-blur-md px-2.5 sm:px-3.5 py-1.5 sm:py-2 text-xs sm:text-sm font-semibold text-gray-800 dark:text-gray-100 shadow-sm hover:border-orange-500/40 hover:bg-orange-50/80 dark:hover:bg-white/5 transition-all liquid-glass-card"
          >
            <ShoppingCart className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-orange-500 shrink-0" />
            <span className="truncate max-w-[80px] sm:max-w-none">{orderType.replace('_', ' ')}</span>
            {selectedTable && <span className="rounded-md bg-orange-500/15 px-1.5 py-0.5 text-xs text-orange-600 dark:text-orange-300 font-bold">{selectedTable.tableNumber}</span>}
          </button>
        </div>
      </div>

      {successMessage && (
        <div className="mx-4 mt-3 bg-emerald-500/10 border border-emerald-500/20 backdrop-blur-md text-emerald-600 dark:text-emerald-400 px-4 py-2.5 rounded-2xl text-xs sm:text-sm shadow-sm flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-2">
            <CheckCircle className="w-4 h-4 text-emerald-500" />
            <span>{successMessage}</span>
          </div>
          <button onClick={() => setSuccessMessage('')} className="text-emerald-500 hover:text-emerald-700">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {error && (
        <div className="mx-4 mt-3 bg-red-500/10 border border-red-500/20 backdrop-blur-md text-red-600 dark:text-red-400 px-4 py-2.5 rounded-2xl text-xs sm:text-sm shadow-sm flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-red-500" />
            <span>{error}</span>
          </div>
          <button onClick={() => setError('')} className="text-red-500 hover:text-red-700">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      <div className="min-h-0 flex-1 flex flex-col lg:flex-row overflow-hidden relative">
        {/* Left menu panel */}
        <div className={`min-w-0 min-h-0 flex-1 flex-col overflow-hidden ${mobileTab === 'menu' ? 'flex' : 'hidden lg:flex'}`}>
          {/* Search & Categories Toolbar */}
          <div className="p-3 sm:p-4 border-b border-orange-500/10 dark:border-white/10 flex gap-3 bg-white/60 dark:bg-[#0e0e13]/60 backdrop-blur-md flex-shrink-0">
            <div className="relative flex-1">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-orange-500/70 pointer-events-none" />
              <input
                type="text"
                placeholder="Search menu items..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="flex h-9 sm:h-10 w-full rounded-xl border border-orange-500/15 dark:border-white/10 bg-white/80 dark:bg-[#121218]/80 backdrop-blur-md text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 pl-10 pr-4 py-2 text-xs sm:text-sm shadow-sm outline-none transition focus:border-orange-500 focus:ring-4 focus:ring-orange-500/15"
              />
            </div>
          </div>

          <div className="p-2.5 sm:p-4 border-b border-orange-500/10 dark:border-white/10 flex gap-2 overflow-x-auto bg-white/40 dark:bg-[#0e0e13]/40 backdrop-blur-md flex-shrink-0 scrollbar-none">
            {categories.map((cat) => (
              <button
                key={cat.id}
                onClick={() => setSelectedCategory(cat.id)}
                className={`px-3 sm:px-4 py-1.5 sm:py-2 rounded-xl text-xs sm:text-sm font-semibold whitespace-nowrap transition-all duration-200 ${
                  selectedCategory === cat.id
                    ? 'bg-gradient-to-r from-orange-500 to-amber-500 text-white shadow-md shadow-orange-500/20'
                    : 'border border-orange-500/10 dark:border-white/10 bg-white/80 dark:bg-[#121218]/80 text-gray-700 dark:text-gray-300 hover:bg-orange-50 dark:hover:bg-white/5 hover:border-orange-500/30'
                }`}
              >
                {cat.name}
              </button>
            ))}
          </div>

          {/* Menu Items Liquid Glass Grid */}
          <div className="flex-1 overflow-y-auto p-3.5 sm:p-6 pb-24 lg:pb-6">
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 sm:gap-4">
              {getFilteredItems().map((item) => (
                <button
                  key={item.id}
                  onClick={() => handleAddItem(item)}
                  className="group relative overflow-hidden rounded-2xl border border-orange-500/15 dark:border-white/10 bg-white/80 dark:bg-[#121218]/85 backdrop-blur-xl p-3 sm:p-3.5 text-left shadow-[0_8px_30px_rgb(0,0,0,0.04)] dark:shadow-[0_8px_32px_0_rgba(0,0,0,0.35)] liquid-glass-card hover:-translate-y-1 hover:border-orange-500/40 dark:hover:border-orange-500/40 hover:shadow-lg transition-all duration-300 flex flex-col justify-between"
                >
                  {/* Top Specular Glare Sheen */}
                  <div className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-orange-400/50 dark:via-white/20 to-transparent pointer-events-none" />

                  {/* Prismatic Corner Glow */}
                  <div className="absolute -top-10 -right-10 h-24 w-24 rounded-full bg-orange-500/10 dark:bg-orange-500/5 blur-xl pointer-events-none group-hover:scale-150 transition-transform duration-500" />

                  <div className="relative z-10 flex flex-col h-full">
                    <div className="aspect-square bg-gradient-to-br from-orange-500/5 to-amber-500/5 dark:bg-white/5 border border-orange-500/10 dark:border-white/5 rounded-xl mb-2.5 sm:mb-3 flex items-center justify-center overflow-hidden">
                      <OptimizedImage
                        src={item.image}
                        alt={item.name}
                        className="w-full h-full object-cover rounded-xl transition-transform duration-300 group-hover:scale-105"
                      />
                    </div>
                    <h3 className="font-semibold text-gray-900 dark:text-gray-100 text-xs sm:text-sm truncate tracking-tight">{item.name}</h3>
                    <p className="text-[11px] sm:text-xs text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-2 leading-relaxed flex-1">{item.description || 'Fresh specialty item'}</p>
                    <div className="mt-2.5 flex items-center justify-between pt-2 border-t border-orange-500/10 dark:border-white/5">
                      <span className="text-xs sm:text-sm font-bold bg-gradient-to-r from-orange-600 to-amber-600 dark:from-orange-400 dark:to-amber-400 bg-clip-text text-transparent">
                        KES {(item.sellingPrice ?? 0).toLocaleString()}
                      </span>
                      <span className="flex h-5 w-5 sm:h-6 sm:w-6 items-center justify-center rounded-lg bg-orange-500/10 text-orange-500 dark:bg-orange-500/20 group-hover:bg-orange-500 group-hover:text-white transition-colors">
                        <Plus className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
                      </span>
                    </div>
                  </div>
                </button>
              ))}
              {getFilteredItems().length === 0 && (
                <div className="col-span-full text-center py-16 text-gray-500 dark:text-gray-400 flex flex-col items-center justify-center">
                  <UtensilsCrossed className="h-10 w-10 text-orange-400/60 mb-2" />
                  <p className="text-sm font-medium">No items found</p>
                  <p className="text-xs text-gray-400 mt-1 max-w-xs">
                    {search ? `No menu items match "${search}"` : 'No items available in this category'}
                  </p>
                  {search && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setSearch('')}
                      className="mt-3 rounded-xl"
                    >
                      Clear Search
                    </Button>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Floating Mobile Cart summary bar when on mobile and in menu tab */}
          {cart.length > 0 && mobileTab === 'menu' && (
            <div className="lg:hidden absolute bottom-3 inset-x-3 p-3 rounded-2xl border border-orange-500/30 bg-white/95 dark:bg-[#121218]/95 backdrop-blur-2xl flex items-center justify-between shadow-2xl z-20 liquid-glass-card animate-in slide-in-from-bottom duration-200">
              <div>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{cart.reduce((s, i) => s + i.quantity, 0)} items in order</p>
                <p className="text-base font-extrabold text-orange-600 dark:text-orange-400">KES {getPreviewTotals().total.toLocaleString()}</p>
              </div>
              <button
                onClick={() => setMobileTab('cart')}
                className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-orange-500 to-amber-500 px-4 py-2.5 text-xs sm:text-sm font-bold text-white shadow-lg shadow-orange-500/30 active:scale-95 transition-transform"
              >
                <ShoppingCart className="h-4 w-4" /> View Cart →
              </button>
            </div>
          )}
        </div>

        {/* Right cart & order panel */}
        <div className={`min-h-0 w-full lg:w-[min(100%,28rem)] shrink-0 border-l border-orange-500/10 dark:border-white/10 flex-col bg-white/80 dark:bg-[#0e0e13]/85 backdrop-blur-2xl shadow-xl ${mobileTab === 'cart' ? 'flex' : 'hidden lg:flex'}`}>
          <div className="p-4 border-b border-orange-500/10 dark:border-white/10 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setMobileTab('menu')}
                className="lg:hidden p-1.5 -ml-1 rounded-xl text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white bg-orange-500/10 hover:bg-orange-500/20"
                title="Back to menu"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
              <div>
                <h2 className="text-base font-bold text-gray-900 dark:text-gray-100">Current Order</h2>
                {selectedTable && (
                  <div className="flex items-center gap-1.5 mt-0.5 text-xs font-semibold text-orange-600 dark:text-orange-400">
                    <TableIcon className="w-3.5 h-3.5" />
                    Table {selectedTable.tableNumber}
                  </div>
                )}
              </div>
            </div>
            {cart.length > 0 && (
              <span className="rounded-full bg-orange-500/10 border border-orange-500/20 px-2.5 py-0.5 text-xs font-bold text-orange-600 dark:text-orange-400">
                {cart.reduce((sum, item) => sum + item.quantity, 0)} items
              </span>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-4 space-y-3">
            {cart.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center py-12">
                <div className="h-12 w-12 rounded-2xl bg-orange-500/10 flex items-center justify-center text-orange-500 mb-3">
                  <ShoppingCart className="h-6 w-6" />
                </div>
                <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">Your order cart is empty</p>
                <p className="text-xs text-gray-400 mt-1">Select items from the menu to add to this order</p>
              </div>
            ) : (
              cart.map((item, index) => (
                <div key={item.id} className="relative overflow-hidden rounded-2xl border border-orange-500/10 dark:border-white/5 bg-white/60 dark:bg-white/[0.03] backdrop-blur-md p-3.5 shadow-sm liquid-glass-card transition-all">
                  <div className="absolute inset-x-0 top-0 h-[1px] bg-gradient-to-r from-transparent via-orange-400/30 dark:via-white/10 to-transparent pointer-events-none" />
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{item.itemNameSnapshot}</h4>
                      {item.modifiers.length > 0 && (
                        <div className="mt-1 space-y-0.5">
                          {item.modifiers.map((mod, i) => (
                            <div key={i} className="text-xs text-orange-600 dark:text-orange-400 font-medium">
                              + {mod.optionNameSnapshot} (+KES {mod.priceAdjustment})
                            </div>
                          ))}
                        </div>
                      )}
                      {item.notes && (
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 italic">Note: {item.notes}</p>
                      )}
                      <div className="flex items-center gap-2 mt-2.5">
                        <button
                          onClick={() => updateCartQuantity(index, -1)}
                          className="w-6 h-6 rounded-lg bg-gray-100 dark:bg-white/10 flex items-center justify-center text-gray-600 dark:text-gray-300 hover:bg-orange-500 hover:text-white dark:hover:bg-orange-500 transition-colors"
                        >
                          <Minus className="w-3 h-3" />
                        </button>
                        <span className="text-sm font-bold w-7 text-center text-gray-900 dark:text-gray-100">{item.quantity}</span>
                        <button
                          onClick={() => updateCartQuantity(index, 1)}
                          className="w-6 h-6 rounded-lg bg-gray-100 dark:bg-white/10 flex items-center justify-center text-gray-600 dark:text-gray-300 hover:bg-orange-500 hover:text-white dark:hover:bg-orange-500 transition-colors"
                        >
                          <Plus className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                    <div className="text-right pl-2">
                      <p className="text-sm font-bold text-gray-900 dark:text-gray-100">
                        KES {((item.unitPrice + item.modifiers.reduce((s, m) => s + m.priceAdjustment, 0)) * item.quantity).toLocaleString()}
                      </p>
                      <button
                        onClick={() => removeFromCart(index)}
                        className="text-red-400 hover:text-red-600 dark:hover:text-red-300 mt-1.5 p-1 rounded-md hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                        title="Remove item"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          {cart.length > 0 && (
            <>
            <div className="shrink-0 border-t border-orange-500/10 dark:border-white/10 p-3 space-y-1.5 bg-white/40 dark:bg-white/[0.02]">
              <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wider">Customer (optional)</label>
              <select
                value={selectedCustomerId}
                onChange={(e) => { setSelectedCustomerId(e.target.value); const c = customers.find((x) => x.id === e.target.value); setCustomerName(c?.name || ''); }}
                className="w-full rounded-xl border border-orange-500/15 dark:border-white/10 px-3 py-2 text-xs sm:text-sm bg-white/80 dark:bg-[#121218]/80 text-gray-900 dark:text-gray-100 outline-none focus:ring-2 focus:ring-orange-500"
              >
                <option value="">Walk-in customer</option>
                {customers.map((c) => <option key={c.id} value={c.id}>{c.name}{c.phone ? ` — ${c.phone}` : ''}</option>)}
              </select>
            </div>

            <div className="shrink-0 max-h-[42%] overflow-y-auto border-t border-orange-500/10 bg-white/80 dark:border-white/10 dark:bg-[#121218]/90 p-4 space-y-3 backdrop-blur-xl">
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wider">Discount / Promotion</label>
                <select value={selectedPromotionId} onChange={e=>{setSelectedPromotionId(e.target.value);if(e.target.value)setManualDiscount(0)}} className="w-full rounded-xl border border-orange-500/15 dark:border-white/10 px-3 py-2 text-xs sm:text-sm bg-white/80 dark:bg-[#121218]/80 text-gray-900 dark:text-gray-100">
                  <option value="">No promotion</option>{promotions.map(p=><option key={p.id} value={p.id}>{p.name} — {p.discountType==='PERCENTAGE'?`${p.value}%`:`KES ${p.value}`}{p.customerId?' — Customer offer':''}</option>)}
                </select>
                {!selectedPromotionId && <div className="grid grid-cols-2 gap-2"><select value={manualDiscountType} onChange={e=>setManualDiscountType(e.target.value as any)} className="rounded-xl border border-orange-500/15 dark:border-white/10 px-2 py-1.5 text-xs bg-white dark:bg-[#121218]"><option value="FIXED">Fixed (KES)</option><option value="PERCENTAGE">Percent (%)</option></select><input type="number" min="0" value={manualDiscount||''} onChange={e=>handleDiscountChange(Number(e.target.value))} placeholder="0" className="rounded-xl border border-orange-500/15 dark:border-white/10 px-3 py-1.5 text-xs bg-white dark:bg-[#121218]"/></div>}
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                <div className="flex justify-between"><span className="text-gray-500 dark:text-gray-400">Subtotal</span><span className="font-semibold text-gray-900 dark:text-gray-100">KES {getPreviewTotals().subtotal.toLocaleString()}</span></div>
                <div className="flex justify-between"><span className="text-gray-500 dark:text-gray-400">Discount</span><span className="font-semibold text-green-600 dark:text-green-400">- KES {getPreviewTotals().discount.toLocaleString()}</span></div>
                <div className="flex justify-between"><span className="text-gray-500 dark:text-gray-400">Tax</span><span className="font-semibold text-gray-900 dark:text-gray-100">KES {getPreviewTotals().tax.toLocaleString()}</span></div>
                <div className="flex justify-between"><span className="text-gray-500 dark:text-gray-400">Service</span><span className="font-semibold text-gray-900 dark:text-gray-100">KES {getPreviewTotals().service.toLocaleString()}</span></div>
              </div>
              <div className="flex justify-between items-center rounded-xl border border-orange-500/20 bg-gradient-to-r from-orange-500/15 to-amber-500/15 px-3.5 py-2.5 text-base font-bold text-gray-900 dark:text-gray-100 liquid-glass-card">
                <span>Total Amount</span><span className="text-lg text-orange-600 dark:text-orange-400">KES {getPreviewTotals().total.toLocaleString()}</span>
              </div>
              <div className="flex gap-2 pt-1">
                <Button variant="secondary" onClick={handleHoldOrder} disabled={submitting} className="flex-1 rounded-xl">
                  Hold
                </Button>
                <Button variant="secondary" onClick={() => { setCart([]); setSelectedTable(null); }} className="rounded-xl">
                  Clear
                </Button>
              </div>
              <Button onClick={handleSubmitOrder} disabled={submitting} className="w-full rounded-xl bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 shadow-md shadow-orange-500/20">
                {submitting ? 'Processing...' : 'Submit Order'}
              </Button>
            </div>
            </>
          )}
        </div>
      </div>

      {showModifierModal && selectedMenuItem && (
        <Modal title={selectedMenuItem.name} onClose={() => { setShowModifierModal(false); setSelectedMenuItem(null); }}>
          <div className="space-y-4">
            <p className="text-sm font-bold text-orange-600 dark:text-orange-400">KES {(selectedMenuItem.sellingPrice ?? 0).toLocaleString()}</p>
            {selectedMenuItem.modifierGroups.map((group) => (
              <div key={group.id}>
                <h4 className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2">
                  {group.name}
                  {group.isRequired && <span className="text-red-500 dark:text-red-400 ml-1">*</span>}
                </h4>
                <div className="space-y-2">
                  {group.options.map((option) => {
                    const isSelected = selectedModifiers.some((m) => m.modifierOptionId === option.id);
                    return (
                      <label
                        key={option.id}
                        className={`relative overflow-hidden flex items-center justify-between p-3.5 border rounded-2xl cursor-pointer transition-all liquid-glass-card ${
                          isSelected
                            ? 'border-orange-500 bg-gradient-to-r from-orange-500/15 to-amber-500/10 dark:border-orange-500 dark:bg-orange-950/30'
                            : 'border-orange-500/15 dark:border-white/10 bg-white/70 dark:bg-[#121218]/70 hover:border-orange-400 dark:hover:border-white/20'
                        }`}
                      >
                        <div className="flex items-center gap-2.5">
                          <input
                            type={group.selectionType === 'SINGLE' ? 'radio' : 'checkbox'}
                            name={group.id}
                            checked={isSelected}
                            onChange={(e) => {
                              if (group.selectionType === 'SINGLE') {
                                setSelectedModifiers((prev) => {
                                   const filtered = prev.filter((m) => !selectedMenuItem.modifierGroups.some((mg) => mg.id === group.id && mg.options.some((o) => o.id === m.modifierOptionId)));
                                  if (e.target.checked) {
                                    return [...filtered, { modifierOptionId: option.id, optionNameSnapshot: option.name, priceAdjustment: option.priceAdjustment }];
                                  }
                                  return filtered;
                                });
                              } else {
                                setSelectedModifiers((prev) => {
                                  if (e.target.checked) {
                                    return [...prev, { modifierOptionId: option.id, optionNameSnapshot: option.name, priceAdjustment: option.priceAdjustment }];
                                  }
                                  return prev.filter((m) => m.modifierOptionId !== option.id);
                                });
                              }
                            }}
                          />
                          <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">{option.name}</span>
                        </div>
                        {option.priceAdjustment > 0 && (
                          <span className="text-xs font-bold text-orange-600 dark:text-orange-400">+KES {option.priceAdjustment}</span>
                        )}
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1">Special Instructions</label>
              <textarea
                value={itemNotes}
                onChange={(e) => setItemNotes(e.target.value)}
                className="flex w-full rounded-xl border border-orange-500/15 dark:border-white/10 bg-white/80 dark:bg-[#121218]/80 dark:text-gray-100 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-orange-500"
                rows={2}
                placeholder="Any special requests..."
              />
            </div>
            {modifierError && (
              <p className="text-xs text-red-500 font-semibold bg-red-500/10 border border-red-500/20 p-2 rounded-xl">
                {modifierError}
              </p>
            )}
            <div className="flex justify-end gap-3 pt-2">
              <Button variant="secondary" onClick={() => { setShowModifierModal(false); setSelectedMenuItem(null); }} className="rounded-xl">Cancel</Button>
              <Button onClick={handleConfirmAddToCart} className="rounded-xl bg-gradient-to-r from-orange-500 to-amber-500">Add to Order</Button>
            </div>
          </div>
        </Modal>
      )}

      {showTableModal && (
        <Modal title="Select Table" onClose={() => setShowTableModal(false)}>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              {tables.map((table) => (
                <button
                  key={table.id}
                  onClick={() => { setSelectedTable(table); setShowTableModal(false); }}
                  disabled={!table.selectable}
                  className={`relative overflow-hidden p-4 border rounded-2xl text-left transition-all liquid-glass-card ${
                    selectedTable?.id === table.id
                      ? 'border-orange-500 bg-gradient-to-br from-orange-500/20 to-amber-500/10 dark:border-orange-500 dark:bg-orange-950/30 shadow-md shadow-orange-500/10'
                      : table.selectable
                      ? 'border-orange-500/15 dark:border-white/10 bg-white/80 dark:bg-[#121218]/80 hover:border-orange-400 dark:hover:border-orange-500 hover:-translate-y-0.5'
                      : 'border-gray-200/50 dark:border-white/5 bg-gray-50/50 dark:bg-white/[0.02] opacity-50 cursor-not-allowed'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-bold text-gray-900 dark:text-gray-100">Table {table.tableNumber}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">{table.capacity} seats</p>
                      <p className="text-xs text-orange-500/80 dark:text-orange-400/80 font-medium">{table.sectionName}</p>
                    </div>
                    <Badge variant={table.status === 'AVAILABLE' ? 'success' : table.status === 'OCCUPIED' ? 'danger' : 'warning'}>
                      {table.status}
                    </Badge>
                  </div>
                </button>
              ))}
            </div>
            <div className="flex justify-end">
              <Button variant="secondary" onClick={() => setShowTableModal(false)} className="rounded-xl">Cancel</Button>
            </div>
          </div>
        </Modal>
      )}

      {showOrderTypeModal && (
        <Modal title="Select Order Type" onClose={() => setShowOrderTypeModal(false)}>
          <div className="space-y-3">
            {ORDER_TYPES.map((type) => (
              <button
                key={type.value}
                onClick={() => { setOrderType(type.value); setShowOrderTypeModal(false); if (type.value !== 'DINE_IN') setSelectedTable(null); }}
                className={`relative overflow-hidden w-full p-4 border rounded-2xl text-left transition-all liquid-glass-card ${
                  orderType === type.value
                    ? 'border-orange-500 bg-gradient-to-br from-orange-500/20 to-amber-500/10 dark:border-orange-500 dark:bg-orange-950/30 shadow-md shadow-orange-500/10'
                    : 'border-orange-500/15 dark:border-white/10 bg-white/80 dark:bg-[#121218]/80 hover:border-orange-400 dark:hover:border-orange-500 hover:-translate-y-0.5'
                }`}
              >
                <p className="font-bold text-gray-900 dark:text-gray-100">{type.label}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">{type.requiresTable ? 'Requires table selection' : 'No table required'}</p>
              </button>
            ))}
          </div>
        </Modal>
      )}

      {showHeldOrdersModal && (
        <Modal title="Held Orders" onClose={() => setShowHeldOrdersModal(false)}>
          <div className="space-y-4">
            {loadingHeld ? (
              <div className="py-8 text-center text-gray-500">Loading held orders...</div>
            ) : heldOrders.length === 0 ? (
              <div className="py-8 text-center text-gray-500">
                <Clock className="w-8 h-8 text-orange-400 mx-auto mb-2 opacity-60" />
                <p className="text-sm">No held orders right now.</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {heldOrders.map((order) => (
                  <div
                    key={order.id}
                    className="p-3.5 border rounded-2xl border-orange-500/15 dark:border-white/10 bg-white/80 dark:bg-[#121218]/80 flex items-center justify-between gap-3"
                  >
                    <div>
                      <p className="font-bold text-gray-900 dark:text-gray-100">Order #{order.orderNumber}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {order.orderType} {order.tableNumber ? `· Table ${order.tableNumber}` : ''} {order.customerName ? `· ${order.customerName}` : ''}
                      </p>
                      <p className="text-xs font-semibold text-orange-600 dark:text-orange-400 mt-0.5">
                        KES {(order.totalAmount || 0).toLocaleString()}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => resumeHeldOrder(order)}
                        className="rounded-xl"
                      >
                        Resume
                      </Button>
                      <Button
                        size="sm"
                        disabled={submittingHeldId === order.id}
                        onClick={() => submitHeldOrder(order.id)}
                        className="rounded-xl bg-orange-500 text-white hover:bg-orange-600"
                      >
                        {submittingHeldId === order.id ? 'Submitting...' : 'Submit to Kitchen'}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="flex justify-end pt-2">
              <Button variant="secondary" onClick={() => setShowHeldOrdersModal(false)} className="rounded-xl">Close</Button>
            </div>
          </div>
        </Modal>
      )}

      {showOfflineModal && (
        <Modal title="Offline Orders Queue" onClose={() => setShowOfflineModal(false)}>
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-gray-500 dark:text-gray-400">
              <span>Orders taken while offline are safely queued locally in IndexedDB.</span>
              {isOnline && pendingOfflineCount > 0 && (
                <Button
                  size="sm"
                  onClick={triggerSync}
                  disabled={syncingOffline}
                  className="rounded-xl bg-orange-500 text-white hover:bg-orange-600 shrink-0"
                >
                  <RefreshCw className={`w-3.5 h-3.5 mr-1 ${syncingOffline ? 'animate-spin' : ''}`} />
                  {syncingOffline ? 'Syncing...' : 'Sync Pending to Cloud'}
                </Button>
              )}
            </div>

            {offlineOrders.length === 0 ? (
              <div className="py-8 text-center text-gray-500">
                <UploadCloud className="w-8 h-8 text-orange-400 mx-auto mb-2 opacity-50" />
                <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">No offline orders in queue</p>
                <p className="text-xs text-gray-400 mt-0.5">Orders taken while disconnected will appear here and sync automatically.</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
                {offlineOrders.map((ord) => (
                  <div
                    key={ord.id}
                    className="p-3.5 border rounded-2xl border-orange-500/15 dark:border-white/10 bg-white/80 dark:bg-[#121218]/80 flex items-center justify-between gap-3 shadow-sm"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-bold text-gray-900 dark:text-gray-100">
                          {ord.offlineOrderNumber}
                          {ord.serverOrderNumber && (
                            <span className="ml-2 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                              → Cloud: {ord.serverOrderNumber}
                            </span>
                          )}
                        </p>
                        <Badge
                          variant={
                            ord.syncStatus === 'SYNCED'
                              ? 'success'
                              : ord.syncStatus === 'SYNCING'
                              ? 'warning'
                              : ord.syncStatus === 'FAILED'
                              ? 'danger'
                              : 'warning'
                          }
                        >
                          {ord.syncStatus}
                        </Badge>
                      </div>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                        {ord.orderType} {ord.tableNumber ? `· Table ${ord.tableNumber}` : ''} {ord.customerName ? `· ${ord.customerName}` : ''} · {ord.items.length} item(s)
                      </p>
                      <p className="text-[11px] text-gray-400">
                        {new Date(ord.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </p>
                      {ord.syncError && (
                        <p className="text-[11px] text-red-500 mt-1 font-medium">{ord.syncError}</p>
                      )}
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold text-orange-600 dark:text-orange-400">
                        KES {(ord.totalAmount || 0).toLocaleString()}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="flex items-center justify-between pt-2 border-t border-orange-500/10 dark:border-white/10">
              <Button
                variant="ghost"
                size="sm"
                onClick={async () => {
                  await offlineSyncService.clearSyncedOrders();
                  await refreshOfflineQueue();
                }}
                className="text-xs text-gray-400 hover:text-red-500"
              >
                <Trash2 className="w-3.5 h-3.5 mr-1" /> Clear Synced
              </Button>
              <Button variant="secondary" onClick={() => setShowOfflineModal(false)} className="rounded-xl">
                Close
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
