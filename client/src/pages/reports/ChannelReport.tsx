import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Link } from 'react-router-dom';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import { reportApi } from '../../services/api';
import { getActiveBranchId, listenForBranchChanges } from '../../utils/branch';
import { useAuth } from '../../contexts/AuthContext';
import { channelLabel } from '../../lib/channels';

const kes = (n: number | null | undefined) => `KES ${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const today = () => new Date().toLocaleDateString('en-CA');
const monthStart = () => `${today().slice(0, 7)}-01`;
const th = 'px-3 py-2 text-left text-xs font-semibold uppercase text-gray-500';
const td = 'px-3 py-2 text-sm tabular-nums';
const DELIVERY_APPS = ['GLOVO', 'UBER_EATS', 'BOLT'];

type Row = { channel: string; label: string; orders: number; sales: number; commission: number; kept: number; averageOrder: number; shareOfSales: number };

/** Sales by channel: what each channel brought in, what it cost in commission, and what you kept. */
export default function ChannelReport() {
  const [startDate, setStartDate] = useState(monthStart());
  const [endDate, setEndDate] = useState(today());
  const [data, setData] = useState<{ totals: { orders: number; sales: number; commission: number; kept: number }; channels: Row[]; commissionRates: Record<string, number> } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const { user } = useAuth();
  const [branchId, setBranchId] = useState(() => getActiveBranchId(user as any) || '');
  useEffect(() => listenForBranchChanges(() => setBranchId(getActiveBranchId(user as any) || '')), [user?.id]);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await reportApi.getChannelReport({ startDate, endDate, ...(branchId ? { branchId } : {}) });
      setData(res.data.data);
    } catch (e: any) {
      setError(e.response?.data?.message || 'Could not load sales by channel');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    if (startDate && endDate && startDate <= endDate) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startDate, endDate, branchId]);

  const apps = data?.channels.filter((c) => DELIVERY_APPS.includes(c.channel)) || [];
  const appCommission = apps.reduce((t, c) => t + c.commission, 0);
  const noRates = data && Object.keys(data.commissionRates || {}).length === 0;

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Sales by channel</h1>
          <p className="mt-1 max-w-2xl text-sm text-gray-500 dark:text-gray-400">
            Orders closed between these dates, by where they came from: the commission each channel took (at the rate set when the order was placed) and what you kept.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-gray-500">
            From
            <input type="date" value={startDate} max={endDate} onChange={(e) => setStartDate(e.target.value)} className="mt-1 block h-10 rounded-lg border border-gray-300 bg-white px-3 text-sm dark:border-gray-600 dark:bg-[#111116]" />
          </label>
          <label className="text-xs text-gray-500">
            To
            <input type="date" value={endDate} min={startDate} max={today()} onChange={(e) => setEndDate(e.target.value)} className="mt-1 block h-10 rounded-lg border border-gray-300 bg-white px-3 text-sm dark:border-gray-600 dark:bg-[#111116]" />
          </label>
          <Button variant="secondary" onClick={load}><RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />Refresh</Button>
        </div>
      </div>

      {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">{error}</div>}

      {noRates && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
          No commission rates are set, so every channel shows what you kept as the full sale. Add the Glovo, Uber Eats and Bolt rates in <Link to="/settings" className="font-semibold underline">Settings</Link>.
        </div>
      )}

      {data && (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {[
            ['Sales', kes(data.totals.sales)],
            ['Orders', data.totals.orders.toLocaleString()],
            ['Commission paid', kes(data.totals.commission)],
            ['You kept', kes(data.totals.kept)],
          ].map(([label, value]) => (
            <Card key={label}>
              <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
              <p className="mt-1 text-xl font-bold tabular-nums text-gray-900 dark:text-gray-100">{value}</p>
            </Card>
          ))}
        </div>
      )}

      {appCommission > 0 && (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300">
          Delivery apps took {kes(appCommission)} in commission over these dates. Every regular customer you move to WhatsApp or your own website keeps that money with you.
        </p>
      )}

      <Card>
        {loading && !data ? (
          <p className="py-8 text-center text-sm text-gray-500">Loading…</p>
        ) : !data?.channels.length ? (
          <p className="py-8 text-center text-sm text-gray-500">No closed orders between these dates.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-white/10">
              <thead>
                <tr>
                  <th className={th}>Channel</th>
                  <th className={`${th} text-right`}>Orders</th>
                  <th className={`${th} text-right`}>Sales</th>
                  <th className={`${th} text-right`}>Commission</th>
                  <th className={`${th} text-right`}>You kept</th>
                  <th className={`${th} text-right`}>Average order</th>
                  <th className={th}>Share of sales</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-white/5">
                {data.channels.map((c) => (
                  <tr key={c.channel}>
                    <td className="px-3 py-2 text-sm font-medium">
                      {channelLabel(c.channel)}
                    </td>
                    <td className={`${td} text-right`}>{c.orders.toLocaleString()}</td>
                    <td className={`${td} text-right`}>{kes(c.sales)}</td>
                    <td className={`${td} text-right ${c.commission > 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-400'}`}>{c.commission > 0 ? `−${kes(c.commission)}` : '—'}</td>
                    <td className={`${td} text-right font-semibold`}>{kes(c.kept)}</td>
                    <td className={`${td} text-right`}>{kes(c.averageOrder)}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-24 overflow-hidden rounded-full bg-gray-100 dark:bg-white/10" aria-hidden="true">
                          <div className="h-full rounded-full bg-orange-500" style={{ width: `${Math.min(100, c.shareOfSales)}%` }} />
                        </div>
                        <span className="text-xs tabular-nums text-gray-500">{c.shareOfSales}%</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
