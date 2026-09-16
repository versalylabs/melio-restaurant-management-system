import { useEffect, useState } from 'react';
import { ChevronRight, Search } from 'lucide-react';
import { customerApi } from '../../services/api';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';

const emptyForm = { name: '', phone: '', email: '', address: '', notes: '' };

export default function Customers() {
  const [customers, setCustomers] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [form, setForm] = useState(emptyForm);
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const load = async () => {
    try {
      const response = await customerApi.getCustomers({ search });
      const payload = response.data?.data;
      setCustomers(payload?.customers || response.data?.customers || []);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Unable to load customers.');
    }
  };

  useEffect(() => { void load(); }, [search]);

  const save = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setSuccess('');
    if (!form.name.trim()) {
      setError('Customer name is required.');
      return;
    }

    setLoading(true);
    try {
      await customerApi.createCustomer({
        name: form.name.trim(),
        phone: form.phone.trim() || undefined,
        email: form.email.trim() || undefined,
        address: form.address.trim() || undefined,
        notes: form.notes.trim() || undefined,
      });
      setForm(emptyForm);
      setShow(false);
      setSuccess('Customer saved successfully.');
      await load();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Customer could not be saved. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Customers</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Manage customer profiles and order relationships.</p>
        </div>
        <Button onClick={() => { setError(''); setShow(true); }}>Add Customer</Button>
      </div>

      {/* Alerts */}
      {error && (
        <div className="rounded-md border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/30 px-4 py-3 text-sm text-red-700 dark:text-red-400">
          {error}
        </div>
      )}
      {success && (
        <div className="rounded-md border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/30 px-4 py-3 text-sm text-green-700 dark:text-green-400">
          {success}
        </div>
      )}

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
        <Input
          placeholder="Search by name, phone or email"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="pl-10 pr-4"
        />
      </div>

      {/* Customer list */}
      <div className="bg-white dark:bg-[#111116] rounded-xl border border-orange-100 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-700">
        {customers.map(c => (
          <button type="button" className="w-full p-4 flex items-center justify-between text-left hover:bg-[#faf9f7] dark:hover:bg-[#1a1a20]/50 transition-colors" key={c.id} onClick={() => window.location.href = `/customers/${c.id}`}>
            <div>
              <div className="font-semibold text-gray-900 dark:text-gray-100">{c.name}</div>
              <div className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                {c.phone || 'No phone'}
                {c.email && ` • ${c.email}`}
              </div>
            </div>
            <div className="flex items-center gap-3"><div className="text-sm text-gray-400 dark:text-gray-500 tabular-nums">{c._count?.orders || 0} orders</div><ChevronRight className="w-4 h-4 text-gray-400" /></div>
          </button>
        ))}
        {!customers.length && (
          <div className="p-10 text-center text-gray-500 dark:text-gray-400">No customers found.</div>
        )}
      </div>

      {/* Add customer modal */}
      {show && (
        <div className="fixed inset-0 bg-black/50 dark:bg-black/70 flex items-center justify-center p-4 z-50">
          <form
            onSubmit={save}
            className="bg-white dark:bg-[#111116] rounded-xl border border-orange-100 dark:border-gray-700 shadow-xl p-6 w-full max-w-lg space-y-4"
          >
            <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">Add Customer</h2>
            {(['name', 'phone', 'email', 'address', 'notes'] as const).map(k => (
              <Input
                key={k}
                label={k[0].toUpperCase() + k.slice(1)}
                placeholder={k[0].toUpperCase() + k.slice(1)}
                value={form[k]}
                onChange={e => setForm({ ...form, [k]: e.target.value })}
                required={k === 'name'}
              />
            ))}
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="secondary" onClick={() => setShow(false)}>Cancel</Button>
              <Button type="submit" loading={loading}>{loading ? 'Saving...' : 'Save Customer'}</Button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
