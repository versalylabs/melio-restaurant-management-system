import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle, ArrowRightLeft, BellRing, CalendarClock, Check, ChefHat, Clock, CreditCard, LayoutGrid, Map as MapIcon,
  Banknote, Pencil, Plus, Receipt, RefreshCw, Sparkles, Timer, Trash2, UserRound, Users, Utensils, Wrench, X,
} from 'lucide-react';
import { orderApi, sectionApi, tableApi } from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';
import { useRealtimeEvents } from '../../hooks/useRealtimeEvents';
import { getActiveBranchId, listenForBranchChanges } from '../../utils/branch';
import { confirmDialog, notify, promptDialog } from '../../lib/dialogs';
import Button from '../../components/ui/Button';
import Modal from '../../components/ui/Modal';
import Input from '../../components/ui/Input';
import DialogOverlay from '../../components/ui/DialogOverlay';

type LiveOrder = { id: string; orderNumber: string; status: string; totalAmount: number; amountPaid: number; createdAt: string; waiterName: string | null; mine: boolean };
type LiveTable = {
  id: string; tableNumber: string; name?: string | null; capacity: number; shape: string; status: string; sectionId: string | null;
  positionX: number; positionY: number; width: number; height: number; rotation: number;
  state: string; minutes: number | null; total: number; paid: number; balance: number;
  waiterId: string | null; waiterName: string | null;
  alert: { kind: string; text: string } | null;
  nextReservation: { id: string; customerName: string; partySize: number; startAt: string; status: string } | null;
  orders: LiveOrder[];
};
type Summary = {
  free: number; occupied: number; cleaning: number; reserved: number; foodReady: number; outOfService: number; tables: number; seats: number; seatsInUse: number;
  openBalance?: number;
  today?: { tablesServed: number; turnsPerTable: number; averageMinutes: number | null; sales: number; bySection: Array<{ sectionId: string | null; name: string; sales: number; orders: number }> };
};
type Floor = { generatedAt: string; sections: Array<{ id: string; name: string }>; tables: LiveTable[]; summary: Summary; longSittingMinutes: number };

const MANAGERS = ['OWNER', 'ADMIN', 'MANAGER'];
const GRID = 20;
const kes = (n: number) => `KES ${Math.round(n).toLocaleString()}`;

