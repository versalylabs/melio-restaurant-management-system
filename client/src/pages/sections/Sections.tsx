import { useState, useEffect } from 'react';
import { Plus, Search, Edit, Trash2 } from 'lucide-react';
import { sectionApi, branchApi } from '../../services/api';
import type { Section } from '../../types';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import Card from '../../components/ui/Card';
import Badge from '../../components/ui/Badge';
import Modal from '../../components/ui/Modal';
import { useAuth } from '../../contexts/AuthContext';
import { getActiveBranchId, listenForBranchChanges } from '../../utils/branch';

type Branch = { id: string; name: string; code: string; status?: string };

export default function Sections() {
  const { user } = useAuth();
  const [sections, setSections] = useState<Section[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingSection, setEditingSection] = useState<Section | null>(null);
  const [formData, setFormData] = useState({ name: '', description: '', displayOrder: 0, status: 'ACTIVE', branchId: '' });

  const canSwitchBranch = ['OWNER', 'ADMIN', 'MANAGER'].includes(user?.roleName || '');
  const activeBranchId = getActiveBranchId(user);
  const visibleBranches = canSwitchBranch ? branches.filter((b) => b.status !== 'INACTIVE') : branches.filter((b) => b.id === activeBranchId);

  const fetchSections = async () => {
    try {
      setLoading(true);
      setError('');
      const branchId = getActiveBranchId(user);
      const response = await sectionApi.getSections({ search, status: 'ACTIVE', ...(branchId ? { branchId } : {}) });
      if (response.data.success) setSections(response.data.data?.sections || []);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to load sections');
    } finally {
      setLoading(false);
    }
  };

  const fetchBranches = async () => {
    try {
      const response = await branchApi.getBranches();
      const list = response.data?.data?.branches || [];
      setBranches(list);
      const current = getActiveBranchId(user) || list[0]?.id || '';
      setFormData((f) => f.branchId ? f : { ...f, branchId: current });
    } catch (err: any) {
      setError(err.response?.data?.message || 'Unable to load branches. Refresh and try again.');
    }
  };

  useEffect(() => {
    fetchBranches();
    fetchSections();
    return listenForBranchChanges(() => {
      const current = getActiveBranchId(user);
      setFormData((f) => ({ ...f, branchId: current }));
      fetchSections();
    });
  }, [user?.id, search]);

  const openCreate = () => {
    const branchId = getActiveBranchId(user) || branches[0]?.id || '';
    setEditingSection(null);
    setFormData({ name: '', description: '', displayOrder: 0, status: 'ACTIVE', branchId });
    setError('');
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setError('');
      const branchId = formData.branchId || getActiveBranchId(user);
      if (!branchId) throw new Error('Select an active branch before creating a section.');
      const payload = { ...formData, branchId };
      if (editingSection) await sectionApi.updateSection(editingSection.id, payload);
      else await sectionApi.createSection(payload);
      setShowModal(false);
      setEditingSection(null);
      await fetchSections();
    } catch (err: any) {
      setError(err.response?.data?.message || err.message || 'Failed to save section');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to deactivate this section?')) return;
    try {
      setError('');
      await sectionApi.deleteSection(id);
      await fetchSections();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to delete section');
    }
  };

  if (loading) return <div className="flex items-center justify-center h-full"><div className="text-gray-500 dark:text-gray-400">Loading sections...</div></div>;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Sections</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Manage restaurant sections and dining areas</p>
        </div>
        <Button onClick={openCreate} className="gap-2"><Plus className="w-4 h-4" />Add Section</Button>
      </div>

      {error && <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 px-4 py-3 rounded-md text-sm">{error}</div>}

      <Card>
        <div className="mb-4">
          <div className="relative">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500 pointer-events-none" />
            <Input placeholder="Search sections..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-10 pr-4" />
          </div>
        </div>
        <div className="mb-3 text-xs text-gray-500 dark:text-gray-400">Active branch: <span className="font-semibold text-gray-700 dark:text-gray-200">{branches.find((b) => b.id === activeBranchId)?.name || 'Not selected'}</span></div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-[#faf9f7] dark:bg-[#111116]/70"><tr>
              {['Name','Description','Order','Tables','Status','Actions'].map((h) => <th key={h} className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">{h}</th>)}
            </tr></thead>
            <tbody className="bg-white dark:bg-[#111116] divide-y divide-gray-200 dark:divide-gray-700">
              {sections.map((section) => <tr key={section.id} className="hover:bg-[#faf9f7] dark:hover:bg-[#1a1a20]/30">
                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-gray-100">{section.name}</td>
                <td className="px-6 py-4 text-sm text-gray-500 dark:text-gray-400">{section.description || '-'}</td>
                <td className="px-6 py-4 text-sm text-gray-500 dark:text-gray-400">{section.displayOrder}</td>
                <td className="px-6 py-4 text-sm text-gray-500 dark:text-gray-400">{section.tableCount}</td>
                <td className="px-6 py-4"><Badge variant={section.status === 'ACTIVE' ? 'success' : 'warning'}>{section.status}</Badge></td>
                <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                  <button onClick={() => { setEditingSection(section); setFormData({ name: section.name, description: section.description || '', displayOrder: section.displayOrder, status: section.status, branchId: section.branchId }); setShowModal(true); }} className="text-orange-600 dark:text-orange-400 hover:text-orange-900 mr-3" title="Edit section"><Edit className="w-4 h-4" /></button>
                  {section.status === 'ACTIVE' && <button onClick={() => handleDelete(section.id)} className="text-red-600 dark:text-red-400 hover:text-red-900" title="Deactivate section"><Trash2 className="w-4 h-4" /></button>}
                </td>
              </tr>)}
              {!sections.length && <tr><td colSpan={6} className="px-6 py-8 text-center text-sm text-gray-500 dark:text-gray-400">No sections found for this branch</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>

      {showModal && <Modal title={editingSection ? 'Edit Section' : 'Add Section'} onClose={() => { setShowModal(false); setEditingSection(null); }}>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input id="name" label="Name" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} required />
          <Input id="description" label="Description" value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })} />
          <Input id="displayOrder" type="number" label="Display Order" value={formData.displayOrder} onChange={(e) => setFormData({ ...formData, displayOrder: parseInt(e.target.value) || 0 })} />
          <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Branch</label>
            <select value={formData.branchId} onChange={(e) => setFormData({ ...formData, branchId: e.target.value })} className="rms-control w-full" required disabled={!canSwitchBranch}>
              <option value="">Select branch</option>
              {visibleBranches.map((b) => <option key={b.id} value={b.id}>{b.name} ({b.code})</option>)}
            </select>
            {!formData.branchId && <p className="mt-1 text-xs text-red-500">Choose an active branch.</p>}
          </div>
          <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Status</label><select value={formData.status} onChange={(e) => setFormData({ ...formData, status: e.target.value })} className="rms-control w-full"><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option></select></div>
          <div className="flex justify-end gap-3"><Button type="button" variant="secondary" onClick={() => { setShowModal(false); setEditingSection(null); }}>Cancel</Button><Button type="submit">{editingSection ? 'Update' : 'Create'}</Button></div>
        </form>
      </Modal>}
    </div>
  );
}
