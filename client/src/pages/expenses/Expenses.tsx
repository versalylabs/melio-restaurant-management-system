import { useEffect, useState } from 'react';
import { Check, Edit3, Plus, RefreshCw, Search, Trash2, X } from 'lucide-react';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import Badge from '../../components/ui/Badge';
import Modal from '../../components/ui/Modal';
import Input from '../../components/ui/Input';
import { expenseApi } from '../../services/api';

const money = (n: number) => `KES ${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const blank = { category: 'Utilities', description: '', amount: '', paymentMethod: 'CASH', expenseDate: new Date().toISOString().slice(0, 10), vendor: '', reference: '', notes: '' };

export default function Expenses() {
  const [expenses, setExpenses] = useState<any[]>([]);
  const [totals, setTotals] = useState({ approved: 0, pending: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState<any>(blank);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');

  const load = async () => {
    try {
      setLoading(true); setError('');
      const r = await expenseApi.getExpenses({ search, status });
      setExpenses(r.data.data?.expenses || []);
      setTotals(r.data.data?.totals || { approved: 0, pending: 0 });
    } catch (e: any) { setError(e.response?.data?.message || 'Failed to load expenses'); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [search, status]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const data = { ...form, amount: Number(form.amount) };
      if (editing) await expenseApi.update(editing.id, data); else await expenseApi.create(data);
      setModal(false); setEditing(null); setForm({ ...blank }); await load();
    } catch (e: any) { setError(e.response?.data?.message || 'Failed to save expense'); }
  };
  const changeStatus = async (id: string, next: string) => {
    try { await expenseApi.setStatus(id, next); await load(); }
    catch (e: any) { setError(e.response?.data?.message || 'Failed to update expense'); }
  };
  const remove = async (id: string) => {
    if (!confirm('Delete this pending expense?')) return;
    try { await expenseApi.remove(id); await load(); }
    catch (e: any) { setError(e.response?.data?.message || 'Failed to delete expense'); }
  };
  const openEdit = (e: any) => {
    setEditing(e);
    setForm({ category: e.category, description: e.description, amount: String(e.amount), paymentMethod: e.paymentMethod, expenseDate: e.expenseDate?.slice(0, 10) || blank.expenseDate, vendor: e.vendor || '', reference: e.reference || '', notes: e.notes || '' });
    setModal(true);
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div><h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Expenses</h1><p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Record and control restaurant operating expenses.</p></div>
        <div className="flex gap-2"><Button variant="secondary" onClick={load}><RefreshCw className="w-4 h-4 mr-2" />Refresh</Button><Button onClick={() => { setEditing(null); setForm({ ...blank }); setModal(true); }}><Plus className="w-4 h-4 mr-2" />Add Expense</Button></div>
      </div>
      {error && <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 px-4 py-3 text-sm">{error}</div>}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4"><Card><p className="text-xs uppercase text-gray-500">Approved expenses</p><p className="text-2xl font-bold mt-2">{money(totals.approved)}</p></Card><Card><p className="text-xs uppercase text-gray-500">Pending approval</p><p className="text-2xl font-bold mt-2">{money(totals.pending)}</p></Card><Card><p className="text-xs uppercase text-gray-500">Records</p><p className="text-2xl font-bold mt-2">{expenses.length}</p></Card></div>
      <Card>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-5"><div className="relative"><Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" /><input placeholder="Search description, vendor, reference" value={search} onChange={e => setSearch(e.target.value)} className="h-10 w-full pl-10 pr-4 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-[#111116] text-sm" /></div><select value={status} onChange={e => setStatus(e.target.value)} className="h-10 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-[#111116] px-3 text-sm"><option value="">All statuses</option><option value="PENDING">Pending</option><option value="APPROVED">Approved</option><option value="REJECTED">Rejected</option></select></div>
        {loading ? <div className="py-10 text-center text-gray-500">Loading expenses...</div> : <div className="overflow-x-auto"><table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700"><thead><tr>{['Date','Category','Description','Vendor','Method','Amount','Status','Recorded by','Actions'].map(h => <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">{h}</th>)}</tr></thead><tbody className="divide-y divide-gray-200 dark:divide-gray-700">
          {expenses.map(e => <tr key={e.id}><td className="px-4 py-3 text-sm">{new Date(e.expenseDate).toLocaleDateString()}</td><td className="px-4 py-3 text-sm font-medium">{e.category}</td><td className="px-4 py-3 text-sm">{e.description}<div className="text-xs text-gray-400">{e.reference || ''}</div></td><td className="px-4 py-3 text-sm text-gray-500">{e.vendor || '—'}</td><td className="px-4 py-3 text-sm">{e.paymentMethod.replace('_', ' ')}</td><td className="px-4 py-3 text-sm font-semibold">{money(e.amount)}</td><td className="px-4 py-3"><Badge variant={e.status === 'APPROVED' ? 'success' : e.status === 'REJECTED' ? 'danger' : 'warning'}>{e.status}</Badge></td><td className="px-4 py-3 text-sm text-gray-500">{e.creatorName}</td><td className="px-4 py-3 whitespace-nowrap">{e.status === 'PENDING' && <><button title="Approve" onClick={() => changeStatus(e.id, 'APPROVED')} className="text-green-600 mr-3"><Check className="w-4 h-4" /></button><button title="Reject" onClick={() => changeStatus(e.id, 'REJECTED')} className="text-red-600 mr-3"><X className="w-4 h-4" /></button><button title="Edit" onClick={() => openEdit(e)} className="text-orange-600 mr-3"><Edit3 className="w-4 h-4" /></button><button title="Delete" onClick={() => remove(e.id)} className="text-red-600"><Trash2 className="w-4 h-4" /></button></>}</td></tr>)}
          {!expenses.length && <tr><td colSpan={9} className="py-10 text-center text-sm text-gray-500">No expenses found.</td></tr>}
        </tbody></table></div>}
      </Card>
      {modal && <Modal title={editing ? 'Edit Expense' : 'Record Expense'} onClose={() => setModal(false)}><form onSubmit={save} className="space-y-4">
        <div className="grid grid-cols-2 gap-4"><label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Category<select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} className="mt-1 h-10 w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-[#111116] px-3"><option>Utilities</option><option>Rent</option><option>Supplies</option><option>Transport</option><option>Maintenance</option><option>Marketing</option><option>Payroll</option><option>Other</option></select></label><Input id="amount" type="number" min="0.01" step="0.01" label="Amount (KES)" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} required /></div>
        <Input id="description" label="Description" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} required />
        <div className="grid grid-cols-2 gap-4"><Input id="vendor" label="Vendor / Payee" value={form.vendor} onChange={e => setForm({ ...form, vendor: e.target.value })} /><Input id="reference" label="Reference / Receipt No." value={form.reference} onChange={e => setForm({ ...form, reference: e.target.value })} /></div>
        <div className="grid grid-cols-2 gap-4"><Input id="expenseDate" type="date" label="Expense Date" value={form.expenseDate} onChange={e => setForm({ ...form, expenseDate: e.target.value })} /><label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Payment Method<select value={form.paymentMethod} onChange={e => setForm({ ...form, paymentMethod: e.target.value })} className="mt-1 h-10 w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-[#111116] px-3"><option value="CASH">Cash</option><option value="CARD">Card</option><option value="MOBILE_MONEY">Mobile Money</option><option value="BANK">Bank Transfer</option></select></label></div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Notes<textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} className="mt-1 w-full min-h-20 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-[#111116] px-3 py-2" /></label>
        <p className="text-xs text-gray-500">New expenses are pending until approved. Approved cash expenses are included in shift reconciliation.</p>
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setModal(false)}>Cancel</Button><Button type="submit">{editing ? 'Save Changes' : 'Record Expense'}</Button></div>
      </form></Modal>}
    </div>
  );
}
