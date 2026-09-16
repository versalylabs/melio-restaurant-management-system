import { useState, useEffect } from 'react';
import { Plus, Search, Edit, Trash2, Grid3x3, Users } from 'lucide-react';
import { tableApi, sectionApi, branchApi } from '../../services/api';
import type { Table, Section } from '../../types';
import { useAuth } from '../../contexts/AuthContext';
import Button from '../../components/ui/Button';
import Card from '../../components/ui/Card';
import Modal from '../../components/ui/Modal';
import Input from '../../components/ui/Input';
import { getActiveBranchId, listenForBranchChanges } from '../../utils/branch';

const SHAPE_COLORS: Record<string, string> = {
  SQUARE: 'border-orange-400 bg-orange-50 dark:bg-orange-900/20 dark:border-orange-500',
  RECTANGLE: 'border-green-400 bg-green-50 dark:bg-green-900/20 dark:border-green-500',
  CIRCLE: 'border-purple-400 bg-purple-50 dark:bg-purple-900/20 dark:border-purple-500',
};

const STATUS_COLORS: Record<string, string> = {
  AVAILABLE: 'bg-green-100 text-green-800 border-green-200 dark:bg-green-900/40 dark:text-green-300 dark:border-green-800',
  OCCUPIED: 'bg-red-100 text-red-800 border-red-200 dark:bg-red-900/40 dark:text-red-300 dark:border-red-800',
  RESERVED: 'bg-yellow-100 text-yellow-800 border-yellow-200 dark:bg-yellow-900/40 dark:text-yellow-300 dark:border-yellow-800',
  CLEANING: 'bg-orange-100 text-orange-800 border-orange-200 dark:bg-orange-900/40 dark:text-orange-300 dark:border-orange-800',
  OUT_OF_SERVICE: 'bg-gray-100 text-gray-800 border-orange-100 dark:bg-[#111116] dark:text-gray-300 dark:border-gray-600',
  INACTIVE: 'bg-gray-100 text-gray-800 border-orange-100 dark:bg-[#111116] dark:text-gray-300 dark:border-gray-600',
};

