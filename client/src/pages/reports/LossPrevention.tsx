import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import { reportApi } from '../../services/api';

const money = (n: number | null | undefined) => `KES ${Math.round(Number(n || 0)).toLocaleString()}`;
const when = (d: string | null | undefined) => (d ? new Date(d).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—');

const today = () => new Date().toLocaleDateString('en-CA');
const daysAgo = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toLocaleDateString('en-CA');
};

function CountValue({ count, value }: { count: number; value: number }) {
  if (!count) return <span className="text-gray-400">—</span>;
  return (
    <span>
      {money(value)} <span className="text-xs text-gray-500">({count})</span>
    </span>
  );
}

const th = 'px-3 py-2 text-left text-xs font-semibold uppercase text-gray-500';
const td = 'px-3 py-2 text-sm align-top';

export default function LossPrevention() {
  const [range, setRange] = useState({ startDate: daysAgo(6), endDate: today() });
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await reportApi.getLossReport(range);
      setData(res.data.data);
    } catch (e: any) {
      setError(e.response?.data?.message || 'Could not load the report');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    load();
  }, [range.startDate, range.endDate]);

  const s = data?.summary;
  const tiles = s
    ? [
        { label: 'Items removed after the kitchen had them', ...s.itemVoids },
        { label: 'Orders cancelled after the kitchen had them', ...s.orderCancels },
        { label: 'Manual discounts', ...s.discounts },
        { label: 'Refunds', ...s.refunds },
        { label: 'Shift shortages', count: s.shiftShortage > 0 ? 1 : 0, value: s.shiftShortage, noCount: true },
        { label: `Not fully paid ${data.unpaidAfterHours}+ hours after the kitchen got them`, ...s.unpaid },
      ]
    : [];

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Loss prevention</h1>
          <p className="mt-1 max-w-2xl text-sm text-gray-500 dark:text-gray-400">
            Money that left the till without a sale: removed items, cancelled orders, discounts, refunds and shift shortages, with who did it and which manager approved it.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-gray-500">
            From
            <input type="date" value={range.startDate} max={range.endDate} onChange={(e) => setRange({ ...range, startDate: e.target.value })} className="mt-1 block h-10 rounded-lg border border-gray-300 bg-white px-3 text-sm dark:border-gray-600 dark:bg-[#111116]" />
          </label>
          <label className="text-xs text-gray-500">
            To
            <input type="date" value={range.endDate} min={range.startDate} max={today()} onChange={(e) => setRange({ ...range, endDate: e.target.value })} className="mt-1 block h-10 rounded-lg border border-gray-300 bg-white px-3 text-sm dark:border-gray-600 dark:bg-[#111116]" />
          </label>
          <Button variant="secondary" onClick={load}><RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />Refresh</Button>
        </div>
      </div>

      {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">{error}</div>}
      {loading && !data && <div className="py-16 text-center text-gray-500">Loading the report...</div>}

      {data && (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {tiles.map((t) => (
              <div key={t.label} className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-white/10 dark:bg-white/[0.03]">
                <p className="text-xs text-gray-500">{t.label}</p>
                <p className="mt-1 text-xl font-bold text-gray-900 dark:text-gray-100">{money(t.value)}</p>
                {!('noCount' in t) && <p className="text-xs text-gray-500">{t.count} {t.count === 1 ? 'time' : 'times'}</p>}
              </div>
            ))}
          </div>

          <Card title="By staff member">
            {data.staff.length === 0 ? (
              <p className="py-6 text-center text-sm text-gray-500">Nothing to report for these dates.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                  <thead>
                    <tr>
                      {['Staff', 'Items removed', 'Orders cancelled', 'Discounts given', 'Refunds', 'Approved for others', 'Shift short', 'Shift over'].map((h) => <th key={h} className={th}>{h}</th>)}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                    {data.staff.map((r: any) => (
                      <tr key={r.userId}>
                        <td className={td}><div className="font-medium">{r.name}</div><div className="text-xs text-gray-500">{r.role}</div></td>
                        <td className={td}><CountValue {...r.voids} /></td>
                        <td className={td}><CountValue {...r.cancels} /></td>
                        <td className={td}><CountValue {...r.discounts} /></td>
                        <td className={td}><CountValue {...r.refunds} /></td>
                        <td className={td}><CountValue {...r.approvals} /></td>
                        <td className={`${td} ${r.shifts.shortage > 0 ? 'font-semibold text-red-600' : ''}`}>{r.shifts.shortage > 0 ? money(r.shifts.shortage) : '—'}</td>
                        <td className={td}>{r.shifts.over > 0 ? money(r.shifts.over) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card title="Removed items and cancelled orders">
            {data.voids.length === 0 ? (
              <p className="py-6 text-center text-sm text-gray-500">No items were removed after the kitchen had them.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                  <thead><tr>{['When', 'What', 'Value', 'Reason', 'Asked by', 'Approved by'].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                    {data.voids.map((v: any) => (
                      <tr key={v.id}>
                        <td className={`${td} whitespace-nowrap text-xs text-gray-500`}>{when(v.createdAt)}</td>
                        <td className={td}>
                          {v.kind === 'ORDER' ? `${v.itemName} cancelled` : `${v.quantity} × ${v.itemName}`}
                          {v.stockDeducted && <div className="text-xs text-amber-600">Already made: counted as waste</div>}
                        </td>
                        <td className={td}>{money(v.value)}</td>
                        <td className={`${td} max-w-xs`}>{v.reason}</td>
                        <td className={td}>{v.requestedBy}</td>
                        <td className={td}>{v.approvedBy || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <div className="grid gap-6 xl:grid-cols-2">
            <Card title="Manual discounts">
              {data.discounts.length === 0 ? (
                <p className="py-6 text-center text-sm text-gray-500">No manual discounts. Promotions are not included here.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                    <thead><tr>{['Order', 'Discount', 'Given by', 'Approved by', 'Reason'].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
                    <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                      {data.discounts.map((d: any) => (
                        <tr key={d.saleId}>
                          <td className={td}><div>{d.orderNumber}</div><div className="text-xs text-gray-500">{when(d.createdAt)}</div></td>
                          <td className={td}>{money(d.amount)}{d.percent != null && <span className="text-xs text-gray-500"> ({d.percent}%)</span>}</td>
                          <td className={td}>{d.appliedBy || '—'}</td>
                          <td className={td}>{d.approvedBy || <span className="text-gray-400">Within their limit</span>}</td>
                          <td className={td}>{d.reason || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            <Card title="Refunds">
              {data.refunds.length === 0 ? (
                <p className="py-6 text-center text-sm text-gray-500">No refunds.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                    <thead><tr>{['Order', 'Amount', 'Refunded by', 'Approved by', 'Reason'].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
                    <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                      {data.refunds.map((r: any) => (
                        <tr key={r.paymentId}>
                          <td className={td}><div>{r.orderNumber || '—'}</div><div className="text-xs text-gray-500">{when(r.refundedAt)}</div></td>
                          <td className={td}>{money(r.amount)} <span className="text-xs text-gray-500">{String(r.method || '').replace('_', ' ').toLowerCase()}</span></td>
                          <td className={td}>{r.refundedBy || '—'}</td>
                          <td className={td}>{r.approvedBy || <span className="text-gray-400">Not recorded</span>}</td>
                          <td className={td}>{r.reason || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </div>

          <Card title={`Orders the kitchen got that aren't fully paid after ${data.unpaidAfterHours} hours`}>
            {data.unpaid.length === 0 ? (
              <p className="py-6 text-center text-sm text-gray-500">Every order the kitchen got has been paid.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                  <thead><tr>{['Order', 'Table', 'Status', 'Still owed', 'Rung up by', 'Served by'].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                    {data.unpaid.map((u: any) => (
                      <tr key={u.saleId}>
                        <td className={td}><div>{u.orderNumber}</div><div className="text-xs text-gray-500">{when(u.createdAt)}</div></td>
                        <td className={td}>{u.table || '—'}</td>
                        <td className={td}>{String(u.status).toLowerCase().replace(/_/g, ' ')}</td>
                        <td className={`${td} font-semibold text-red-600`}>{money(u.balance)}</td>
                        <td className={td}>{u.createdBy || '—'}</td>
                        <td className={td}>{u.servedBy || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
