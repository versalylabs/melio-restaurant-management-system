import { useEffect, useMemo, useState } from 'react';
import { Coins, Search, Users } from 'lucide-react';
import { Link } from 'react-router-dom';
import { customerApi } from '../../services/api';
import Card from '../../components/ui/Card';
import Input from '../../components/ui/Input';
import Button from '../../components/ui/Button';

export default function Loyalty() {
  const [customers, setCustomers] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true); setError('');
    try {
      const response = await customerApi.getCustomers({ search });
      const data = response.data?.data;
      setCustomers(data?.customers || response.data?.customers || []);
    } catch (err: any) { setError(err.response?.data?.message || 'Unable to load loyalty customers.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [search]);

  const totalPoints = useMemo(() => customers.reduce((sum, c) => sum + Number(c.loyaltyBalance || 0), 0), [customers]);
  const customersWithPoints = customers.filter(c => Number(c.loyaltyBalance || 0) > 0).length;

  return <div className="p-6 space-y-6">
    <div><h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Loyalty Program</h1><p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Monitor customer points and manage loyalty activity.</p></div>
    {error && <div className="rounded-md border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/30 px-4 py-3 text-sm text-red-700 dark:text-red-400">{error}</div>}
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <Card title="Points in Circulation"><div className="flex items-center gap-2 text-2xl font-bold text-gray-900 dark:text-gray-100"><Coins className="w-6 h-6 text-yellow-500" />{totalPoints.toLocaleString()}</div></Card>
      <Card title="Customers with Points"><div className="flex items-center gap-2 text-2xl font-bold text-gray-900 dark:text-gray-100"><Users className="w-6 h-6" />{customersWithPoints}</div></Card>
      <Card title="Current Earning Rule"><div className="text-lg font-bold text-gray-900 dark:text-gray-100">1 point / 100 spent</div><p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Awarded automatically when an order is completed.</p></Card>
    </div>
    <Card title="Customer Loyalty Balances">
      <div className="mb-5 relative"><Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" /><Input className="pl-10 pr-4" placeholder="Search customers by name, phone or email" value={search} onChange={e => setSearch(e.target.value)} /></div>
      {loading ? <div className="py-10 text-center text-gray-500 dark:text-gray-400">Loading loyalty balances...</div> : customers.length === 0 ? <div className="py-10 text-center text-gray-500 dark:text-gray-400">No customers found.</div> : <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-gray-500 dark:text-gray-400 border-b border-orange-100 dark:border-gray-700"><th className="py-3 pr-4">Customer</th><th className="py-3 pr-4">Phone</th><th className="py-3 pr-4">Points</th><th className="py-3">Action</th></tr></thead><tbody>{customers.map(c => <tr key={c.id} className="border-b last:border-0 border-gray-100 dark:border-gray-700/60"><td className="py-3 pr-4 font-medium text-gray-900 dark:text-gray-100">{c.name}</td><td className="py-3 pr-4 text-gray-600 dark:text-gray-300">{c.phone || '—'}</td><td className="py-3 pr-4 font-semibold text-gray-900 dark:text-gray-100">{Number(c.loyaltyBalance || 0).toLocaleString()}</td><td className="py-3"><Link to={`/customers/${c.id}`}><Button variant="secondary">View Customer</Button></Link></td></tr>)}</tbody></table></div>}
    </Card>
  </div>;
}
