import { useEffect, useState } from 'react';
import { Download, RefreshCw } from 'lucide-react';
import { Link } from 'react-router-dom';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import { reportApi } from '../../services/api';
import { getActiveBranchId, listenForBranchChanges } from '../../utils/branch';
import { useAuth } from '../../contexts/AuthContext';

const kes = (n: number | null | undefined) => `KES ${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const thisMonth = () => new Date().toLocaleDateString('en-CA').slice(0, 7);
const th = 'px-3 py-2 text-left text-xs font-semibold uppercase text-gray-500';
const td = 'px-3 py-2 text-sm tabular-nums';

/** Monthly VAT, credit notes and Tourism Levy, with a CSV for the accountant. */
export default function TaxSummary() {
  const [month, setMonth] = useState(thisMonth());
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [downloading, setDownloading] = useState(false);
  const { user } = useAuth();
  const [branchId, setBranchId] = useState(() => getActiveBranchId(user as any) || '');
  useEffect(() => listenForBranchChanges(() => setBranchId(getActiveBranchId(user as any) || '')), [user?.id]);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await reportApi.getTaxSummary({ month, ...(branchId ? { branchId } : {}) });
      setData(res.data.data);
    } catch (e: any) {
      setError(e.response?.data?.message || 'Could not load the tax summary');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    load();
  }, [month, branchId]);

  const download = async () => {
    setDownloading(true);
    try {
      const res = await reportApi.exportTaxSummary({ month, ...(branchId ? { branchId } : {}) });
      const url = URL.createObjectURL(new Blob([res.data], { type: 'text/csv' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `tax-summary-${month}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setError('Could not download the CSV');
    } finally {
      setDownloading(false);
    }
  };

  const t = data?.totals;
  const levy = data?.tourismLevy;
  const vatPct = data ? Math.round(data.business.vatRate * 10000) / 100 : 0;

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Tax summary</h1>
          <p className="mt-1 max-w-2xl text-sm text-gray-500 dark:text-gray-400">
            VAT, credit notes and the Tourism Levy for one month, from closed bills. Download the CSV for your accountant.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-gray-500">
            Month
            <input type="month" value={month} max={thisMonth()} onChange={(e) => setMonth(e.target.value)} className="mt-1 block h-10 rounded-lg border border-gray-300 bg-white px-3 text-sm dark:border-gray-600 dark:bg-[#111116]" />
          </label>
          <Button variant="secondary" onClick={load}><RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />Refresh</Button>
          <Button onClick={download} loading={downloading} disabled={!data}><Download className="mr-2 h-4 w-4" aria-hidden="true" />Download CSV</Button>
        </div>
      </div>

      {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">{error}</div>}
      {loading && !data && <div className="py-16 text-center text-gray-500">Loading…</div>}

      {data && (
        <>
          {(!data.business.kraPin || !data.business.vatRegistered) && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
              {!data.business.kraPin ? 'Your KRA PIN is not set. ' : ''}
              {!data.business.vatRegistered ? 'The business is not marked as VAT-registered. ' : ''}
              Set these in <Link to="/settings" className="font-semibold underline">Settings</Link>.
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[
              { label: `Output VAT (${vatPct}%)`, value: t.outputVat, note: `on ${kes(t.standardRated)} standard-rated sales` },
              { label: 'Less: VAT on credit notes', value: t.creditNoteVat, note: `${data.creditNoteList.length} credit note${data.creditNoteList.length === 1 ? '' : 's'}, ${kes(t.creditNotes)}` },
              { label: 'Net VAT', value: t.netVat, note: data.business.pricesIncludeTax ? 'Prices include VAT' : 'VAT added on top of prices' },
              { label: `Tourism Levy (${Math.round(levy.rate * 10000) / 100}%)`, value: levy.due, note: `on ${kes(levy.base)} · due by ${levy.dueDate}` },
            ].map((tile) => (
              <div key={tile.label} className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-white/10 dark:bg-white/[0.03]">
                <p className="text-xs text-gray-500">{tile.label}</p>
                <p className="mt-1 text-xl font-bold text-gray-900 dark:text-gray-100">{kes(tile.value)}</p>
                <p className="text-xs text-gray-500">{tile.note}</p>
              </div>
            ))}
          </div>

          <Card title={`Sales in ${month}`}>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm md:grid-cols-4">
              {[
                ['Closed bills', String(t.bills)],
                ['Gross sales', kes(t.grossSales)],
                ['Discounts', kes(t.discounts)],
                ['Service charge', kes(t.serviceCharge)],
                ['Standard-rated (excl. VAT)', kes(t.standardRated)],
                ['Zero-rated', kes(t.zeroRated)],
                ['Exempt', kes(t.exempt)],
                ...(t.noCategory > 0 ? [['No VAT category (older bills)', kes(t.noCategory)]] : []),
              ].map(([k, v]) => (
                <div key={k}><dt className="text-gray-500">{k}</dt><dd className="font-semibold tabular-nums">{v}</dd></div>
              ))}
            </dl>
          </Card>

          <Card title="By day">
            {data.days.length === 0 ? (
              <p className="py-6 text-center text-sm text-gray-500">No closed bills or credit notes in this month.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                  <thead><tr>{['Date', 'Bills', 'Gross', 'Standard-rated', 'VAT', 'Zero-rated', 'Exempt', 'Credit notes'].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                    {data.days.map((d: any) => (
                      <tr key={d.date}>
                        <td className={td}>{d.date}</td>
                        <td className={td}>{d.bills}</td>
                        <td className={td}>{kes(d.grossSales)}</td>
                        <td className={td}>{kes(d.standardRated)}</td>
                        <td className={td}>{kes(d.vat)}</td>
                        <td className={td}>{kes(d.zeroRated)}</td>
                        <td className={td}>{kes(d.exempt)}</td>
                        <td className={td}>{d.creditNotes ? `-${kes(d.creditNotes)}` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {data.creditNoteList.length > 0 && (
            <Card title="Credit notes">
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                  <thead><tr>{['Number', 'Order', 'Amount', 'VAT', 'Reason', 'Date'].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                    {data.creditNoteList.map((c: any) => (
                      <tr key={c.number}>
                        <td className={td}>{c.number}</td>
                        <td className={td}>{c.orderNumber}</td>
                        <td className={td}>{kes(c.amount)}{c.countedAmount < c.amount && <div className="text-xs text-gray-500">{c.countedAmount > 0 ? `${kes(c.countedAmount)} counted` : 'Re-paid later: not counted'}</div>}</td>
                        <td className={td}>{kes(c.vatAmount)}</td>
                        <td className="px-3 py-2 text-sm">{c.reason}</td>
                        <td className={td}>{new Date(c.createdAt).toLocaleDateString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          <p className="text-xs text-gray-500">
            Prepared from the bills recorded in Melio. It is not an eTIMS invoice or a KRA return: check it with your accountant before filing.
          </p>
        </>
      )}
    </div>
  );
}
