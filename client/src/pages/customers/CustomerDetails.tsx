import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Coins, Edit3, Mail, MapPin, MessageSquare, Phone, Search, ShoppingBag, UserRound } from 'lucide-react';
import { customerApi } from '../../services/api';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import Badge from '../../components/ui/Badge';
import Card from '../../components/ui/Card';
import DialogOverlay from '../../components/ui/DialogOverlay';

const money = (value: number) => `KES ${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const date = (value?: string | null) => value ? new Date(value).toLocaleString() : '—';

function statusVariant(status: string) {
  if (status === 'COMPLETED') return 'success' as const;
  if (status === 'CANCELLED') return 'danger' as const;
  if (['READY', 'SERVED'].includes(status)) return 'info' as const;
  return 'warning' as const;
}

export default function CustomerDetails() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [customer, setCustomer] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [orderStatus, setOrderStatus] = useState('ALL');
  const [showEdit, setShowEdit] = useState(false);
  const [showPoints, setShowPoints] = useState(false);
  const [pointsMode, setPointsMode] = useState<'adjust' | 'redeem'>('adjust');
  const [adjustDirection, setAdjustDirection] = useState<'credit' | 'debit'>('credit');
  const [points, setPoints] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: '', phone: '', email: '', address: '', notes: '', status: 'ACTIVE' });

  const load = async () => {
    if (!id) return;
    setLoading(true); setError('');
    try {
      const response = await customerApi.getCustomer(id);
      const data = response.data?.data || response.data;
      setCustomer(data);
      setForm({ name: data.name || '', phone: data.phone || '', email: data.email || '', address: data.address || '', notes: data.notes || '', status: data.status || 'ACTIVE' });
    } catch (err: any) {
      setError(err.response?.data?.message || 'Unable to load customer.');
    } finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, [id]);

  const orders = useMemo(() => (customer?.orders || []).filter((order: any) => {
    const matchesStatus = orderStatus === 'ALL' || order.status === orderStatus;
    const q = search.trim().toLowerCase();
    const matchesSearch = !q || order.orderNumber.toLowerCase().includes(q) || order.items.some((item: any) => item.itemNameSnapshot.toLowerCase().includes(q));
    return matchesStatus && matchesSearch;
  }), [customer, search, orderStatus]);

  const saveCustomer = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true); setError('');
    try {
      await customerApi.updateCustomer(id!, form);
      setShowEdit(false); await load();
    } catch (err: any) { setError(err.response?.data?.message || 'Unable to update customer.'); }
    finally { setSaving(false); }
  };

  const changePoints = async (event: React.FormEvent) => {
    event.preventDefault();
    const amount = Number(points);
    if (!Number.isInteger(amount) || amount <= 0) { setError('Enter a positive whole number of points.'); return; }
    setSaving(true); setError('');
    try {
      if (pointsMode === 'redeem') await customerApi.redeemLoyalty(id!, { points: amount, note });
      else await customerApi.adjustLoyalty(id!, { points: adjustDirection === 'credit' ? amount : -amount, note });
      setShowPoints(false); setPoints(''); setNote(''); await load();
    } catch (err: any) { setError(err.response?.data?.message || 'Unable to update loyalty points.'); }
    finally { setSaving(false); }
  };

  if (loading) return <div className="p-6 text-gray-500 dark:text-gray-400">Loading customer...</div>;
  if (!customer) return <div className="p-6"><div className="mb-4">{error || 'Customer not found.'}</div><Button onClick={() => navigate('/customers')}>Back to Customers</Button></div>;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/customers')} className="p-2 rounded-lg hover:bg-orange-50 dark:hover:bg-[#1a1a20] text-gray-600 dark:text-gray-300"><ArrowLeft className="w-5 h-5" /></button>
        <div className="flex-1"><h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{customer.name}</h1><p className="text-sm text-gray-500 dark:text-gray-400">Customer profile, order history and loyalty activity.</p></div>
        <Button variant="secondary" onClick={() => setShowEdit(true)}><Edit3 className="w-4 h-4 mr-2" />Edit Customer</Button>
      </div>
      {error && <div className="rounded-md border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/30 px-4 py-3 text-sm text-red-700 dark:text-red-400">{error}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        <Card title="Orders"><div className="text-2xl font-bold text-gray-900 dark:text-gray-100">{customer.stats?.orderCount || 0}</div><p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Completed orders</p></Card>
        <Card title="Total Spent"><div className="text-2xl font-bold text-gray-900 dark:text-gray-100">{money(customer.stats?.totalSpent || 0)}</div><p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Completed orders</p></Card>
        <Card title="Last Order"><div className="text-lg font-bold text-gray-900 dark:text-gray-100">{customer.stats?.lastOrderDate ? new Date(customer.stats.lastOrderDate).toLocaleDateString() : '—'}</div><p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Most recent completed order</p></Card>
        <Card title="Loyalty Points" actions={<Button onClick={() => { setPointsMode('adjust'); setShowPoints(true); }} variant="secondary">Manage</Button>}><div className="flex items-center gap-2"><Coins className="w-5 h-5 text-yellow-500" /><span className="text-2xl font-bold text-gray-900 dark:text-gray-100">{customer.loyaltyBalance || 0}</span></div><p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Current balance</p></Card>
      </div>

      <Card title="Customer Details">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 text-sm">
          <div className="flex gap-3"><UserRound className="w-4 h-4 mt-0.5 text-gray-400" /><div><div className="text-gray-500 dark:text-gray-400">Name</div><div className="font-medium text-gray-900 dark:text-gray-100">{customer.name}</div></div></div>
          <div className="flex gap-3"><Phone className="w-4 h-4 mt-0.5 text-gray-400" /><div><div className="text-gray-500 dark:text-gray-400">Phone</div><div className="font-medium text-gray-900 dark:text-gray-100">{customer.phone || 'Not provided'}</div></div></div>
          <div className="flex gap-3"><Mail className="w-4 h-4 mt-0.5 text-gray-400" /><div><div className="text-gray-500 dark:text-gray-400">Email</div><div className="font-medium text-gray-900 dark:text-gray-100">{customer.email || 'Not provided'}</div></div></div>
          <div className="flex gap-3"><MapPin className="w-4 h-4 mt-0.5 text-gray-400" /><div><div className="text-gray-500 dark:text-gray-400">Address</div><div className="font-medium text-gray-900 dark:text-gray-100">{customer.address || 'Not provided'}</div></div></div>
        </div>
      </Card>

      <SmsCard customer={customer} onSaved={load} onError={setError} />

      <Card title="Order History" description="Sales linked to this customer.">
        <div className="flex flex-col md:flex-row gap-3 mb-5">
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
            <Input
              placeholder="Search order number or item"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-10 pr-4"
            />
          </div>
          <select value={orderStatus} onChange={e => setOrderStatus(e.target.value)} className="rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-[#111116] text-gray-900 dark:text-gray-100 px-3 py-2 text-sm">
            <option value="ALL">All statuses</option>
            {['DRAFT','HELD','SUBMITTED','PREPARING','READY','SERVED','COMPLETED','CANCELLED'].map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        {orders.length === 0 ? <div className="py-10 text-center text-gray-500 dark:text-gray-400"><ShoppingBag className="w-8 h-8 mx-auto mb-2 opacity-50" />No orders match the current filters.</div> : <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-gray-500 dark:text-gray-400 border-b border-orange-100 dark:border-gray-700"><th className="py-3 pr-4">Date</th><th className="py-3 pr-4">Order</th><th className="py-3 pr-4">Items</th><th className="py-3 pr-4">Total</th><th className="py-3 pr-4">Status</th><th className="py-3">Branch</th></tr></thead><tbody>{orders.map((order: any) => <tr key={order.id} className="border-b last:border-0 border-gray-100 dark:border-gray-700/60"><td className="py-3 pr-4 text-gray-600 dark:text-gray-300">{date(order.createdAt)}</td><td className="py-3 pr-4 font-medium text-gray-900 dark:text-gray-100">{order.orderNumber}</td><td className="py-3 pr-4 text-gray-600 dark:text-gray-300">{order.items.map((i: any) => `${i.itemNameSnapshot} × ${i.quantity}`).join(', ')}</td><td className="py-3 pr-4 font-medium text-gray-900 dark:text-gray-100">{money(order.totalAmount)}</td><td className="py-3 pr-4"><Badge variant={statusVariant(order.status)}>{order.status}</Badge></td><td className="py-3 text-gray-600 dark:text-gray-300">{order.branch?.name || '—'}</td></tr>)}</tbody></table></div>}
      </Card>

      <Card title="Loyalty Ledger" description="Points earned, redeemed and manually adjusted.">
        <div className="flex justify-end mb-4"><Button variant="secondary" onClick={() => { setPointsMode('redeem'); setShowPoints(true); }}>Redeem Points</Button></div>
        {(!customer.loyaltyTransactions || customer.loyaltyTransactions.length === 0) ? <div className="py-8 text-center text-gray-500 dark:text-gray-400">No loyalty transactions yet.</div> : <div className="space-y-2">{customer.loyaltyTransactions.map((tx: any) => <div key={tx.id} className="flex items-center justify-between p-3 rounded-lg bg-[#faf9f7] dark:bg-[#111116]/70"><div><div className="font-medium text-gray-900 dark:text-gray-100">{tx.type.replaceAll('_', ' ')}</div><div className="text-xs text-gray-500 dark:text-gray-400">{tx.note || 'No note'} • {date(tx.createdAt)}</div></div><div className={`font-semibold ${tx.points >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>{tx.points >= 0 ? '+' : ''}{tx.points} pts</div></div>)}</div>}
      </Card>

      {showEdit && <DialogOverlay onClose={() => setShowEdit(false)} label="Edit customer" className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50"><form onSubmit={saveCustomer} className="bg-white dark:bg-[#111116] rounded-xl border border-orange-100 dark:border-gray-700 shadow-xl p-6 w-full max-w-lg space-y-4"><h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">Edit Customer</h2>{(['name','phone','email','address','notes'] as const).map(k => <Input key={k} label={k[0].toUpperCase()+k.slice(1)} value={form[k]} onChange={e => setForm({...form,[k]:e.target.value})} required={k==='name'} />)}<div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setShowEdit(false)}>Cancel</Button><Button type="submit" loading={saving}>Save Changes</Button></div></form></DialogOverlay>}
      {showPoints && <DialogOverlay onClose={() => setShowPoints(false)} label="Loyalty points" className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50"><form onSubmit={changePoints} className="bg-white dark:bg-[#111116] rounded-xl border border-orange-100 dark:border-gray-700 shadow-xl p-6 w-full max-w-md space-y-4"><h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">{pointsMode === 'redeem' ? 'Redeem Loyalty Points' : 'Add Loyalty Points'}</h2><p className="text-sm text-gray-500 dark:text-gray-400">Current balance: <strong>{customer.loyaltyBalance || 0} points</strong></p><Input label="Points" type="number" min="1" step="1" value={points} onChange={e => setPoints(e.target.value)} required /><Input label="Note" placeholder="Reason for this transaction" value={note} onChange={e => setNote(e.target.value)} /><div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setShowPoints(false)}>Cancel</Button>{pointsMode === 'adjust' && <select value={adjustDirection} onChange={e => setAdjustDirection(e.target.value as 'credit' | 'debit')} className="rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-[#111116] text-gray-900 dark:text-gray-100 px-3 py-2 text-sm"><option value="credit">Add points</option><option value="debit">Remove points</option></select>}<Button type="submit" loading={saving}>{pointsMode === 'redeem' ? 'Redeem' : adjustDirection === 'credit' ? 'Add Points' : 'Remove Points'}</Button></div></form></DialogOverlay>}
    </div>
  );
}

const SMS_KIND: Record<string, string> = { RECEIPT: 'Receipt', RESERVATION: 'Booking', TEST: 'Test' };
const SMS_STATUS: Record<string, { label: string; tone: string }> = {
  SENT: { label: 'Sent', tone: 'text-green-700 dark:text-green-400' },
  SIMULATED: { label: 'Test mode, not sent', tone: 'text-gray-500 dark:text-gray-400' },
  FAILED: { label: 'Failed', tone: 'text-red-600 dark:text-red-400' },
  SKIPPED: { label: 'Not sent: opted out', tone: 'text-amber-700 dark:text-amber-400' },
  QUEUED: { label: 'Sending', tone: 'text-gray-500' },
};

/** SMS preferences (with consent recorded separately for offers) and the messages this customer got. */
function SmsCard({ customer, onSaved, onError }: { customer: any; onSaved: () => Promise<void> | void; onError: (m: string) => void }) {
  const [busy, setBusy] = useState(false);
  const optedOut = !!customer.smsOptOutAt;
  const save = async (data: Record<string, unknown>) => {
    setBusy(true);
    try {
      await customerApi.updateCustomer(customer.id, data);
      await onSaved();
    } catch (err: any) {
      onError(err.response?.data?.message || 'Could not save the SMS settings');
    } finally {
      setBusy(false);
    }
  };
  const consentWhen = customer.marketingConsentAt ? new Date(customer.marketingConsentAt).toLocaleDateString() : null;
  const consentHow: Record<string, string> = { POS: 'at the till', WEBSITE: 'on the website', STAFF: 'recorded by staff' };
  return (
    <Card title="SMS" description="Receipts and points by SMS, and whether this customer agreed to offers.">
      {optedOut && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          <span>
            {customer.smsOptOutSource === 'STAFF'
              ? `Marked "no SMS" by staff on ${new Date(customer.smsOptOutAt).toLocaleDateString()}.`
              : customer.smsOptOutSource === 'BLACKLIST'
                ? 'The mobile network refuses SMS to this number.'
                : `Texted STOP on ${new Date(customer.smsOptOutAt).toLocaleDateString()}. Only the customer can turn SMS back on, by texting START.`}
            {' '}No SMS of any kind goes to this number.
          </span>
          {customer.smsOptOutSource === 'STAFF' && <Button size="sm" variant="secondary" disabled={busy} onClick={() => save({ smsOptOut: false })}>They asked to get SMS again</Button>}
        </div>
      )}
      {!customer.phone && <p className="mb-4 text-sm text-gray-500">Add a phone number to send SMS.</p>}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" className="mt-1 h-4 w-4" disabled={busy || optedOut} checked={!!customer.smsReceipts} onChange={(e) => save({ smsReceipts: e.target.checked })} />
          <span><strong className="text-gray-900 dark:text-gray-100">Receipts and points</strong><br /><span className="text-gray-500 dark:text-gray-400">A text after each paid visit.</span></span>
        </label>
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" className="mt-1 h-4 w-4" disabled={busy || optedOut} checked={!!customer.marketingConsent} onChange={(e) => save({ marketingConsent: e.target.checked })} />
          <span><strong className="text-gray-900 dark:text-gray-100">Offers</strong><br /><span className="text-gray-500 dark:text-gray-400">{customer.marketingConsent && consentWhen ? `Agreed ${consentWhen}${customer.marketingConsentSource ? `, ${consentHow[customer.marketingConsentSource] || ''}` : ''}` : 'Only tick if the customer said yes.'}</span></span>
        </label>
        <label className="text-sm">
          <span className="font-semibold text-gray-900 dark:text-gray-100">Language</span>
          <select disabled={busy} value={customer.language || 'en'} onChange={(e) => save({ language: e.target.value })} className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-[#111116]">
            <option value="en">English</option>
            <option value="sw">Kiswahili</option>
          </select>
        </label>
      </div>
      {!optedOut && customer.phone && (
        <button type="button" disabled={busy} onClick={() => save({ smsOptOut: true })} className="mt-3 text-xs font-semibold text-gray-500 underline hover:text-gray-700 dark:hover:text-gray-300">Customer asked for no SMS at all</button>
      )}
      <div className="mt-5">
        <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-gray-100"><MessageSquare className="h-4 w-4" aria-hidden="true" />Messages</p>
        {!customer.smsMessages?.length ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">No SMS yet.</p>
        ) : (
          <ul className="divide-y divide-gray-100 rounded-lg border border-gray-100 dark:divide-gray-800 dark:border-gray-800">
            {customer.smsMessages.map((m: any) => {
              const st = SMS_STATUS[m.status] || { label: m.status, tone: 'text-gray-500' };
              return (
                <li key={m.id} className="p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span className="font-semibold text-gray-700 dark:text-gray-300">{SMS_KIND[m.kind] || (m.kind.startsWith('ORDER_') ? 'Order update' : m.kind)} · {new Date(m.createdAt).toLocaleString()}</span>
                    <span className={st.tone} title={m.error || undefined}>{st.label}</span>
                  </div>
                  <p className="mt-1 text-gray-700 dark:text-gray-300">{m.body}</p>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Card>
  );
}
