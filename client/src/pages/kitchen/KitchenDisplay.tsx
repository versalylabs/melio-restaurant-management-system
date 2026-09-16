import { useState, useEffect, useCallback } from 'react';
import { Clock, Play, CheckCircle, AlertTriangle, Printer, Flag, WifiOff } from 'lucide-react';
import { kitchenApi } from '../../services/api';
import { getActiveBranchId } from '../../utils/branch';
import type { KitchenTicket, KitchenStation } from '../../types';
import { useAuth } from '../../contexts/AuthContext';
import { useRealtimeEvents } from '../../hooks/useRealtimeEvents';
import Button from '../../components/ui/Button';
import Badge from '../../components/ui/Badge';
import Modal from '../../components/ui/Modal';

const LATE_THRESHOLD_MINUTES = 15;

function formatDuration(start?: string, end?: string): string {
  if (!start) return '—';
  const diff = Math.max(0, (end ? new Date(end).getTime() : Date.now()) - new Date(start).getTime());
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(mins / 60);
  return hours ? `${hours}h ${mins % 60}m` : `${mins}m`;
}

function isLate(receivedAt: string): boolean {
  return Date.now() - new Date(receivedAt).getTime() > LATE_THRESHOLD_MINUTES * 60000;
}

const priorityRank: Record<string, number> = { URGENT: 0, HIGH: 1, NORMAL: 2, LOW: 3 };

