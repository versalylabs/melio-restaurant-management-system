import { useState, useEffect } from 'react';
import { Plus, Search, Minus, X, ShoppingCart, Table as TableIcon } from 'lucide-react';
import { orderApi, customerApi, promotionApi, restaurantApi, branchApi } from '../../services/api';
import type { PosCategory, PosMenuItem, PosTable, SaleItem, SaleItemModifier } from '../../types';
import { useAuth } from '../../contexts/AuthContext';
import Button from '../../components/ui/Button';
import Badge from '../../components/ui/Badge';
import Modal from '../../components/ui/Modal';
import { getActiveBranchId, listenForBranchChanges } from '../../utils/branch';

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
  const [error, setError] = useState('');
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
  const [showTableModal, setShowTableModal] = useState(false);
  const [showOrderTypeModal, setShowOrderTypeModal] = useState(false);
  const [selectedMenuItem, setSelectedMenuItem] = useState<PosMenuItem | null>(null);
  const [itemNotes, setItemNotes] = useState('');
  const [selectedModifiers, setSelectedModifiers] = useState<SaleItemModifier[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [activeBranchName, setActiveBranchName] = useState('');

  useEffect(() => {
    fetchData();
    return listenForBranchChanges(fetchData);
  }, [user?.id]);

  const fetchData = async () => {
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
        setCategories(menuRes.data.data?.categories || []);
        if (menuRes.data.data?.categories?.length > 0 && !selectedCategory) {
          setSelectedCategory(menuRes.data.data.categories[0].id);
        }
      }
      if (tablesRes.data.success) {
        setTables(tablesRes.data.data?.tables || []);
      }
      if (customersRes.data.success) setCustomers(customersRes.data.data?.customers || customersRes.data.data || []);
      if (promotionsRes.data.success) setPromotions(promotionsRes.data.data?.promotions || []);
      const activeBranchId = getActiveBranchId(user);
      const activeBranch = (branchesRes.data?.data?.branches || []).find((b:any) => b.id === activeBranchId);
      setActiveBranchName(activeBranch?.name || user?.branchName || 'Active branch');
      if (restaurantRes.data.success) { setTaxRate((restaurantRes.data.data?.taxRate || 0) * 100); setServiceChargeRate((restaurantRes.data.data?.serviceChargeRate || 0) * 100); }
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to load POS data');
    } finally {
      setLoading(false);
    }
  };

  const getFilteredItems = (): PosMenuItem[] => {
    const category = categories.find((c) => c.id === selectedCategory);
    if (!category) return [];
    let items = category.items;
    if (search) {
      items = items.filter((item) => item.name.toLowerCase().includes(search.toLowerCase()));
    }
    return items;
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

  const getPreviewTotals = () => {
    const subtotal = calculateCartTotal(); const discount = getDiscountAmount(); const after = subtotal-discount;
    const tax = Math.round(after*taxRate)/100; const service = Math.round(after*serviceChargeRate)/100;
    return {subtotal,discount,tax,service,total:Math.round((after+tax+service)*100)/100};
  };

  const handleAddItem = (item: PosMenuItem) => {
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

  const handleSubmitOrder = async () => {
    if (cart.length === 0) return;
    if (orderType === 'DINE_IN' && !selectedTable) {
      setShowTableModal(true);
      return;
    }

    setSubmitting(true);
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
      setError(err.response?.data?.message || 'Failed to submit order');
    } finally {
      setSubmitting(false);
    }
  };

  const handleHoldOrder = async () => {
    if (cart.length === 0) return;
    setSubmitting(true);
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
        setCart([]);
        setCustomerName('');
        setSelectedCustomerId('');
        setOrderNotes('');
        setSelectedTable(null);
      }
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to hold order');
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

  const selectedCat = categories.find((c) => c.id === selectedCategory);

  return (
    <div className="h-[calc(100vh-4rem)] flex flex-col bg-[#faf9f7] dark:bg-[#111116]">
      <div className="p-4 border-b border-orange-100 dark:border-gray-700 flex items-center justify-between bg-white dark:bg-[#111116]">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Point of Sale</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">Branch: {activeBranchName || user?.branchName || 'Not assigned'}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setShowOrderTypeModal(true)} className="gap-2">
            <ShoppingCart className="w-4 h-4" />
            {orderType.replace('_', ' ')}
            {selectedTable && ` - ${selectedTable.tableNumber}`}
          </Button>
        </div>
      </div>

      {error && (
        <div className="mx-4 mt-4 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 px-4 py-3 rounded-md text-sm">
          {error}
        </div>
      )}

      <div className="min-h-0 flex-1 flex overflow-hidden">
        {/* Left menu panel */}
        <div className="min-w-0 min-h-0 flex-1 flex flex-col overflow-hidden bg-[#faf9f7] dark:bg-[#111116]">
          <div className="p-4 border-b border-orange-100 dark:border-gray-700 flex gap-4 bg-white dark:bg-[#111116]/50">
            <div className="relative flex-1">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500 pointer-events-none" />
              <input
                type="text"
                placeholder="Search menu..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="flex h-10 w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-[#111116] text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 pl-10 pr-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
              />
            </div>
          </div>

          <div className="p-4 border-b border-orange-100 dark:border-gray-700 flex gap-2 overflow-x-auto bg-white dark:bg-[#111116]/50">
            {categories.map((cat) => (
              <button
                key={cat.id}
                onClick={() => setSelectedCategory(cat.id)}
                className={`px-4 py-2 rounded-md text-sm font-medium whitespace-nowrap transition-colors ${
                  selectedCategory === cat.id
                    ? 'bg-orange-600 text-white dark:bg-orange-600 dark:text-white'
                    : 'bg-gray-100 dark:bg-[#111116] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-[#1a1a20]'
                }`}
              >
                {cat.name}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            {selectedCat && (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                {getFilteredItems().map((item) => (
                  <button
                    key={item.id}
                    onClick={() => handleAddItem(item)}
                    className="bg-white dark:bg-[#111116] border border-orange-100 dark:border-gray-700 rounded-lg p-4 text-left hover:border-orange-400 dark:hover:border-orange-500 hover:shadow-md transition-all"
                  >
                    <div className="aspect-square bg-gray-100 dark:bg-[#111116] rounded-md mb-3 flex items-center justify-center">
                      {item.image ? (
                        <img src={item.image} alt={item.name} className="w-full h-full object-cover rounded-md" />
                      ) : (
                        <span className="text-3xl">🍽️</span>
                      )}
                    </div>
                    <h3 className="font-medium text-gray-900 dark:text-gray-100 text-sm truncate">{item.name}</h3>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 line-clamp-2">{item.description}</p>
                    <p className="text-sm font-bold text-orange-600 dark:text-orange-400 mt-2">
                      KES {(item.sellingPrice ?? 0).toLocaleString()}
                    </p>
                  </button>
                ))}
                {getFilteredItems().length === 0 && (
                  <div className="col-span-full text-center py-8 text-gray-500 dark:text-gray-400">
                    No items found in this category
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right cart panel */}
        <div className="min-h-0 w-[min(100%,28rem)] shrink-0 border-l border-orange-100 dark:border-gray-700 flex flex-col bg-white dark:bg-[#111116]">
          <div className="p-4 border-b border-orange-100 dark:border-gray-700">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Current Order</h2>
            {selectedTable && (
              <div className="flex items-center gap-2 mt-1 text-sm text-gray-600 dark:text-gray-400">
                <TableIcon className="w-4 h-4" />
                Table {selectedTable.tableNumber}
              </div>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-4 space-y-3">
            {cart.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-8">No items in order</p>
            ) : (
              cart.map((item, index) => (
                <div key={item.id} className="bg-[#faf9f7] dark:bg-[#111116]/70 rounded-lg p-3">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <h4 className="text-sm font-medium text-gray-900 dark:text-gray-100">{item.itemNameSnapshot}</h4>
                      {item.modifiers.length > 0 && (
                        <div className="mt-1 space-y-1">
                          {item.modifiers.map((mod, i) => (
                            <div key={i} className="text-xs text-gray-600 dark:text-gray-400">
                              + {mod.optionNameSnapshot} (+KES {mod.priceAdjustment})
                            </div>
                          ))}
                        </div>
                      )}
                      {item.notes && (
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 italic">Note: {item.notes}</p>
                      )}
                      <div className="flex items-center gap-2 mt-2">
                        <button
                          onClick={() => updateCartQuantity(index, -1)}
                          className="w-6 h-6 rounded-full bg-gray-200 dark:bg-[#111116] flex items-center justify-center text-gray-600 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-[#1a1a20] transition-colors"
                        >
                          <Minus className="w-3 h-3" />
                        </button>
                        <span className="text-sm font-medium w-8 text-center text-gray-900 dark:text-gray-100">{item.quantity}</span>
                        <button
                          onClick={() => updateCartQuantity(index, 1)}
                          className="w-6 h-6 rounded-full bg-gray-200 dark:bg-[#111116] flex items-center justify-center text-gray-600 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-[#1a1a20] transition-colors"
                        >
                          <Plus className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                        KES {((item.unitPrice + item.modifiers.reduce((s, m) => s + m.priceAdjustment, 0)) * item.quantity).toLocaleString()}
                      </p>
                      <button
                        onClick={() => removeFromCart(index)}
                        className="text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 mt-1 transition-colors"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          {cart.length > 0 && (
            <>
            <div className="shrink-0 border-t border-orange-100 dark:border-gray-700 p-3 space-y-2">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Customer (optional)</label>
              <select
                value={selectedCustomerId}
                onChange={(e) => { setSelectedCustomerId(e.target.value); const c = customers.find((x) => x.id === e.target.value); setCustomerName(c?.name || ''); }}
                className="w-full rounded-md border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm bg-white dark:bg-[#111116] text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-orange-500"
              >
                <option value="">Walk-in customer</option>
                {customers.map((c) => <option key={c.id} value={c.id}>{c.name}{c.phone ? ` — ${c.phone}` : ''}</option>)}
              </select>
            </div>

            <div className="shrink-0 max-h-[38%] overflow-y-auto border-t border-orange-100 bg-white dark:border-gray-700 dark:bg-[#111116] p-4 space-y-3">
              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Discount / Promotion</label>
                <select value={selectedPromotionId} onChange={e=>{setSelectedPromotionId(e.target.value);if(e.target.value)setManualDiscount(0)}} className="w-full rounded-md border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm bg-white dark:bg-[#111116] text-gray-900 dark:text-gray-100">
                  <option value="">No promotion</option>{promotions.map(p=><option key={p.id} value={p.id}>{p.name} — {p.discountType==='PERCENTAGE'?`${p.value}%`:`KES ${p.value}`}{p.customerId?' — Customer offer':''}</option>)}
                </select>
                {!selectedPromotionId && <div className="grid grid-cols-2 gap-2"><select value={manualDiscountType} onChange={e=>setManualDiscountType(e.target.value as any)} className="rounded-md border px-2 py-2 text-sm bg-white dark:bg-[#111116]"><option value="FIXED">Fixed</option><option value="PERCENTAGE">Percent</option></select><input type="number" min="0" value={manualDiscount||''} onChange={e=>setManualDiscount(Number(e.target.value))} placeholder="0" className="rounded-md border px-3 py-2 text-sm bg-white dark:bg-[#111116]"/></div>}
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                <div className="flex justify-between"><span className="text-gray-600 dark:text-gray-400">Subtotal</span><span className="font-medium text-gray-900 dark:text-gray-100">KES {getPreviewTotals().subtotal.toLocaleString()}</span></div>
                <div className="flex justify-between text-sm"><span className="text-gray-600 dark:text-gray-400">Discount</span><span className="text-green-600 dark:text-green-400">- KES {getPreviewTotals().discount.toLocaleString()}</span></div>
                <div className="flex justify-between text-sm"><span className="text-gray-600 dark:text-gray-400">Tax</span><span className="text-gray-900 dark:text-gray-100">KES {getPreviewTotals().tax.toLocaleString()}</span></div>
                <div className="flex justify-between text-sm"><span className="text-gray-600 dark:text-gray-400">Service Charge</span><span className="text-gray-900 dark:text-gray-100">KES {getPreviewTotals().service.toLocaleString()}</span></div>
              </div>
              <div className="mt-2 flex justify-between rounded-lg bg-orange-50 px-3 py-2 text-lg font-bold text-gray-900 dark:bg-orange-500/10 dark:text-gray-100">
                <span>Total</span><span>KES {getPreviewTotals().total.toLocaleString()}</span>
              </div>
              <div className="flex gap-2">
                <Button variant="secondary" onClick={handleHoldOrder} disabled={submitting} className="flex-1">
                  Hold
                </Button>
                <Button variant="secondary" onClick={() => { setCart([]); setSelectedTable(null); }}>
                  Clear
                </Button>
              </div>
              <Button onClick={handleSubmitOrder} disabled={submitting} className="w-full">
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
            <p className="text-sm text-gray-600 dark:text-gray-400">KES {(selectedMenuItem.sellingPrice ?? 0).toLocaleString()}</p>
            {selectedMenuItem.modifierGroups.map((group) => (
              <div key={group.id}>
                <h4 className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">
                  {group.name}
                  {group.isRequired && <span className="text-red-500 dark:text-red-400 ml-1">*</span>}
                </h4>
                <div className="space-y-2">
                  {group.options.map((option) => {
                    const isSelected = selectedModifiers.some((m) => m.modifierOptionId === option.id);
                    return (
                      <label
                        key={option.id}
                        className={`flex items-center justify-between p-3 border rounded-md cursor-pointer transition-colors ${
                          isSelected
                            ? 'border-orange-500 bg-orange-50 dark:border-orange-500 dark:bg-orange-900/30'
                            : 'border-orange-100 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 dark:hover:bg-[#1a1a20]/30'
                        }`}
                      >
                        <div className="flex items-center gap-2">
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
                          <span className="text-sm text-gray-900 dark:text-gray-100">{option.name}</span>
                        </div>
                        {option.priceAdjustment > 0 && (
                          <span className="text-sm text-gray-600 dark:text-gray-400">+KES {option.priceAdjustment}</span>
                        )}
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Special Instructions</label>
              <textarea
                value={itemNotes}
                onChange={(e) => setItemNotes(e.target.value)}
                className="flex w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-[#111116] dark:text-gray-100 dark:placeholder-gray-500 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                rows={2}
                placeholder="Any special requests..."
              />
            </div>
            <div className="flex justify-end gap-3">
              <Button variant="secondary" onClick={() => { setShowModifierModal(false); setSelectedMenuItem(null); }}>Cancel</Button>
              <Button onClick={() => selectedMenuItem && addToCart(selectedMenuItem, selectedModifiers, itemNotes)}>Add to Order</Button>
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
                  className={`p-4 border rounded-lg text-left transition-colors ${
                    selectedTable?.id === table.id
                      ? 'border-orange-500 bg-orange-50 dark:border-orange-500 dark:bg-orange-900/30'
                      : table.selectable
                      ? 'border-orange-100 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 dark:hover:bg-[#1a1a20]/30'
                      : 'border-gray-100 dark:border-gray-800 bg-[#faf9f7] dark:bg-[#111116]/50 opacity-50 cursor-not-allowed'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-gray-900 dark:text-gray-100">{table.tableNumber}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">{table.capacity} seats</p>
                      <p className="text-xs text-gray-400 dark:text-gray-500">{table.sectionName}</p>
                    </div>
                    <Badge variant={table.status === 'AVAILABLE' ? 'success' : table.status === 'OCCUPIED' ? 'danger' : 'warning'}>
                      {table.status}
                    </Badge>
                  </div>
                </button>
              ))}
            </div>
            <div className="flex justify-end">
              <Button variant="secondary" onClick={() => setShowTableModal(false)}>Cancel</Button>
            </div>
          </div>
        </Modal>
      )}

      {showOrderTypeModal && (
        <Modal title="Order Type" onClose={() => setShowOrderTypeModal(false)}>
          <div className="space-y-3">
            {ORDER_TYPES.map((type) => (
              <button
                key={type.value}
                onClick={() => { setOrderType(type.value); setShowOrderTypeModal(false); if (type.value !== 'DINE_IN') setSelectedTable(null); }}
                className={`w-full p-4 border rounded-lg text-left transition-colors ${
                  orderType === type.value
                    ? 'border-orange-500 bg-orange-50 dark:border-orange-500 dark:bg-orange-900/30'
                    : 'border-orange-100 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 dark:hover:bg-[#1a1a20]/30'
                }`}
              >
                <p className="font-medium text-gray-900 dark:text-gray-100">{type.label}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">{type.requiresTable ? 'Requires table selection' : 'No table required'}</p>
              </button>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}
