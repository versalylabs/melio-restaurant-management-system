import { useEffect, useMemo, useState } from 'react';
import { Building2, RefreshCw, Plus, CheckCircle2, XCircle } from 'lucide-react';
import { branchApi, inventoryApi } from '../../services/api';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import Card from '../../components/ui/Card';
import Badge from '../../components/ui/Badge';
import { useAuth } from '../../contexts/AuthContext';

type Branch = { id: string; name: string; code: string; city?: string; status: string };
type Ingredient = { id: string; name: string; unit: string };

export default function Branches() {
  const { user } = useAuth();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [transfers, setTransfers] = useState<any[]>([]);
  const [toBranchId, setToBranchId] = useState('');
  const [ingredientId, setIngredientId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const canManage = ['OWNER','ADMIN','MANAGER'].includes(user?.roleName || '');

  const load = async () => {
    setLoading(true);
    try {
      const [b, i, t] = await Promise.all([
        branchApi.getBranches(),
        inventoryApi.getIngredients({ status: 'ACTIVE', limit: 200 }),
        branchApi.getTransfers(),
      ]);
      setBranches(b.data?.data?.branches || []);
      setIngredients(i.data?.data?.items || i.data?.data?.ingredients || []);
      setTransfers(t.data?.data?.transfers || []);
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const activeBranchId = localStorage.getItem('rms-active-branch') || user?.branchId || '';
  const fromBranch = branches.find(b => b.id === activeBranchId);
  const destinations = branches.filter(b => b.id !== activeBranchId && b.status === 'ACTIVE');

  const selectedIngredient = useMemo(() => ingredients.find(i => i.id === ingredientId), [ingredients, ingredientId]);

  const createTransfer = async () => {
    if (!toBranchId || !ingredientId || Number(quantity) <= 0) return;
    setSaving(true);
    try {
      await branchApi.createTransfer({ toBranchId, notes, items: [{ ingredientId, quantity: Number(quantity), unit: selectedIngredient?.unit || 'pieces' }] });
      setToBranchId(''); setIngredientId(''); setQuantity(''); setNotes('');
      await load();
    } catch (e: any) {
      alert(e?.response?.data?.message || 'Could not create transfer');
    } finally { setSaving(false); }
  };

  const complete = async (id: string) => {
    if (!confirm('Complete this transfer and move the stock?')) return;
    try { await branchApi.completeTransfer(id); await load(); }
    catch (e: any) { alert(e?.response?.data?.message || 'Could not complete transfer'); }
  };

  const cancel = async (id: string) => {
    if (!confirm('Cancel this draft transfer?')) return;
    try { await branchApi.cancelTransfer(id); await load(); }
    catch (e: any) { alert(e?.response?.data?.message || 'Could not cancel transfer'); }
  };

  return <div className="p-6 space-y-6">
    <div className="flex items-start justify-between">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Branches</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Manage branch context and transfer stock between locations.</p>
      </div>
      <Button variant="secondary" onClick={load}><RefreshCw className="w-4 h-4 mr-2" />Refresh</Button>
    </div>

    <Card>
      <div className="p-5">
        <div className="flex items-center gap-3 mb-4">
          <Building2 className="w-5 h-5 text-orange-600" />
          <div><h2 className="font-semibold">Branch Overview</h2><p className="text-xs text-gray-500">Your active branch is selected from the top bar.</p></div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {branches.map(b => <div key={b.id} className={`rounded-lg border p-4 ${b.id === activeBranchId ? 'border-orange-500 bg-orange-50 dark:bg-orange-900/20' : 'border-orange-100 dark:border-gray-700'}`}>
            <div className="flex justify-between"><div><p className="font-medium">{b.name}</p><p className="text-xs text-gray-500">{b.code}{b.city ? ` • ${b.city}` : ''}</p></div><Badge variant={b.status === 'ACTIVE' ? 'success' : 'default'}>{b.status}</Badge></div>
            {b.id === activeBranchId && <p className="text-xs text-orange-600 mt-2 font-medium">Active branch</p>}
          </div>)}
        </div>
      </div>
    </Card>

    {canManage && activeBranchId && destinations.length > 0 && <Card>
      <div className="p-5">
        <h2 className="font-semibold flex items-center gap-2"><Plus className="w-4 h-4" />New Stock Transfer</h2>
        <p className="text-xs text-gray-500 mt-1">Move ingredient stock from <b>{fromBranch?.name}</b> to another branch.</p>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mt-4">
          <div><label className="text-xs font-medium">Destination</label><select value={toBranchId} onChange={e=>setToBranchId(e.target.value)} className="mt-1 w-full rounded-md border p-2 bg-white dark:bg-[#111116] dark:border-gray-700"><option value="">Select branch</option>{destinations.map(b=><option key={b.id} value={b.id}>{b.name} ({b.code})</option>)}</select></div>
          <div><label className="text-xs font-medium">Ingredient</label><select value={ingredientId} onChange={e=>setIngredientId(e.target.value)} className="mt-1 w-full rounded-md border p-2 bg-white dark:bg-[#111116] dark:border-gray-700"><option value="">Select ingredient</option>{ingredients.map(i=><option key={i.id} value={i.id}>{i.name}</option>)}</select></div>
          <Input label={`Quantity${selectedIngredient ? ` (${selectedIngredient.unit})` : ''}`} value={quantity} onChange={e=>setQuantity(e.target.value)} type="number" min="0" />
          <Input label="Notes" value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Optional" />
        </div>
        <div className="mt-4"><Button onClick={createTransfer} disabled={saving || !toBranchId || !ingredientId || Number(quantity)<=0}>{saving ? 'Creating...' : 'Create Transfer'}</Button></div>
      </div>
    </Card>}

    <Card>
      <div className="p-5 border-b border-orange-100 dark:border-gray-700"><h2 className="font-semibold">Stock Transfers</h2></div>
      {loading ? <div className="p-8 text-center text-gray-500">Loading...</div> : transfers.length === 0 ? <div className="p-8 text-center text-gray-500">No stock transfers yet.</div> :
      <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-xs text-gray-500 border-b"><th className="p-3">Reference</th><th className="p-3">From</th><th className="p-3">To</th><th className="p-3">Items</th><th className="p-3">Status</th><th className="p-3">Created</th><th className="p-3"></th></tr></thead>
      <tbody>{transfers.map(t=><tr key={t.id} className="border-b last:border-0 dark:border-gray-800"><td className="p-3 font-medium">{t.reference}</td><td className="p-3">{t.fromBranch?.name}</td><td className="p-3">{t.toBranch?.name}</td><td className="p-3">{t.items?.map((i:any)=>`${i.ingredient?.name || 'Ingredient'} × ${i.quantity} ${i.unit}`).join(', ')}</td><td className="p-3"><Badge variant={t.status==='COMPLETED'?'success':t.status==='CANCELLED'?'danger':'warning'}>{t.status}</Badge></td><td className="p-3 text-gray-500">{new Date(t.createdAt).toLocaleString()}</td><td className="p-3"><div className="flex gap-2">{t.status==='DRAFT' && canManage && <><Button size="sm" onClick={()=>complete(t.id)}><CheckCircle2 className="w-4 h-4 mr-1"/>Complete</Button><Button size="sm" variant="secondary" onClick={()=>cancel(t.id)}><XCircle className="w-4 h-4 mr-1"/>Cancel</Button></>}</div></td></tr>)}</tbody></table></div>}
    </Card>
  </div>;
}
