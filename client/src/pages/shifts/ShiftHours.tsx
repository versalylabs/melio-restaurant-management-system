import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import { shiftApi } from '../../services/api';

const today = () => new Date().toLocaleDateString('en-CA');
const monthStart = () => `${today().slice(0, 7)}-01`;
type Row = { userId: string; name: string; role: string; days: number; shifts: number; hours: number; openShifts: number };

/** Hours each person worked on the till, with a CSV for whoever runs payroll. */
export default function ShiftHours() {
  const [startDate, setStartDate] = useState(monthStart());
  const [endDate, setEndDate] = useState(today());
  const [rows, setRows] = useState<Row[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!startDate || !endDate || startDate > endDate) return;
    shiftApi.getHours({ startDate, endDate })
      .then((r) => { setRows(r.data.data.staff); setTotal(r.data.data.totals.hours); setError(''); })
      .catch((e) => setError(e.response?.data?.message || 'Could not load hours'));
  }, [startDate, endDate]);

  const download = async () => {
    setBusy(true);
    try {
      const res = await shiftApi.exportHours({ startDate, endDate });
      const url = URL.createObjectURL(new Blob([res.data], { type: 'text/csv' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `shift-hours-${startDate}-to-${endDate}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setError('Could not download the CSV');
    } finally {
      setBusy(false);
    }
  };

  const input = 'mt-1 block h-10 rounded-lg border border-gray-300 bg-white px-3 text-sm dark:border-gray-600 dark:bg-[#111116]';
  return (
    <Card title="Hours for payroll" description="Closed till shifts between these dates, per person. Shifts still open are listed but not counted.">
      <div className="mb-4 flex flex-wrap items-end gap-2">
        <label className="text-xs text-gray-500">From<input type="date" value={startDate} max={endDate} onChange={(e) => setStartDate(e.target.value)} className={input} /></label>
        <label className="text-xs text-gray-500">To<input type="date" value={endDate} min={startDate} max={today()} onChange={(e) => setEndDate(e.target.value)} className={input} /></label>
        <Button variant="secondary" onClick={download} loading={busy} disabled={!rows?.length}><Download className="mr-2 h-4 w-4" aria-hidden="true" />Download CSV</Button>
      </div>
      {error && <p role="alert" className="mb-3 text-sm text-red-600">{error}</p>}
      {!rows ? <p className="text-sm text-gray-500">Loading…</p> : !rows.length ? <p className="text-sm text-gray-500">No shifts between these dates.</p> : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-xs font-semibold uppercase text-gray-500">
                <th className="px-3 py-2">Staff member</th><th className="px-3 py-2">Role</th><th className="px-3 py-2 text-right">Days</th><th className="px-3 py-2 text-right">Shifts</th><th className="px-3 py-2 text-right">Hours</th><th className="px-3 py-2 text-right">Still open</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {rows.map((r) => (
                <tr key={r.userId}>
                  <td className="px-3 py-2 font-medium">{r.name}</td>
                  <td className="px-3 py-2 text-gray-500">{r.role.charAt(0) + r.role.slice(1).toLowerCase()}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.days}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.shifts}</td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums">{r.hours.toFixed(1)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-500">{r.openShifts || '—'}</td>
                </tr>
              ))}
              <tr><td className="px-3 py-2 font-semibold" colSpan={4}>Total</td><td className="px-3 py-2 text-right font-bold tabular-nums">{total.toFixed(1)}</td><td /></tr>
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
