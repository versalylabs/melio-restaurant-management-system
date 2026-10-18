import { useEffect, useState } from 'react';
import { Plus, Edit, Trash2, Tag, CheckCircle2, AlertCircle, RefreshCw } from 'lucide-react';
import { promotionApi, menuItemApi, customerApi, branchApi } from '../../services/api';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import Card from '../../components/ui/Card';
import Badge from '../../components/ui/Badge';

const empty = {
  name: '',
  code: '',
  description: '',
  discountType: 'PERCENTAGE',
  value: 10,
  scope: 'ORDER',
  menuItemId: '',
  customerId: '',
  branchId: '',
  minSubtotal: 0,
  maxDiscountAmount: '',
  startsAt: '',
  endsAt: '',
  startTime: '',
  endTime: '',
  happyHour: false,
  active: true,
};

export default function Promotions() {
  const [promotions, setPromotions] = useState<any[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [branches, setBranches] = useState<any[]>([]);
  const [form, setForm] = useState<any>(empty);
  const [editing, setEditing] = useState<any>(null);
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [modalError, setModalError] = useState('');
  const [success, setSuccess] = useState('');

  const load = async () => {
    try {
      setError('');
      const [p, i, c, b] = await Promise.all([
        promotionApi.getPromotions(),
        menuItemApi.getMenuItems({ limit: 500 }),
        customerApi.getCustomers({ status: 'ACTIVE', limit: 500 }),
        branchApi.getBranches(),
      ]);
      setPromotions(p.data?.data?.promotions || p.data?.promotions || []);
      setItems(i.data?.data?.items || i.data?.data?.menuItems || i.data?.items || []);
      setCustomers(c.data?.data?.customers || c.data?.customers || (Array.isArray(c.data?.data) ? c.data.data : []));
      setBranches(b.data?.data?.branches || (Array.isArray(b.data?.data) ? b.data.data : []));
    } catch (e: any) {
      setError(e.response?.data?.message || 'Failed to load promotions');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const open = (p?: any) => {
    setEditing(p || null);
    setForm(
      p
        ? {
            ...empty,
            ...p,
            startsAt: p.startsAt ? p.startsAt.slice(0, 16) : '',
            endsAt: p.endsAt ? p.endsAt.slice(0, 16) : '',
            maxDiscountAmount: p.maxDiscountAmount ?? '',
            menuItemId: p.menuItemId || '',
            customerId: p.customerId || '',
            branchId: p.branchId || '',
          }
        : { ...empty }
    );
    setModalError('');
    setShow(true);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setModalError('');
    setError('');
    setSuccess('');
    setSaving(true);
    try {
      const data = {
        ...form,
        value: Number(form.value),
        minSubtotal: Number(form.minSubtotal || 0),
        maxDiscountAmount: form.maxDiscountAmount === '' ? null : Number(form.maxDiscountAmount || 0),
        menuItemId: form.scope === 'PRODUCT' ? (form.menuItemId || null) : null,
        customerId: form.customerId || null,
        branchId: form.branchId || null,
        startsAt: form.startsAt || null,
        endsAt: form.endsAt || null,
        startTime: form.startTime || null,
        endTime: form.endTime || null,
      };
      if (editing) {
        await promotionApi.update(editing.id, data);
        setSuccess(`Promotion "${data.name}" updated successfully.`);
      } else {
        await promotionApi.create(data);
        setSuccess(`Promotion "${data.name}" created successfully.`);
      }
      setShow(false);
      await load();
    } catch (e: any) {
      setModalError(e.response?.data?.message || 'Failed to save promotion');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string, name: string) => {
    if (!confirm(`Delete promotion "${name}"?`)) return;
    setDeletingId(id);
    setError('');
    setSuccess('');
    try {
      await promotionApi.remove(id);
      setSuccess(`Promotion "${name}" deleted.`);
      await load();
    } catch (e: any) {
      setError(e.response?.data?.message || 'Failed to delete promotion');
    } finally {
      setDeletingId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center text-gray-500 dark:text-gray-400">
        <div className="flex items-center gap-2">
          <RefreshCw className="w-5 h-5 animate-spin text-orange-500" />
          <span>Loading promotions...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <Tag className="w-6 h-6 text-orange-500" />
            Discounts & Promotions
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Manage discounts, happy-hour pricing, and targeted customer offers.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={load} className="gap-2">
            <RefreshCw className="w-4 h-4" />
            Refresh
          </Button>
          <Button onClick={() => open()} className="gap-2">
            <Plus className="w-4 h-4" />
            New Promotion
          </Button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 px-4 py-3 rounded-md text-sm flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {success && (
        <div className="bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800 text-green-700 dark:text-green-400 px-4 py-3 rounded-md text-sm flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{success}</span>
        </div>
      )}

      <Card>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-[#faf9f7] dark:bg-[#111116]/70">
              <tr>
                {['Promotion', 'Type', 'Scope', 'Target', 'Schedule', 'Status', 'Actions'].map((h) => (
                  <th key={h} className="px-5 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-[#111116] divide-y divide-gray-200 dark:divide-gray-700">
              {promotions.map((p) => (
                <tr key={p.id} className="hover:bg-[#faf9f7] dark:hover:bg-[#1a1a20]/30 transition-colors">
                  <td className="px-5 py-4">
                    <div className="font-medium text-gray-900 dark:text-gray-100">{p.name}</div>
                    {p.code && <div className="text-xs text-orange-600 font-mono mt-0.5">Code: {p.code}</div>}
                    {p.description && <div className="text-xs text-gray-500 mt-0.5">{p.description}</div>}
                  </td>
                  <td className="px-5 py-4 text-sm font-semibold text-gray-900 dark:text-gray-100">
                    {p.discountType === 'PERCENTAGE' ? `${p.value}%` : `KES ${Number(p.value).toLocaleString()}`}
                  </td>
                  <td className="px-5 py-4 text-sm">
                    <Badge variant={p.scope === 'PRODUCT' ? 'info' : 'default'}>{p.scope}</Badge>
                  </td>
                  <td className="px-5 py-4 text-sm text-gray-600 dark:text-gray-300">
                    {p.menuItem?.name || p.customer?.name || 'Entire order'}
                  </td>
                  <td className="px-5 py-4 text-xs text-gray-500 dark:text-gray-400">
                    {p.happyHour ? (
                      <span className="font-semibold text-amber-600 dark:text-amber-400">Happy hour</span>
                    ) : p.startTime ? (
                      `${p.startTime} – ${p.endTime}`
                    ) : (
                      'Any time'
                    )}
                  </td>
                  <td className="px-5 py-4">
                    <Badge variant={p.active ? 'success' : 'warning'}>{p.active ? 'ACTIVE' : 'INACTIVE'}</Badge>
                  </td>
                  <td className="px-5 py-4 whitespace-nowrap text-sm">
                    <button
                      onClick={() => open(p)}
                      className="text-orange-600 hover:text-orange-900 dark:text-orange-400 dark:hover:text-orange-300 mr-3 inline-flex items-center gap-1"
                      title="Edit promotion"
                    >
                      <Edit className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => remove(p.id, p.name)}
                      disabled={deletingId === p.id}
                      className="text-red-600 hover:text-red-900 dark:text-red-400 dark:hover:text-red-300 inline-flex items-center gap-1 disabled:opacity-50"
                      title="Delete promotion"
                    >
                      {deletingId === p.id ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                    </button>
                  </td>
                </tr>
              ))}
              {promotions.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center">
                    <Tag className="w-10 h-10 mx-auto text-gray-400 mb-3 opacity-60" />
                    <p className="text-base font-semibold text-gray-900 dark:text-gray-100">No promotions found</p>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 mb-4">
                      Create percentage discounts, happy hours, or customer-specific offers.
                    </p>
                    <Button onClick={() => open()} className="gap-2 inline-flex">
                      <Plus className="w-4 h-4" />
                      Create Promotion
                    </Button>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {show && (
        <div className="fixed inset-0 bg-black/50 dark:bg-black/70 flex items-center justify-center z-50 p-4">
          <Card title={editing ? 'Edit Promotion' : 'Create Promotion'} className="w-full max-w-3xl max-h-[92vh] overflow-y-auto">
            {modalError && (
              <div className="mb-4 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 px-4 py-3 rounded-md text-sm flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{modalError}</span>
              </div>
            )}
            <form onSubmit={save} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Input
                  id="name"
                  label="Promotion Name"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g. Lunch Special 10% Off"
                  required
                />
                <Input
                  id="code"
                  label="Promo Code (optional)"
                  value={form.code}
                  onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                  placeholder="e.g. LUNCH10"
                />
              </div>

              <Input
                id="description"
                label="Description"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Brief explanation of the offer"
              />

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Discount Type</label>
                  <select
                    value={form.discountType}
                    onChange={(e) => setForm({ ...form, discountType: e.target.value })}
                    className="h-10 w-full rounded-md border border-gray-300 dark:border-gray-600 px-3 bg-white dark:bg-[#111116] text-gray-900 dark:text-gray-100 text-sm"
                  >
                    <option value="PERCENTAGE">Percentage (%)</option>
                    <option value="FIXED">Fixed Amount (KES)</option>
                  </select>
                </div>
                <Input
                  id="value"
                  type="number"
                  min="0"
                  step="0.01"
                  label={form.discountType === 'PERCENTAGE' ? 'Discount (%)' : 'Discount Amount (KES)'}
                  value={form.value}
                  onChange={(e) => setForm({ ...form, value: e.target.value })}
                  required
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Scope</label>
                  <select
                    value={form.scope}
                    onChange={(e) => setForm({ ...form, scope: e.target.value })}
                    className="h-10 w-full rounded-md border border-gray-300 dark:border-gray-600 px-3 bg-white dark:bg-[#111116] text-gray-900 dark:text-gray-100 text-sm"
                  >
                    <option value="ORDER">Entire Order</option>
                    <option value="PRODUCT">Specific Product</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Branch</label>
                  <select
                    value={form.branchId}
                    onChange={(e) => setForm({ ...form, branchId: e.target.value })}
                    className="h-10 w-full rounded-md border border-gray-300 dark:border-gray-600 px-3 bg-white dark:bg-[#111116] text-gray-900 dark:text-gray-100 text-sm"
                  >
                    <option value="">All branches</option>
                    {branches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {form.scope === 'PRODUCT' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Menu Item (Product)</label>
                  <select
                    required
                    value={form.menuItemId}
                    onChange={(e) => setForm({ ...form, menuItemId: e.target.value })}
                    className="h-10 w-full rounded-md border border-gray-300 dark:border-gray-600 px-3 bg-white dark:bg-[#111116] text-gray-900 dark:text-gray-100 text-sm"
                  >
                    <option value="">Select menu item</option>
                    {items.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.name} {i.sellingPrice ? `(KES ${Number(i.sellingPrice).toLocaleString()})` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Customer (optional)</label>
                <select
                  value={form.customerId}
                  onChange={(e) => setForm({ ...form, customerId: e.target.value })}
                  className="h-10 w-full rounded-md border border-gray-300 dark:border-gray-600 px-3 bg-white dark:bg-[#111116] text-gray-900 dark:text-gray-100 text-sm"
                >
                  <option value="">All customers</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                      {c.phone ? ` — ${c.phone}` : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Input
                  id="min"
                  type="number"
                  min="0"
                  step="0.01"
                  label="Minimum Subtotal (KES)"
                  value={form.minSubtotal}
                  onChange={(e) => setForm({ ...form, minSubtotal: e.target.value })}
                />
                <Input
                  id="max"
                  type="number"
                  min="0"
                  step="0.01"
                  label="Maximum Discount Amount (KES)"
                  value={form.maxDiscountAmount}
                  onChange={(e) => setForm({ ...form, maxDiscountAmount: e.target.value })}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Input
                  id="starts"
                  type="datetime-local"
                  label="Starts At"
                  value={form.startsAt}
                  onChange={(e) => setForm({ ...form, startsAt: e.target.value })}
                />
                <Input
                  id="ends"
                  type="datetime-local"
                  label="Ends At"
                  value={form.endsAt}
                  onChange={(e) => setForm({ ...form, endsAt: e.target.value })}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Input
                  id="startTime"
                  type="time"
                  label="Daily Start Time"
                  value={form.startTime}
                  onChange={(e) => setForm({ ...form, startTime: e.target.value })}
                />
                <Input
                  id="endTime"
                  type="time"
                  label="Daily End Time"
                  value={form.endTime}
                  onChange={(e) => setForm({ ...form, endTime: e.target.value })}
                />
              </div>

              <div className="flex flex-col sm:flex-row gap-4 pt-2">
                <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.happyHour}
                    onChange={(e) => setForm({ ...form, happyHour: e.target.checked })}
                    className="rounded border-gray-300 text-orange-600 focus:ring-orange-500"
                  />
                  Happy-hour promotion
                </label>
                <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.active}
                    onChange={(e) => setForm({ ...form, active: e.target.checked })}
                    className="rounded border-gray-300 text-orange-600 focus:ring-orange-500"
                  />
                  Active
                </label>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-gray-100 dark:border-gray-700">
                <Button type="button" variant="secondary" onClick={() => setShow(false)}>
                  Cancel
                </Button>
                <Button type="submit" loading={saving} disabled={saving}>
                  {saving ? 'Saving...' : editing ? 'Save Changes' : 'Create Promotion'}
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}
    </div>
  );
}
