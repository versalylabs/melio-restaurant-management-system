import { useState, useEffect } from 'react';
import { Search, Eye, Trash2, CreditCard, Printer } from 'lucide-react';
import { orderApi, paymentApi } from '../../services/api';
import type { Sale } from '../../types';
import Card from '../../components/ui/Card';
import Badge from '../../components/ui/Badge';
import Modal from '../../components/ui/Modal';
import { useAuth } from '../../contexts/AuthContext';
import { getActiveBranchId, listenForBranchChanges } from '../../utils/branch';

export default function Orders() {
  const { user } = useAuth();
  const [orders, setOrders] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterType, setFilterType] = useState('');
  const [selectedOrder, setSelectedOrder] = useState<Sale | null>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [paymentOrder, setPaymentOrder] = useState<Sale | null>(null);
  const [paymentMethod, setPaymentMethod] = useState('CASH');
  const [paymentAmount, setPaymentAmount] = useState('');
  const [tendered, setTendered] = useState('');
  const [paymentBusy, setPaymentBusy] = useState(false);

  const fetchOrders = async () => {
    try {
      const activeBranchId = getActiveBranchId(user);
      const params: any = { page: page.toString(), limit: '20', ...(activeBranchId ? { branchId: activeBranchId } : {}) };
      if (search) params.search = search;
      if (filterStatus) params.status = filterStatus;
      if (filterType) params.orderType = filterType;
      const response = await orderApi.getOrders(params);
      if (response.data.success) {
        setOrders(response.data.data?.orders || []);
        setTotalPages(response.data.data?.pagination?.totalPages || 1);
      }
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to load orders');
    } finally {
      setLoading(false);
    }
  };


  const openPayment = (order: Sale) => {
    setPaymentOrder(order);
    setPaymentAmount(Math.max(0, order.totalAmount - (order.amountPaid || 0)).toFixed(2));
    setTendered(Math.max(0, order.totalAmount - (order.amountPaid || 0)).toFixed(2));
    setPaymentMethod('CASH');
  };

  const handlePayment = async () => {
    if (!paymentOrder) return;
    try {
      setPaymentBusy(true);
      const response = await paymentApi.recordPayment(paymentOrder.id, { method: paymentMethod, amount: Number(paymentAmount), amountTendered: Number(tendered) });
      const state = response.data?.data;
      if (state?.paymentStatus) {
        setOrders((current) => current.map((order) => order.id === paymentOrder.id ? { ...order, paymentStatus: state.paymentStatus, amountPaid: state.paid } : order));
      }
      setPaymentOrder(null);
      await fetchOrders();
    } catch (err: any) { setError(err.response?.data?.message || 'Failed to record payment'); }
    finally { setPaymentBusy(false); }
  };

  const handleReceipt = async (order: Sale) => {
    try {
      const response = await paymentApi.getReceipt(order.id);
      const data = response.data.data;
      const sale = data.sale;
      const receipt = data.receipt;
      const rows = sale.items.map((i: any) => `<tr><td>${i.quantity}x ${i.itemNameSnapshot}</td><td style="text-align:right">KES ${(i.subtotal || 0).toLocaleString()}</td></tr>`).join('');
      const payments = sale.payments.map((p: any) => `<div>${p.method}: KES ${p.amount.toLocaleString()}</div>`).join('');
      const w = window.open('', '_blank', 'width=420,height=700');
      if (!w) return;
      w.document.write(`<html><head><title>${receipt.receiptNumber}</title><style>body{font-family:Arial;padding:24px;max-width:380px;margin:auto}table{width:100%;border-collapse:collapse}td{padding:6px 0}.total{font-size:18px;font-weight:700;border-top:1px solid #ccc;padding-top:10px}</style></head><body><h2 style="text-align:center">${sale.branch.name}</h2><p style="text-align:center">Receipt ${receipt.receiptNumber}<br>Order ${sale.orderNumber}<br>${new Date(receipt.issuedAt).toLocaleString()}</p><table>${rows}</table><p class="total">Total: KES ${sale.totalAmount.toLocaleString()}</p><p>${payments}</p><p style="text-align:center">Thank you for dining with us.</p><script>window.print();</script></body></html>`);
      w.document.close();
    } catch (err: any) { setError(err.response?.data?.message || 'Failed to generate receipt'); }
  };

  useEffect(() => {
    fetchOrders();
    return listenForBranchChanges(fetchOrders);
  }, [page, search, filterStatus, filterType, user?.id]);

  const handleViewOrder = async (order: Sale) => {
    try {
      const response = await orderApi.getOrder(order.id);
      if (response.data.success) {
        setSelectedOrder(response.data.data);
        setShowDetailModal(true);
      }
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to load order details');
    }
  };

  const handleCancelOrder = async (order: Sale) => {
    const reason = prompt('Enter cancellation reason:');
    if (!reason) return;
    try {
      await orderApi.cancelOrder(order.id, { cancelReason: reason });
      fetchOrders();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to cancel order');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-gray-500 dark:text-gray-400">Loading orders...</div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Orders</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Manage restaurant orders</p>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 px-4 py-3 rounded-md text-sm">
          {error}
        </div>
      )}

      <Card>
        <div className="mb-4 flex flex-col sm:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500 pointer-events-none" />
            <input
              type="text"
              placeholder="Search orders..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex h-10 w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-[#111116] pl-10 pr-4 py-2 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500"
            />
          </div>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="flex h-10 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-[#111116] px-3 py-2 text-sm text-gray-900 dark:text-gray-100"
          >
            <option value="">All Status</option>
            <option value="DRAFT">Draft</option>
            <option value="HELD">Held</option>
            <option value="SUBMITTED">Submitted</option>
            <option value="PREPARING">Preparing</option>
            <option value="READY">Ready</option>
            <option value="SERVED">Served</option>
            <option value="COMPLETED">Completed</option>
            <option value="CANCELLED">Cancelled</option>
          </select>
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="flex h-10 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-[#111116] px-3 py-2 text-sm text-gray-900 dark:text-gray-100"
          >
            <option value="">All Types</option>
            <option value="DINE_IN">Dine In</option>
            <option value="TAKEAWAY">Takeaway</option>
            <option value="DELIVERY">Delivery</option>
          </select>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-[#faf9f7] dark:bg-[#111116]/70">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Order</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Type</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Table</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Branch</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Status</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Payment</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Total</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-[#111116] divide-y divide-gray-200 dark:divide-gray-700">
              {orders.map((order) => (
                <tr key={order.id} className="hover:bg-[#faf9f7] dark:hover:bg-[#1a1a20]/30">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div>
                      <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{order.orderNumber}</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">{new Date(order.createdAt).toLocaleString()}</div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">{order.orderType}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">{order.tableNumber || '-'}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">{order.branchName}</td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <Badge variant={order.status === 'COMPLETED' ? 'success' : order.status === 'CANCELLED' ? 'danger' : 'warning'}>
                      {order.status}
                    </Badge>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <Badge variant={order.paymentStatus === 'PAID' ? 'success' : order.paymentStatus === 'PARTIAL' ? 'warning' : 'danger'}>
                      {order.paymentStatus || 'UNPAID'}
                    </Badge>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-gray-100">
                    KES {order.totalAmount.toLocaleString()}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <button
                      onClick={() => handleViewOrder(order)}
                      className="text-orange-600 hover:text-orange-900 dark:text-orange-400 dark:hover:text-orange-300 mr-3"
                    >
                      <Eye className="w-4 h-4" />
                    </button>
                    {order.paymentStatus !== 'PAID' && order.status !== 'CANCELLED' && (
                      <button onClick={() => openPayment(order)} className="text-green-600 hover:text-green-900 dark:text-green-400 mr-3" title="Record payment">
                        <CreditCard className="w-4 h-4" />
                      </button>
                    )}
                    {order.paymentStatus === 'PAID' && (
                      <button onClick={() => handleReceipt(order)} className="text-gray-600 hover:text-gray-900 dark:text-gray-300 mr-3" title="Print receipt">
                        <Printer className="w-4 h-4" />
                      </button>
                    )}
                    {['DRAFT', 'HELD', 'SUBMITTED'].includes(order.status) && (
                      <button onClick={() => handleCancelOrder(order)} className="text-red-600 hover:text-red-900 dark:text-red-400 dark:hover:text-red-300">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {orders.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-6 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
                    No orders found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="mt-4 flex items-center justify-between">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-sm text-gray-700 dark:text-gray-300 hover:bg-[#faf9f7] dark:hover:bg-[#1a1a20]/50 disabled:opacity-50"
            >
              Previous
            </button>
            <span className="text-sm text-gray-600 dark:text-gray-400">Page {page} of {totalPages}</span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-sm text-gray-700 dark:text-gray-300 hover:bg-[#faf9f7] dark:hover:bg-[#1a1a20]/50 disabled:opacity-50"
            >
              Next
            </button>
          </div>
        )}
      </Card>

      {showDetailModal && selectedOrder && (
        <Modal title={`Order ${selectedOrder.orderNumber}`} onClose={() => { setShowDetailModal(false); setSelectedOrder(null); }}>
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400 uppercase">Order Type</p>
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{selectedOrder.orderType}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400 uppercase">Payment</p>
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{selectedOrder.paymentStatus} · KES {(selectedOrder.amountPaid || 0).toLocaleString()} paid</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400 uppercase">Status</p>
                <Badge variant={selectedOrder.status === 'COMPLETED' ? 'success' : selectedOrder.status === 'CANCELLED' ? 'danger' : 'warning'}>
                  {selectedOrder.status}
                </Badge>
              </div>
              {selectedOrder.tableNumber && (
                <div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 uppercase">Table</p>
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{selectedOrder.tableNumber}</p>
                </div>
              )}
              {selectedOrder.customerName && (
                <div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 uppercase">Customer</p>
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{selectedOrder.customerName}</p>
                </div>
              )}
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400 uppercase">Branch</p>
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{selectedOrder.branchName}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400 uppercase">Created</p>
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{new Date(selectedOrder.createdAt).toLocaleString()}</p>
              </div>
            </div>

            <div>
              <h4 className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-3">Items</h4>
              <div className="space-y-3">
                {selectedOrder.items.map((item) => (
                  <div key={item.id} className="border-b border-gray-100 dark:border-gray-700 pb-3 last:border-0">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                          {item.quantity}x {item.itemNameSnapshot}
                        </p>
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
                      </div>
                      <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                        KES {(item.unitPrice * item.quantity + item.modifiers.reduce((s, m) => s + m.priceAdjustment * item.quantity, 0)).toLocaleString()}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="border-t border-orange-100 dark:border-gray-700 pt-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-gray-600 dark:text-gray-400">Subtotal</span>
                <span className="font-medium text-gray-900 dark:text-gray-100">KES {selectedOrder.subtotal.toLocaleString()}</span>
              </div>
              {selectedOrder.discountAmount > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600 dark:text-gray-400">Discount{selectedOrder.discountReason ? ` (${selectedOrder.discountReason})` : ''}</span>
                  <span className="font-medium text-red-600 dark:text-red-400">-KES {selectedOrder.discountAmount.toLocaleString()}</span>
                </div>
              )}
              <div className="flex justify-between text-sm">
                <span className="text-gray-600 dark:text-gray-400">Tax</span>
                <span className="font-medium text-gray-900 dark:text-gray-100">KES {selectedOrder.taxAmount.toLocaleString()}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-600 dark:text-gray-400">Service Charge</span>
                <span className="font-medium text-gray-900 dark:text-gray-100">KES {selectedOrder.serviceChargeAmount.toLocaleString()}</span>
              </div>
              <div className="flex justify-between text-lg font-bold text-gray-900 dark:text-gray-100">
                <span>Total</span>
                <span>KES {selectedOrder.totalAmount.toLocaleString()}</span>
              </div>
            </div>

            {selectedOrder.notes && (
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400 uppercase">Order Notes</p>
                <p className="text-sm text-gray-700 dark:text-gray-300 mt-1">{selectedOrder.notes}</p>
              </div>
            )}

            {selectedOrder.statusHistory && selectedOrder.statusHistory.length > 0 && (
              <div>
                <h4 className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">Status History</h4>
                <div className="space-y-2">
                  {selectedOrder.statusHistory.map((history) => (
                    <div key={history.id} className="flex items-center justify-between text-sm">
                      <div>
                        <Badge variant={history.status === 'COMPLETED' ? 'success' : history.status === 'CANCELLED' ? 'danger' : 'warning'}>
                          {history.status}
                        </Badge>
                        {history.notes && <span className="ml-2 text-gray-600 dark:text-gray-400">{history.notes}</span>}
                      </div>
                      <span className="text-xs text-gray-400 dark:text-gray-500">{new Date(history.createdAt).toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </Modal>
      )}

      {paymentOrder && (
        <Modal title={`Payment — ${paymentOrder.orderNumber}`} onClose={() => setPaymentOrder(null)}>
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-4">
              <div><p className="text-xs text-gray-500 dark:text-gray-400">ORDER TOTAL</p><p className="text-lg font-semibold">KES {paymentOrder.totalAmount.toLocaleString()}</p></div>
              <div><p className="text-xs text-gray-500 dark:text-gray-400">REMAINING</p><p className="text-lg font-semibold">KES {Math.max(0, paymentOrder.totalAmount - (paymentOrder.amountPaid || 0)).toLocaleString()}</p></div>
            </div>
            <label className="block text-sm font-medium">Payment method<select value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)} className="mt-1 w-full h-10 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-[#111116] px-3 text-sm"><option value="CASH">Cash</option><option value="CARD">Card</option><option value="MOBILE_MONEY">Mobile Money</option></select></label>
            <label className="block text-sm font-medium">Amount<input type="number" min="0.01" step="0.01" value={paymentAmount} onChange={e => setPaymentAmount(e.target.value)} className="mt-1 w-full h-10 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-[#111116] px-3 text-sm" /></label>
            <label className="block text-sm font-medium">Amount tendered{paymentMethod === 'CASH' ? <input type="number" min="0" step="0.01" value={tendered} onChange={e => setTendered(e.target.value)} className="mt-1 w-full h-10 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-[#111116] px-3 text-sm" /> : <div className="mt-1 text-sm text-gray-500">Not applicable for this method</div>}</label>
            {paymentMethod === 'CASH' && <div className="text-sm text-gray-600 dark:text-gray-300">Change: <strong>KES {Math.max(0, Number(tendered || 0) - Number(paymentAmount || 0)).toLocaleString()}</strong></div>}
            <button disabled={paymentBusy} onClick={handlePayment} className="w-full h-10 rounded-md bg-orange-600 hover:bg-orange-700 text-white text-sm font-medium disabled:opacity-50">{paymentBusy ? 'Processing...' : 'Record Payment'}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
