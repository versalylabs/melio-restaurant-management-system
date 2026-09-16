import { useState, useEffect } from 'react';
import { Plus, Search, Edit, Trash2, Copy, Eye, Upload, Image as ImageIcon, X } from 'lucide-react';
import { menuItemApi, categoryApi, modifierGroupApi, branchApi } from '../../services/api';
import type { MenuItem, Category, ModifierGroup } from '../../types';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import Card from '../../components/ui/Card';
import Badge from '../../components/ui/Badge';
import Modal from '../../components/ui/Modal';

export default function MenuItems() {
  const [items, setItems] = useState<MenuItem[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [modifierGroups, setModifierGroups] = useState<ModifierGroup[]>([]);
  const [branches, setBranches] = useState<Array<{id:string; name:string; code:string; status?:string}>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingItem, setEditingItem] = useState<MenuItem | null>(null);
  const [viewingItem, setViewingItem] = useState<MenuItem | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageRemoved, setImageRemoved] = useState(false);
  const [imageUploading, setImageUploading] = useState(false);
  const [formData, setFormData] = useState({
    name: '', description: '', image: '', sku: '', sellingPrice: '', costPrice: '', taxRate: '0', preparationTime: '', categoryId: '', available: true, status: 'ACTIVE', displayOrder: 0, branchIds: [] as string[], modifierGroupIds: [] as string[],
  });

  const fetchItems = async () => {
    try {
      const params: any = {};
      if (search) params.search = search;
      if (filterCategory) params.categoryId = filterCategory;
      if (filterStatus) params.status = filterStatus;
      const response = await menuItemApi.getMenuItems(params);
      if (response.data.success) {
        setItems(response.data.data?.items || []);
      }
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to load menu items');
    } finally {
      setLoading(false);
    }
  };

  const fetchFilters = async () => {
    try {
      const [catRes, modRes, branchRes] = await Promise.all([categoryApi.getCategories(), modifierGroupApi.getModifierGroups(), branchApi.getBranches()]);
      if (catRes.data.success) setCategories(catRes.data.data?.categories || []);
      if (modRes.data.success) setModifierGroups(modRes.data.data?.groups || []);
      setBranches((branchRes.data?.data?.branches || []).filter((b:any) => b.status !== 'INACTIVE'));
    } catch {}
  };

  useEffect(() => { fetchFilters(); }, []);

  useEffect(() => {
    fetchItems();
  }, [search, filterCategory, filterStatus]);

  const resetImageState = () => {
    if (imagePreview?.startsWith('blob:')) URL.revokeObjectURL(imagePreview);
    setImageFile(null);
    setImagePreview(null);
    setImageRemoved(false);
    setImageUploading(false);
  };

  const handleImageChange = (file?: File) => {
    if (!file) return;
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!allowed.includes(file.type)) {
      setError('Please choose a JPG, PNG, WEBP or GIF image.');
      return;
    }
    if (file.size > 6 * 1024 * 1024) {
      setError('Image must be 6MB or smaller.');
      return;
    }
    if (imagePreview?.startsWith('blob:')) URL.revokeObjectURL(imagePreview);
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
    setImageRemoved(false);
    setError('');
  };

  const removeSelectedImage = () => {
    if (imagePreview?.startsWith('blob:')) URL.revokeObjectURL(imagePreview);
    setImageFile(null);
    setImagePreview(null);
    setImageRemoved(true);
    setFormData((current) => ({ ...current, image: '' }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setImageUploading(Boolean(imageFile));
      const data = {
        ...formData,
        image: imageRemoved ? '' : formData.image,
        sellingPrice: parseFloat(formData.sellingPrice),
        costPrice: formData.costPrice ? parseFloat(formData.costPrice) : undefined,
        taxRate: parseFloat(formData.taxRate),
        preparationTime: formData.preparationTime ? parseInt(formData.preparationTime) : undefined,
      };
      const response = editingItem
        ? await menuItemApi.updateMenuItem(editingItem.id, data)
        : await menuItemApi.createMenuItem(data);
      const savedId = editingItem?.id || response.data?.data?.id;
      if (!savedId) throw new Error('Menu item was saved, but its ID could not be determined.');

      if (imageFile) {
        await menuItemApi.uploadImage(savedId, imageFile);
      } else if (editingItem && imageRemoved && editingItem.image) {
        await menuItemApi.removeImage(savedId);
      }

      setShowModal(false);
      setEditingItem(null);
      resetImageState();
      setFormData({ name: '', description: '', image: '', sku: '', sellingPrice: '', costPrice: '', taxRate: '0', preparationTime: '', categoryId: '', available: true, status: 'ACTIVE', displayOrder: 0, branchIds: [], modifierGroupIds: [] });
      await fetchItems();
    } catch (err: any) {
      setError(err.response?.data?.message || err.message || 'Failed to save menu item');
    } finally {
      setImageUploading(false);
    }
  };

  const handleDuplicate = async (id: string) => {
    try {
      await menuItemApi.duplicateMenuItem(id, {});
      fetchItems();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to duplicate menu item');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to deactivate this menu item?')) return;
    try {
      await menuItemApi.deleteMenuItem(id);
      fetchItems();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to delete menu item');
    }
  };

  const openCreate = () => {
    setEditingItem(null);
    resetImageState();
    setFormData({ name: '', description: '', image: '', sku: '', sellingPrice: '', costPrice: '', taxRate: '0', preparationTime: '', categoryId: '', available: true, status: 'ACTIVE', displayOrder: 0, branchIds: branches.map((b) => b.id), modifierGroupIds: [] });
    setShowModal(true);
  };

  const openEdit = (item: MenuItem) => {
    setEditingItem(item);
    setFormData({
      name: item.name,
      description: item.description || '',
      image: item.image || '',
      sku: item.sku || '',
      sellingPrice: item.sellingPrice.toString(),
      costPrice: item.costPrice?.toString() || '',
      taxRate: item.taxRate.toString(),
      preparationTime: item.preparationTime?.toString() || '',
      categoryId: item.categoryId,
      available: item.available,
      status: item.status,
      displayOrder: item.displayOrder,
      branchIds: item.branches.filter((b) => b.available).map((b) => b.id),
      modifierGroupIds: item.modifierGroups.map((mg) => mg.id),
    });
    resetImageState();
    setImagePreview(item.image || null);
    setShowModal(true);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-gray-500 dark:text-gray-400">Loading menu items...</div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Menu Items</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Manage your menu</p>
        </div>
        <Button onClick={openCreate} className="gap-2">
          <Plus className="w-4 h-4" />
          Add Item
        </Button>
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 px-4 py-3 rounded-md text-sm">
          {error}
        </div>
      )}

      <Card>
        <div className="flex flex-col sm:flex-row gap-4 mb-4">
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500 pointer-events-none" />
            <Input placeholder="Search items..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-10 pr-4" />
          </div>
          <div className="flex gap-2">
            <select
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value)}
              className="flex h-10 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-[#111116] dark:text-gray-100"
            >
              <option value="">All Categories</option>
              {categories.map((cat) => (
                <option key={cat.id} value={cat.id}>{cat.name}</option>
              ))}
            </select>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="flex h-10 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-[#111116] dark:text-gray-100"
            >
              <option value="">All Status</option>
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
              <option value="OUT_OF_STOCK">Out of Stock</option>
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-[#faf9f7] dark:bg-[#111116]/70">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Photo</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Name</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Category</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Price</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Status</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Available</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-[#111116] divide-y divide-gray-200 dark:divide-gray-700">
              {items.map((item) => (
                <tr key={item.id}>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="h-12 w-12 overflow-hidden rounded-xl border border-orange-100 bg-orange-50 dark:border-gray-700 dark:bg-[#111116]">{item.image ? <img src={item.image} alt={item.name} className="h-full w-full object-cover" /> : <div className="flex h-full w-full items-center justify-center text-orange-400"><ImageIcon className="h-5 w-5" /></div>}</div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{item.name}</div>
                    {item.sku && <div className="text-xs text-gray-500 dark:text-gray-400">SKU: {item.sku}</div>}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">{item.categoryName}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100">KSh {item.sellingPrice.toLocaleString()}</td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <Badge variant={item.status === 'ACTIVE' ? 'success' : item.status === 'OUT_OF_STOCK' ? 'danger' : 'warning'}>{item.status}</Badge>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <Badge variant={item.available ? 'success' : 'danger'}>{item.available ? 'Available' : 'Unavailable'}</Badge>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <button onClick={() => setViewingItem(item)} className="text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200 mr-3"><Eye className="w-4 h-4" /></button>
                    <button onClick={() => openEdit(item)} className="text-orange-600 hover:text-orange-900 dark:text-orange-400 dark:hover:text-orange-300 mr-3"><Edit className="w-4 h-4" /></button>
                    <button onClick={() => handleDuplicate(item.id)} className="text-green-600 hover:text-green-900 dark:text-green-400 dark:hover:text-green-300 mr-3"><Copy className="w-4 h-4" /></button>
                    <button onClick={() => handleDelete(item.id)} className="text-red-600 hover:text-red-900 dark:text-red-400 dark:hover:text-red-300"><Trash2 className="w-4 h-4" /></button>
                  </td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-6 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
                    No menu items found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {showModal && (
        <Modal title={editingItem ? 'Edit Menu Item' : 'Add Menu Item'} onClose={() => { setShowModal(false); setEditingItem(null); resetImageState(); }}>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Input id="name" label="Name" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} required />
              <Input id="sku" label="SKU" value={formData.sku} onChange={(e) => setFormData({ ...formData, sku: e.target.value })} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Description</label>
              <textarea
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                className="flex min-h-[80px] w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-[#111116] dark:text-gray-100"
              />
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">Meal Photo</label>
              <div className="rounded-2xl border border-dashed border-orange-200 bg-orange-50/50 p-4 dark:border-gray-700 dark:bg-[#111116]/60">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                  <div className="h-28 w-28 shrink-0 overflow-hidden rounded-2xl border border-orange-100 bg-white dark:border-gray-700 dark:bg-[#111116]">
                    {imagePreview ? <img src={imagePreview} alt="Meal preview" className="h-full w-full object-cover" /> : <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-orange-400"><ImageIcon className="h-7 w-7" /><span className="text-[11px]">No photo</span></div>}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">Add a meal photo</p>
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">JPG, PNG, WEBP or GIF · maximum 6MB</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-orange-500 px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-orange-600">
                        <Upload className="h-4 w-4" />
                        Choose photo
                        <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="hidden" onChange={(e) => handleImageChange(e.target.files?.[0])} />
                      </label>
                      {imagePreview && <button type="button" onClick={removeSelectedImage} className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:bg-[#111116] dark:text-gray-300 dark:hover:bg-[#1a1a20]"><X className="h-4 w-4" /> Remove</button>}
                    </div>
                  </div>
                </div>
                {imageUploading && <p className="mt-3 text-xs font-medium text-orange-600">Uploading photo...</p>}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Category</label>
                <select
                  value={formData.categoryId}
                  onChange={(e) => setFormData({ ...formData, categoryId: e.target.value })}
                  className="flex h-10 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-[#111116] dark:text-gray-100"
                  required
                >
                  <option value="">Select category</option>
                  {categories.map((cat) => (
                    <option key={cat.id} value={cat.id}>{cat.name}</option>
                  ))}
                </select>
              </div>
              <Input id="preparationTime" type="number" label="Prep Time (min)" value={formData.preparationTime} onChange={(e) => setFormData({ ...formData, preparationTime: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Input id="sellingPrice" type="number" label="Selling Price (KSh)" value={formData.sellingPrice} onChange={(e) => setFormData({ ...formData, sellingPrice: e.target.value })} required step="0.01" />
              <Input id="costPrice" type="number" label="Cost Price (KSh)" value={formData.costPrice} onChange={(e) => setFormData({ ...formData, costPrice: e.target.value })} step="0.01" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Input id="taxRate" type="number" label="Tax Rate (%)" value={formData.taxRate} onChange={(e) => setFormData({ ...formData, taxRate: e.target.value })} step="0.01" />
              <Input id="displayOrder" type="number" label="Display Order" value={formData.displayOrder} onChange={(e) => setFormData({ ...formData, displayOrder: parseInt(e.target.value) || 0 })} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Status</label>
                <select
                  value={formData.status}
                  onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                  className="flex h-10 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-[#111116] dark:text-gray-100"
                >
                  <option value="ACTIVE">Active</option>
                  <option value="INACTIVE">Inactive</option>
                  <option value="OUT_OF_STOCK">Out of Stock</option>
                </select>
              </div>
              <div className="flex items-center gap-2 pt-6">
                <input
                  id="available"
                  type="checkbox"
                  checked={formData.available}
                  onChange={(e) => setFormData({ ...formData, available: e.target.checked })}
                  className="rounded border-gray-300 dark:border-gray-600 dark:bg-[#111116]"
                />
                <label htmlFor="available" className="text-sm text-gray-700 dark:text-gray-300">Available</label>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Branches</label>
              <div className="space-y-2 max-h-32 overflow-y-auto border border-orange-100 dark:border-gray-700 rounded-md p-2">
                {branches.length === 0 && <p className="text-sm text-gray-500 dark:text-gray-400">No branches available</p>}
                {branches.map((branch) => (
                  <label key={branch.id} className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                    <input
                      type="checkbox"
                      className="rounded border-gray-300 dark:border-gray-600 dark:bg-[#111116]"
                      checked={formData.branchIds.includes(branch.id)}
                      onChange={(e) => {
                        const newBranches = e.target.checked ? [...formData.branchIds, branch.id] : formData.branchIds.filter((id) => id !== branch.id);
                        setFormData({ ...formData, branchIds: newBranches });
                      }}
                    />
                    {branch.name} ({branch.code})
                  </label>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Modifier Groups</label>
              <div className="space-y-2 max-h-32 overflow-y-auto border border-orange-100 dark:border-gray-700 rounded-md p-2">
                {modifierGroups.map((mg) => (
                  <label key={mg.id} className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                    <input
                      type="checkbox"
                      className="rounded border-gray-300 dark:border-gray-600 dark:bg-[#111116]"
                      checked={formData.modifierGroupIds.includes(mg.id)}
                      onChange={(e) => {
                        const newMods = e.target.checked ? [...formData.modifierGroupIds, mg.id] : formData.modifierGroupIds.filter((id) => id !== mg.id);
                        setFormData({ ...formData, modifierGroupIds: newMods });
                      }}
                    />
                    {mg.name}
                  </label>
                ))}
              </div>
            </div>
            <div className="flex justify-end gap-3">
              <Button type="button" variant="secondary" onClick={() => { setShowModal(false); setEditingItem(null); resetImageState(); }}>Cancel</Button>
              <Button type="submit">{editingItem ? 'Update' : 'Create'}</Button>
            </div>
          </form>
        </Modal>
      )}

      {viewingItem && (
        <Modal title="Menu Item Details" onClose={() => setViewingItem(null)}>
          <div className="space-y-4">
            <div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{viewingItem.name}</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400">{viewingItem.categoryName}</p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400 uppercase">Selling Price</p>
                <p className="text-lg font-semibold text-gray-900 dark:text-gray-100">KSh {viewingItem.sellingPrice.toLocaleString()}</p>
              </div>
              {viewingItem.costPrice !== undefined && (
                <div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 uppercase">Cost Price</p>
                  <p className="text-lg font-semibold text-gray-900 dark:text-gray-100">KSh {viewingItem.costPrice.toLocaleString()}</p>
                </div>
              )}
            </div>
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400 uppercase">Status</p>
              <div className="flex gap-2 mt-1">
                <Badge variant={viewingItem.status === 'ACTIVE' ? 'success' : 'warning'}>{viewingItem.status}</Badge>
                <Badge variant={viewingItem.available ? 'success' : 'danger'}>{viewingItem.available ? 'Available' : 'Unavailable'}</Badge>
              </div>
            </div>
            {viewingItem.description && (
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400 uppercase">Description</p>
                <p className="text-sm text-gray-900 dark:text-gray-100 mt-1">{viewingItem.description}</p>
              </div>
            )}
            {viewingItem.preparationTime && (
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400 uppercase">Preparation Time</p>
                <p className="text-sm text-gray-900 dark:text-gray-100">{viewingItem.preparationTime} minutes</p>
              </div>
            )}
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400 uppercase">Branches</p>
              <div className="flex flex-wrap gap-2 mt-1">
                {viewingItem.branches.map((b) => (
                  <Badge key={b.id} variant={b.available ? 'success' : 'danger'}>
                    {b.available ? '✓' : '✗'} {b.name}
                  </Badge>
                ))}
              </div>
            </div>
            {viewingItem.modifierGroups.length > 0 && (
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400 uppercase">Modifiers</p>
                <div className="flex flex-wrap gap-2 mt-1">
                  {viewingItem.modifierGroups.map((mg) => (
                    <Badge key={mg.id}>{mg.name}</Badge>
                  ))}
                </div>
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
