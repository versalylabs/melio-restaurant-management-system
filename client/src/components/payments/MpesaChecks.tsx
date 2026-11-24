import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, RefreshCw, XCircle } from 'lucide-react';
import { paymentApi } from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';
import { getActiveBranchId } from '../../utils/branch';
import { confirmDialog, notify, promptDialog } from '../../lib/dialogs';

type Check = {
  id: string; amount: number; reference: string | null; payerPhone: string | null; createdAt: string; takenBy: string | null; takenById: string; notes: string | null;
  order: { id: string; orderNumber: string; totalAmount: number; status: string };
};
type Data = {
  recheck: { checked: number; settled: number; failed: number; unknown: number } | null;
  toCheck: Check[];
  stuckPrompts: Array<{ id: string; amount: number; createdAt: string; order: { orderNumber: string } }>;
  totalToCheck: number;
};

const kes = (n: number) => `KES ${Math.round(n).toLocaleString()}`;
const MANAGERS = ['OWNER', 'ADMIN', 'MANAGER'];

/**
 * M-Pesa taken while Safaricom was down, waiting for a manager to check it
 * against the till statement, and prompts whose answer never came (asked
 * again each time this list loads). Hidden when there is nothing to check.
 */
export default function MpesaChecks({ onChanged }: { onChanged?: () => void }) {
  const { user } = useAuth();
  const isManager = MANAGERS.includes(user?.roleName || '');
  const [data, setData] = useState<Data | null>(null);
  const [busy, setBusy] = useState('');

  const [checking, setChecking] = useState(false);
  const load = useCallback(async (recheck = false) => {
    if (recheck) setChecking(true);
    try {
      const branchId = getActiveBranchId(user as any) || undefined;
      const res = await paymentApi.getMpesaChecks(branchId, recheck);
      setData(res.data.data);
      const r = res.data.data?.recheck;
      if (recheck && r) notify(r.settled || r.failed ? `Safaricom answered: ${r.settled} paid, ${r.failed} not paid.` : 'No new answers from Safaricom yet.', r.settled ? 'success' : 'info');
    } catch {
      // Keep what is on screen: this list matters most while things are failing.
      if (recheck) notify('Could not reach the server. The list below is the last one loaded.');
    } finally {
      setChecking(false);
    }
  }, [user?.id]);
  useEffect(() => { void load(); }, [load]);

  const check = async (c: Check, result: 'CONFIRMED' | 'NOT_RECEIVED') => {
    let reference: string | undefined;
    if (result === 'CONFIRMED') {
      const code = await promptDialog(`Find KES ${c.amount.toLocaleString()} for order ${c.order.orderNumber} on the till statement and enter its M-Pesa code${c.reference ? ' (the code taken at the till is filled in; correct it if it differs)' : ''}.`, { title: 'Payment received', required: true, placeholder: 'e.g. SKL7H2X9QD', defaultValue: c.reference || '', confirmLabel: 'Confirm' });
      if (!code) return;
      reference = code;
    } else if (!(await confirmDialog(`KES ${c.amount.toLocaleString()} for order ${c.order.orderNumber} is not on the till statement? It comes off the bill, which then shows what is still owed.`, { title: 'Not received', danger: true, confirmLabel: 'Not received' }))) {
      return;
    }
    setBusy(c.id);
    try {
      const res = await paymentApi.checkPayment(c.id, { result, reference });
      notify(res.data.message || 'Saved', result === 'CONFIRMED' ? 'success' : 'error');
      await load();
      onChanged?.();
    } catch (e: any) {
      notify(e.response?.data?.message || 'Could not save the check');
    } finally {
      setBusy('');
    }
  };

  if (!data || (!data.toCheck.length && !data.stuckPrompts.length)) return null;
  return (
    <section className="rounded-2xl border border-amber-300 bg-amber-50/70 p-4 dark:border-amber-800 dark:bg-amber-950/20" aria-label="M-Pesa to check">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-gray-900 dark:text-gray-100">M-Pesa to check</h2>
          <p className="mt-0.5 text-sm text-gray-600 dark:text-gray-300">
            {data.toCheck.length > 0 && <>{data.toCheck.length} {data.toCheck.length === 1 ? 'payment' : 'payments'} ({kes(data.totalToCheck)}) taken while M-Pesa was down. {isManager ? 'Find each on the till statement.' : 'A manager checks these against the till.'}</>}
            {data.stuckPrompts.length > 0 && <> {data.stuckPrompts.length} {data.stuckPrompts.length === 1 ? 'prompt is' : 'prompts are'} still waiting for Safaricom's answer; they are asked again each time this list opens.</>}
          </p>
        </div>
        <button type="button" disabled={checking} onClick={() => load(true)} className="inline-flex disabled:opacity-50 items-center gap-1.5 rounded-lg border border-amber-300 px-3 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-100 dark:border-amber-700 dark:text-amber-200 dark:hover:bg-amber-900/30">
          <RefreshCw className={`h-3.5 w-3.5 ${checking ? 'animate-spin' : ''}`} aria-hidden="true" /> {checking ? 'Asking Safaricom…' : 'Ask Safaricom again'}
        </button>
      </div>
      {data.toCheck.length > 0 && (
        <ul className="mt-3 divide-y divide-amber-200 rounded-xl border border-amber-200 bg-white dark:divide-amber-900/50 dark:border-amber-900/50 dark:bg-[#111116]">
          {data.toCheck.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm">
              <div className="min-w-0">
                <p className="font-semibold text-gray-900 dark:text-gray-100">{kes(c.amount)} · Order {c.order.orderNumber}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {new Date(c.createdAt).toLocaleString()}{c.takenBy ? ` · taken by ${c.takenBy}` : ''}{c.payerPhone ? ` · from ${c.payerPhone}` : ''}{c.reference ? ` · code ${c.reference}` : ' · no code yet'}{c.notes ? ` · ${c.notes}` : ''}
                </p>
              </div>
              {isManager && c.takenById === user?.id && <p className="text-xs text-gray-500">Another manager checks this one: you took it.</p>}
              {isManager && c.takenById !== user?.id && (
                <div className="flex gap-2">
                  <button type="button" disabled={busy === c.id} onClick={() => check(c, 'CONFIRMED')} className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
                    <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> Received
                  </button>
                  <button type="button" disabled={busy === c.id} onClick={() => check(c, 'NOT_RECEIVED')} className="inline-flex items-center gap-1 rounded-lg border border-red-300 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950/30">
                    <XCircle className="h-3.5 w-3.5" aria-hidden="true" /> Not received
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