/** How each state looks: always a word and an icon, never colour alone. */
const STATES: Record<string, { label: string; card: string; chip: string; icon: typeof Check }> = {
  FREE: { label: 'Free', card: 'border-emerald-300 bg-emerald-50/60 dark:border-emerald-800 dark:bg-emerald-950/20', chip: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300', icon: Check },
  SEATED: { label: 'Seated, no order', card: 'border-violet-300 bg-violet-50/60 dark:border-violet-800 dark:bg-violet-950/20', chip: 'bg-violet-100 text-violet-800 dark:bg-violet-900/50 dark:text-violet-300', icon: Users },
  ORDERED: { label: 'Ordered', card: 'border-sky-300 bg-sky-50/60 dark:border-sky-800 dark:bg-sky-950/20', chip: 'bg-sky-100 text-sky-800 dark:bg-sky-900/50 dark:text-sky-300', icon: ChefHat },
  FOOD_READY: { label: 'Food ready', card: 'border-orange-400 bg-orange-50 ring-2 ring-orange-400/60 dark:border-orange-500 dark:bg-orange-950/30', chip: 'bg-orange-500 text-white', icon: BellRing },
  EATING: { label: 'Eating', card: 'border-indigo-300 bg-indigo-50/60 dark:border-indigo-800 dark:bg-indigo-950/20', chip: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/50 dark:text-indigo-300', icon: Utensils },
  PAID: { label: 'Paid, clear when they leave', card: 'border-teal-300 bg-teal-50/60 dark:border-teal-800 dark:bg-teal-950/20', chip: 'bg-teal-100 text-teal-800 dark:bg-teal-900/50 dark:text-teal-300', icon: CreditCard },
  CLEANING: { label: 'Needs cleaning', card: 'border-amber-300 bg-amber-50/70 dark:border-amber-700 dark:bg-amber-950/20', chip: 'bg-amber-100 text-amber-900 dark:bg-amber-900/50 dark:text-amber-300', icon: Sparkles },
  RESERVED: { label: 'Reserved', card: 'border-yellow-300 bg-yellow-50/70 dark:border-yellow-700 dark:bg-yellow-950/20', chip: 'bg-yellow-100 text-yellow-900 dark:bg-yellow-900/50 dark:text-yellow-300', icon: CalendarClock },
  HELD: { label: 'Order on hold', card: 'border-slate-300 bg-slate-50 dark:border-slate-700 dark:bg-slate-900/40', chip: 'bg-slate-200 text-slate-800 dark:bg-slate-800 dark:text-slate-300', icon: Clock },
  OUT_OF_SERVICE: { label: 'Out of service', card: 'border-gray-300 bg-gray-100 opacity-70 dark:border-gray-700 dark:bg-gray-900/60', chip: 'bg-gray-200 text-gray-700 dark:bg-gray-800 dark:text-gray-400', icon: Wrench },
};
const SEATED_STATES = ['SEATED', 'ORDERED', 'FOOD_READY', 'EATING', 'PAID'];
const FILTERS: Array<{ key: string; label: string; states: string[] }> = [
  { key: 'ALL', label: 'All', states: [] },
  { key: 'FREE', label: 'Free', states: ['FREE'] },
  { key: 'SEATED', label: 'Seated', states: SEATED_STATES },
  { key: 'FOOD_READY', label: 'Food ready', states: ['FOOD_READY'] },
  { key: 'CLEANING', label: 'Needs cleaning', states: ['CLEANING'] },
  { key: 'RESERVED', label: 'Reserved', states: ['RESERVED'] },
];
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const duration = (m: number) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`);

export default function FloorPlan() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const isManager = MANAGERS.includes(user?.roleName || '');
  const [branchId, setBranchId] = useState(() => getActiveBranchId(user as any) || '');
  const [floor, setFloor] = useState<Floor | null>(null);
  const [loadedAt, setLoadedAt] = useState(Date.now());
  const [now, setNow] = useState(Date.now());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [view, setView] = useState<'board' | 'map'>('board');
  const [editing, setEditing] = useState(false);
  const [section, setSection] = useState('ALL');
  const [filter, setFilter] = useState('ALL');
  const [mineOnly, setMineOnly] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState('');
  const [moveFor, setMoveFor] = useState<LiveTable | null>(null);
  const [tableForm, setTableForm] = useState<{ table: LiveTable | null } | null>(null);
  // The day so far: open on wide screens, one tap away on phones.
  const [showToday, setShowToday] = useState(() => typeof window === 'undefined' || window.innerWidth >= 768);

  useEffect(() => listenForBranchChanges(() => setBranchId(getActiveBranchId(user as any) || '')), [user?.id]);

  const requestSeq = useRef(0);
  const editingRef = useRef(false);
  editingRef.current = editing;
  const load = useCallback(async (quiet = false) => {
    if (!branchId) { setLoading(false); setFloor(null); setError('Choose a branch in the top bar to see its tables.'); return; }
    const seq = ++requestSeq.current;
    if (!quiet) setLoading(true);
    try {
      const res = await tableApi.getLiveFloor(branchId);
      if (seq !== requestSeq.current) return;
      const t = Date.now();
      setFloor(res.data.data);
      setLoadedAt(t);
      setNow(t);
      setError('');
    } catch (e: any) {
      if (seq === requestSeq.current && !quiet) setError(e.response?.data?.message || 'Could not load the tables');
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, [branchId]);
  useEffect(() => { setFloor(null); setSelectedId(null); }, [branchId]);
  useEffect(() => { void load(); }, [load]);

  // Live: refresh on order, payment and table events, and every 30 s as a fallback.
  const { isConnected, subscribe } = useRealtimeEvents({ channels: branchId ? [`orders:${branchId}`, `reservations:${branchId}`] : [], enabled: !!user && !!branchId });
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const softRefresh = useCallback(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    // While a manager is arranging tables, a refresh could put a dropped table back.
    refreshTimer.current = setTimeout(() => { if (!editingRef.current) void load(true); }, 400);
  }, [load]);
  useEffect(() => {
    const events = ['order_status_updated', 'order_paid', 'order_updated', 'table_updated', 'new_reservation', 'reservation_status_updated', 'new_online_order'];
    const offs = events.map((e) => subscribe(e, softRefresh));
    return () => offs.forEach((off) => off());
  }, [subscribe, softRefresh]);
  useEffect(() => {
    const poll = setInterval(() => { if (!editing && document.visibilityState === 'visible') void load(true); }, 30_000);
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    return () => { clearInterval(poll); clearInterval(tick); };
  }, [load, editing]);

  const elapsed = Math.max(0, Math.floor((now - loadedAt) / 60000));
  const minutesOf = (t: LiveTable) => (t.minutes === null ? null : t.minutes + elapsed);
  const tables = floor?.tables || [];
  const selected = tables.find((t) => t.id === selectedId) || null;
  const filterStates = FILTERS.find((f) => f.key === filter)?.states || [];
  const visible = useMemo(() => tables
    .filter((t) => section === 'ALL' || t.sectionId === section || (section === 'NONE' && !t.sectionId))
    .filter((t) => !filterStates.length || filterStates.includes(t.state))
    .filter((t) => !mineOnly || t.orders.some((o) => o.mine))
    .sort((a, b) => a.tableNumber.localeCompare(b.tableNumber, undefined, { numeric: true })),
  [tables, section, filterStates, mineOnly]);
  const hasUnsectioned = tables.some((t) => !t.sectionId);

  const act = async (table: LiveTable, action: 'MARK_CLEAN' | 'SEAT' | 'CLEAR') => {
    setBusy(action);
    try {
      await tableApi.serviceAction(table.id, action);
      await load(true);
    } catch (e: any) {
      notify(e.response?.data?.message || 'Could not update the table');
    } finally {
      setBusy('');
    }
  };
  const setOutOfService = async (table: LiveTable, out: boolean) => {
    setBusy('OOS');
    try {
      await tableApi.updateTableStatus(table.id, { status: out ? 'OUT_OF_SERVICE' : 'AVAILABLE' });
      await load(true);
    } catch (e: any) {
      notify(e.response?.data?.message || 'Could not update the table');
    } finally {
      setBusy('');
    }
  };

  const s = floor?.summary;
  const counts: Record<string, number> = s ? { ALL: s.tables, FREE: s.free, SEATED: s.occupied, FOOD_READY: s.foodReady, CLEANING: s.cleaning, RESERVED: s.reserved } : {};

  return (
    <div className="space-y-5 p-4 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Tables</h1>
          <p className="mt-1 flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
            <span className={`inline-block h-2 w-2 rounded-full ${isConnected ? 'bg-emerald-500' : 'bg-gray-400'}`} aria-hidden="true" />
            {editing ? 'Drag tables to match your room. Changes save as you drop them.' : isConnected ? 'Live: updates as orders and payments come in' : 'Updates every 30 seconds'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!editing && (
            <div className="hidden rounded-lg border border-gray-200 p-0.5 dark:border-gray-700 sm:flex" role="group" aria-label="View">
              {([['board', 'Cards', LayoutGrid], ['map', 'Room map', MapIcon]] as const).map(([v, label, Icon]) => (
                <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)} className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold ${view === v ? 'bg-orange-500 text-white' : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/5'}`}>
                  <Icon className="h-3.5 w-3.5" aria-hidden="true" /> {label}
                </button>
              ))}
            </div>
          )}
          <Button variant="secondary" size="sm" onClick={() => load()} aria-label="Refresh"><RefreshCw className="h-4 w-4" aria-hidden="true" /></Button>
          {isManager && (editing ? (
            <>
              <Button variant="secondary" size="sm" onClick={addSection}><Plus className="mr-1 h-4 w-4" aria-hidden="true" />Section</Button>
              <Button variant="secondary" size="sm" onClick={() => setTableForm({ table: null })}><Plus className="mr-1 h-4 w-4" aria-hidden="true" />Table</Button>
              <Button size="sm" onClick={() => { setEditing(false); void load(true); }}><Check className="mr-1 h-4 w-4" aria-hidden="true" />Done</Button>
            </>
          ) : (
            <Button variant="secondary" size="sm" onClick={() => { setEditing(true); setSelectedId(null); }}><Pencil className="mr-1 h-4 w-4" aria-hidden="true" />Edit layout</Button>
          ))}
        </div>
      </div>

      {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">{error}</div>}

      {s && !editing && (
        <>
          {s.today && showToday && (
            <FloorPulse summary={s} onHide={() => setShowToday(false)} />
          )}
          {s.today && !showToday && (
            <button type="button" onClick={() => setShowToday(true)} className="text-xs font-semibold text-orange-600 dark:text-orange-400">
              Today: {s.seatsInUse} of {s.seats} seats in use, {kes(s.openBalance || 0)} open. Show more
            </button>
          )}

          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Show tables">
            {FILTERS.map((f) => (
              <button key={f.key} type="button" aria-pressed={filter === f.key} onClick={() => setFilter(f.key)}
                className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${filter === f.key ? 'border-orange-500 bg-orange-500 text-white' : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300 dark:border-gray-700 dark:bg-[#15151b] dark:text-gray-300'}`}>
                {f.label} <span className="tabular-nums opacity-80">{counts[f.key] ?? 0}</span>
              </button>
            ))}
            <label className="ml-auto flex items-center gap-2 text-xs font-semibold text-gray-600 dark:text-gray-300">
              <input type="checkbox" className="h-4 w-4" checked={mineOnly} onChange={(e) => setMineOnly(e.target.checked)} /> My tables
            </label>
          </div>
        </>
      )}

      {floor && (floor.sections.length > 0) && (
        <div className="flex gap-1 overflow-x-auto border-b border-gray-200 dark:border-gray-800" role="tablist" aria-label="Sections">
          {[{ id: 'ALL', name: 'All sections' }, ...floor.sections, ...(hasUnsectioned ? [{ id: 'NONE', name: 'No section' }] : [])].map((sec) => (
            <button key={sec.id} role="tab" aria-selected={section === sec.id} onClick={() => setSection(sec.id)}
              className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm font-semibold ${section === sec.id ? 'border-orange-500 text-orange-600 dark:text-orange-400' : 'border-transparent text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'}`}>
              {sec.name}
            </button>
          ))}
        </div>
      )}

      {loading && !floor ? (
        <p className="py-16 text-center text-sm text-gray-500">Loading tables…</p>
      ) : !tables.length ? (
        <div className="rounded-xl border border-dashed border-gray-300 py-16 text-center dark:border-gray-700">
          <p className="text-sm text-gray-500">No tables in this branch yet.</p>
          {isManager && <Button className="mt-3" size="sm" onClick={() => { setEditing(true); setTableForm({ table: null }); }}><Plus className="mr-1 h-4 w-4" aria-hidden="true" />Add the first table</Button>}
        </div>
      ) : editing || view === 'map' ? (
        <RoomMap
          tables={tables.filter((t) => section === 'ALL' || t.sectionId === section || (section === 'NONE' && !t.sectionId))}
          editing={editing}
          minutesOf={minutesOf}
          onSelect={(t) => (editing ? setTableForm({ table: t }) : setSelectedId(t.id))}
          onMoved={(id, x, y) => setFloor((f) => (f ? { ...f, tables: f.tables.map((t) => (t.id === id ? { ...t, positionX: x, positionY: y } : t)) } : f))}
        />
      ) : !visible.length ? (
        <p className="py-12 text-center text-sm text-gray-500">No tables match. <button type="button" className="font-semibold text-orange-600 underline" onClick={() => { setFilter('ALL'); setMineOnly(false); setSection('ALL'); }}>Show all</button></p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
          {visible.map((t) => <TableCard key={t.id} table={t} minutes={minutesOf(t)} long={floor!.longSittingMinutes} onOpen={() => setSelectedId(t.id)} />)}
        </div>
      )}

      {selected && !editing && (
        <TableSheet
          table={selected}
          minutes={minutesOf(selected)}
          busy={busy}
          isManager={isManager}
          onClose={() => setSelectedId(null)}
          onNewOrder={() => navigate(`/pos?tableId=${selected.id}`)}
          onPay={(orderId) => navigate(`/orders?pay=${orderId}`)}
          onAction={(a) => act(selected, a)}
          onMove={() => setMoveFor(selected)}
          onOutOfService={(out) => setOutOfService(selected, out)}
          onEdit={() => setTableForm({ table: selected })}
        />
      )}

      {moveFor && (
        <MoveDialog
          from={moveFor}
          tables={tables.filter((t) => t.id !== moveFor.id && t.state !== 'OUT_OF_SERVICE')}
          onClose={() => setMoveFor(null)}
          onMoved={async (msg) => { setMoveFor(null); notify(msg, 'success'); await load(true); }}
        />
      )}

      {tableForm && (
        <TableForm
          table={tableForm.table}
          branchId={branchId}
          sections={floor?.sections || []}
          defaultSection={section !== 'ALL' && section !== 'NONE' ? section : ''}
          existing={tables}
          onClose={() => setTableForm(null)}
          onSaved={async () => { setTableForm(null); await load(true); }}
        />
      )}
    </div>
  );

  async function addSection() {
    const name = await promptDialog('Name the section, for example Terrace, Main hall or VIP.', { title: 'Add a section', required: true, confirmLabel: 'Add section' });
    if (!name) return;
    try {
      await sectionApi.createSection({ name: name.trim(), branchId });
      await load(true);
    } catch (e: any) {
      notify(e.response?.data?.message || 'Could not add the section');
    }
  }
}

/**
 * The manager's strip: how full the room is right now (one block per seat),
 * money still on the tables, and how the day is going.
 */
function FloorPulse({ summary: s, onHide }: { summary: Summary; onHide: () => void }) {
  const today = s.today!;
  const pct = s.seats ? Math.round((s.seatsInUse / s.seats) * 100) : 0;
  const perSeat = s.seats > 0 && s.seats <= 60;
  const best = today.bySection.length > 1 ? today.bySection[0] : null;
  const avg = today.averageMinutes === null ? '—' : today.averageMinutes < 1 ? 'Under 1 min' : duration(today.averageMinutes);
  return (
    <section aria-label="The floor right now and today" className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-[#15151b] lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <div className="border-b border-gray-200 p-5 dark:border-gray-800 lg:border-b-0 lg:border-r">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">Right now</p>
          <p className="text-xs text-gray-500 dark:text-gray-400">{pct}% full</p>
        </div>
        <p className="mt-2 text-3xl font-extrabold tabular-nums text-gray-900 dark:text-gray-50">
          {s.seatsInUse}<span className="text-lg font-semibold text-gray-400"> of {s.seats} seats taken</span>
        </p>
        {perSeat ? (
          <div className="mt-3 flex flex-wrap gap-1" aria-hidden="true">
            {Array.from({ length: s.seats }, (_, i) => (
              <span key={i} className={`h-3 w-3 rounded-[3px] ${i < s.seatsInUse ? 'bg-orange-500' : 'bg-gray-200 dark:bg-white/10'}`} />
            ))}
          </div>
        ) : (
          <div className="mt-3 h-3 overflow-hidden rounded-full bg-gray-200 dark:bg-white/10" aria-hidden="true">
            <div className="h-full rounded-full bg-orange-500" style={{ width: `${pct}%` }} />
          </div>
        )}
        <p className="mt-4 flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
          <Banknote className="h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
          {(s.openBalance || 0) > 0
            ? <span><strong className="tabular-nums text-gray-900 dark:text-gray-50">{kes(s.openBalance || 0)}</strong> still to collect from seated tables</span>
            : <span>No unpaid bills on the floor</span>}
        </p>
      </div>
      <div className="p-5">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">Today at the tables</p>
          <button type="button" onClick={onHide} className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 md:hidden">Hide</button>
        </div>
        <dl className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-3 sm:gap-0 sm:divide-x sm:divide-gray-200 dark:sm:divide-gray-800">
          <PulseStat icon={Banknote} label="Sales" value={kes(today.sales)} hint={best ? `Most from ${best.name}` : undefined} first />
          <PulseStat icon={Receipt} label="Bills closed" value={String(today.tablesServed)} hint={`About ${today.turnsPerTable} per table`} />
          <PulseStat icon={Timer} label="Average time per bill" value={avg} hint="From order to closing" />
        </dl>
      </div>
    </section>
  );
}

function PulseStat({ icon: Icon, label, value, hint, first }: { icon: typeof Check; label: string; value: string; hint?: string; first?: boolean }) {
  return (
    <div className={`flex items-start gap-3 ${first ? 'sm:pr-4' : 'sm:px-4'}`}>
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-orange-50 text-orange-600 dark:bg-orange-500/10 dark:text-orange-400"><Icon className="h-4 w-4" aria-hidden="true" /></span>
      <div className="min-w-0">
        <dt className="text-xs text-gray-500 dark:text-gray-400">{label}</dt>
        <dd className="mt-0.5 truncate text-xl font-bold tabular-nums text-gray-900 dark:text-gray-50">{value}</dd>
        {hint && <dd className="text-xs text-gray-500 dark:text-gray-400">{hint}</dd>}
      </div>
    </div>
  );
}

function TableCard({ table: t, minutes, long, onOpen }: { table: LiveTable; minutes: number | null; long: number; onOpen: () => void }) {
  const st = STATES[t.state] || STATES.FREE;
  const Icon = st.icon;
  const seated = SEATED_STATES.includes(t.state);
  const late = seated && minutes !== null && minutes >= long;
  const warm = seated && minutes !== null && minutes >= long * 0.66;
  return (
    <button type="button" onClick={onOpen} aria-label={`Table ${t.tableNumber}, ${st.label}`}
      className={`flex min-h-[148px] flex-col rounded-xl border-2 p-3 text-left transition hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 ${st.card}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-2xl font-extrabold leading-none text-gray-900 dark:text-gray-50">{t.tableNumber}</div>
          <div className="mt-1 flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400"><Users className="h-3 w-3" aria-hidden="true" />{t.capacity}{t.name ? ` · ${t.name}` : ''}</div>
        </div>
        {minutes !== null && (
          <span className={`flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 text-xs font-bold tabular-nums ${late ? 'bg-red-600 text-white' : warm ? 'bg-amber-200 text-amber-900 dark:bg-amber-800 dark:text-amber-100' : 'bg-white/70 text-gray-700 dark:bg-black/30 dark:text-gray-200'}`}>
            <Clock className="h-3 w-3" aria-hidden="true" />{duration(minutes)}
          </span>
        )}
      </div>
      <span className={`mt-2 inline-flex w-fit items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold ${st.chip} ${t.state === 'FOOD_READY' ? 'animate-pulse' : ''}`}>
        <Icon className="h-3 w-3" aria-hidden="true" />{st.label}
      </span>
      <div className="mt-auto space-y-0.5 pt-2">
        {t.total > 0 && (
          <div className="text-sm">
            {t.balance > 0
              ? <><span className="font-bold tabular-nums text-gray-900 dark:text-gray-50">{kes(t.balance)}</span><span className="text-xs text-gray-500"> due</span></>
              : <span className="font-bold text-teal-700 dark:text-teal-400">Paid {kes(t.total)}</span>}
          </div>
        )}
        {t.waiterName && <div className="flex items-center gap-1 text-xs text-gray-600 dark:text-gray-400"><UserRound className="h-3 w-3" aria-hidden="true" />{t.waiterName}</div>}
        {t.alert && t.alert.kind !== 'FOOD_READY' && (
          <div className={`flex items-center gap-1 text-xs font-semibold ${t.alert.kind === 'LONG' ? 'text-red-700 dark:text-red-400' : 'text-amber-800 dark:text-amber-300'}`}>
            <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden="true" />
            {t.alert.kind === 'BOOKING' && t.nextReservation ? `Booked ${timeOf(t.nextReservation.startAt)}` : t.alert.text}
          </div>
        )}
        {!t.alert && t.state === 'RESERVED' && t.nextReservation && (
          <div className="text-xs text-gray-700 dark:text-gray-300">{timeOf(t.nextReservation.startAt)} · {t.nextReservation.customerName} ({t.nextReservation.partySize})</div>
        )}
      </div>
    </button>
  );
}

function TableSheet({ table: t, minutes, busy, isManager, onClose, onNewOrder, onPay, onAction, onMove, onOutOfService, onEdit }: {
  table: LiveTable; minutes: number | null; busy: string; isManager: boolean; onClose: () => void; onNewOrder: () => void; onPay: (orderId: string) => void;
  onAction: (a: 'MARK_CLEAN' | 'SEAT' | 'CLEAR') => void; onMove: () => void; onOutOfService: (out: boolean) => void; onEdit: () => void;
}) {
  const st = STATES[t.state] || STATES.FREE;
  const Icon = st.icon;
  const seatedOrders = t.orders.filter((o) => !['DRAFT', 'HELD'].includes(o.status));
  const big = 'flex h-12 w-full items-center justify-center gap-2 rounded-xl text-sm font-semibold transition disabled:opacity-50';
  return (
    <DialogOverlay onClose={onClose} label={`Table ${t.tableNumber}`} className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-stretch sm:justify-end">
      <button type="button" aria-label="Close" className="absolute inset-0 cursor-default" onClick={onClose} tabIndex={-1} />
      <div className="relative max-h-[88vh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 shadow-2xl dark:bg-[#15151b] sm:max-h-none sm:w-[400px] sm:rounded-none">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-2xl font-extrabold text-gray-900 dark:text-gray-50">Table {t.tableNumber}</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">{t.capacity} seats{t.name ? ` · ${t.name}` : ''}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-white/5"><X className="h-5 w-5" /></button>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold ${st.chip}`}><Icon className="h-3.5 w-3.5" aria-hidden="true" />{st.label}</span>
          {minutes !== null && <span className="text-sm text-gray-600 dark:text-gray-300">{t.state === 'CLEANING' ? 'waiting' : 'seated'} {duration(minutes)}</span>}
          {t.waiterName && <span className="text-sm text-gray-600 dark:text-gray-300">· {t.waiterName}</span>}
        </div>

        {t.nextReservation && (
          <div className="mt-4 flex items-start gap-2 rounded-xl bg-yellow-50 p-3 text-sm text-yellow-900 dark:bg-yellow-950/30 dark:text-yellow-200">
            <CalendarClock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>Booked at <strong>{timeOf(t.nextReservation.startAt)}</strong> for {t.nextReservation.customerName}, {t.nextReservation.partySize} {t.nextReservation.partySize === 1 ? 'guest' : 'guests'}.</span>
          </div>
        )}

        {t.orders.length > 0 && (
          <section className="mt-4" aria-label="Orders at this table">
            <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200 dark:divide-gray-800 dark:border-gray-800">
              {t.orders.map((o) => {
                const due = Math.max(0, o.totalAmount - o.amountPaid);
                return (
                  <li key={o.id} className="flex items-center justify-between gap-3 p-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold">Order {o.orderNumber}</p>
                      <p className="text-xs text-gray-500">{o.status.charAt(0) + o.status.slice(1).toLowerCase()} · {timeOf(o.createdAt)}{o.waiterName ? ` · ${o.waiterName}` : ''}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold tabular-nums">{kes(o.totalAmount)}</p>
                      {due > 0 && !['DRAFT', 'HELD'].includes(o.status)
                        ? <button type="button" onClick={() => onPay(o.id)} className="text-xs font-semibold text-orange-600 underline dark:text-orange-400">Take {kes(due)}</button>
                        : due <= 0 ? <p className="text-xs font-semibold text-teal-600">Paid</p> : <p className="text-xs text-gray-500">On hold</p>}
                    </div>
                  </li>
                );
              })}
            </ul>
            {seatedOrders.length > 1 && <p className="mt-2 text-right text-sm">Table total <strong className="tabular-nums">{kes(t.total)}</strong>{t.balance > 0 ? <>, <strong className="tabular-nums">{kes(t.balance)}</strong> due</> : ', all paid'}</p>}
          </section>
        )}

        <div className="mt-5 space-y-2">
          {t.state === 'CLEANING' && (
            <button type="button" disabled={!!busy} onClick={() => onAction('MARK_CLEAN')} className={`${big} bg-emerald-600 text-white hover:bg-emerald-700`}><Sparkles className="h-4 w-4" aria-hidden="true" />{busy === 'MARK_CLEAN' ? 'Saving…' : 'Mark clean, table is free'}</button>
          )}
          {t.state !== 'OUT_OF_SERVICE' && (
            <button type="button" onClick={onNewOrder} className={`${big} bg-orange-500 text-white hover:bg-orange-600`}><Plus className="h-4 w-4" aria-hidden="true" />{seatedOrders.length ? 'Add another order' : 'Start an order'}</button>
          )}
          {t.balance > 0 && seatedOrders.length === 1 && (
            <button type="button" onClick={() => onPay(seatedOrders[0].id)} className={`${big} border border-gray-300 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-white/5`}><CreditCard className="h-4 w-4" aria-hidden="true" />Take payment ({kes(t.balance)})</button>
          )}
          {['FREE', 'RESERVED', 'CLEANING'].includes(t.state) && (
            <button type="button" disabled={!!busy} onClick={() => onAction('SEAT')} className={`${big} border border-gray-300 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-white/5`}><Users className="h-4 w-4" aria-hidden="true" />{busy === 'SEAT' ? 'Saving…' : 'Seat guests (order later)'}</button>
          )}
          {t.orders.length > 0 && (
            <button type="button" onClick={onMove} className={`${big} border border-gray-300 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-white/5`}><ArrowRightLeft className="h-4 w-4" aria-hidden="true" />Move to another table</button>
          )}
          {t.state === 'SEATED' && (
            <button type="button" disabled={!!busy} onClick={() => onAction('CLEAR')} className={`${big} border border-gray-300 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-white/5`}><X className="h-4 w-4" aria-hidden="true" />{busy === 'CLEAR' ? 'Saving…' : 'Guests left without ordering'}</button>
          )}
        </div>

        {isManager && (
          <div className="mt-6 flex flex-wrap gap-2 border-t border-gray-200 pt-4 dark:border-gray-800">
            <Button variant="secondary" size="sm" onClick={onEdit}><Pencil className="mr-1 h-3.5 w-3.5" aria-hidden="true" />Edit table</Button>
            {t.state === 'OUT_OF_SERVICE'
              ? <Button variant="secondary" size="sm" disabled={!!busy} onClick={() => onOutOfService(false)}>Back in service</Button>
              : !SEATED_STATES.includes(t.state) && <Button variant="secondary" size="sm" disabled={!!busy} onClick={() => onOutOfService(true)}><Wrench className="mr-1 h-3.5 w-3.5" aria-hidden="true" />Out of service</Button>}
          </div>
        )}
      </div>
    </DialogOverlay>
  );
}

function MoveDialog({ from, tables, onClose, onMoved }: { from: LiveTable; tables: LiveTable[]; onClose: () => void; onMoved: (msg: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const free = tables.filter((t) => ['FREE', 'CLEANING', 'RESERVED'].includes(t.state));
  const taken = tables.filter((t) => !['FREE', 'CLEANING', 'RESERVED'].includes(t.state));
  const move = async (to: LiveTable) => {
    if (SEATED_STATES.includes(to.state) && !(await confirmDialog(`Table ${to.tableNumber} already has guests. Put both parties' orders on table ${to.tableNumber}?`, { confirmLabel: 'Move anyway' }))) return;
    setBusy(true);
    setError('');
    try {
      const res = await orderApi.moveTable(from.orders[0].id, to.id);
      onMoved(res.data.message || `Moved to table ${to.tableNumber}`);
    } catch (e: any) {
      setError(e.response?.data?.message || 'Could not move the order');
      setBusy(false);
    }
  };
  const pick = (list: LiveTable[]) => (
    <div className="grid grid-cols-4 gap-2 sm:grid-cols-5">
      {list.map((t) => (
        <button key={t.id} type="button" disabled={busy} onClick={() => move(t)} className={`rounded-lg border-2 p-2 text-center disabled:opacity-50 ${(STATES[t.state] || STATES.FREE).card}`}>
          <span className="block text-lg font-extrabold">{t.tableNumber}</span>
          <span className="block text-[11px] text-gray-500">{t.capacity} seats</span>
        </button>
      ))}
    </div>
  );
  return (
    <Modal title={`Move table ${from.tableNumber}`} onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-gray-600 dark:text-gray-300">Pick where the guests moved to. All {from.orders.length > 1 ? `${from.orders.length} open orders` : 'the open order'} on table {from.tableNumber} go with them, and table {from.tableNumber} is marked for cleaning.</p>
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        {free.length ? pick(free) : <p className="text-sm text-gray-500">No free tables right now.</p>}
        {taken.length > 0 && <details><summary className="cursor-pointer text-sm font-semibold text-gray-600 dark:text-gray-300">Join a table that already has guests</summary><div className="mt-2">{pick(taken)}</div></details>}
      </div>
    </Modal>
  );
}

/** The room, drawn to scale. Managers drag tables in edit mode (mouse or touch); it snaps to a grid and saves on drop. */
function RoomMap({ tables, editing, minutesOf, onSelect, onMoved }: {
  tables: LiveTable[]; editing: boolean; minutesOf: (t: LiveTable) => number | null; onSelect: (t: LiveTable) => void; onMoved: (id: string, x: number, y: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: string; dx: number; dy: number; startX: number; startY: number; moved: boolean } | null>(null);
  const [pos, setPos] = useState<{ id: string; x: number; y: number } | null>(null);
  const [saving, setSaving] = useState<{ id: string; state: 'saving' | 'saved' | 'failed' } | null>(null);
  const width = Math.max(900, ...tables.map((t) => t.positionX + t.width + GRID * 2));
  const height = Math.max(520, ...tables.map((t) => t.positionY + t.height + GRID * 2));

  const down = (e: React.PointerEvent, t: LiveTable) => {
    if (!editing || !e.isPrimary || e.button !== 0 || drag.current) return;
    const box = ref.current!.getBoundingClientRect();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { id: t.id, dx: e.clientX - box.left + ref.current!.scrollLeft - t.positionX, dy: e.clientY - box.top + ref.current!.scrollTop - t.positionY, startX: t.positionX, startY: t.positionY, moved: false };
  };
  const cancel = () => {
    drag.current = null;
    setPos(null);
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || !e.isPrimary) return;
    const box = ref.current!.getBoundingClientRect();
    const x = Math.max(0, e.clientX - box.left + ref.current!.scrollLeft - d.dx);
    const y = Math.max(0, e.clientY - box.top + ref.current!.scrollTop - d.dy);
    if (Math.abs(x - d.startX) + Math.abs(y - d.startY) > 4) d.moved = true;
    setPos({ id: d.id, x, y });
  };
  const up = async (t: LiveTable) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (!d.moved || !pos) { setPos(null); onSelect(t); return; }
    const x = Math.round(pos.x / GRID) * GRID;
    const y = Math.round(pos.y / GRID) * GRID;
    setPos(null);
    onMoved(t.id, x, y);
    setSaving({ id: t.id, state: 'saving' });
    try {
      await tableApi.updateTablePosition(t.id, { positionX: x, positionY: y, width: t.width, height: t.height, rotation: t.rotation });
      setSaving({ id: t.id, state: 'saved' });
      setTimeout(() => setSaving((s) => (s?.id === t.id ? null : s)), 1500);
    } catch {
      onMoved(t.id, d.startX, d.startY);
      setSaving({ id: t.id, state: 'failed' });
      notify(`Couldn't save where table ${t.tableNumber} goes. It was put back.`);
    }
  };

  return (
    <div ref={ref} className="relative h-[560px] overflow-auto rounded-xl border border-gray-200 bg-[#faf9f7] dark:border-gray-800 dark:bg-[#0f0f14]"
      style={editing ? { backgroundImage: 'radial-gradient(circle, rgba(148,163,184,.35) 1px, transparent 1px)', backgroundSize: `${GRID}px ${GRID}px` } : undefined}>
      <div className="relative" style={{ width, height }}>
        {tables.map((t) => {
          const st = STATES[t.state] || STATES.FREE;
          const p = pos?.id === t.id ? pos : null;
          const minutes = minutesOf(t);
          return (
            <button
              key={t.id}
              type="button"
              aria-label={`Table ${t.tableNumber}, ${st.label}`}
              onPointerDown={(e) => down(e, t)}
              onPointerMove={move}
              onPointerUp={(e) => { if (e.isPrimary) void up(t); }}
              onPointerCancel={cancel}
              onLostPointerCapture={() => { if (drag.current?.id === t.id) cancel(); }}
              onClick={() => { if (!editing) onSelect(t); }}
              className={`absolute flex select-none flex-col items-center justify-center border-2 text-center shadow-sm ${t.shape === 'CIRCLE' ? 'rounded-full' : 'rounded-xl'} ${st.card} ${editing ? 'cursor-grab touch-none active:cursor-grabbing' : 'cursor-pointer'} ${p ? 'z-20 shadow-lg' : ''}`}
              style={{ left: p ? p.x : t.positionX, top: p ? p.y : t.positionY, width: t.width, height: t.height, transform: `rotate(${t.rotation}deg)` }}
            >
              <span className="text-base font-extrabold leading-none">{t.tableNumber}</span>
              {!editing && minutes !== null && <span className="mt-0.5 text-[10px] font-semibold tabular-nums text-gray-600 dark:text-gray-300">{duration(minutes)}</span>}
              {editing && <span className="mt-0.5 text-[10px] text-gray-500">{t.capacity} seats</span>}
              {saving?.id === t.id && <span className="absolute -bottom-5 whitespace-nowrap text-[10px] font-semibold text-gray-500">{saving.state === 'saving' ? 'Saving…' : saving.state === 'saved' ? 'Saved' : 'Not saved'}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function TableForm({ table, branchId, sections, defaultSection, existing, onClose, onSaved }: {
  table: LiveTable | null; branchId: string; sections: Array<{ id: string; name: string }>; defaultSection: string; existing: LiveTable[]; onClose: () => void; onSaved: () => void;
}) {
  const nextNumber = String(Math.max(0, ...existing.map((t) => parseInt(t.tableNumber, 10)).filter((n) => !Number.isNaN(n))) + 1);
  const [form, setForm] = useState({
    tableNumber: table?.tableNumber || nextNumber,
    name: table?.name || '',
    capacity: String(table?.capacity || 4),
    shape: table?.shape || 'SQUARE',
    sectionId: table ? table.sectionId || '' : defaultSection,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const sizeFor = (shape: string) => (shape === 'RECTANGLE' ? { width: 140, height: 80 } : { width: 80, height: 80 });

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    const base = { tableNumber: form.tableNumber.trim(), name: form.name.trim() || null, capacity: Number(form.capacity), shape: form.shape, sectionId: form.sectionId || null };
    try {
      if (table) {
        const size = form.shape !== table.shape ? sizeFor(form.shape) : {};
        await tableApi.updateTable(table.id, { ...base, ...size });
      } else {
        // New tables go on the next free spot of a grid instead of on top of each other.
        const taken = new Set(existing.map((t) => `${Math.round(t.positionX / 120)}:${Math.round(t.positionY / 120)}`));
        let slot = 0;
        while (taken.has(`${slot % 7}:${Math.floor(slot / 7)}`)) slot++;
        await tableApi.createTable({ ...base, branchId, status: 'AVAILABLE', positionX: 20 + (slot % 7) * 120, positionY: 20 + Math.floor(slot / 7) * 120, ...sizeFor(form.shape), rotation: 0, displayOrder: 0 });
      }
      onSaved();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Could not save the table');
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!table || !(await confirmDialog(`Remove table ${table.tableNumber}? Past orders keep their records.`, { danger: true, confirmLabel: 'Remove table' }))) return;
    try {
      await tableApi.deleteTable(table.id);
      onSaved();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Could not remove the table');
    }
  };

  return (
    <Modal title={table ? `Table ${table.tableNumber}` : 'Add a table'} onClose={onClose}>
      <form onSubmit={save} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <Input id="tableNumber" label="Table number" value={form.tableNumber} onChange={(e) => setForm({ ...form, tableNumber: e.target.value })} required maxLength={20} />
          <Input id="capacity" type="number" min="1" max="50" label="Seats" value={form.capacity} onChange={(e) => setForm({ ...form, capacity: e.target.value })} required />
        </div>
        <Input id="name" label="Name (optional)" placeholder="e.g. Window booth" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <div className="grid grid-cols-2 gap-4">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Shape
            <select value={form.shape} onChange={(e) => setForm({ ...form, shape: e.target.value })} className="rms-control mt-1 w-full">
              <option value="SQUARE">Square</option>
              <option value="RECTANGLE">Long table</option>
              <option value="CIRCLE">Round</option>
            </select>
          </label>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Section
            <select value={form.sectionId} onChange={(e) => setForm({ ...form, sectionId: e.target.value })} className="rms-control mt-1 w-full">
              <option value="">No section</option>
              {sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
        </div>
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        <div className="flex items-center justify-between gap-3">
          {table ? <Button type="button" variant="danger" size="sm" onClick={remove}><Trash2 className="mr-1 h-4 w-4" aria-hidden="true" />Remove</Button> : <span />}
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
            <Button type="submit" loading={busy}>{table ? 'Save' : 'Add table'}</Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
