import { useEffect, useState } from 'react';
import { Clock3, LogIn, LogOut, RefreshCw } from 'lucide-react';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import Badge from '../../components/ui/Badge';
import Modal from '../../components/ui/Modal';
import Input from '../../components/ui/Input';
import { shiftApi } from '../../services/api';

const money = (n: number | null | undefined) =>
  `KES ${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function Difference({ value }: { value: number | null | undefined }) {
  if (value == null) return <span className="text-gray-400">—</span>;
  const rounded = Math.round(value * 100) / 100;
  if (rounded === 0) return <span className="text-green-600">Exact</span>;
  return <span className={rounded < 0 ? 'text-red-600' : 'text-amber-600'}>{rounded < 0 ? `Short ${money(-rounded)}` : `Over ${money(rounded)}`}</span>;
}

export default function Shifts() {
  const [shifts, setShifts] = useState<any[]>([]);
  const [current, setCurrent] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const [close, setClose] = useState<any>(null);
  const [closed, setClosed] = useState<any>(null);
  const [openingCash, setOpeningCash] = useState('0');
  const [notes, setNotes] = useState('');
  const [count, setCount] = useState({ cash: '', mpesa: '', card: '' });
  const [closing, setClosing] = useState(false);
  const [filter, setFilter] = useState('');

  const load = async () => {
    try {
      setLoading(true);
      setError('');
      const [a, b] = await Promise.all([shiftApi.getShifts(filter ? { status: filter } : undefined), shiftApi.getCurrent()]);
      setShifts(a.data.data?.shifts || []);
      setCurrent(b.data.data?.shift || null);
    } catch (e: any) {
      setError(e.response?.data?.message || 'Failed to load shifts');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    load();
  }, [filter]);

  const start = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await shiftApi.open({ openingCash: Number(openingCash), notes });
      setOpen(false);
      setOpeningCash('0');
      setNotes('');
      await load();
    } catch (e: any) {
      setError(e.response?.data?.message || 'Could not open shift');
    }
  };

  const beginClose = (shift: any) => {
    setClose(shift);
    setCount({ cash: '', mpesa: '', card: '' });
  };

  const finish = async (e: React.FormEvent) => {
    e.preventDefault();
    setClosing(true);
    try {
      const res = await shiftApi.close(close.id, {
        closingCash: Number(count.cash),
        declaredMobileMoney: Number(count.mpesa || 0),
        declaredCard: Number(count.card || 0),
      });
      setClose(null);
      setClosed(res.data.data?.shift || null);
      await load();
    } catch (e: any) {
      setError(e.response?.data?.message || 'Could not close shift');
    } finally {
      setClosing(false);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Shifts</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Open, monitor and close staff cash shifts.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={load}><RefreshCw className="w-4 h-4 mr-2" aria-hidden="true" />Refresh</Button>
          {!current && <Button onClick={() => setOpen(true)}><LogIn className="w-4 h-4 mr-2" aria-hidden="true" />Open Shift</Button>}
        </div>
      </div>
      {error && <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 px-4 py-3 text-sm" role="alert">{error}</div>}

      {current && (
        <Card className="border-orange-200 dark:border-orange-800">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <Clock3 className="w-5 h-5 text-orange-600" aria-hidden="true" />
                <h2 className="font-semibold text-gray-900 dark:text-gray-100">Your current shift</h2>
                <Badge variant="success">OPEN</Badge>
              </div>
              <p className="text-sm text-gray-500 mt-2">Opened {new Date(current.openedAt).toLocaleString()}</p>
            </div>
            <div className="grid grid-cols-2 gap-5">
              <div><p className="text-xs text-gray-500 uppercase">Opening cash</p><p className="font-semibold">{money(current.openingCash)}</p></div>
              <div><p className="text-xs text-gray-500 uppercase">Branch</p><p className="font-semibold">{current.branch?.name || '—'}</p></div>
            </div>
            <Button variant="danger" onClick={() => beginClose(current)}><LogOut className="w-4 h-4 mr-2" aria-hidden="true" />Close Shift</Button>
          </div>
        </Card>
      )}

      <Card
        title="Shift history"
        actions={
          <select aria-label="Filter shifts" value={filter} onChange={(e) => setFilter(e.target.value)} className="h-9 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-[#111116] px-3 text-sm">
            <option value="">All shifts</option>
            <option value="OPEN">Open</option>
            <option value="CLOSED">Closed</option>
          </select>
        }
      >
        {loading ? (
          <div className="py-10 text-center text-gray-500">Loading shifts...</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
              <thead>
                <tr>
                  {['Staff', 'Branch', 'Opened', 'Closed', 'Opening', 'Cash', 'M-Pesa', 'Card', 'Status', 'Action'].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {shifts.map((s) => (
                  <tr key={s.id}>
                    <td className="px-4 py-3 text-sm font-medium">{s.userName}</td>
                    <td className="px-4 py-3 text-sm">{s.branchName}</td>
                    <td className="px-4 py-3 text-xs text-gray-500">{new Date(s.openedAt).toLocaleString()}</td>
                    <td className="px-4 py-3 text-xs text-gray-500">{s.closedAt ? new Date(s.closedAt).toLocaleString() : '—'}</td>
                    <td className="px-4 py-3 text-sm">{money(s.openingCash)}</td>
                    {s.blind ? (
                      <td colSpan={3} className="px-4 py-3 text-xs text-gray-500">Shown after the shift is closed</td>
                    ) : (
                      <>
                        <td className="px-4 py-3 text-sm">
                          {s.status === 'OPEN' ? <span className="text-gray-500">Expected {money(s.expectedCash)}</span> : <><div>{money(s.closingCash)}</div><Difference value={s.cashVariance} /></>}
                        </td>
                        <td className="px-4 py-3 text-sm">
                          {s.status === 'OPEN' ? <span className="text-gray-500">Expected {money(s.expectedMobileMoney)}</span> : s.declaredMobileMoney == null ? '—' : <><div>{money(s.declaredMobileMoney)}</div><Difference value={s.mobileMoneyVariance} /></>}
                        </td>
                        <td className="px-4 py-3 text-sm">
                          {s.status === 'OPEN' ? <span className="text-gray-500">Expected {money(s.expectedCard)}</span> : s.declaredCard == null ? '—' : <><div>{money(s.declaredCard)}</div><Difference value={s.cardVariance} /></>}
                        </td>
                      </>
                    )}
                    <td className="px-4 py-3"><Badge variant={s.status === 'OPEN' ? 'success' : 'default'}>{s.status}</Badge></td>
                    <td className="px-4 py-3">{s.status === 'OPEN' && s.userId === current?.userId && <Button size="sm" variant="danger" onClick={() => beginClose(s)}>Close</Button>}</td>
                  </tr>
                ))}
                {!shifts.length && <tr><td colSpan={10} className="py-10 text-center text-sm text-gray-500">No shifts found.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {open && (
        <Modal title="Open Shift" onClose={() => setOpen(false)}>
          <form onSubmit={start} className="space-y-4">
            <Input id="openingCash" type="number" min="0" step="0.01" label="Opening Cash (KES)" value={openingCash} onChange={(e) => setOpeningCash(e.target.value)} required />
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
              Notes
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="mt-1 w-full min-h-24 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-[#111116] px-3 py-2" />
            </label>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit">Open Shift</Button>
            </div>
          </form>
        </Modal>
      )}

      {close && (
        <Modal title="Close Shift" onClose={() => setClose(null)}>
          <form onSubmit={finish} className="space-y-4">
            <p className="text-sm text-gray-600 dark:text-gray-300">
              Count what you actually have before you see what the system expected. Opened {new Date(close.openedAt).toLocaleString()} with {money(close.openingCash)} in the drawer.
            </p>
            <Input id="closingCash" type="number" min="0" step="0.01" inputMode="decimal" label="Cash in the drawer (KES)" value={count.cash} onChange={(e) => setCount({ ...count, cash: e.target.value })} required />
            <Input id="closingMpesa" type="number" min="0" step="0.01" inputMode="decimal" label="M-Pesa received this shift (KES)" value={count.mpesa} onChange={(e) => setCount({ ...count, mpesa: e.target.value })} required />
            <Input id="closingCard" type="number" min="0" step="0.01" inputMode="decimal" label="Card payments this shift (KES)" value={count.card} onChange={(e) => setCount({ ...count, card: e.target.value })} required />
            <p className="text-xs text-gray-500">Use the till statement for M-Pesa and the card machine's end-of-day slip for card. Enter 0 if there were none.</p>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setClose(null)}>Cancel</Button>
              <Button type="submit" variant="danger" loading={closing}>Close Shift</Button>
            </div>
          </form>
        </Modal>
      )}

      {closed && (
        <Modal title="Shift closed" onClose={() => setClosed(null)}>
          <div className="space-y-4">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-gray-500">
                  <th className="py-2">Method</th><th className="py-2">You counted</th><th className="py-2">Expected</th><th className="py-2">Difference</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                <tr><td className="py-2">Cash</td><td>{money(closed.closingCash)}</td><td>{money(closed.expectedCash)}</td><td><Difference value={closed.cashVariance} /></td></tr>
                <tr><td className="py-2">M-Pesa</td><td>{money(closed.declaredMobileMoney)}</td><td>{money(closed.expectedMobileMoney)}</td><td><Difference value={closed.mobileMoneyVariance} /></td></tr>
                <tr><td className="py-2">Card</td><td>{money(closed.declaredCard)}</td><td>{money(closed.expectedCard)}</td><td><Difference value={closed.cardVariance} /></td></tr>
              </tbody>
            </table>
            <p className="text-xs text-gray-500">Differences are recorded on the shift and appear in the loss prevention report.</p>
            <div className="flex justify-end"><Button onClick={() => setClosed(null)}>Done</Button></div>
          </div>
        </Modal>
      )}
    </div>
  );
}