export default function KitchenDisplay() {
  const { user } = useAuth();
  const activeBranchId = getActiveBranchId(user);
  const [tickets, setTickets] = useState<KitchenTicket[]>([]);
  const [stations, setStations] = useState<KitchenStation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedStation, setSelectedStation] = useState('');
  const [selectedTicket, setSelectedTicket] = useState<KitchenTicket | null>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [updating, setUpdating] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [ticketsRes, stationsRes] = await Promise.all([kitchenApi.getTickets(activeBranchId ? { branchId: activeBranchId } : undefined), kitchenApi.getStations(activeBranchId ? { branchId: activeBranchId } : undefined)]);
      if (ticketsRes.data.success) setTickets(ticketsRes.data.data?.tickets || []);
      if (stationsRes.data.success) {
        const next = stationsRes.data.data?.stations || [];
        setStations(next);
        if (!selectedStation && next.length) setSelectedStation('');
      }
      setError('');
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to load kitchen data');
    } finally {
      setLoading(false);
    }
  }, [activeBranchId, selectedStation]);

  // Real-time Event Subscription
  const { isConnected, subscribe } = useRealtimeEvents({
    url: '/api/realtime/stream',
    channels: activeBranchId ? [`kitchen:${activeBranchId}`] : [],
    enabled: !!user,
  });

  useEffect(() => {
    const unsub1 = subscribe('ticket_created', () => {
      fetchData();
    });
    const unsub2 = subscribe('ticket_status_changed', () => {
      fetchData();
    });
    const unsub3 = subscribe('ticket_item_updated', () => {
      fetchData();
    });
    const unsub4 = subscribe('new_online_order', () => {
      fetchData();
    });

    return () => {
      unsub1();
      unsub2();
      unsub3();
      unsub4();
    };
  }, [subscribe, fetchData]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const filteredTickets = tickets
    .filter((t) => !selectedStation || (t.stationIds || []).includes(selectedStation) || t.stationId === selectedStation || (t.items || []).some(i => (i.stationIds || []).includes(selectedStation)))
    .sort((a, b) => (priorityRank[a.priority] ?? 2) - (priorityRank[b.priority] ?? 2) || new Date(a.receivedAt).getTime() - new Date(b.receivedAt).getTime());

  const byStatus = (status: string) => filteredTickets.filter(t => t.status === status);

  const updateTicket = async (ticket: KitchenTicket, status: string, extra: any = {}) => {
    setUpdating(ticket.id);
    try {
      await kitchenApi.updateTicketStatus(ticket.id, { status, ...extra });
      await fetchData();
      if (selectedTicket?.id === ticket.id) {
        const fresh = tickets.find(t => t.id === ticket.id);
        if (fresh) setSelectedTicket(fresh);
      }
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to update kitchen ticket');
    } finally { setUpdating(null); }
  };

  const handleItemStatus = async (ticketId: string, itemId: string, status: string) => {
    setUpdating(itemId);
    try {
      await kitchenApi.updateTicketItemStatus(ticketId, itemId, { status });
      await fetchData();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to update item status');
    } finally { setUpdating(null); }
  };

  const printTicket = (ticket: KitchenTicket) => {
    const items = ticket.items.map(i => `<tr><td>${i.quantity} × ${escapeHtml(i.itemNameSnapshot)}</td><td>${escapeHtml(i.status)}</td></tr>`).join('');
    const popup = window.open('', '_blank', 'width=520,height=720');
    if (!popup) return;
    popup.document.write(`<!doctype html><html><head><title>Kitchen Ticket ${escapeHtml(ticket.orderNumber || '')}</title><style>body{font-family:Arial,sans-serif;padding:24px}h1{font-size:22px;margin:0 0 6px}p{margin:4px 0;color:#444}table{width:100%;border-collapse:collapse;margin-top:18px}td{padding:9px 4px;border-bottom:1px solid #ddd}td:last-child{text-align:right}.priority{font-weight:bold}.notes{margin-top:18px;padding:10px;background:#f4f4f4}</style></head><body><h1>KITCHEN TICKET #${escapeHtml(ticket.orderNumber || '')}</h1><p>${escapeHtml(ticket.orderType || '')}${ticket.tableNumber ? ` · Table ${escapeHtml(ticket.tableNumber)}` : ''}</p><p>Received: ${new Date(ticket.receivedAt).toLocaleString()}</p><p class="priority">Priority: ${escapeHtml(ticket.priority)}</p><table>${items}</table>${ticket.orderNotes ? `<div class="notes"><b>Order Notes:</b><br>${escapeHtml(ticket.orderNotes)}</div>` : ''}<script>window.onload=()=>{window.print();window.close()}</script></body></html>`);
    popup.document.close();
  };

  if (loading) return <div className="flex items-center justify-center h-full"><div className="text-gray-500 dark:text-gray-400">Loading kitchen display...</div></div>;

  const stationName = stations.find(s => s.id === selectedStation)?.name || 'All Stations';
  const columns = [
    { key: 'NEW', title: 'NEW', variant: 'default' as const, action: (t: KitchenTicket) => updateTicket(t, 'PREPARING') },
    { key: 'PREPARING', title: 'PREPARING', variant: 'warning' as const, action: (t: KitchenTicket) => updateTicket(t, 'READY') },
    { key: 'READY', title: 'READY', variant: 'success' as const, action: (t: KitchenTicket) => updateTicket(t, 'SERVED') },
  ];

  return <div className="h-[calc(100vh-4rem)] flex flex-col">
    <div className="p-4 border-b border-orange-100 dark:border-gray-700 flex flex-wrap items-center justify-between gap-4">
      <div>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Kitchen Display</h1>
          {isConnected ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-400">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
              LIVE SYNC
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 border border-amber-500/30 px-2.5 py-0.5 text-[11px] font-semibold text-amber-400">
              <WifiOff size={11} /> Polling Mode
            </span>
          )}
        </div>
        <p className="text-sm text-gray-500 dark:text-gray-400">Branch: {user?.branchName || 'Not assigned'} • {stationName} • {filteredTickets.length} active tickets</p>
      </div>
      <div className="flex gap-2">
        <select value={selectedStation} onChange={e => setSelectedStation(e.target.value)} className="flex h-10 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-[#111116] dark:text-gray-100">
          <option value="">All Stations</option>
          {stations.map(s => <option key={s.id} value={s.id}>{s.name}{s.branchName ? ` — ${s.branchName}` : ''}</option>)}
        </select>
        <Button variant="secondary" onClick={fetchData} size="sm">Refresh</Button>
      </div>
    </div>
    {error && <div className="mx-4 mt-4 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 px-4 py-3 rounded-md text-sm">{error}</div>}
    <div className="flex-1 overflow-x-auto"><div className="flex gap-6 p-6 h-full">
      {columns.map(col => {
        const list = byStatus(col.key);
        return <div key={col.key} className="flex-1 min-w-[300px]"><div className="flex items-center justify-between mb-4"><h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{col.title}</h2><Badge variant={col.variant}>{list.length}</Badge></div><div className="space-y-4">
          {list.map(ticket => <TicketCard key={ticket.id} ticket={ticket} selectedStation={selectedStation} onAction={() => col.action(ticket)} onView={() => { setSelectedTicket(ticket); setShowDetailModal(true); }} onPrint={() => printTicket(ticket)} updating={updating === ticket.id} />)}
          {!list.length && <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-8">No {col.title.toLowerCase()} orders</p>}
        </div></div>;
      })}
    </div></div>

    {showDetailModal && selectedTicket && <Modal title={`Order ${selectedTicket.orderNumber}`} onClose={() => { setShowDetailModal(false); setSelectedTicket(null); }}>
      <div className="space-y-5">
        <div className="flex items-start justify-between gap-3"><div><h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{selectedTicket.orderNumber}</h3><p className="text-sm text-gray-500 dark:text-gray-400">{selectedTicket.orderType}{selectedTicket.tableNumber ? ` • Table ${selectedTicket.tableNumber}` : ''}</p></div><div className="flex gap-2"><Badge variant={selectedTicket.priority === 'URGENT' ? 'danger' : selectedTicket.priority === 'HIGH' ? 'warning' : 'default'}>{selectedTicket.priority}</Badge><Badge variant={selectedTicket.status === 'READY' || selectedTicket.status === 'SERVED' ? 'success' : selectedTicket.status === 'PREPARING' ? 'warning' : 'default'}>{selectedTicket.status}</Badge></div></div>
        <div className="grid grid-cols-3 gap-3"><div><p className="text-xs text-gray-500 uppercase">Received</p><p className="text-sm font-medium">{new Date(selectedTicket.receivedAt).toLocaleTimeString()}</p></div><div><p className="text-xs text-gray-500 uppercase">Prep time</p><p className="text-sm font-medium">{formatDuration(selectedTicket.startedAt, selectedTicket.readyAt || selectedTicket.completedAt)}</p></div><div><p className="text-xs text-gray-500 uppercase">Elapsed</p><p className={`text-sm font-medium ${isLate(selectedTicket.receivedAt) ? 'text-red-600' : ''}`}>{formatDuration(selectedTicket.receivedAt)} {isLate(selectedTicket.receivedAt) && <AlertTriangle className="w-4 h-4 inline" />}</p></div></div>
        <div className="flex items-center gap-3"><label className="text-sm font-medium text-gray-700 dark:text-gray-300">Priority</label><select value={selectedTicket.priority} onChange={e => updateTicket(selectedTicket, selectedTicket.status, { priority: e.target.value })} className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-[#111116] dark:text-gray-100"><option value="LOW">Low</option><option value="NORMAL">Normal</option><option value="HIGH">High</option><option value="URGENT">Urgent</option></select><Button variant="secondary" size="sm" onClick={() => printTicket(selectedTicket)}><Printer className="w-4 h-4 mr-1"/>Print Ticket</Button></div>
        {selectedTicket.orderNotes && <div className="rounded-md bg-[#faf9f7] dark:bg-[#111116]/70 p-3"><p className="text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">Order Notes</p><p className="text-sm mt-1 text-gray-700 dark:text-gray-300">{selectedTicket.orderNotes}</p></div>}
        <div><h4 className="text-sm font-medium mb-3 text-gray-900 dark:text-gray-100">Preparation by station</h4><div className="space-y-3">{selectedTicket.items.map(item => {
          const belongs = !selectedStation || (item.stationIds || []).includes(selectedStation) || (selectedTicket.stationIds || []).includes(selectedStation);
          if (!belongs) return null;
          return <div key={item.id} className="border-b border-gray-100 dark:border-gray-700 pb-3"><div className="flex items-center justify-between gap-3"><div className="flex-1"><p className="text-sm font-medium">{item.quantity}× {item.itemNameSnapshot}</p>{item.stationNames?.length ? <div className="flex flex-wrap gap-1 mt-1">{item.stationNames.map((n,i)=><Badge key={`${n}-${i}`} className="text-[10px]">{n}</Badge>)}</div>:null}{item.notes && <p className="text-xs italic text-gray-500 mt-1">{item.notes}</p>}</div><select value={item.status} onChange={e => handleItemStatus(selectedTicket.id,item.id,e.target.value)} disabled={updating===item.id} className="text-xs rounded-md border border-gray-300 bg-white px-2 py-1 dark:border-gray-600 dark:bg-[#111116] dark:text-gray-100"><option value="PENDING">Pending</option><option value="PREPARING">Preparing</option><option value="READY">Ready</option><option value="CANCELLED">Cancelled</option></select></div></div>;
        })}</div></div>
        <div className="flex gap-2">{selectedTicket.status === 'NEW' && <Button onClick={() => updateTicket(selectedTicket,'PREPARING')} disabled={!!updating} className="flex-1"><Play className="w-4 h-4 mr-1"/>Start Preparing</Button>}{selectedTicket.status === 'PREPARING' && <Button onClick={() => updateTicket(selectedTicket,'READY')} disabled={!!updating} className="flex-1"><CheckCircle className="w-4 h-4 mr-1"/>Mark Ready</Button>}{selectedTicket.status === 'READY' && <Button onClick={() => updateTicket(selectedTicket,'SERVED')} disabled={!!updating} className="flex-1"><CheckCircle className="w-4 h-4 mr-1"/>Mark Served</Button>}</div>
      </div>
    </Modal>}
  </div>;
}

function escapeHtml(value: string): string { return value.replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c] || c)); }

