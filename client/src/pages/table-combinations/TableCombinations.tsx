import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search, Edit, Trash2 } from 'lucide-react';
import { tableApi } from '../../services/api';
import type { TableCombination } from '../../types';
import Button from '../../components/ui/Button';
import Card from '../../components/ui/Card';
import Badge from '../../components/ui/Badge';
import Modal from '../../components/ui/Modal';
import Input from '../../components/ui/Input';
import { useAuth } from '../../contexts/AuthContext';
import { getActiveBranchId, listenForBranchChanges } from '../../utils/branch';

export default function TableCombinations() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [combinations, setCombinations] = useState<TableCombination[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingCombination, setEditingCombination] = useState<TableCombination | null>(null);
  const [formData, setFormData] = useState({ name: '', status: 'ACTIVE' });

  const fetchCombinations = async () => {
    try {
      const activeBranchId = getActiveBranchId(user);
      const response = await tableApi.getTableCombinations({ search, status: 'ACTIVE', ...(activeBranchId ? { branchId: activeBranchId } : {}) });
      if (response.data.success) {
        setCombinations(response.data.data?.combinations || []);
      }
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to load table combinations');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCombinations();
    return listenForBranchChanges(fetchCombinations);
  }, [search, user?.id]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingCombination) {
        await tableApi.updateTableCombination(editingCombination.id, formData);
      } else {
        alert('Please use the Floor Plan to create table combinations by selecting tables and clicking Combine.');
        return;
      }
      setShowModal(false);
      setEditingCombination(null);
      setFormData({ name: '', status: 'ACTIVE' });
      fetchCombinations();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to save table combination');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to deactivate this table combination?')) return;
    try {
      await tableApi.deleteTableCombination(id);
      fetchCombinations();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to delete table combination');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-gray-500 dark:text-gray-400">Loading table combinations...</div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Table Combinations</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Manage combined tables for larger groups</p>
        </div>
        <Button onClick={() => navigate('/tables')} className="gap-2">
          <Plus className="w-4 h-4" />
          Select Tables
        </Button>
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 px-4 py-3 rounded-md text-sm">
          {error}
        </div>
      )}

      <Card>
        <div className="mb-4">
          <div className="relative">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500 pointer-events-none" />
            <input
              type="text"
              placeholder="Search combinations..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex h-10 w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-[#111116] pl-10 pr-4 py-2 text-sm"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-[#faf9f7] dark:bg-[#111116]/70">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Name</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Tables</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Branch</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Status</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-[#111116] divide-y divide-gray-200 dark:divide-gray-700">
              {combinations.map((combination) => (
                <tr key={combination.id} className="hover:bg-[#faf9f7] dark:hover:bg-[#1a1a20]/30">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{combination.name}</div>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-500 dark:text-gray-400">
                    {combination.tableIds.length} table{combination.tableIds.length > 1 ? 's' : ''}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-500 dark:text-gray-400">{combination.branchName}</td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <Badge variant={combination.status === 'ACTIVE' ? 'success' : 'warning'}>{combination.status}</Badge>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <button
                      onClick={() => { setEditingCombination(combination); setFormData({ name: combination.name, status: combination.status }); setShowModal(true); }}
                      className="text-orange-600 dark:text-orange-400 hover:text-orange-900 dark:hover:text-orange-300 mr-3"
                    >
                      <Edit className="w-4 h-4" />
                    </button>
                    {combination.status === 'ACTIVE' && (
                      <button onClick={() => handleDelete(combination.id)} className="text-red-600 dark:text-red-400 hover:text-red-900 dark:hover:text-red-300">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {combinations.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
                    No table combinations found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {showModal && (
        <Modal title={editingCombination ? 'Edit Table Combination' : 'Add Table Combination'} onClose={() => { setShowModal(false); setEditingCombination(null); }}>
          <form onSubmit={handleSubmit} className="space-y-4">
            <Input id="name" label="Name" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} required />
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Status</label>
              <select value={formData.status} onChange={(e) => setFormData({ ...formData, status: e.target.value })} className="flex h-10 w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-[#111116] text-gray-900 dark:text-gray-100 px-3 py-2 text-sm">
                <option value="ACTIVE">Active</option>
                <option value="INACTIVE">Inactive</option>
              </select>
            </div>
            {!editingCombination && (
              <div className="bg-yellow-50 dark:bg-yellow-900/30 border border-yellow-200 dark:border-yellow-800 text-yellow-700 dark:text-yellow-400 px-4 py-3 rounded-md text-sm">
                To create a table combination, go to the Floor Plan, select multiple tables (Shift+Click), and click Combine.
              </div>
            )}
            <div className="flex justify-end gap-3">
              <Button type="button" variant="secondary" onClick={() => { setShowModal(false); setEditingCombination(null); }}>Cancel</Button>
              <Button type="submit">{editingCombination ? 'Update' : 'Create'}</Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