export default function FloorPlan() {
  const { user } = useAuth();
  const [tables, setTables] = useState<Table[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [branches, setBranches] = useState<Array<{id:string; name:string; code:string; status?:string}>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedTable, setSelectedTable] = useState<Table | null>(null);
  const [showTableModal, setShowTableModal] = useState(false);
  const [editingTable, setEditingTable] = useState<Table | null>(null);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterSection, setFilterSection] = useState('');
  const [dragging, setDragging] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [selectedTables, setSelectedTables] = useState<Set<string>>(new Set());
  const [showCombineModal, setShowCombineModal] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    setError('');
    const activeBranchId = getActiveBranchId(user);
    const params: any = {};
    if (activeBranchId) params.branchId = activeBranchId;

    const [tablesResult, sectionsResult, branchesResult] = await Promise.allSettled([
      tableApi.getFloorLayout(params),
      sectionApi.getSections({ ...(activeBranchId ? { branchId: activeBranchId } : {}), status: 'ACTIVE' }),
      branchApi.getBranches(),
    ]);

    const errors: string[] = [];
    if (tablesResult.status === 'fulfilled' && tablesResult.value.data.success) {
      setTables(tablesResult.value.data.data?.tables || []);
    } else if (tablesResult.status === 'rejected') {
      errors.push(tablesResult.reason?.response?.data?.message || 'Unable to load tables');
    }
    if (sectionsResult.status === 'fulfilled' && sectionsResult.value.data.success) {
      setSections(sectionsResult.value.data.data?.sections || []);
    } else if (sectionsResult.status === 'rejected') {
      errors.push(sectionsResult.reason?.response?.data?.message || 'Unable to load sections');
    }
    if (branchesResult.status === 'fulfilled') {
      const branchList = (branchesResult.value.data?.data?.branches || []).filter((b:any) => b.status !== 'INACTIVE');
      setBranches(branchList);
    } else {
      errors.push(branchesResult.reason?.response?.data?.message || 'Unable to load branches');
    }
    if (errors.length) setError(errors.join(' • '));
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
    return listenForBranchChanges(fetchData);
  }, [user?.id]);

  const handleDragStart = (e: React.MouseEvent, table: Table) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(table.id);
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    setDragOffset({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    });
    setSelectedTable(table);
  };

  const handleDragMove = (e: React.MouseEvent) => {
    if (!dragging) return;
    const container = document.getElementById('floor-container');
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const x = e.clientX - rect.left - dragOffset.x;
    const y = e.clientY - rect.top - dragOffset.y;
    setTables((prev) =>
      prev.map((t) =>
        t.id === dragging ? { ...t, positionX: Math.max(0, Math.min(x, rect.width - t.width)), positionY: Math.max(0, Math.min(y, rect.height - t.height)) } : t
      )
    );
  };

  const handleDragEnd = async () => {
    if (!dragging) return;
    const table = tables.find((t) => t.id === dragging);
    if (table) {
      try {
        await tableApi.updateTablePosition(table.id, { positionX: table.positionX, positionY: table.positionY, width: table.width, height: table.height, rotation: table.rotation });
      } catch {}
    }
    setDragging(null);
  };

  const handleSaveTable = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const formData = new FormData(e.target as HTMLFormElement);
      const data = {
        tableNumber: formData.get('tableNumber') as string,
        name: formData.get('name') as string,
        capacity: parseInt(formData.get('capacity') as string),
        shape: formData.get('shape') as string,
        branchId: String(formData.get('branchId') || getActiveBranchId(user) || ''),
        sectionId: formData.get('sectionId') as string,
        status: formData.get('status') as string,
        positionX: editingTable ? editingTable.positionX : 50 + Math.random() * 100,
        positionY: editingTable ? editingTable.positionY : 50 + Math.random() * 100,
        width: 80,
        height: 80,
        rotation: 0,
        displayOrder: 0,
      };
      if (editingTable) {
        await tableApi.updateTable(editingTable.id, data);
      } else {
        await tableApi.createTable(data);
      }
      setShowTableModal(false);
      setEditingTable(null);
      fetchData();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to save table');
    }
  };

  const handleStatusChange = async (table: Table, status: string) => {
    try {
      await tableApi.updateTableStatus(table.id, { status });
      fetchData();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to update status');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to deactivate this table?')) return;
    try {
      await tableApi.deleteTable(id);
      if (selectedTable?.id === id) setSelectedTable(null);
      fetchData();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to delete table');
    }
  };

  const handleCombineTables = async () => {
    if (selectedTables.size < 2) {
      alert('Please select at least 2 tables to combine');
      return;
    }
    const name = prompt('Enter a name for this table combination:');
    if (!name) return;
    try {
      await tableApi.createTableCombination({
        name,
        tableIds: Array.from(selectedTables),
        branchId: getActiveBranchId(user) || '',
      });
      setShowCombineModal(false);
      setSelectedTables(new Set());
      fetchData();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to create table combination');
    }
  };

  const toggleTableSelection = (tableId: string) => {
    setSelectedTables((prev) => {
      const next = new Set(prev);
      if (next.has(tableId)) {
        next.delete(tableId);
      } else {
        next.add(tableId);
      }
      return next;
    });
  };

  const filteredTables = tables.filter((t) => {
    if (search && !t.tableNumber.toLowerCase().includes(search.toLowerCase()) && !t.name?.toLowerCase().includes(search.toLowerCase())) return false;
    if (filterStatus && t.status !== filterStatus) return false;
    if (filterSection && t.sectionId !== filterSection) return false;
    return true;
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-gray-500 dark:text-gray-400">Loading floor plan...</div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Floor Plan</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Manage tables and floor layout</p>
        </div>
        <div className="flex gap-2">
          {selectedTables.size > 0 && (
            <Button variant="secondary" onClick={() => setShowCombineModal(true)} className="gap-2">
              <Users className="w-4 h-4" />
              Combine ({selectedTables.size})
            </Button>
          )}
          <Button onClick={() => { setEditingTable(null); setShowTableModal(true); }} className="gap-2">
            <Plus className="w-4 h-4" />
            Add Table
          </Button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 dark:bg-red-900/30 dark:border-red-800 dark:text-red-400 px-4 py-3 rounded-md text-sm">
          {error}
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500 pointer-events-none" />
          <input
            type="text"
            placeholder="Search tables..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex h-10 w-full rounded-md border border-gray-300 bg-white pl-10 pr-4 py-2 text-sm text-gray-900 placeholder:text-gray-400 dark:border-gray-600 dark:bg-[#111116] dark:text-gray-100 dark:placeholder:text-gray-500"
          />
        </div>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="flex h-10 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-[#111116] dark:text-gray-100"
        >
          <option value="">All Status</option>
          <option value="AVAILABLE">Available</option>
          <option value="OCCUPIED">Occupied</option>
          <option value="RESERVED">Reserved</option>
          <option value="CLEANING">Cleaning</option>
          <option value="OUT_OF_SERVICE">Out of Service</option>
        </select>
        <select
          value={filterSection}
          onChange={(e) => setFilterSection(e.target.value)}
          className="flex h-10 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-[#111116] dark:text-gray-100"
        >
          <option value="">All Sections</option>
          {sections.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <Card>
            <div
              id="floor-container"
              className="relative bg-[#faf9f7] dark:bg-[#111116] border border-orange-100 dark:border-gray-700 rounded-lg overflow-hidden"
              style={{ height: '600px' }}
              onMouseMove={handleDragMove}
              onMouseUp={handleDragEnd}
              onMouseLeave={handleDragEnd}
            >
              {filteredTables.length === 0 ? (
                <div className="flex items-center justify-center h-full">
                  <div className="text-center">
                    <Grid3x3 className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-2" />
                    <p className="text-gray-500 dark:text-gray-400">No tables found</p>
                    <Button variant="secondary" size="sm" className="mt-2" onClick={() => { setEditingTable(null); setShowTableModal(true); }}>
                      Add Table
                    </Button>
                  </div>
                </div>
              ) : (
                filteredTables.map((table) => (
                  <div
                    key={table.id}
                    className={`absolute border-2 rounded-lg flex items-center justify-center cursor-pointer transition-all ${dragging === table.id ? 'shadow-lg scale-105 z-50' : 'shadow-sm'} ${selectedTables.has(table.id) ? 'ring-2 ring-offset-1 ring-orange-500 dark:ring-offset-gray-900' : ''} ${SHAPE_COLORS[table.shape] || 'border-gray-300 bg-white dark:border-gray-600 dark:bg-[#111116]'}`}
                    style={{
                      left: table.positionX,
                      top: table.positionY,
                      width: table.width,
                      height: table.height,
                      transform: `rotate(${table.rotation}deg)`,
                    }}
                    onMouseDown={(e) => handleDragStart(e, table)}
                     onClick={(e) => {
                       if (e.shiftKey) {
                         toggleTableSelection(table.id);
                       } else {
                         setSelectedTable(table);
                       }
                     }}
                    onDoubleClick={() => { setEditingTable(table); setShowTableModal(true); }}
                  >
                    <div className="text-center p-2">
                      <div className="text-sm font-bold text-gray-900 dark:text-gray-100">{table.tableNumber}</div>
                      <div className="text-xs text-gray-600 dark:text-gray-400">{table.capacity} seats</div>
                      <div className={`text-xs px-2 py-0.5 rounded-full mt-1 ${STATUS_COLORS[table.status] || 'bg-gray-100 text-gray-800 dark:bg-[#111116] dark:text-gray-300'}`}>
                        {table.status}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </Card>
        </div>

        <div>
          <Card title="Table Details" description="Select a table to view details">
            {selectedTable ? (
              <div className="space-y-4">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{selectedTable.name || selectedTable.tableNumber}</h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400">{selectedTable.sectionName || 'No section'}</p>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 uppercase">Capacity</p>
                    <p className="text-lg font-semibold text-gray-900 dark:text-gray-100">{selectedTable.capacity} guests</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 uppercase">Shape</p>
                    <p className="text-lg font-semibold text-gray-900 dark:text-gray-100">{selectedTable.shape}</p>
                  </div>
                </div>
                <div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 uppercase">Status</p>
                  <div className="flex flex-wrap gap-2 mt-1">
                    {['AVAILABLE', 'OCCUPIED', 'RESERVED', 'CLEANING', 'OUT_OF_SERVICE'].map((status) => (
                      <button
                        key={status}
                        onClick={() => handleStatusChange(selectedTable, status)}
                        className={`px-2 py-1 text-xs rounded-full border transition-colors ${selectedTable.status === status ? STATUS_COLORS[status] : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300 dark:bg-[#111116] dark:border-gray-700 dark:text-gray-400 dark:hover:border-gray-600'}`}
                      >
                        {status.replace('_', ' ')}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 uppercase">Branch</p>
                  <p className="text-sm text-gray-900 dark:text-gray-100">{selectedTable.branchName}</p>
                </div>
                <div className="flex gap-2">
                  <Button variant="secondary" size="sm" className="flex-1" onClick={() => { setEditingTable(selectedTable); setShowTableModal(true); }}>
                    <Edit className="w-4 h-4 mr-1" /> Edit
                  </Button>
                  <Button variant="danger" size="sm" onClick={() => handleDelete(selectedTable.id)}>
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            ) : (
              <p className="text-sm text-gray-500 dark:text-gray-400">Select a table to view details</p>
            )}
          </Card>
        </div>
      </div>

      {showTableModal && (
        <Modal title={editingTable ? 'Edit Table' : 'Add Table'} onClose={() => { setShowTableModal(false); setEditingTable(null); }}>
          <form onSubmit={handleSaveTable} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Input id="tableNumber" name="tableNumber" label="Table Number" defaultValue={editingTable?.tableNumber} required />
              <Input id="name" name="name" label="Name" defaultValue={editingTable?.name} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Input id="capacity" name="capacity" type="number" label="Capacity" defaultValue={editingTable?.capacity || 2} required />
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Shape</label>
                <select name="shape" defaultValue={editingTable?.shape || 'SQUARE'} className="flex h-10 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-[#111116] dark:text-gray-100">
                  <option value="SQUARE">Square</option>
                  <option value="RECTANGLE">Rectangle</option>
                  <option value="CIRCLE">Circle</option>
                </select>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Branch</label>
              <select name="branchId" defaultValue={editingTable?.branchId || getActiveBranchId(user)} className="rms-control w-full" required disabled={!['OWNER','ADMIN','MANAGER'].includes(user?.roleName || '')}>
                <option value="">Select branch</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name} ({b.code})</option>)}
              </select>
              {!getActiveBranchId(user) && <p className="mt-1 text-xs text-red-500">Select an active branch from the top bar.</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Section</label>
              <select name="sectionId" defaultValue={editingTable?.sectionId} className="flex h-10 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-[#111116] dark:text-gray-100">
                <option value="">No section</option>
                {sections.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Status</label>
              <select name="status" defaultValue={editingTable?.status || 'AVAILABLE'} className="flex h-10 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-[#111116] dark:text-gray-100">
                <option value="AVAILABLE">Available</option>
                <option value="OCCUPIED">Occupied</option>
                <option value="RESERVED">Reserved</option>
                <option value="CLEANING">Cleaning</option>
                <option value="OUT_OF_SERVICE">Out of Service</option>
              </select>
            </div>
            <div className="flex justify-end gap-3">
              <Button type="button" variant="secondary" onClick={() => { setShowTableModal(false); setEditingTable(null); }}>Cancel</Button>
              <Button type="submit">{editingTable ? 'Update' : 'Create'}</Button>
            </div>
          </form>
        </Modal>
      )}

      {showCombineModal && (
        <Modal title="Combine Tables" onClose={() => { setShowCombineModal(false); setSelectedTables(new Set()); }}>
          <div className="space-y-4">
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Combine {selectedTables.size} tables into a single larger table. Selected tables: {Array.from(selectedTables).join(', ')}
            </p>
            <div className="flex justify-end gap-3">
              <Button type="button" variant="secondary" onClick={() => { setShowCombineModal(false); setSelectedTables(new Set()); }}>Cancel</Button>
              <Button onClick={handleCombineTables}>Combine Tables</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
