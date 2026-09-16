import { useState, useEffect } from 'react';
import { Plus, Trash2, Edit, ShieldCheck } from 'lucide-react';
import { api } from '../../services/api';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import Card from '../../components/ui/Card';
import Badge from '../../components/ui/Badge';

interface Permission { key: string; label: string; group: string }
interface Role { id: string; name: string; description?: string; permissions: string[]; maxDiscountPercent?: number; maxDiscountAmount?: number; isSystem: boolean; userCount: number; createdAt: string }

export default function Roles() {
  const [roles, setRoles] = useState<Role[]>([]);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingRole, setEditingRole] = useState<Role | null>(null);
  const [formData, setFormData] = useState({ name: '', description: '', permissions: [] as string[], maxDiscountPercent: 100, maxDiscountAmount: 1000000 });

  const fetchAll = async () => {
    try {
      const [r, p] = await Promise.all([api.get('/roles'), api.get('/roles/permissions')]);
      if (r.data.success) setRoles(r.data.data?.roles || []);
      if (p.data.success) setPermissions(p.data.data?.permissions || []);
    } catch (err: any) { setError(err.response?.data?.message || 'Failed to load roles'); }
    finally { setLoading(false); }
  };
  useEffect(() => { fetchAll(); }, []);

  const openCreate = () => { setEditingRole(null); setFormData({ name: '', description: '', permissions: [], maxDiscountPercent: 100, maxDiscountAmount: 1000000 }); setShowModal(true); };
  const openEdit = (role: Role) => { setEditingRole(role); setFormData({ name: role.name, description: role.description || '', permissions: role.permissions || [], maxDiscountPercent: role.maxDiscountPercent ?? 100, maxDiscountAmount: role.maxDiscountAmount ?? 1000000 }); setShowModal(true); };
  const toggle = (key: string) => setFormData((f) => ({ ...f, permissions: f.permissions.includes(key) ? f.permissions.filter((p) => p !== key) : [...f.permissions, key] }));
  const toggleGroup = (group: string) => {
    const keys = permissions.filter((p) => p.group === group).map((p) => p.key);
    const all = keys.every((k) => formData.permissions.includes(k));
    setFormData((f) => ({ ...f, permissions: all ? f.permissions.filter((p) => !keys.includes(p)) : [...new Set([...f.permissions, ...keys])] }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setError('');
    try {
      const data = { name: formData.name, description: formData.description, permissions: formData.permissions, maxDiscountPercent: formData.maxDiscountPercent, maxDiscountAmount: formData.maxDiscountAmount };
      if (editingRole) await api.put(`/roles/${editingRole.id}`, data); else await api.post('/roles', data);
      setShowModal(false); fetchAll();
    } catch (err: any) { setError(err.response?.data?.message || 'Failed to save role'); }
  };
  const handleDelete = async (id: string) => {
    if (!confirm('Delete this custom role?')) return;
    try { await api.delete(`/roles/${id}`); fetchAll(); } catch (err: any) { setError(err.response?.data?.message || 'Failed to delete role'); }
  };
  const groups = [...new Set(permissions.map((p) => p.group))];

  if (loading) return <div className="flex items-center justify-center h-full"><div className="text-gray-500 dark:text-gray-400">Loading roles...</div></div>;
  return <div className="p-6 space-y-6">
    <div className="flex items-center justify-between"><div><h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Roles & Permissions</h1><p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Control what each staff role can access and manage.</p></div><Button onClick={openCreate} className="gap-2"><Plus className="w-4 h-4"/>Create Role</Button></div>
    {error && <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 px-4 py-3 rounded-md text-sm">{error}</div>}
    <Card><div className="overflow-x-auto"><table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700"><thead className="bg-[#faf9f7] dark:bg-[#111116]/70"><tr>{['Role','Description','Users','Permissions','Type','Actions'].map(h=><th key={h} className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">{h}</th>)}</tr></thead><tbody className="bg-white dark:bg-[#111116] divide-y divide-gray-200 dark:divide-gray-700">{roles.map(role=><tr key={role.id}><td className="px-6 py-4 font-medium text-gray-900 dark:text-gray-100">{role.name}</td><td className="px-6 py-4 text-sm text-gray-500 dark:text-gray-400">{role.description || '-'}</td><td className="px-6 py-4 text-sm text-gray-500 dark:text-gray-400">{role.userCount}</td><td className="px-6 py-4 text-sm text-gray-500 dark:text-gray-400">{role.permissions.includes('*') ? 'Full access' : `${role.permissions.length} permissions`}</td><td className="px-6 py-4"><Badge variant={role.isSystem ? 'info' : 'default'}>{role.isSystem ? 'System' : 'Custom'}</Badge></td><td className="px-6 py-4"><button onClick={()=>openEdit(role)} className="text-orange-600 dark:text-orange-400 mr-3"><Edit className="w-4 h-4"/></button>{!role.isSystem && <button onClick={()=>handleDelete(role.id)} className="text-red-600 dark:text-red-400"><Trash2 className="w-4 h-4"/></button>}</td></tr>)}</tbody></table></div></Card>
    {showModal && <div className="fixed inset-0 bg-black/50 dark:bg-black/70 flex items-center justify-center z-50 p-4"><Card title={editingRole ? `Edit ${editingRole.name}` : 'Create Role'} className="w-full max-w-3xl max-h-[90vh] overflow-y-auto"><form onSubmit={handleSubmit} className="space-y-5"><div className="grid grid-cols-1 md:grid-cols-2 gap-4"><Input id="roleName" label="Role Name" value={formData.name} onChange={e=>setFormData({...formData,name:e.target.value})} disabled={!!editingRole?.isSystem} required/><Input id="roleDescription" label="Description" value={formData.description} onChange={e=>setFormData({...formData,description:e.target.value})}/></div><div className="grid grid-cols-1 md:grid-cols-2 gap-4 border border-orange-100 dark:border-gray-700 rounded-lg p-4">
<div><Input id="maxDiscountPercent" type="number" min="0" max="100" step="0.01" label="Max Discount (%)" value={formData.maxDiscountPercent} onChange={e=>setFormData({...formData,maxDiscountPercent:Number(e.target.value)})}/><p className="text-xs text-gray-500 mt-1">Maximum percentage discount this role can approve.</p></div>
<div><Input id="maxDiscountAmount" type="number" min="0" step="0.01" label="Max Discount Amount" value={formData.maxDiscountAmount} onChange={e=>setFormData({...formData,maxDiscountAmount:Number(e.target.value)})}/><p className="text-xs text-gray-500 mt-1">Maximum fixed discount amount this role can approve.</p></div>
</div><div><div className="flex items-center gap-2 mb-3"><ShieldCheck className="w-5 h-5 text-orange-500"/><h3 className="font-semibold text-gray-900 dark:text-gray-100">Permissions</h3></div><div className="grid grid-cols-1 md:grid-cols-2 gap-4">{groups.map(group=>{const items=permissions.filter(p=>p.group===group); const all=items.every(p=>formData.permissions.includes(p.key)); return <div key={group} className="border border-orange-100 dark:border-gray-700 rounded-lg p-4"><div className="flex justify-between mb-3"><span className="font-medium text-gray-900 dark:text-gray-100">{group}</span><button type="button" onClick={()=>toggleGroup(group)} className="text-xs text-orange-600 dark:text-orange-400">{all?'Clear':'All'}</button></div><div className="space-y-2">{items.map(p=><label key={p.key} className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300"><input type="checkbox" checked={formData.permissions.includes(p.key)} onChange={()=>toggle(p.key)} className="rounded border-gray-300"/>{p.label}</label>)}</div></div>})}</div></div><div className="flex justify-end gap-3"><Button type="button" variant="secondary" onClick={()=>setShowModal(false)}>Cancel</Button><Button type="submit">{editingRole?'Save Changes':'Create Role'}</Button></div></form></Card></div>}
  </div>;
}
