import { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import {
  Plus,
  Search,
  Edit,
  Trash2,
  Package,
  TrendingDown,
  DollarSign,
  AlertTriangle,
  ChefHat,
  Truck,
  FileText,
  ArrowDownToLine,
  CalendarClock,
  ClipboardCheck,
} from 'lucide-react';
import { inventoryApi, menuItemApi, branchApi } from '../../services/api';
import type {
  Ingredient,
  IngredientCategory,
  InventoryStock,
  InventoryDashboard,
  StockMovement,
  Supplier,
  PurchaseOrder,
  Recipe,
  MenuItem,
  InventoryBatch,
  Stocktake,
} from '../../types';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import Card from '../../components/ui/Card';
import Badge from '../../components/ui/Badge';
import Modal from '../../components/ui/Modal';

type TabKey = 'dashboard' | 'ingredients' | 'stock' | 'recipes' | 'batches' | 'stocktakes' | 'suppliers' | 'purchases';
type RecipeRow = { ingredientId: string; quantity: string; unit: string; notes: string };
type PurchaseRow = { ingredientId: string; quantity: string; unit: string; unitPrice: string };

export default function Inventory() {
  const location = useLocation();
  const getInitialTab = (): TabKey => {
    const path = location.pathname;
    if (path === '/suppliers') return 'suppliers';
    if (path === '/purchases') return 'purchases';
    return 'dashboard';
  };
  const [activeTab, setActiveTab] = useState<TabKey>(getInitialTab());

  useEffect(() => {
    setActiveTab(getInitialTab());
  }, [location.pathname]);

  const tabs: Array<{ key: TabKey; label: string; icon: React.ComponentType<{ className?: string }> }> = [
    { key: 'dashboard', label: 'Dashboard', icon: Package },
    { key: 'ingredients', label: 'Ingredients', icon: ChefHat },
    { key: 'stock', label: 'Stock Levels', icon: TrendingDown },
    { key: 'recipes', label: 'Recipes', icon: FileText },
    { key: 'batches', label: 'Batches & Expiry', icon: CalendarClock },
    { key: 'stocktakes', label: 'Stocktakes', icon: ClipboardCheck },
    { key: 'suppliers', label: 'Suppliers', icon: Truck },
    { key: 'purchases', label: 'Purchase Orders', icon: ArrowDownToLine },
  ];

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Inventory</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Manage ingredients, stock, recipes, and suppliers</p>
      </div>

      <div className="border-b border-orange-100 dark:border-gray-700">
        <nav className="flex space-x-4 overflow-x-auto">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex items-center gap-2 px-3 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                  activeTab === tab.key
                    ? 'border-orange-600 text-orange-600 dark:border-orange-400 dark:text-orange-400'
                    : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600'
                }`}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
              </button>
            );
          })}
        </nav>
      </div>

      {activeTab === 'dashboard' && <DashboardTab />}
      {activeTab === 'ingredients' && <IngredientsTab />}
      {activeTab === 'stock' && <StockTab />}
      {activeTab === 'recipes' && <RecipesTab />}
      {activeTab === 'batches' && <BatchesTab />}
      {activeTab === 'stocktakes' && <StocktakesTab />}
      {activeTab === 'suppliers' && <SuppliersTab />}
      {activeTab === 'purchases' && <PurchaseOrdersTab />}
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number | string;
  color: 'blue' | 'green' | 'amber' | 'red';
}) {
  const colors = {
    blue: 'bg-orange-50 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
    green: 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-400',
    amber: 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    red: 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  };
  return (
    <Card>
      <div className="flex items-center gap-3">
        <div className={`w-10 h-10 rounded-md flex items-center justify-center ${colors[color]}`}>
          <Icon className="w-5 h-5" />
        </div>
        <div>
          <p className="text-xs text-gray-500 dark:text-gray-400 uppercase">{label}</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{value}</p>
        </div>
      </div>
    </Card>
  );
}

function DashboardTab() {
  const [data, setData] = useState<InventoryDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const response = await inventoryApi.getInventoryDashboard();
        if (response.data.success) setData(response.data.data);
      } catch (err: any) {
        setError(err.response?.data?.message || 'Failed to load dashboard');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <div className="text-gray-500 dark:text-gray-400 text-sm">Loading dashboard...</div>;

  return (
    <div className="space-y-6">
      {error && (
        <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 px-4 py-3 rounded-md text-sm">{error}</div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={Package} label="Total Ingredients" value={data?.totalIngredients ?? 0} color="blue" />
        <StatCard icon={DollarSign} label="Total Stock Value" value={`KSh ${(data?.totalStockValue ?? 0).toLocaleString()}`} color="green" />
        <StatCard icon={AlertTriangle} label="Low Stock Items" value={data?.lowStockCount ?? 0} color="amber" />
        <StatCard icon={TrendingDown} label="Out of Stock" value={data?.outOfStockCount ?? 0} color="red" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card title="Reorder Required">
          {data?.reorderItems && data.reorderItems.length > 0 ? (
            <div className="space-y-2">
              {data.reorderItems.map((item) => (
                <div key={item.id} className="flex items-center justify-between py-2 border-b border-gray-100 dark:border-gray-700 last:border-0">
                  <div>
                    <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{item.ingredientName}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{item.branchName}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{item.quantity} {item.unit}</p>
                    <Badge variant="warning">LOW_STOCK</Badge>
                  </div>
                </div>
              ))}
            </div>
          ) : <p className="text-sm text-gray-500 dark:text-gray-400 py-4">No items need reordering</p>}
        </Card>
        <Card title="Recent Stock Movements">
          {data?.recentMovements && data.recentMovements.length > 0 ? (
            <div className="space-y-2">
              {data.recentMovements.slice(0, 5).map((mv) => (
                <div key={mv.id} className="flex items-center justify-between py-2 border-b border-gray-100 dark:border-gray-700 last:border-0">
                  <div>
                    <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{mv.ingredientName}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{mv.type}{mv.reason ? ` Â· ${mv.reason}` : ''} Â· {new Date(mv.createdAt).toLocaleDateString()}</p>
                  </div>
                  <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{mv.quantity > 0 ? '+' : ''}{mv.quantity} {mv.unit}</span>
                </div>
              ))}
            </div>
          ) : <p className="text-sm text-gray-500 dark:text-gray-400 py-4">No recent movements</p>}
        </Card>
        <Card title="Recent Wastage" className="lg:col-span-2">
          {data?.recentWastage && data.recentWastage.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                <thead className="bg-[#faf9f7] dark:bg-[#111116]/70">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Ingredient</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Quantity</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Reason</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Date</th>
                  </tr>
                </thead>
                <tbody className="bg-white dark:bg-[#111116] divide-y divide-gray-200 dark:divide-gray-700">
                  {data.recentWastage.slice(0, 5).map((w) => (
                    <tr key={w.id} className="hover:bg-[#faf9f7] dark:hover:bg-[#1a1a20]/30">
                      <td className="px-4 py-2 text-sm text-gray-900 dark:text-gray-100">{w.ingredientName}</td>
                      <td className="px-4 py-2 text-sm text-gray-500 dark:text-gray-400">{w.quantity} {w.unit}</td>
                      <td className="px-4 py-2 text-sm text-gray-500 dark:text-gray-400">{w.reason}</td>
                      <td className="px-4 py-2 text-sm text-gray-500 dark:text-gray-400">{new Date(w.createdAt).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="text-sm text-gray-500 dark:text-gray-400 py-4">No recent wastage records</p>}
        </Card>
      </div>
    </div>
  );
}

function CategoriesManagerModal({
  categories,
  onClose,
  onSaved,
}: {
  categories: IngredientCategory[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await inventoryApi.createIngredientCategory({ name, description, displayOrder: 0, status: 'ACTIVE' });
      setName('');
      setDescription('');
      onSaved();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to create category');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this category?')) return;
    try {
      await inventoryApi.deleteIngredientCategory(id);
      onSaved();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to delete');
    }
  };

  return (
    <Modal title="Ingredient Categories" onClose={onClose}>
      <div className="space-y-4">
        {error && <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 px-4 py-3 rounded-md text-sm">{error}</div>}
        <form onSubmit={handleAdd} className="space-y-3 border-b border-orange-100 dark:border-gray-700 pb-4">
          <Input id="cat-name" label="New Category Name" value={name} onChange={(e) => setName(e.target.value)} required />
          <Input id="cat-desc" label="Description" value={description} onChange={(e) => setDescription(e.target.value)} />
          <div className="flex justify-end">
            <Button type="submit"><Plus className="w-4 h-4 mr-1" />Add</Button>
          </div>
        </form>
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {categories.length === 0 && <p className="text-sm text-gray-500 dark:text-gray-400">No categories yet</p>}
          {categories.map((c) => (
            <div key={c.id} className="flex items-center justify-between py-2 border-b border-gray-100 dark:border-gray-700">
              <div>
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{c.name}</p>
                {c.description && <p className="text-xs text-gray-500 dark:text-gray-400">{c.description}</p>}
              </div>
              <button onClick={() => handleDelete(c.id)} className="text-red-600 dark:text-red-400 hover:text-red-900 dark:hover:text-red-300">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}

function BatchesTab() {
  const [items, setItems] = useState<InventoryBatch[]>([]);
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [branches, setBranches] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ branchId: '', ingredientId: '', batchNumber: '', expiryDate: '', quantity: '', unit: '', costPerUnit: '' });

  const load = async () => {
    try {
      setLoading(true); setError('');
      const [b, i, br] = await Promise.all([inventoryApi.getInventoryBatches({ expiringDays: 30 }), inventoryApi.getIngredients({ limit: 200 }), branchApi.getBranches()]);
      if (b.data.success) setItems(b.data.data?.items || []);
      if (i.data.success) setIngredients(i.data.data?.items || []);
      const branchData = br.data?.data;
      setBranches(Array.isArray(branchData) ? branchData : (branchData?.branches || []));
    } catch (err: any) { setError(err.response?.data?.message || 'Failed to load batches'); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await inventoryApi.createInventoryBatch({ ...form, quantity: Number(form.quantity), costPerUnit: form.costPerUnit ? Number(form.costPerUnit) : undefined });
      setShowModal(false); setForm({ branchId:'', ingredientId:'', batchNumber:'', expiryDate:'', quantity:'', unit:'', costPerUnit:'' }); load();
    } catch (err: any) { setError(err.response?.data?.message || 'Failed to create batch'); }
  };
  const today = new Date();
  return <div className="space-y-4">
    {error && <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 px-4 py-3 rounded-md text-sm">{error}</div>}
    <div className="flex justify-between items-center"><div><h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Batch & Expiry Tracking</h2><p className="text-sm text-gray-500">FIFO consumption uses earliest-expiring stock first.</p></div><Button onClick={() => setShowModal(true)} className="gap-2"><Plus className="w-4 h-4" /> Add Batch</Button></div>
    <Card><div className="overflow-x-auto"><table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700"><thead className="bg-[#faf9f7] dark:bg-[#111116]/70"><tr>{['Ingredient','Branch','Batch','Quantity','Expiry','Cost/Unit','Status'].map(h=><th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{h}</th>)}</tr></thead><tbody className="divide-y divide-gray-200 dark:divide-gray-700">{loading ? <tr><td colSpan={7} className="p-8 text-center text-sm text-gray-500">Loading batches...</td></tr> : items.map(b => { const expired=b.expiryDate && new Date(b.expiryDate)<today; const soon=!expired && b.expiryDate && new Date(b.expiryDate)<=new Date(Date.now()+30*86400000); return <tr key={b.id}><td className="px-4 py-3 text-sm text-gray-900 dark:text-gray-100">{b.ingredientName}</td><td className="px-4 py-3 text-sm text-gray-500">{b.branchName}</td><td className="px-4 py-3 text-sm">{b.batchNumber || '—'}</td><td className="px-4 py-3 text-sm">{b.quantity} {b.unit}</td><td className="px-4 py-3 text-sm">{b.expiryDate ? new Date(b.expiryDate).toLocaleDateString() : 'No expiry'}</td><td className="px-4 py-3 text-sm">{b.costPerUnit != null ? `KSh ${b.costPerUnit.toLocaleString()}` : '—'}</td><td className="px-4 py-3"><Badge variant={expired?'danger':soon?'warning':'success'}>{expired?'EXPIRED':soon?'EXPIRING SOON':b.status}</Badge></td></tr> })}{!loading&&items.length===0&&<tr><td colSpan={7} className="p-8 text-center text-sm text-gray-500">No inventory batches found.</td></tr>}</tbody></table></div></Card>
    {showModal && <Modal title="Add Inventory Batch" onClose={() => setShowModal(false)}><form onSubmit={submit} className="space-y-4"><div className="grid grid-cols-2 gap-4"><div><label className="block text-sm font-medium mb-1">Branch</label><select value={form.branchId} onChange={e=>setForm({...form,branchId:e.target.value})} required className="flex h-10 w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-[#111116] px-3 text-sm dark:text-gray-100"><option value="">Select branch</option>{branches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></div><div><label className="block text-sm font-medium mb-1">Ingredient</label><select value={form.ingredientId} onChange={e=>{const ing=ingredients.find(i=>i.id===e.target.value);setForm({...form,ingredientId:e.target.value,unit:ing?.unit||''})}} required className="flex h-10 w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-[#111116] px-3 text-sm dark:text-gray-100"><option value="">Select ingredient</option>{ingredients.map(i=><option key={i.id} value={i.id}>{i.name}</option>)}</select></div></div><div className="grid grid-cols-2 gap-4"><Input id="batch-number" label="Batch Number" value={form.batchNumber} onChange={e=>setForm({...form,batchNumber:e.target.value})}/><Input id="expiry" type="date" label="Expiry Date" value={form.expiryDate} onChange={e=>setForm({...form,expiryDate:e.target.value})}/></div><div className="grid grid-cols-3 gap-4"><Input id="qty" type="number" step="0.01" label="Quantity" value={form.quantity} onChange={e=>setForm({...form,quantity:e.target.value})} required/><Input id="unit" label="Unit" value={form.unit} onChange={e=>setForm({...form,unit:e.target.value})} required/><Input id="cost" type="number" step="0.01" label="Cost / Unit" value={form.costPerUnit} onChange={e=>setForm({...form,costPerUnit:e.target.value})}/></div><div className="flex justify-end gap-3"><Button type="button" variant="secondary" onClick={()=>setShowModal(false)}>Cancel</Button><Button type="submit">Add Batch</Button></div></form></Modal>}
  </div>;
}

function StocktakesTab() {
  const [items, setItems] = useState<Stocktake[]>([]); const [branches,setBranches]=useState<any[]>([]); const [loading,setLoading]=useState(true); const [error,setError]=useState(''); const [branchId,setBranchId]=useState(''); const [editing,setEditing]=useState<Stocktake|null>(null);
  const load=async()=>{try{setLoading(true);const [r,b]=await Promise.all([inventoryApi.getStocktakes({branchId:branchId||undefined}),branchApi.getBranches()]);if(r.data.success)setItems(r.data.data?.items||[]);const bd=b.data?.data;setBranches(Array.isArray(bd)?bd:(bd?.branches||[]));}catch(err:any){setError(err.response?.data?.message||'Failed to load stocktakes')}finally{setLoading(false)}};
  useEffect(()=>{load()},[branchId]);
  const create=async()=>{try{await inventoryApi.createStocktake({branchId:branchId||undefined});load()}catch(err:any){setError(err.response?.data?.message||'Failed to create stocktake')}};
  const save=async()=>{if(!editing)return;try{await inventoryApi.updateStocktake(editing.id,{items:editing.items.map(i=>({ingredientId:i.ingredientId,countedQty:i.countedQty,notes:i.notes}))});setEditing(null);load()}catch(err:any){setError(err.response?.data?.message||'Failed to update stocktake')}};
  const complete=async(id:string)=>{if(!confirm('Complete this stocktake and apply all variances to inventory?'))return;try{await inventoryApi.completeStocktake(id);load()}catch(err:any){setError(err.response?.data?.message||'Failed to complete stocktake')}};
  return <div className="space-y-4">{error&&<div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-md text-sm">{error}</div>}<div className="flex flex-wrap gap-3 items-end"><div><label className="block text-sm font-medium mb-1">Branch</label><select value={branchId} onChange={e=>setBranchId(e.target.value)} className="h-10 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-[#111116] px-3 text-sm dark:text-gray-100"><option value="">My branch</option>{branches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></div><Button onClick={create} className="gap-2"><Plus className="w-4 h-4"/> New Stocktake</Button></div><Card><div className="overflow-x-auto"><table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700"><thead><tr>{['Reference','Branch','Status','Items','Created','Actions'].map(h=><th key={h} className="px-4 py-3 text-left text-xs uppercase text-gray-500">{h}</th>)}</tr></thead><tbody className="divide-y divide-gray-200 dark:divide-gray-700">{loading?<tr><td colSpan={6} className="p-8 text-center text-sm text-gray-500">Loading...</td></tr>:items.map(st=><tr key={st.id}><td className="px-4 py-3 text-sm font-medium">{st.reference}</td><td className="px-4 py-3 text-sm">{st.branch?.name||'—'}</td><td className="px-4 py-3"><Badge variant={st.status==='COMPLETED'?'success':'warning'}>{st.status}</Badge></td><td className="px-4 py-3 text-sm">{st.items?.length||0}</td><td className="px-4 py-3 text-sm">{new Date(st.createdAt).toLocaleString()}</td><td className="px-4 py-3">{st.status==='DRAFT'&&<><button className="text-orange-600 mr-3" onClick={()=>setEditing(JSON.parse(JSON.stringify(st)))}>Count</button><button className="text-green-600" onClick={()=>complete(st.id)}>Complete</button></>}</td></tr>)}{!loading&&items.length===0&&<tr><td colSpan={6} className="p-8 text-center text-sm text-gray-500">No stocktakes yet.</td></tr>}</tbody></table></div></Card>{editing&&<Modal title={`Count ${editing.reference}`} onClose={()=>setEditing(null)}><div className="space-y-3 max-h-[60vh] overflow-y-auto">{editing.items.map((i,idx)=><div key={i.id} className="grid grid-cols-[1fr_130px_100px] gap-3 items-end border-b pb-3"><div><p className="text-sm font-medium">{i.ingredient?.name||'Ingredient'}</p><p className="text-xs text-gray-500">Expected: {i.expectedQty} {i.unit}</p></div><Input id={`count-${i.id}`} type="number" step="0.01" label="Counted" value={String(i.countedQty)} onChange={e=>{const arr=[...editing.items];arr[idx]={...arr[idx],countedQty:Number(e.target.value),variance:Number(e.target.value)-arr[idx].expectedQty};setEditing({...editing,items:arr})}}/><div className="text-sm pb-2">Variance: <strong>{(i.countedQty-i.expectedQty).toFixed(2)}</strong></div></div>)}</div><div className="flex justify-end gap-3 mt-5"><Button variant="secondary" onClick={()=>setEditing(null)}>Cancel</Button><Button onClick={save}>Save Counts</Button></div></Modal>}</div>;
}

function IngredientsTab() {
  const [items, setItems] = useState<Ingredient[]>([]);
  const [categories, setCategories] = useState<IngredientCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Ingredient | null>(null);
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [formData, setFormData] = useState({
    name: '', code: '', description: '', categoryId: '', unit: 'kg',
    costPerUnit: '', minStockLevel: '', reorderLevel: '',
    available: true, status: 'ACTIVE', displayOrder: 0,
  });

  const fetchData = async () => {
    try {
      setLoading(true);
      const params: any = {};
      if (search) params.search = search;
      if (filterCategory) params.categoryId = filterCategory;
      const [iRes, cRes] = await Promise.all([
        inventoryApi.getIngredients(params),
        inventoryApi.getIngredientCategories(),
      ]);
      if (iRes.data.success) setItems(iRes.data.data?.items || []);
      if (cRes.data.success) setCategories(cRes.data.data?.categories || []);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [search, filterCategory]);

  const resetForm = () => setFormData({
    name: '', code: '', description: '', categoryId: '', unit: 'kg',
    costPerUnit: '', minStockLevel: '', reorderLevel: '',
    available: true, status: 'ACTIVE', displayOrder: 0,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const data = {
        ...formData,
        costPerUnit: parseFloat(formData.costPerUnit),
        minStockLevel: parseFloat(formData.minStockLevel),
        reorderLevel: parseFloat(formData.reorderLevel),
      };
      if (editing) await inventoryApi.updateIngredient(editing.id, data);
      else await inventoryApi.createIngredient(data);
      setShowModal(false);
      setEditing(null);
      resetForm();
      fetchData();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to save ingredient');
    }
  };

  const openEdit = (item: Ingredient) => {
    setEditing(item);
    setFormData({
      name: item.name, code: item.code || '', description: item.description || '',
      categoryId: item.categoryId, unit: item.unit,
      costPerUnit: item.costPerUnit.toString(),
      minStockLevel: item.minStockLevel.toString(),
      reorderLevel: item.reorderLevel.toString(),
      available: item.available, status: item.status, displayOrder: item.displayOrder,
    });
    setShowModal(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Deactivate this ingredient?')) return;
    try { await inventoryApi.deleteIngredient(id); fetchData(); }
    catch (err: any) { setError(err.response?.data?.message || 'Failed to delete'); }
  };

  if (loading) return <div className="text-gray-500 dark:text-gray-400 text-sm">Loading ingredients...</div>;

  return (
    <div className="space-y-4">
      {error && <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 px-4 py-3 rounded-md text-sm">{error}</div>}
      <div className="flex gap-2">
        <Button onClick={() => { setEditing(null); resetForm(); setShowModal(true); }} className="gap-2">
          <Plus className="w-4 h-4" />Add Ingredient
        </Button>
        <Button variant="secondary" onClick={() => setShowCategoryModal(true)} className="gap-2">
          <Plus className="w-4 h-4" />Add Category
        </Button>
      </div>
      <Card>
        <div className="flex flex-col sm:flex-row gap-4 mb-4">
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
            <Input placeholder="Search ingredients..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-10 pr-4" />
          </div>
          <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)} className="flex h-10 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-[#111116] px-3 py-2 text-sm dark:text-gray-100">
            <option value="">All Categories</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-[#faf9f7] dark:bg-[#111116]/70">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Name</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Category</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Unit</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Cost/Unit</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Reorder</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Status</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-[#111116] divide-y divide-gray-200 dark:divide-gray-700">
              {items.map((item) => (
                <tr key={item.id} className="hover:bg-[#faf9f7] dark:hover:bg-[#1a1a20]/30">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{item.name}</div>
                    {item.code && <div className="text-xs text-gray-500 dark:text-gray-400">Code: {item.code}</div>}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">{item.categoryName || '-'}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">{item.unit}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100">KSh {(item.costPerUnit ?? 0).toLocaleString()}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">{item.reorderLevel}</td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <Badge variant={item.status === 'ACTIVE' ? 'success' : 'warning'}>{item.status}</Badge>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <button onClick={() => openEdit(item)} className="text-orange-600 dark:text-orange-400 hover:text-orange-900 dark:hover:text-orange-300 mr-3"><Edit className="w-4 h-4" /></button>
                    <button onClick={() => handleDelete(item.id)} className="text-red-600 dark:text-red-400 hover:text-red-900 dark:hover:text-red-300"><Trash2 className="w-4 h-4" /></button>
                  </td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr><td colSpan={7} className="px-6 py-8 text-center text-sm text-gray-500 dark:text-gray-400">No ingredients found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {showModal && (
        <Modal title={editing ? 'Edit Ingredient' : 'Add Ingredient'} onClose={() => { setShowModal(false); setEditing(null); }}>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Input id="name" label="Name" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} required />
              <Input id="code" label="Code" value={formData.code} onChange={(e) => setFormData({ ...formData, code: e.target.value })} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Description</label>
              <textarea value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })} className="flex min-h-[80px] w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-[#111116] px-3 py-2 text-sm dark:text-gray-100" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Category</label>
                <select value={formData.categoryId} onChange={(e) => setFormData({ ...formData, categoryId: e.target.value })} className="flex h-10 w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-[#111116] px-3 py-2 text-sm dark:text-gray-100" required>
                  <option value="">Select category</option>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Unit</label>
                <select value={formData.unit} onChange={(e) => setFormData({ ...formData, unit: e.target.value })} className="flex h-10 w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-[#111116] px-3 py-2 text-sm dark:text-gray-100">
                  <option value="kg">kg</option><option value="g">g</option><option value="l">l</option>
                  <option value="ml">ml</option><option value="pcs">pcs</option><option value="box">box</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <Input id="costPerUnit" type="number" label="Cost / Unit" value={formData.costPerUnit} onChange={(e) => setFormData({ ...formData, costPerUnit: e.target.value })} required step="0.01" />
              <Input id="minStockLevel" type="number" label="Min Stock" value={formData.minStockLevel} onChange={(e) => setFormData({ ...formData, minStockLevel: e.target.value })} required step="0.01" />
              <Input id="reorderLevel" type="number" label="Reorder Level" value={formData.reorderLevel} onChange={(e) => setFormData({ ...formData, reorderLevel: e.target.value })} required step="0.01" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Input id="displayOrder" type="number" label="Display Order" value={formData.displayOrder} onChange={(e) => setFormData({ ...formData, displayOrder: parseInt(e.target.value) || 0 })} />
              <div className="flex items-center gap-2 pt-6">
                <input id="available" type="checkbox" checked={formData.available} onChange={(e) => setFormData({ ...formData, available: e.target.checked })} className="rounded border-gray-300 dark:border-gray-600" />
                <label htmlFor="available" className="text-sm text-gray-700 dark:text-gray-300">Available</label>
              </div>
            </div>
            <div className="flex justify-end gap-3">
              <Button type="button" variant="secondary" onClick={() => { setShowModal(false); setEditing(null); }}>Cancel</Button>
              <Button type="submit">{editing ? 'Update' : 'Create'}</Button>
            </div>
          </form>
        </Modal>
      )}

      {showCategoryModal && (
        <CategoriesManagerModal
          categories={categories}
          onClose={() => setShowCategoryModal(false)}
          onSaved={() => { setShowCategoryModal(false); fetchData(); }}
        />
      )}
    </div>
  );
}
function StockTab() {
  const [stock, setStock] = useState<InventoryStock[]>([]);
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [showAdjust, setShowAdjust] = useState(false);
  const [showWastage, setShowWastage] = useState(false);
  const [selectedStock, setSelectedStock] = useState<InventoryStock | null>(null);
  const [adjustData, setAdjustData] = useState({ quantity: '', type: 'RESTOCK', reason: '', notes: '' });
  const [wastageData, setWastageData] = useState({ quantity: '', reason: 'EXPIRED', notes: '' });

  const fetchData = async () => {
    try {
      setLoading(true);
      const params: any = {};
      if (search) params.search = search;
      const [sRes, mRes] = await Promise.all([
        inventoryApi.getInventoryStock(params),
        inventoryApi.getStockMovements(),
      ]);
      let stockItems = [];
      if (sRes.data.success) stockItems = sRes.data.data?.items || [];
      if (filterStatus === 'LOW') stockItems = stockItems.filter((s: any) => s.isLowStock);
      if (filterStatus === 'OUT_OF_STOCK') stockItems = stockItems.filter((s: any) => s.isOutOfStock);
      setStock(stockItems);
      if (mRes.data.success) setMovements(mRes.data.data?.items || []);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to load stock');
    } finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [search, filterStatus]);

  const openAdjust = (s: InventoryStock) => {
    setSelectedStock(s);
    setAdjustData({ quantity: '', type: 'RESTOCK', reason: '', notes: '' });
    setShowAdjust(true);
  };

  const openWastage = (s: InventoryStock) => {
    setSelectedStock(s);
    setWastageData({ quantity: '', reason: 'EXPIRED', notes: '' });
    setShowWastage(true);
  };

  const handleAdjust = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedStock) return;
    try {
      await inventoryApi.adjustStock(selectedStock.ingredientId, {
        quantity: parseFloat(adjustData.quantity),
        type: adjustData.type,
        reason: adjustData.reason,
        notes: adjustData.notes,
      });
      setShowAdjust(false); setSelectedStock(null); fetchData();
    } catch (err: any) { setError(err.response?.data?.message || 'Failed to adjust stock'); }
  };

  const handleWastage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedStock) return;
    try {
      await inventoryApi.createWastageRecord({
        ingredientId: selectedStock.ingredientId,
        branchId: selectedStock.branchId,
        quantity: parseFloat(wastageData.quantity),
        reason: wastageData.reason,
        notes: wastageData.notes,
      });
      setShowWastage(false); setSelectedStock(null); fetchData();
    } catch (err: any) { setError(err.response?.data?.message || 'Failed to record wastage'); }
  };

  if (loading) return <div className="text-gray-500 dark:text-gray-400 text-sm">Loading stock...</div>;

  return (
    <div className="space-y-6">
      {error && <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 px-4 py-3 rounded-md text-sm">{error}</div>}
      <Card title="Current Stock Levels">
        <div className="flex flex-col sm:flex-row gap-4 mb-4">
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
            <Input placeholder="Search stock..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-10 pr-4" />
          </div>
          <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="flex h-10 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-[#111116] px-3 py-2 text-sm dark:text-gray-100">
            <option value="">All Status</option>
            <option value="OK">OK</option><option value="LOW">Low Stock</option>
            <option value="CRITICAL">Critical</option><option value="OUT_OF_STOCK">Out of Stock</option>
          </select>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-[#faf9f7] dark:bg-[#111116]/70">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Ingredient</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Branch</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Quantity</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Value</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Status</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-[#111116] divide-y divide-gray-200 dark:divide-gray-700">
              {stock.map((s) => (
                <tr key={s.id} className="hover:bg-[#faf9f7] dark:hover:bg-[#1a1a20]/30">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{s.ingredientName}</div>
                    {s.ingredientCode && <div className="text-xs text-gray-500 dark:text-gray-400">Code: {s.ingredientCode}</div>}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">{s.branchName || '-'}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100">{s.quantity} {s.unit}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100">KSh {((s.costPerUnit || 0) * s.quantity).toLocaleString()}</td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <Badge variant={s.isOutOfStock ? 'danger' : s.isLowStock ? 'warning' : 'success'}>
                      {s.isOutOfStock ? 'OUT_OF_STOCK' : s.isLowStock ? 'LOW' : 'OK'}
                    </Badge>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <button onClick={() => openAdjust(s)} className="text-orange-600 dark:text-orange-400 hover:text-orange-900 dark:hover:text-orange-300 mr-3">Adjust</button>
                    <button onClick={() => openWastage(s)} className="text-red-600 dark:text-red-400 hover:text-red-900 dark:hover:text-red-300">Wastage</button>
                  </td>
                </tr>
              ))}
              {stock.length === 0 && <tr><td colSpan={6} className="px-6 py-8 text-center text-sm text-gray-500 dark:text-gray-400">No stock records found</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Recent Stock Movements">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-[#faf9f7] dark:bg-[#111116]/70">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Date</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Ingredient</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Type</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Quantity</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">User</th>
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-[#111116] divide-y divide-gray-200 dark:divide-gray-700">
              {movements.slice(0, 20).map((mv) => (
                <tr key={mv.id} className="hover:bg-[#faf9f7] dark:hover:bg-[#1a1a20]/30">
                  <td className="px-6 py-3 text-sm text-gray-500 dark:text-gray-400">{new Date(mv.createdAt).toLocaleString()}</td>
                  <td className="px-6 py-3 text-sm text-gray-900 dark:text-gray-100">{mv.ingredientName}</td>
                  <td className="px-6 py-3">
                    <Badge variant={mv.type === 'RESTOCK' ? 'success' : mv.type === 'WASTAGE' ? 'danger' : 'info'}>{mv.type}</Badge>
                  </td>
                  <td className="px-6 py-3 text-sm text-gray-900 dark:text-gray-100">{mv.quantity > 0 ? '+' : ''}{mv.quantity} {mv.unit}</td>
                  <td className="px-6 py-3 text-sm text-gray-500 dark:text-gray-400">{mv.userName || '-'}</td>
                </tr>
              ))}
              {movements.length === 0 && <tr><td colSpan={5} className="px-6 py-8 text-center text-sm text-gray-500 dark:text-gray-400">No movements recorded</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>

      {showAdjust && selectedStock && (
        <Modal title="Adjust Stock" onClose={() => setShowAdjust(false)}>
          <form onSubmit={handleAdjust} className="space-y-4">
            <p className="text-sm text-gray-600 dark:text-gray-400"><strong>{selectedStock.ingredientName}</strong> · Current: {selectedStock.quantity} {selectedStock.unit}</p>
            <Input id="adj-qty" type="number" label="Quantity Change (negative to subtract)" value={adjustData.quantity} onChange={(e) => setAdjustData({ ...adjustData, quantity: e.target.value })} required step="0.01" />
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Type</label>
              <select value={adjustData.type} onChange={(e) => setAdjustData({ ...adjustData, type: e.target.value })} className="flex h-10 w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-[#111116] px-3 py-2 text-sm dark:text-gray-100">
                <option value="RESTOCK">Restock</option>
                <option value="CONSUMPTION">Consumption</option>
                <option value="ADJUSTMENT">Adjustment</option>
                <option value="TRANSFER">Transfer</option>
              </select>
            </div>
            <Input id="adj-reason" label="Reason" value={adjustData.reason} onChange={(e) => setAdjustData({ ...adjustData, reason: e.target.value })} />
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Notes</label>
              <textarea value={adjustData.notes} onChange={(e) => setAdjustData({ ...adjustData, notes: e.target.value })} className="flex min-h-[60px] w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-[#111116] px-3 py-2 text-sm dark:text-gray-100" />
            </div>
            <div className="flex justify-end gap-3">
              <Button type="button" variant="secondary" onClick={() => setShowAdjust(false)}>Cancel</Button>
              <Button type="submit">Save Adjustment</Button>
            </div>
          </form>
        </Modal>
      )}

      {showWastage && selectedStock && (
        <Modal title="Record Wastage" onClose={() => setShowWastage(false)}>
          <form onSubmit={handleWastage} className="space-y-4">
            <p className="text-sm text-gray-600 dark:text-gray-400"><strong>{selectedStock.ingredientName}</strong> · Available: {selectedStock.quantity} {selectedStock.unit}</p>
            <Input id="w-qty" type="number" label="Quantity Wasted" value={wastageData.quantity} onChange={(e) => setWastageData({ ...wastageData, quantity: e.target.value })} required step="0.01" />
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Reason</label>
              <select value={wastageData.reason} onChange={(e) => setWastageData({ ...wastageData, reason: e.target.value })} className="flex h-10 w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-[#111116] px-3 py-2 text-sm dark:text-gray-100">
                <option value="EXPIRED">Expired</option><option value="SPOILED">Spoiled</option>
                <option value="OVERPREPARED">Over-prepared</option><option value="DAMAGED">Damaged</option>
                <option value="OTHER">Other</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Notes</label>
              <textarea value={wastageData.notes} onChange={(e) => setWastageData({ ...wastageData, notes: e.target.value })} className="flex min-h-[60px] w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-[#111116] px-3 py-2 text-sm dark:text-gray-100" />
            </div>
            <div className="flex justify-end gap-3">
              <Button type="button" variant="secondary" onClick={() => setShowWastage(false)}>Cancel</Button>
              <Button type="submit" variant="danger">Record Wastage</Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

function RecipesTab() {
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Recipe | null>(null);
  const [viewing, setViewing] = useState<Recipe | null>(null);
  const [formData, setFormData] = useState({
    menuItemId: '', name: '', description: '', servings: '1', status: 'ACTIVE',
    ingredients: [] as RecipeRow[],
  });

  const fetchData = async () => {
    try {
      setLoading(true);
      const [rRes, mRes, iRes] = await Promise.all([
        inventoryApi.getRecipes(),
        menuItemApi.getMenuItems({ status: 'ACTIVE' }),
        inventoryApi.getIngredients(),
      ]);
      if (rRes.data.success) setRecipes(rRes.data.data?.items || []);
      if (mRes.data.success) setMenuItems(mRes.data.data?.items || []);
      if (iRes.data.success) setIngredients(iRes.data.data?.items || []);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to load recipes');
    } finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const openCreate = () => {
    setEditing(null);
    setFormData({ menuItemId: '', name: '', description: '', servings: '1', status: 'ACTIVE', ingredients: [] });
    setShowModal(true);
  };

  const handleView = async (r: Recipe) => {
    try {
      const res = await inventoryApi.getRecipe(r.menuItemId);
      setViewing(res.data.data);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to load recipe details');
    }
  };

  const openEdit = async (r: Recipe) => {
    try {
      const res = await inventoryApi.getRecipe(r.menuItemId);
      const fullRecipe = res.data.data;
      setEditing(fullRecipe);
      setFormData({
        menuItemId: fullRecipe.menuItemId, name: fullRecipe.name || '', description: fullRecipe.description || '',
        servings: fullRecipe.servings.toString(), status: fullRecipe.status,
        ingredients: fullRecipe.ingredients.map((ri: any) => ({
          ingredientId: ri.ingredientId, quantity: ri.quantity.toString(),
          unit: ri.unit, notes: ri.notes || '',
        })),
      });
      setShowModal(true);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to load recipe details');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const data = {
        menuItemId: formData.menuItemId,
        name: formData.name,
        description: formData.description,
        servings: parseInt(formData.servings),
        status: formData.status,
        ingredients: formData.ingredients.map((row) => ({
          ingredientId: row.ingredientId,
          quantity: parseFloat(row.quantity),
          unit: row.unit,
          notes: row.notes,
        })),
      };
      if (editing) await inventoryApi.updateRecipe(editing.menuItemId, data);
      else await inventoryApi.createRecipe(data);
      setShowModal(false); setEditing(null); fetchData();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to save recipe');
    }
  };

  const handleDelete = async (menuItemId: string) => {
    if (!confirm('Delete this recipe?')) return;
    try { await inventoryApi.deleteRecipe(menuItemId); fetchData(); }
    catch (err: any) { setError(err.response?.data?.message || 'Failed to delete'); }
  };

  const addRow = () => {
    setFormData({ ...formData, ingredients: [...formData.ingredients, { ingredientId: '', quantity: '', unit: 'kg', notes: '' }] });
  };

  const updateRow = (idx: number, field: keyof RecipeRow, value: string) => {
    const updated = [...formData.ingredients];
    updated[idx] = { ...updated[idx], [field]: value };
    setFormData({ ...formData, ingredients: updated });
  };

  const removeRow = (idx: number) => {
    setFormData({ ...formData, ingredients: formData.ingredients.filter((_, i) => i !== idx) });
  };

  if (loading) return <div className="text-gray-500 dark:text-gray-400 text-sm">Loading recipes...</div>;

  return (
    <div className="space-y-4">
      {error && <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 px-4 py-3 rounded-md text-sm">{error}</div>}
      <div className="flex justify-end">
        <Button onClick={openCreate} className="gap-2"><Plus className="w-4 h-4" />Add Recipe</Button>
      </div>
      <Card>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-[#faf9f7] dark:bg-[#111116]/70">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Menu Item</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Servings</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Ingredients</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Food Cost</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Status</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-[#111116] divide-y divide-gray-200 dark:divide-gray-700">
              {recipes.map((r) => (
                <tr key={r.id} className="hover:bg-[#faf9f7] dark:hover:bg-[#1a1a20]/30">
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-gray-100">{r.menuItemName || r.name}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">{r.servings}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">{r.ingredientCount || 0}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100">KSh {(r.menuItemPrice || 0).toLocaleString()}</td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <Badge variant={r.status === 'ACTIVE' ? 'success' : 'warning'}>{r.status}</Badge>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <button onClick={() => handleView(r)} className="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 mr-3"><FileText className="w-4 h-4" /></button>
                    <button onClick={() => openEdit(r)} className="text-orange-600 dark:text-orange-400 hover:text-orange-900 dark:hover:text-orange-300 mr-3"><Edit className="w-4 h-4" /></button>
                    <button onClick={() => handleDelete(r.menuItemId)} className="text-red-600 dark:text-red-400 hover:text-red-900 dark:hover:text-red-300"><Trash2 className="w-4 h-4" /></button>
                  </td>
                </tr>
              ))}
              {recipes.length === 0 && <tr><td colSpan={6} className="px-6 py-8 text-center text-sm text-gray-500 dark:text-gray-400">No recipes defined</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>

      {showModal && (
        <Modal title={editing ? 'Edit Recipe' : 'Add Recipe'} onClose={() => { setShowModal(false); setEditing(null); }}>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Menu Item</label>
              <select value={formData.menuItemId} onChange={(e) => setFormData({ ...formData, menuItemId: e.target.value })} className="flex h-10 w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-[#111116] px-3 py-2 text-sm dark:text-gray-100" required>
                <option value="">Select menu item</option>
                {menuItems.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Input id="r-name" label="Recipe Name (optional)" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} />
              <Input id="r-servings" type="number" label="Servings" value={formData.servings} onChange={(e) => setFormData({ ...formData, servings: e.target.value })} required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Description</label>
              <textarea value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })} className="flex min-h-[60px] w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-[#111116] px-3 py-2 text-sm dark:text-gray-100" />
            </div>
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Ingredients</label>
                <Button type="button" size="sm" variant="secondary" onClick={addRow}><Plus className="w-3 h-3 mr-1" />Add</Button>
              </div>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {formData.ingredients.length === 0 && <p className="text-sm text-gray-500 dark:text-gray-400">No ingredients added</p>}
                {formData.ingredients.map((row, idx) => (
                  <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                    <select value={row.ingredientId} onChange={(e) => updateRow(idx, 'ingredientId', e.target.value)} className="col-span-5 h-9 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-[#111116] px-2 text-sm dark:text-gray-100" required>
                      <option value="">Ingredient</option>
                      {ingredients.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                    </select>
                    <Input value={row.quantity} onChange={(e) => updateRow(idx, 'quantity', e.target.value)} placeholder="Qty" type="number" step="0.01" className="col-span-2" required />
                    <select value={row.unit} onChange={(e) => updateRow(idx, 'unit', e.target.value)} className="col-span-2 h-9 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-[#111116] px-2 text-sm dark:text-gray-100">
                      <option value="kg">kg</option><option value="g">g</option><option value="l">l</option>
                      <option value="ml">ml</option><option value="pcs">pcs</option><option value="box">box</option>
                    </select>
                    <Input value={row.notes} onChange={(e) => updateRow(idx, 'notes', e.target.value)} placeholder="Notes" className="col-span-2" />
                    <button type="button" onClick={() => removeRow(idx)} className="col-span-1 text-red-600 dark:text-red-400 hover:text-red-900 dark:hover:text-red-300 flex justify-center"><Trash2 className="w-4 h-4" /></button>
                  </div>
                ))}
              </div>
            </div>
            <div className="flex justify-end gap-3">
              <Button type="button" variant="secondary" onClick={() => { setShowModal(false); setEditing(null); }}>Cancel</Button>
              <Button type="submit">{editing ? 'Update' : 'Create'}</Button>
            </div>
          </form>
        </Modal>
      )}

      {viewing && (
        <Modal title={`Recipe: ${viewing.menuItemName || viewing.name}`} onClose={() => setViewing(null)}>
          <div className="space-y-3">
            <p className="text-sm text-gray-600 dark:text-gray-400">Servings: {viewing.servings} · Menu Price: KSh {(viewing.menuItemPrice || 0).toLocaleString()}</p>
            {viewing.description && <p className="text-sm text-gray-700 dark:text-gray-300">{viewing.description}</p>}
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
              <thead className="bg-[#faf9f7] dark:bg-[#111116]/70">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Ingredient</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Quantity</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {viewing.ingredients.map((ri) => (
                  <tr key={ri.id} className="hover:bg-[#faf9f7] dark:hover:bg-[#1a1a20]/30">
                    <td className="px-3 py-2 text-sm text-gray-900 dark:text-gray-100">{ri.ingredientName}</td>
                    <td className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">{ri.quantity} {ri.unit}</td>
                    <td className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">{ri.notes || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Modal>
      )}
    </div>
  );
}

function SuppliersTab() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [formData, setFormData] = useState({
    name: '', contactName: '', email: '', phone: '', address: '', city: '',
    taxNumber: '', businessRegNumber: '', notes: '', status: 'ACTIVE',
  });

  const fetchData = async () => {
    try {
      setLoading(true);
      const params: any = {};
      if (search) params.search = search;
      if (filterStatus) params.status = filterStatus;
      const response = await inventoryApi.getSuppliers(params);
      if (response.data.success) setSuppliers(response.data.data?.items || []);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to load suppliers');
    } finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [search, filterStatus]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editing) await inventoryApi.updateSupplier(editing.id, formData);
      else await inventoryApi.createSupplier(formData);
      setShowModal(false); setEditing(null);
      setFormData({ name: '', contactName: '', email: '', phone: '', address: '', city: '', taxNumber: '', businessRegNumber: '', notes: '', status: 'ACTIVE' });
      fetchData();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to save supplier');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Deactivate this supplier?')) return;
    try { await inventoryApi.deleteSupplier(id); fetchData(); }
    catch (err: any) { setError(err.response?.data?.message || 'Failed to delete'); }
  };

  const filtered = suppliers.filter((s) => !search || s.name.toLowerCase().includes(search.toLowerCase()));

  if (loading) return <div className="text-gray-500 dark:text-gray-400 text-sm">Loading suppliers...</div>;

  return (
    <div className="space-y-4">
      {error && <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 px-4 py-3 rounded-md text-sm">{error}</div>}
      <div className="flex justify-end">
        <Button onClick={() => { setEditing(null); setFormData({ name: '', contactName: '', email: '', phone: '', address: '', city: '', taxNumber: '', businessRegNumber: '', notes: '', status: 'ACTIVE' }); setShowModal(true); }} className="gap-2">
          <Plus className="w-4 h-4" />Add Supplier
        </Button>
      </div>
      <Card>
        <div className="flex flex-col sm:flex-row gap-4 mb-4">
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
            <Input placeholder="Search suppliers..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-10 pr-4" />
          </div>
          <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="flex h-10 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-[#111116] px-3 py-2 text-sm dark:text-gray-100">
            <option value="">All Status</option>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
          </select>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-[#faf9f7] dark:bg-[#111116]/70">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Name</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Contact</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Phone</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">City</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Status</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-[#111116] divide-y divide-gray-200 dark:divide-gray-700">
              {filtered.map((s) => (
                <tr key={s.id} className="hover:bg-[#faf9f7] dark:hover:bg-[#1a1a20]/30">
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-gray-100">{s.name}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">{s.contactName || '-'}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">{s.phone || '-'}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">{s.city || '-'}</td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <Badge variant={s.status === 'ACTIVE' ? 'success' : 'warning'}>{s.status}</Badge>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <button onClick={() => { setEditing(s); setFormData({ name: s.name, contactName: s.contactName || '', email: s.email || '', phone: s.phone || '', address: s.address || '', city: s.city || '', taxNumber: s.taxNumber || '', businessRegNumber: s.businessRegNumber || '', notes: s.notes || '', status: s.status }); setShowModal(true); }} className="text-orange-600 dark:text-orange-400 hover:text-orange-900 dark:hover:text-orange-300 mr-3"><Edit className="w-4 h-4" /></button>
                    <button onClick={() => handleDelete(s.id)} className="text-red-600 dark:text-red-400 hover:text-red-900 dark:hover:text-red-300"><Trash2 className="w-4 h-4" /></button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && <tr><td colSpan={6} className="px-6 py-8 text-center text-sm text-gray-500 dark:text-gray-400">No suppliers found</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>

      {showModal && (
        <Modal title={editing ? 'Edit Supplier' : 'Add Supplier'} onClose={() => { setShowModal(false); setEditing(null); }}>
          <form onSubmit={handleSubmit} className="space-y-4">
            <Input id="s-name" label="Business Name" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} required />
            <Input id="s-contact" label="Contact Person" value={formData.contactName} onChange={(e) => setFormData({ ...formData, contactName: e.target.value })} />
            <div className="grid grid-cols-2 gap-4">
              <Input id="s-email" type="email" label="Email" value={formData.email} onChange={(e) => setFormData({ ...formData, email: e.target.value })} />
              <Input id="s-phone" label="Phone" value={formData.phone} onChange={(e) => setFormData({ ...formData, phone: e.target.value })} />
            </div>
            <Input id="s-address" label="Address" value={formData.address} onChange={(e) => setFormData({ ...formData, address: e.target.value })} />
            <div className="grid grid-cols-2 gap-4">
              <Input id="s-city" label="City" value={formData.city} onChange={(e) => setFormData({ ...formData, city: e.target.value })} />
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Status</label>
                <select value={formData.status} onChange={(e) => setFormData({ ...formData, status: e.target.value })} className="flex h-10 w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-[#111116] px-3 py-2 text-sm dark:text-gray-100">
                  <option value="ACTIVE">Active</option>
                  <option value="INACTIVE">Inactive</option>
                </select>
              </div>
            </div>
            <Input id="s-tax" label="Tax / Business Registration" value={formData.taxNumber} onChange={(e) => setFormData({ ...formData, taxNumber: e.target.value })} />
            <Input id="s-bizreg" label="Business Registration Number" value={formData.businessRegNumber} onChange={(e) => setFormData({ ...formData, businessRegNumber: e.target.value })} />
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Notes</label>
              <textarea value={formData.notes} onChange={(e) => setFormData({ ...formData, notes: e.target.value })} className="flex min-h-[60px] w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-[#111116] px-3 py-2 text-sm dark:text-gray-100" />
            </div>
            <div className="flex justify-end gap-3">
              <Button type="button" variant="secondary" onClick={() => { setShowModal(false); setEditing(null); }}>Cancel</Button>
              <Button type="submit">{editing ? 'Update' : 'Create'}</Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

function PurchaseOrdersTab() {
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [branches, setBranches] = useState<Array<{ id: string; name: string; code: string }>>([]);
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [viewing, setViewing] = useState<PurchaseOrder | null>(null);
  const [receiving, setReceiving] = useState<PurchaseOrder | null>(null);
  const [receiveItems, setReceiveItems] = useState<Array<{ purchaseOrderItemId: string; receivedQuantity: string; batchNumber: string; expiryDate: string }>>([]);
  const [formData, setFormData] = useState({
    branchId: '', supplierId: '', notes: '',
    items: [] as PurchaseRow[],
  });

  const fetchData = async () => {
    try {
      setLoading(true);
      const params: any = {};
      if (search) params.search = search;
      if (filterStatus) params.status = filterStatus;
      const [oRes, sRes, bRes, iRes] = await Promise.all([
        inventoryApi.getPurchaseOrders(params),
        inventoryApi.getSuppliers(),
        branchApi.getBranches(),
        inventoryApi.getIngredients(),
      ]);
      if (oRes.data.success) setOrders(oRes.data.data?.items || []);
      if (sRes.data.success) setSuppliers(sRes.data.data?.items || []);
      if (bRes.data.success) setBranches(bRes.data.data?.branches || []);
      if (iRes.data.success) setIngredients(iRes.data.data?.items || []);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to load purchase orders');
    } finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [search, filterStatus]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const data = {
        branchId: formData.branchId,
        supplierId: formData.supplierId,
        notes: formData.notes,
        items: formData.items.map((row) => ({
          ingredientId: row.ingredientId,
          quantity: parseFloat(row.quantity),
          unit: row.unit,
          unitPrice: parseFloat(row.unitPrice),
        })),
      };
      await inventoryApi.createPurchaseOrder(data);
      setShowModal(false);
      setFormData({ branchId: '', supplierId: '', notes: '', items: [] });
      fetchData();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to create purchase order');
    }
  };

  const handleStatusAction = async (id: string, action: 'submit' | 'approve' | 'cancel') => {
    const reason = action === 'cancel' ? prompt('Cancellation reason (optional):') : undefined;
    try {
      if (action === 'submit') await inventoryApi.submitPurchaseOrder(id);
      else if (action === 'approve') await inventoryApi.approvePurchaseOrder(id);
      else if (action === 'cancel') await inventoryApi.cancelPurchaseOrder(id, reason ? { reason } : undefined);
      fetchData();
      if (viewing && viewing.id === id) setViewing(null);
    } catch (err: any) {
      setError(err.response?.data?.message || `Failed to ${action} order`);
    }
  };

  const handleDelete = async (po: PurchaseOrder) => {
    if (!window.confirm(`Delete purchase order ${po.orderNumber}? This cannot be undone.`)) return;
    try {
      await inventoryApi.deletePurchaseOrder(po.id);
      await fetchData();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to delete purchase order');
    }
  };

  const openReceive = async (po: PurchaseOrder) => {
    try {
      // The list endpoint returns summary rows without line items. Always
      // load the complete purchase order before opening the receiving form.
      const response = await inventoryApi.getPurchaseOrder(po.id);
      const fullOrder = response.data?.data || response.data?.purchaseOrder || response.data;
      const items = Array.isArray(fullOrder?.items) ? fullOrder.items : [];
      if (!items.length) {
        setError('This purchase order has no line items available to receive.');
        return;
      }
      const normalizedOrder = { ...po, ...fullOrder, items } as PurchaseOrder;
      setReceiving(normalizedOrder);
      setReceiveItems(items.map((it: any) => ({ purchaseOrderItemId: it.id, receivedQuantity: '', batchNumber: '', expiryDate: '' })));
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to load purchase order details');
    }
  };

  const handleReceive = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!receiving) return;
    try {
      const items = receiveItems
        .filter((ri) => ri.receivedQuantity !== '')
        .map((ri) => ({ purchaseOrderItemId: ri.purchaseOrderItemId, receivedQuantity: parseFloat(ri.receivedQuantity), batchNumber: ri.batchNumber || undefined, expiryDate: ri.expiryDate || undefined }));
      await inventoryApi.receivePurchaseOrder(receiving.id, { items });
      setReceiving(null);
      setReceiveItems([]);
      fetchData();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to receive order');
    }
  };

  const addRow = () => {
    setFormData({ ...formData, items: [...formData.items, { ingredientId: '', quantity: '', unit: 'kg', unitPrice: '' }] });
  };

  const updateRow = (idx: number, field: keyof PurchaseRow, value: string) => {
    const updated = [...formData.items];
    updated[idx] = { ...updated[idx], [field]: value };
    setFormData({ ...formData, items: updated });
  };

  const removeRow = (idx: number) => {
    setFormData({ ...formData, items: formData.items.filter((_, i) => i !== idx) });
  };

  if (loading) return <div className="text-gray-500 dark:text-gray-400 text-sm">Loading purchase orders...</div>;

  return (
    <div className="space-y-4">
      {error && <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 px-4 py-3 rounded-md text-sm">{error}</div>}
      <div className="flex justify-end">
        <Button onClick={() => { setFormData({ branchId: branches[0]?.id || '', supplierId: '', notes: '', items: [] }); setShowModal(true); }} className="gap-2">
          <Plus className="w-4 h-4" />New Purchase Order
        </Button>
      </div>
      <Card>
        <div className="flex flex-col sm:flex-row gap-4 mb-4">
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
            <Input placeholder="Search orders..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-10 pr-4" />
          </div>
          <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="flex h-10 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-[#111116] px-3 py-2 text-sm dark:text-gray-100">
            <option value="">All Status</option>
            <option value="DRAFT">Draft</option>
            <option value="SUBMITTED">Submitted</option>
            <option value="APPROVED">Approved</option>
            <option value="PARTIALLY_RECEIVED">Partially Received</option>
            <option value="RECEIVED">Received</option>
            <option value="CANCELLED">Cancelled</option>
          </select>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-[#faf9f7] dark:bg-[#111116]/70">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Order #</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Supplier</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Branch</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Items</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Total</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Status</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Date</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-[#111116] divide-y divide-gray-200 dark:divide-gray-700">
              {orders.map((o) => (
                <tr key={o.id} className="hover:bg-[#faf9f7] dark:hover:bg-[#1a1a20]/30">
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-gray-100">{o.orderNumber}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">{o.supplierName || '-'}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">{o.branchName || '-'}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">{o.itemCount ?? o.items?.length ?? 0}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100">KSh {(o.totalAmount ?? 0).toLocaleString()}</td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <Badge variant={o.status === 'RECEIVED' ? 'success' : o.status === 'CANCELLED' ? 'danger' : o.status === 'PARTIALLY_RECEIVED' ? 'warning' : 'info'}>{o.status === 'RECEIVED' ? 'COMPLETED / RECEIVED' : o.status}</Badge>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">{new Date(o.orderDate).toLocaleDateString()}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <button onClick={async () => { try { const res = await inventoryApi.getPurchaseOrder(o.id); setViewing({ ...o, ...(res.data?.data || res.data?.purchaseOrder || res.data) }); } catch (err: any) { setError(err.response?.data?.message || 'Failed to load purchase order details'); } }} className="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 mr-3"><FileText className="w-4 h-4" /></button>
                    {o.status === 'DRAFT' && (
                      <button onClick={() => handleStatusAction(o.id, 'submit')} className="text-orange-600 dark:text-orange-400 hover:text-orange-900 dark:hover:text-orange-300 mr-3">Submit</button>
                    )}
                    {o.status === 'SUBMITTED' && (
                      <>
                        <button onClick={() => handleStatusAction(o.id, 'approve')} className="text-green-600 dark:text-green-400 hover:text-green-900 dark:hover:text-green-300 mr-3">Approve</button>
                        <button onClick={() => handleStatusAction(o.id, 'cancel')} className="text-red-600 dark:text-red-400 hover:text-red-900 dark:hover:text-red-300">Cancel</button>
                      </>
                    )}
                    {(o.status === 'APPROVED' || o.status === 'PARTIALLY_RECEIVED') && (
                      <button onClick={() => openReceive(o)} className="text-green-600 dark:text-green-400 hover:text-green-900 dark:hover:text-green-300 mr-3">Receive</button>
                    )}
                    {(o.status === 'DRAFT' || o.status === 'CANCELLED') && (
                      <button onClick={() => handleDelete(o)} className="text-red-600 dark:text-red-400 hover:text-red-900 dark:hover:text-red-300" title="Delete purchase order"><Trash2 className="w-4 h-4" /></button>
                    )}
                  </td>
                </tr>
              ))}
              {orders.length === 0 && <tr><td colSpan={8} className="px-6 py-8 text-center text-sm text-gray-500 dark:text-gray-400">No purchase orders</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>

      {showModal && (
        <Modal title="New Purchase Order" onClose={() => setShowModal(false)}>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Branch</label>
                <select value={formData.branchId} onChange={(e) => setFormData({ ...formData, branchId: e.target.value })} className="flex h-10 w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-[#111116] px-3 py-2 text-sm dark:text-gray-100" required>
                  <option value="">Select branch</option>
                  {branches.map((b) => <option key={b.id} value={b.id}>{b.name} ({b.code})</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Supplier</label>
                <select value={formData.supplierId} onChange={(e) => setFormData({ ...formData, supplierId: e.target.value })} className="flex h-10 w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-[#111116] px-3 py-2 text-sm dark:text-gray-100" required>
                  <option value="">Select supplier</option>
                  {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Notes</label>
              <textarea value={formData.notes} onChange={(e) => setFormData({ ...formData, notes: e.target.value })} className="flex min-h-[60px] w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-[#111116] px-3 py-2 text-sm dark:text-gray-100" />
            </div>
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Items</label>
                <Button type="button" size="sm" variant="secondary" onClick={addRow}><Plus className="w-3 h-3 mr-1" />Add</Button>
              </div>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {formData.items.length === 0 && <p className="text-sm text-gray-500 dark:text-gray-400">No items added</p>}
                {formData.items.map((row, idx) => (
                  <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                    <select value={row.ingredientId} onChange={(e) => updateRow(idx, 'ingredientId', e.target.value)} className="col-span-5 h-9 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-[#111116] px-2 text-sm dark:text-gray-100" required>
                      <option value="">Ingredient</option>
                      {ingredients.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                    </select>
                    <Input value={row.quantity} onChange={(e) => updateRow(idx, 'quantity', e.target.value)} placeholder="Qty" type="number" step="0.01" className="col-span-2" required />
                    <select value={row.unit} onChange={(e) => updateRow(idx, 'unit', e.target.value)} className="col-span-2 h-9 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-[#111116] px-2 text-sm dark:text-gray-100">
                      <option value="kg">kg</option><option value="g">g</option><option value="l">l</option>
                      <option value="ml">ml</option><option value="pcs">pcs</option><option value="box">box</option>
                    </select>
                    <Input value={row.unitPrice} onChange={(e) => updateRow(idx, 'unitPrice', e.target.value)} placeholder="Price" type="number" step="0.01" className="col-span-2" required />
                    <button type="button" onClick={() => removeRow(idx)} className="col-span-1 text-red-600 dark:text-red-400 hover:text-red-900 dark:hover:text-red-300 flex justify-center"><Trash2 className="w-4 h-4" /></button>
                  </div>
                ))}
              </div>
            </div>
            <div className="flex justify-end gap-3">
              <Button type="button" variant="secondary" onClick={() => setShowModal(false)}>Cancel</Button>
              <Button type="submit">Create Order</Button>
            </div>
          </form>
        </Modal>
      )}

      {viewing && (
        <Modal title={`Purchase Order ${viewing.orderNumber}`} onClose={() => setViewing(null)}>
          <div className="space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-gray-500 dark:text-gray-400">Supplier:</span>
              <span className="font-medium dark:text-gray-100">{viewing.supplierName}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500 dark:text-gray-400">Branch:</span>
              <span className="font-medium dark:text-gray-100">{viewing.branchName || '-'}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500 dark:text-gray-400">Status:</span>
              <Badge variant={viewing.status === 'RECEIVED' ? 'success' : viewing.status === 'CANCELLED' ? 'danger' : 'warning'}>{viewing.status}</Badge>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500 dark:text-gray-400">Order Date:</span>
              <span className="font-medium dark:text-gray-100">{new Date(viewing.orderDate).toLocaleDateString()}</span>
            </div>
            {viewing.expectedDeliveryDate && (
              <div className="flex justify-between text-sm">
                <span className="text-gray-500 dark:text-gray-400">Expected Delivery:</span>
                <span className="font-medium dark:text-gray-100">{new Date(viewing.expectedDeliveryDate).toLocaleDateString()}</span>
              </div>
            )}
            {viewing.notes && <p className="text-sm text-gray-700 dark:text-gray-300">{viewing.notes}</p>}
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
              <thead className="bg-[#faf9f7] dark:bg-[#111116]/70">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Ingredient</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Ordered</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Received</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Unit Price</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {(viewing.items || []).map((it) => (
                  <tr key={it.id} className="hover:bg-[#faf9f7] dark:hover:bg-[#1a1a20]/30">
                    <td className="px-3 py-2 text-sm text-gray-900 dark:text-gray-100">{it.ingredientName}</td>
                    <td className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">{it.orderedQuantity} {it.unit}</td>
                    <td className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">{it.receivedQuantity} {it.unit}</td>
                    <td className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">KSh {(it.unitPrice ?? 0).toLocaleString()}</td>
                    <td className="px-3 py-2 text-sm text-gray-900 dark:text-gray-100">KSh {(it.totalPrice ?? 0).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="flex justify-between pt-2 border-t border-orange-100 dark:border-gray-700">
              <span className="font-medium dark:text-gray-100">Total</span>
              <span className="font-bold dark:text-gray-100">KSh {(viewing.totalAmount ?? 0).toLocaleString()}</span>
            </div>
          </div>
        </Modal>
      )}

      {receiving && (
        <Modal title={`Receive PO ${receiving.orderNumber}`} onClose={() => setReceiving(null)}>
          <form onSubmit={handleReceive} className="space-y-4">
            <p className="text-sm text-gray-600 dark:text-gray-400">Enter quantities actually received for each item.</p>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {(receiving.items || []).map((it) => {
                const row = receiveItems.find((r) => r.purchaseOrderItemId === it.id);
                return <div key={it.id} className="grid grid-cols-12 gap-2 items-center border-b border-orange-100 dark:border-gray-700 pb-3">
                  <div className="col-span-3 text-sm text-gray-900 dark:text-gray-100">{it.ingredientName}<div className="text-xs text-gray-500">Ordered: {it.orderedQuantity} {it.unit}</div></div>
                  <Input type="number" step="0.01" placeholder="Received" className="col-span-3" value={row?.receivedQuantity || ''} onChange={(e) => setReceiveItems(receiveItems.map((r) => r.purchaseOrderItemId === it.id ? { ...r, receivedQuantity: e.target.value } : r))} required />
                  <Input placeholder="Batch #" className="col-span-3" value={row?.batchNumber || ''} onChange={(e) => setReceiveItems(receiveItems.map((r) => r.purchaseOrderItemId === it.id ? { ...r, batchNumber: e.target.value } : r))} />
                  <Input type="date" className="col-span-3" value={row?.expiryDate || ''} onChange={(e) => setReceiveItems(receiveItems.map((r) => r.purchaseOrderItemId === it.id ? { ...r, expiryDate: e.target.value } : r))} />
                </div>;
              })}
            </div>
            <div className="flex justify-end gap-3">
              <Button type="button" variant="secondary" onClick={() => setReceiving(null)}>Cancel</Button>
              <Button type="submit">Receive Stock</Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
