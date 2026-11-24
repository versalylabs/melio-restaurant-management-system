import { useState } from 'react';
import { FileSpreadsheet } from 'lucide-react';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import { paymentApi } from '../../services/api';
import { notify } from '../../lib/dialogs';

type Order = { id: string; orderNumber: string } | null;
type Row = {
  receipt: string; time: string; amount: number; from: string; result: string; order?: Order; recordedAmount?: number; flagged?: boolean;
  candidates?: Array<{ paymentId: string; amount: number; createdAt: string; order: Order }>;
};
type Result = {
  period: { from: string; to: string };
  summary: { lines: number; received: number; matched: number; confirmedNow: number; possible: number; notInMelio: number; amountDiffers: number; missingFromStatement: number };
  rows: Row[];
  missingFromStatement: Array<{ paymentId: string; reference: string; amount: number; createdAt: string; order: Order; takenBy: string | null }>;
};

const kes = (n: number) => `KES ${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const when = (iso: string) => new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** Upload the till's M-Pesa statement and see what matches the payments recorded in Melio. */
export default function MpesaStatementCheck({ onChanged }: { onChanged?: () => void }) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  // Receipts and payments confirmed here, so a payment is never offered twice.
  const [done, setDone] = useState<Set<string>>(new Set());

  const check = async () => {
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      const data = new FormData();
      data.append('statement', file);
      const res = await paymentApi.checkMpesaStatement(data);
      setResult(res.data.data);
      setDone(new Set());
      if (res.data.data.summary.confirmedNow) onChanged?.();
    } catch (e: any) {
      setError(e.response?.data?.message || 'Could not read the statement');
    } finally {
      setBusy(false);
    }
  };
  const confirm = async (row: Row, paymentId: string) => {
    try {
      await paymentApi.checkPayment(paymentId, { result: 'CONFIRMED', reference: row.receipt });
      setDone((d) => new Set(d).add(row.receipt).add(paymentId));
      notify(`Confirmed ${row.receipt}`, 'success');
      onChanged?.();
    } catch (e: any) {
      notify(e.response?.data?.message || 'Could not confirm it');
    }
  };

  const s = result?.summary;
  const notIn = result?.rows.filter((r) => r.result === 'NOT_IN_MELIO') || [];
  const possible = result?.rows.filter((r) => r.result === 'POSSIBLE_MATCH') || [];
  const differs = result?.rows.filter((r) => r.result === 'AMOUNT_DIFFERS') || [];
  const otherManager = result?.rows.filter((r) => r.result === 'NEEDS_OTHER_MANAGER') || [];
  const wasCancelled = result?.rows.filter((r) => r.result === 'WAS_MARKED_NOT_RECEIVED') || [];
  const section = 'mt-5';
  const h = 'text-sm font-bold text-gray-900 dark:text-gray-100';
  const list = 'mt-2 divide-y divide-gray-100 rounded-xl border border-gray-200 text-sm dark:divide-gray-800 dark:border-gray-800';

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}><FileSpreadsheet className="mr-2 h-4 w-4" aria-hidden="true" />Check M-Pesa statement</Button>
      {open && (
        <Modal title="Check the M-Pesa statement" onClose={() => { setOpen(false); setResult(null); setFile(null); setError(''); }}>
          {!result ? (
            <div className="space-y-4 text-sm">
              <p className="text-gray-600 dark:text-gray-300">
                Download the till's statement from the M-Pesa business portal as CSV (from Excel: File, Save As, CSV) and upload it here.
                Melio matches every payment received to the bills, confirms "M-Pesa to check" payments it proves, and shows anything that doesn't add up.
              </p>
              <input type="file" accept=".csv,text/csv" onChange={(e) => setFile(e.target.files?.[0] || null)} className="block w-full text-sm" aria-label="M-Pesa statement (CSV)" />
              {error && <p role="alert" className="text-red-600">{error}</p>}
              <Button onClick={check} loading={busy} disabled={!file}>Check statement</Button>
            </div>
          ) : (
            <div className="text-sm">
              <p className="text-gray-600 dark:text-gray-300">{when(result.period.from)} to {when(result.period.to)}: {s!.lines} payments received, {kes(s!.received)}.</p>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[
                  ['Matched', s!.matched, 'text-emerald-700 dark:text-emerald-400'],
                  ['Confirmed now', s!.confirmedNow, 'text-emerald-700 dark:text-emerald-400'],
                  ['Not in Melio', s!.notInMelio, s!.notInMelio ? 'text-amber-700 dark:text-amber-400' : ''],
                  ['Not on this statement', s!.missingFromStatement, s!.missingFromStatement ? 'text-red-600' : ''],
                ].map(([label, n, tone]) => (
                  <div key={label as string} className="rounded-lg border border-gray-200 p-2 dark:border-gray-800">
                    <p className="text-xs text-gray-500">{label}</p>
                    <p className={`text-lg font-bold tabular-nums ${tone}`}>{n as number}</p>
                  </div>
                ))}
              </div>

              {result.missingFromStatement.length > 0 && (
                <div className={section}>
                  <p className={h}>Recorded in Melio, not on this statement</p>
                  <p className="text-xs text-gray-500">These M-Pesa codes were typed in at this branch's till during the statement's period, but the statement doesn't have them. Check each one: it may be a payment to another till, or a fake or reused message.</p>
                  <ul className={list}>
                    {result.missingFromStatement.map((m) => (
                      <li key={m.paymentId} className="flex justify-between gap-3 p-2.5">
                        <span><strong>{m.reference}</strong> · order {m.order?.orderNumber} · {when(m.createdAt)}{m.takenBy ? ` · ${m.takenBy}` : ''}</span>
                        <span className="tabular-nums">{kes(m.amount)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {possible.length > 0 && (
                <div className={section}>
                  <p className={h}>Possible matches for "M-Pesa to check" payments</p>
                  <p className="text-xs text-gray-500">Same amount, around the same time, but no code was taken at the till. Confirm the one that is right.</p>
                  <ul className={list}>
                    {possible.map((r) => (
                      <li key={r.receipt} className="p-2.5">
                        <p><strong>{r.receipt}</strong> · {kes(r.amount)} · {when(r.time)}{r.from ? ` · ${r.from}` : ''}</p>
                        {done.has(r.receipt) ? <p className="text-xs font-semibold text-emerald-700">Confirmed</p> : (
                          <div className="mt-1 flex flex-wrap gap-2">
                            {r.candidates!.filter((c) => !done.has(c.paymentId)).map((c) => (
                              <button key={c.paymentId} type="button" onClick={() => confirm(r, c.paymentId)} className="rounded-lg border border-emerald-300 px-2.5 py-1 text-xs font-semibold text-emerald-800 hover:bg-emerald-50 dark:border-emerald-800 dark:text-emerald-300 dark:hover:bg-emerald-950/30">
                                It's order {c.order?.orderNumber} ({when(c.createdAt)})
                              </button>
                            ))}
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {otherManager.length > 0 && (
                <div className={section}>
                  <p className={h}>Proven by the statement: another manager confirms</p>
                  <p className="text-xs text-gray-500">These "M-Pesa to check" payments are on the statement, but you took them (or they are another branch's), so someone else confirms them under Payments, "M-Pesa to check".</p>
                  <ul className={list}>
                    {otherManager.map((r) => <li key={r.receipt} className="flex justify-between gap-3 p-2.5"><span><strong>{r.receipt}</strong> · order {r.order?.orderNumber}</span><span className="tabular-nums">{kes(r.amount)}</span></li>)}
                  </ul>
                </div>
              )}

              {wasCancelled.length > 0 && (
                <div className={section}>
                  <p className={h}>Marked "not received", but the money did arrive</p>
                  <p className="text-xs text-gray-500">A manager took these off the bill. The order may still show as owing: record the payment again with this code.</p>
                  <ul className={list}>
                    {wasCancelled.map((r) => <li key={r.receipt} className="flex justify-between gap-3 p-2.5"><span><strong>{r.receipt}</strong> · order {r.order?.orderNumber} · {when(r.time)}</span><span className="tabular-nums">{kes(r.amount)}</span></li>)}
                  </ul>
                </div>
              )}

              {differs.length > 0 && (
                <div className={section}>
                  <p className={h}>Amount differs</p>
                  <ul className={list}>
                    {differs.map((r) => (
                      <li key={r.receipt} className="flex justify-between gap-3 p-2.5">
                        <span><strong>{r.receipt}</strong> · order {r.order?.orderNumber}</span>
                        <span className="tabular-nums">statement {kes(r.amount)}, Melio {kes(r.recordedAmount || 0)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {notIn.length > 0 && (
                <div className={section}>
                  <p className={h}>Money received with nothing recorded in Melio</p>
                  <p className="text-xs text-gray-500">The customer paid the till, but no bill shows it. A bill may have been closed as cash instead, or it may not be a restaurant sale.</p>
                  <ul className={list}>
                    {notIn.map((r) => (
                      <li key={r.receipt} className="flex justify-between gap-3 p-2.5">
                        <span><strong>{r.receipt}</strong> · {when(r.time)}{r.from ? ` · ${r.from}` : ''}</span>
                        <span className="tabular-nums">{kes(r.amount)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="mt-5 flex justify-end">
                <Button variant="secondary" onClick={() => { setResult(null); setFile(null); }}>Check another statement</Button>
              </div>
            </div>
          )}
        </Modal>
      )}
    </>
  );
}
