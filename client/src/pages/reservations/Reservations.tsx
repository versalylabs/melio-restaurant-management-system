import { useEffect, useState, useMemo } from 'react';
import {
  CalendarDays,
  Plus,
  Search,
  UsersRound,
  Globe,
  Phone,
  UserCheck,
  CheckCircle2,
  AlertCircle,
  Table as TableIcon
} from 'lucide-react';
import { reservationApi, tableApi, branchApi, api } from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import Card from '../../components/ui/Card';
import Badge from '../../components/ui/Badge';
import Modal from '../../components/ui/Modal';
import { getActiveBranchId, listenForBranchChanges } from '../../utils/branch';

const statusVariant: any = {
  PENDING: 'warning',
  CONFIRMED: 'info',
  SEATED: 'success',
  COMPLETED: 'default',
  CANCELLED: 'danger',
  NO_SHOW: 'danger'
};

export default function Reservations() {
  const { user } = useAuth();
  const [reservations, setReservations] = useState<any[]>([]);
  const [tables, setTables] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [branches, setBranches] = useState<any[]>([]);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [status, setStatus] = useState('');
  const [sourceFilter, setSourceFilter] = useState('ALL');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState<any>({
    customerId: '',
    tableId: '',
    customerName: '',
    phone: '',
    email: '',
    partySize: 2,
    startAt: '',
    durationMinutes: 90,
    notes: '',
    source: 'PHONE',
    branchId: ''
  });

  const load = async () => {
    try {
      setError('');
      const activeBranchId = getActiveBranchId(user);
      const params: any = { date, ...(activeBranchId ? { branchId: activeBranchId } : {}) };
      if (status) params.status = status;
      if (search) params.search = search;
      const [r, t, c, b] = await Promise.all([
        reservationApi.getReservations(params),
        tableApi.getTables({}),
        api.get('/customers', { params: { limit: 100 } }),
        branchApi.getBranches()
      ]);
      setReservations(r.data.data?.reservations || []);
      setTables(t.data.data?.tables || []);
      setCustomers(c.data.data?.customers || []);
      setBranches(b.data.data?.branches || []);
    } catch (e: any) {
      setError(e.response?.data?.message || 'Failed to load reservations');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    return listenForBranchChanges(load);
  }, [date, status, user?.id]);

  const openNew = () => {
    setEditing(null);
    setForm({
      customerId: '',
      tableId: '',
      customerName: '',
      phone: '',
      email: '',
      partySize: 2,
      startAt: `${date}T12:00`,
      durationMinutes: 90,
      notes: '',
      source: 'PHONE',
      branchId: getActiveBranchId(user) || branches[0]?.id || ''
    });
    setShowModal(true);
  };

  const openEdit = (r: any) => {
    setEditing(r);
    setForm({
      ...r,
      startAt: new Date(r.startAt).toISOString().slice(0, 16),
      durationMinutes: Math.round((new Date(r.endAt).getTime() - new Date(r.startAt).getTime()) / 60000),
      branchId: r.branchId
    });
    setShowModal(true);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const payload = {
        ...form,
        partySize: Number(form.partySize),
        durationMinutes: Number(form.durationMinutes),
        branchId: form.branchId || getActiveBranchId(user)
      };
      if (editing) await reservationApi.updateReservation(editing.id, payload);
      else await reservationApi.createReservation(payload);
      setShowModal(false);
      load();
    } catch (e: any) {
      setError(e.response?.data?.message || 'Failed to save reservation');
    }
  };

  const setStatusFor = async (id: string, next: string) => {
    try {
      await reservationApi.updateStatus(id, { status: next });
      load();
    } catch (e: any) {
      setError(e.response?.data?.message || 'Failed to update reservation status');
    }
  };

  const filteredReservations = useMemo(() => {
    return reservations.filter((r) => {
      if (sourceFilter !== 'ALL' && r.source !== sourceFilter) return false;
      return true;
    });
  }, [reservations, sourceFilter]);

  // Summary Metrics for the date
  const metrics = useMemo(() => {
    const total = reservations.length;
    const guests = reservations.reduce((sum, r) => sum + (r.partySize || 0), 0);
    const pending = reservations.filter((r) => r.status === 'PENDING').length;
    const seated = reservations.filter((r) => r.status === 'SEATED').length;
    const websiteCount = reservations.filter((r) => r.source === 'WEBSITE').length;
    return { total, guests, pending, seated, websiteCount };
  }, [reservations]);

  const filteredTables = tables.filter(
    (t) =>
      t.status !== 'OUT_OF_SERVICE' &&
      (!form.branchId || t.branchId === form.branchId) &&
      t.capacity >= Number(form.partySize || 1)
  );

  if (loading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <div className="text-gray-500">Loading reservations engine...</div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Table Reservations</h1>
            <span className="rounded-full bg-orange-100 px-2.5 py-0.5 text-xs font-bold text-orange-700 dark:bg-orange-950/60 dark:text-orange-300">
              Phase 32
            </span>
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Manage incoming online bookings, telephone reservations, table allocations, and dining turns.
          </p>
        </div>
        <Button onClick={openNew} className="gap-2 shrink-0">
          <Plus className="w-4 h-4" /> New Booking
        </Button>
      </div>

      {/* KPI Cards Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-[#111116]">
          <div className="flex items-center justify-between text-xs font-semibold text-gray-500 dark:text-gray-400">
            <span>Total Bookings</span>
            <CalendarDays size={16} className="text-orange-500" />
          </div>
          <div className="mt-2 text-2xl font-bold text-gray-900 dark:text-white">{metrics.total}</div>
          <div className="mt-1 text-xs text-gray-400">{metrics.guests} total expected guests</div>
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-[#111116]">
          <div className="flex items-center justify-between text-xs font-semibold text-gray-500 dark:text-gray-400">
            <span>Pending Approvals</span>
            <AlertCircle size={16} className="text-amber-500" />
          </div>
          <div className="mt-2 text-2xl font-bold text-amber-600 dark:text-amber-400">{metrics.pending}</div>
          <div className="mt-1 text-xs text-amber-500/80">Requires table assignment</div>
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-[#111116]">
          <div className="flex items-center justify-between text-xs font-semibold text-gray-500 dark:text-gray-400">
            <span>Online Website Bookings</span>
            <Globe size={16} className="text-orange-500" />
          </div>
          <div className="mt-2 text-2xl font-bold text-orange-600 dark:text-orange-400">{metrics.websiteCount}</div>
          <div className="mt-1 text-xs text-orange-500/80">From customer landing page</div>
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-[#111116]">
          <div className="flex items-center justify-between text-xs font-semibold text-gray-500 dark:text-gray-400">
            <span>Currently Seated</span>
            <UserCheck size={16} className="text-green-500" />
          </div>
          <div className="mt-2 text-2xl font-bold text-green-600 dark:text-green-400">{metrics.seated}</div>
          <div className="mt-1 text-xs text-green-500/80">Active dining tables</div>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 px-4 py-3 rounded-xl text-sm">
          {error}
        </div>
      )}

      {/* Filter Controls */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <Input id="date" type="date" label="Booking Date" value={date} onChange={(e) => setDate(e.target.value)} />

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Status</label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="h-10 w-full rounded-xl border border-gray-300 bg-white px-3 text-sm dark:border-gray-700 dark:bg-[#111116] dark:text-gray-100"
          >
            <option value="">All Statuses</option>
            {['PENDING', 'CONFIRMED', 'SEATED', 'COMPLETED', 'CANCELLED', 'NO_SHOW'].map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Channel Source</label>
          <select
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
            className="h-10 w-full rounded-xl border border-gray-300 bg-white px-3 text-sm dark:border-gray-700 dark:bg-[#111116] dark:text-gray-100"
          >
            <option value="ALL">All Channels</option>
            <option value="WEBSITE">🌐 Website Online</option>
            <option value="PHONE">📞 Phone Call</option>
            <option value="WALK_IN">🚶 Walk-In</option>
            <option value="SOCIAL">📱 Social / Concierge</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Search Guest</label>
          <div className="relative">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && load()}
              placeholder="Guest name, phone or email"
              className="h-10 w-full rounded-xl border border-gray-300 bg-white pl-10 pr-4 text-sm dark:border-gray-700 dark:bg-[#111116] dark:text-gray-100"
            />
          </div>
        </div>
      </div>

      {/* Main Table */}
      <Card>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b dark:border-gray-700 text-left text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">
                <th className="py-3.5 pr-4 pl-4">Time & Ref</th>
                <th className="py-3.5 pr-4">Guest Details</th>
                <th className="py-3.5 pr-4">Channel</th>
                <th className="py-3.5 pr-4">Party</th>
                <th className="py-3.5 pr-4">Table</th>
                <th className="py-3.5 pr-4">Branch</th>
                <th className="py-3.5 pr-4">Status</th>
                <th className="py-3.5 pr-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y dark:divide-gray-700/60">
              {filteredReservations.map((r) => (
                <tr
                  key={r.id}
                  className={`transition hover:bg-[#faf9f7] dark:hover:bg-[#1a1a20]/40 ${
                    r.status === 'PENDING' ? 'bg-amber-500/5' : ''
                  }`}
                >
                  <td className="py-4 pr-4 pl-4 font-medium">
                    <div className="text-gray-900 dark:text-gray-100 font-semibold">
                      {new Date(r.startAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                    <div className="text-[11px] text-gray-400">
                      until {new Date(r.endAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                    <div className="text-[10px] font-mono text-orange-500 font-bold mt-0.5">
                      RES-{r.id.slice(-6).toUpperCase()}
                    </div>
                  </td>

                  <td className="py-4 pr-4">
                    <div className="font-semibold text-gray-900 dark:text-gray-100">{r.customerName}</div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">{r.phone || r.email || 'No contact'}</div>
                    {r.notes && (
                      <div className="mt-1 text-xs text-amber-700 dark:text-amber-300/80 bg-amber-100/60 dark:bg-amber-950/40 px-2 py-0.5 rounded-md inline-block max-w-xs truncate">
                        📝 {r.notes}
                      </div>
                    )}
                  </td>

                  <td className="py-4 pr-4">
                    {r.source === 'WEBSITE' ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-orange-100 px-2.5 py-1 text-xs font-semibold text-orange-700 dark:bg-orange-950/60 dark:text-orange-300">
                        <Globe size={12} /> Online
                      </span>
                    ) : r.source === 'PHONE' ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-purple-100 px-2.5 py-1 text-xs font-semibold text-purple-700 dark:bg-purple-950/60 dark:text-purple-300">
                        <Phone size={12} /> Phone
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-1 text-xs font-semibold text-gray-700 dark:bg-[#111116] dark:text-gray-300">
                        {r.source}
                      </span>
                    )}
                  </td>

                  <td className="py-4 pr-4">
                    <span className="inline-flex items-center gap-1 font-semibold text-gray-800 dark:text-gray-200">
                      <UsersRound size={15} className="text-orange-500" />
                      {r.partySize}
                    </span>
                  </td>

                  <td className="py-4 pr-4">
                    {r.table ? (
                      <div className="inline-flex items-center gap-1.5 font-semibold text-gray-900 dark:text-white">
                        <TableIcon size={14} className="text-orange-500" />
                        Table #{r.table.tableNumber}
                      </div>
                    ) : (
                      <span className="text-xs italic text-gray-400">Unassigned</span>
                    )}
                  </td>

                  <td className="py-4 pr-4 text-xs text-gray-600 dark:text-gray-300">{r.branch?.name || '—'}</td>

                  <td className="py-4 pr-4">
                    <Badge variant={statusVariant[r.status] || 'default'}>{r.status}</Badge>
                  </td>

                  <td className="py-4 pr-4 text-right">
                    <div className="flex justify-end items-center gap-1.5 flex-wrap">
                      {r.status === 'PENDING' && (
                        <Button size="sm" onClick={() => setStatusFor(r.id, 'CONFIRMED')} className="gap-1">
                          <CheckCircle2 size={13} /> Confirm
                        </Button>
                      )}

                      {r.status === 'CONFIRMED' && (
                        <Button size="sm" onClick={() => setStatusFor(r.id, 'SEATED')} className="gap-1 bg-green-600 hover:bg-green-700">
                          <UserCheck size={13} /> Seat Guest
                        </Button>
                      )}

                      {r.status === 'SEATED' && (
                        <Button size="sm" onClick={() => setStatusFor(r.id, 'COMPLETED')} variant="secondary">
                          Complete
                        </Button>
                      )}

                      {['PENDING', 'CONFIRMED'].includes(r.status) && (
                        <Button size="sm" variant="secondary" onClick={() => setStatusFor(r.id, 'CANCELLED')} className="text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40">
                          Cancel
                        </Button>
                      )}

                      <Button size="sm" variant="secondary" onClick={() => openEdit(r)}>
                        Edit
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}

              {filteredReservations.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-16 text-center text-gray-500 dark:text-gray-400">
                    <CalendarDays className="w-10 h-10 mx-auto mb-2 text-gray-400" />
                    <p className="font-semibold">No reservations found for {date}</p>
                    <p className="text-xs text-gray-400 mt-1">Try switching dates, clearing search filters, or click "New Booking".</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Modal for Creating / Editing Reservation */}
      {showModal && (
        <Modal title={editing ? 'Edit Reservation' : 'New Table Booking'} onClose={() => setShowModal(false)}>
          <form onSubmit={submit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Input
                id="customerName"
                label="Guest Full Name"
                value={form.customerName}
                onChange={(e) => setForm({ ...form, customerName: e.target.value })}
                required
              />
              <Input
                id="phone"
                label="Phone Number"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Input
                id="email"
                type="email"
                label="Email Address"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
              <Input
                id="partySize"
                type="number"
                min="1"
                label="Party Size (Guests)"
                value={form.partySize}
                onChange={(e) => setForm({ ...form, partySize: e.target.value })}
                required
              />
            </div>

            {!user?.branchId && (
              <div>
                <label className="block text-sm font-medium mb-1">Branch</label>
                <select
                  value={form.branchId}
                  onChange={(e) => setForm({ ...form, branchId: e.target.value, tableId: '' })}
                  className="h-10 w-full rounded-xl border border-gray-300 px-3 bg-white dark:bg-[#111116] dark:border-gray-600 dark:text-gray-100"
                >
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <Input
                id="startAt"
                type="datetime-local"
                label="Date & Start Time"
                value={form.startAt}
                onChange={(e) => setForm({ ...form, startAt: e.target.value })}
                required
              />
              <Input
                id="duration"
                type="number"
                min="15"
                label="Duration (Minutes)"
                value={form.durationMinutes}
                onChange={(e) => setForm({ ...form, durationMinutes: e.target.value })}
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Assigned Table</label>
              <select
                value={form.tableId}
                onChange={(e) => setForm({ ...form, tableId: e.target.value })}
                className="h-10 w-full rounded-xl border border-gray-300 px-3 bg-white dark:bg-[#111116] dark:border-gray-600 dark:text-gray-100"
              >
                <option value="">No table assigned yet</option>
                {filteredTables.map((t) => (
                  <option key={t.id} value={t.id}>
                    Table #{t.tableNumber} — {t.capacity} seats {t.sectionName ? `(${t.sectionName})` : ''}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Existing Customer (Optional)</label>
              <select
                value={form.customerId}
                onChange={(e) => {
                  const c = customers.find((x) => x.id === e.target.value);
                  setForm({
                    ...form,
                    customerId: e.target.value,
                    customerName: c?.name || form.customerName,
                    phone: c?.phone || form.phone,
                    email: c?.email || form.email
                  });
                }}
                className="h-10 w-full rounded-xl border border-gray-300 px-3 bg-white dark:bg-[#111116] dark:border-gray-600 dark:text-gray-100"
              >
                <option value="">Walk-in / New guest</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} {c.phone ? `(${c.phone})` : ''}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Channel Source</label>
              <select
                value={form.source}
                onChange={(e) => setForm({ ...form, source: e.target.value })}
                className="h-10 w-full rounded-xl border border-gray-300 px-3 bg-white dark:bg-[#111116] dark:border-gray-600 dark:text-gray-100"
              >
                {['PHONE', 'WALK_IN', 'WEBSITE', 'SOCIAL', 'OTHER'].map((x) => (
                  <option key={x} value={x}>
                    {x}
                  </option>
                ))}
              </select>
            </div>

            <Input
              id="notes"
              label="Special Occasion / Guest Notes"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="e.g. Anniversary dinner, terrace table preferred"
            />

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="secondary" onClick={() => setShowModal(false)}>
                Cancel
              </Button>
              <Button type="submit">{editing ? 'Save Changes' : 'Create Reservation'}</Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
