import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { CheckCircle2, Smartphone, XCircle } from 'lucide-react';
import { publicPayApi } from '../../services/api';

type Bill = {
  restaurantName: string;
  logo?: string | null;
  branchName: string;
  orderNumber: string;
  items: Array<{ itemNameSnapshot: string; quantity: number; subtotal: number }>;
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  taxInclusive?: boolean;
  serviceChargeAmount: number;
  totalAmount: number;
  paid: number;
  balance: number;
  cancelled: boolean;
  simulation: boolean;
};
type Phase =
  | { phase: 'idle' }
  | { phase: 'waiting'; checkoutRequestId: string; amount: number; simulated: boolean; startedAt: number }
  | { phase: 'paid'; receipt?: string; amount: number }
  | { phase: 'failed'; reason: string };

const kes = (n: number) => `KES ${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const POLL_MS = 3000;
const GIVE_UP_MS = 3 * 60_000;

/** The page a customer opens from a payment link: their bill, and an M-Pesa prompt to pay it. */
export default function PayLink() {
  const { token = '' } = useParams();
  const [bill, setBill] = useState<Bill | null>(null);
  const [loadError, setLoadError] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [state, setState] = useState<Phase>({ phase: 'idle' });
  const stateRef = useRef(state);
  stateRef.current = state;

  const loadBill = async () => {
    try {
      const res = await publicPayApi.get(token);
      setBill(res.data.data);
    } catch (err: any) {
      setLoadError(err.response?.data?.message || 'This payment link could not be opened.');
    }
  };
  useEffect(() => {
    void loadBill();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    if (state.phase !== 'waiting') return;
    const timer = setInterval(async () => {
      const current = stateRef.current;
      if (current.phase !== 'waiting') return;
      if (Date.now() - current.startedAt > GIVE_UP_MS) {
        setState({ phase: 'failed', reason: 'No answer from M-Pesa yet. If you entered your PIN, the payment will still reach the restaurant. Otherwise try again.' });
        return;
      }
      try {
        const res = await publicPayApi.status(token, current.checkoutRequestId);
        const s = res.data.data;
        if (s.status === 'SUCCESS' || s.status === 'ALREADY_RECORDED' || s.status === 'REFUND_REQUIRED') {
          setState({ phase: 'paid', receipt: s.receipt, amount: s.amount });
          void loadBill();
        } else if (s.status === 'FAILED') {
          setState({ phase: 'failed', reason: s.reason || 'The payment was not completed.' });
        }
      } catch {
        // Try again on the next tick.
      }
    }, POLL_MS);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase, token]);

  const pay = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const res = await publicPayApi.pay(token, phone);
      const d = res.data.data;
      setState({ phase: 'waiting', checkoutRequestId: d.checkoutRequestId, amount: d.amount, simulated: !!d.simulated, startedAt: Date.now() });
    } catch (err: any) {
      setError(err.response?.data?.message || 'Could not send the M-Pesa prompt. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const simulate = async () => {
    if (state.phase !== 'waiting') return;
    try {
      await publicPayApi.simulate(token, state.checkoutRequestId);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Simulation failed');
    }
  };

  return (
    <main className="site-glass glass-backdrop glass-backdrop-fixed relative min-h-screen px-4 py-10 text-stone-900 dark:text-zinc-100">
      <div className="mx-auto w-full max-w-md">
        {loadError ? (
          <div className="rounded-2xl bg-white p-6 text-center shadow-sm dark:bg-zinc-900" role="alert">
            <XCircle className="mx-auto h-10 w-10 text-red-500" aria-hidden="true" />
            <p className="mt-3 text-sm">{loadError}</p>
          </div>
        ) : !bill ? (
          <p className="text-center text-sm text-stone-500">Loading your bill…</p>
        ) : (
          <div className="overflow-hidden rounded-2xl bg-white shadow-sm dark:bg-zinc-900">
            <header className="border-b border-stone-200 p-6 dark:border-zinc-800">
              <h1 className="text-xl font-bold">{bill.restaurantName}</h1>
              <p className="text-sm text-stone-500 dark:text-zinc-400">{bill.branchName} · Order {bill.orderNumber}</p>
            </header>

            <section className="p-6" aria-label="Your bill">
              <ul className="space-y-2 text-sm">
                {bill.items.map((item, i) => (
                  <li key={i} className="flex justify-between gap-4">
                    <span>{item.quantity} × {item.itemNameSnapshot}</span>
                    <span className="tabular-nums">{kes(item.subtotal)}</span>
                  </li>
                ))}
              </ul>
              <dl className="mt-4 space-y-1 border-t border-stone-200 pt-4 text-sm dark:border-zinc-800">
                {bill.discountAmount > 0 && <div className="flex justify-between"><dt>Discount</dt><dd className="tabular-nums">−{kes(bill.discountAmount)}</dd></div>}
                {bill.serviceChargeAmount > 0 && <div className="flex justify-between"><dt>Service charge</dt><dd className="tabular-nums">{kes(bill.serviceChargeAmount)}</dd></div>}
                {bill.taxAmount > 0 && <div className="flex justify-between text-stone-500"><dt>VAT{bill.taxInclusive ? ' (included)' : ''}</dt><dd className="tabular-nums">{kes(bill.taxAmount)}</dd></div>}
                <div className="flex justify-between font-semibold"><dt>Total</dt><dd className="tabular-nums">{kes(bill.totalAmount)}</dd></div>
                {bill.paid > 0 && <div className="flex justify-between text-stone-500"><dt>Already paid</dt><dd className="tabular-nums">{kes(bill.paid)}</dd></div>}
              </dl>
              <div className="mt-4 flex items-baseline justify-between rounded-xl bg-stone-100 px-4 py-3 dark:bg-zinc-800">
                <span className="text-sm font-medium">To pay</span>
                <span className="text-2xl font-bold tabular-nums">{kes(bill.balance)}</span>
              </div>
            </section>

            <section className="border-t border-stone-200 p-6 dark:border-zinc-800" aria-live="polite">
              {bill.cancelled ? (
                <p className="text-sm">This order was cancelled. Contact the restaurant if you think this is a mistake.</p>
              ) : state.phase === 'paid' || bill.balance <= 0 ? (
                <div className="flex items-start gap-3 text-emerald-700 dark:text-emerald-400" role="status">
                  <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0" aria-hidden="true" />
                  <p className="text-sm">
                    {state.phase === 'paid'
                      ? `Paid. ${kes(state.amount)}${state.receipt ? `, M-Pesa receipt ${state.receipt}` : ''}. Thank you!`
                      : 'This bill is fully paid. Thank you!'}
                  </p>
                </div>
              ) : state.phase === 'waiting' ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="h-5 w-5 animate-spin rounded-full border-2 border-emerald-600 border-t-transparent" aria-hidden="true" />
                    <p className="text-sm font-medium">Check your phone and enter your M-Pesa PIN to pay {kes(state.amount)}.</p>
                  </div>
                  {state.simulated && (
                    <button type="button" onClick={simulate} className="text-xs font-semibold text-emerald-700 underline dark:text-emerald-400">
                      Test mode: pretend I paid
                    </button>
                  )}
                  {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
                </div>
              ) : (
                <form onSubmit={pay} className="space-y-3">
                  {state.phase === 'failed' && (
                    <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{state.reason}</p>
                  )}
                  <label className="block text-sm font-medium">
                    Your M-Pesa number
                    <input
                      type="tel"
                      inputMode="tel"
                      autoComplete="tel"
                      required
                      placeholder="0712 345 678"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      className="mt-1 h-12 w-full rounded-xl border border-stone-300 bg-white px-4 text-base focus:border-emerald-600 focus:outline-none dark:border-zinc-700 dark:bg-zinc-950"
                    />
                  </label>
                  {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
                  <button type="submit" disabled={busy} className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 text-base font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
                    <Smartphone className="h-5 w-5" aria-hidden="true" /> {busy ? 'Sending…' : `Pay ${kes(bill.balance)} with M-Pesa`}
                  </button>
                  <p className="text-xs text-stone-500 dark:text-zinc-400">You'll get a prompt on your phone from Safaricom. Enter your PIN there; nothing is charged until you do.</p>
                </form>
              )}
            </section>
          </div>
        )}
      </div>
    </main>
  );
}