function TicketCard({ ticket, selectedStation, onAction, onView, onPrint, updating }: { ticket: KitchenTicket; selectedStation: string; onAction: () => void; onView: () => void; onPrint: () => void; updating: boolean }) {
  const visibleItems = selectedStation ? ticket.items.filter(i => (i.stationIds || []).includes(selectedStation) || (ticket.stationIds || []).includes(selectedStation)) : ticket.items;
  const late = isLate(ticket.receivedAt);
  return <div className={`rounded-lg border-2 p-4 cursor-pointer transition-all ${late ? 'border-red-300 bg-red-50 dark:bg-red-900/30 dark:border-red-800' : 'border-gray-200 bg-white dark:bg-[#111116] dark:border-gray-700'} ${updating ? 'opacity-50' : ''}`} onClick={onView}>
    <div className="flex items-start justify-between mb-3"><div><div className="flex items-center gap-2"><h3 className="font-bold text-gray-900 dark:text-gray-100">#{ticket.orderNumber}</h3><Badge variant={ticket.priority === 'URGENT' ? 'danger' : ticket.priority === 'HIGH' ? 'warning' : 'default'} className="text-xs"><Flag className="w-3 h-3 mr-1 inline"/>{ticket.priority}</Badge></div><p className="text-sm text-gray-600 dark:text-gray-400 mt-1">{ticket.orderType}{ticket.tableNumber ? ` • Table ${ticket.tableNumber}` : ''}</p></div><div className={`flex items-center gap-1 text-xs ${late ? 'text-red-600' : 'text-gray-500'}`}><Clock className="w-3 h-3"/>{formatDuration(ticket.receivedAt)}</div></div>
    <div className="space-y-2 mb-4">{visibleItems.map(item => <div key={item.id} className="flex items-center justify-between gap-2"><div><p className="text-sm text-gray-900 dark:text-gray-100">{item.quantity}× {item.itemNameSnapshot}</p>{item.stationNames?.length ? <p className="text-[10px] text-gray-500">{item.stationNames.join(' • ')}</p>:null}</div><Badge variant={item.status === 'READY' ? 'success' : item.status === 'PREPARING' ? 'warning' : 'default'} className="text-xs">{item.status}</Badge></div>)}</div>
    <div className="flex gap-2"><Button size="sm" onClick={e => {e.stopPropagation();onAction();}} disabled={updating} className="flex-1">{ticket.status === 'NEW' ? 'Start Preparing' : ticket.status === 'PREPARING' ? 'Ready' : 'Served'}</Button><Button size="sm" variant="secondary" onClick={e=>{e.stopPropagation();onPrint();}} disabled={updating}><Printer className="w-4 h-4"/></Button></div>
  </div>;
}
