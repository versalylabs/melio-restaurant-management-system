import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Smartphone, XCircle } from 'lucide-react';
import { paymentApi } from '../../services/api';

type Mode = 'prompt' | 'code';
type PromptState =
  | { phase: 'idle' }
  | { phase: 'waiting'; checkoutRequestId: string; phone: string; amount: number; simulated: boolean; startedAt: number }
  | { phase: 'paid'; receipt?: string; amount: number }
  | { phase: 'refund'; receipt?: string }
  | { phase: 'failed'; reason: string };

const POLL_MS = 3000;
const GIVE_UP_MS = 3 * 60_000;

const field =
  'mt-1 w-full h-10 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-[#111116] px-3 text-sm focus:border-orange-500 focus:outline-none';

/**
 * Taking M-Pesa for a bill, two ways:
 * - send a prompt to the customer's phone and wait for Safaricom to confirm
 *   (nothing to type, nothing to fake);
 * - or, if they already paid to the till, enter the 10-character M-Pesa code
 *   from their message. The server refuses a code that was already used.
 */
export default function MpesaPayment({
  orderId,
  balance,
  defaultPhone,
  canEnterCode = true,
  onPaid,
}: {
  orderId: string;
  balance: number;
  defaultPhone?: string;
  /** Waiters can send prompts but don't record payments by hand. */
  canEnterCode?: boolean;
  onPaid: (message: string) => void;
}) {
  const [mode, setMode] = useState<Mode>('prompt');
  const [phone, setPhone] = useState(defaultPhone || '');
  const [amount, setAmount] = useState(String(Math.round(balance * 100) / 100));
  // Untouched means "the whole balance": the server works it out (and rounds up for M-Pesa).
  const [amountEdited, setAmountEdited] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [state, setState] = useState<PromptState>({ phase: 'idle' });
  const onPaidRef = useRef(onPaid);
  onPaidRef.current = onPaid;

  // While waiting, ask the server every few seconds what Safaricom said.
  useEffect(() => {
    if (state.phase !== 'waiting') return;
    let stopped = false;
    const timer = setInterval(async () => {
      if (stopped) return;
      if (Date.now() - state.startedAt > GIVE_UP_MS) {
        setState({ phase: 'failed', reason: "No answer yet. Ask the customer to check their phone; if they paid, it will still show up here. Otherwise send the prompt again." });
        return;
      }
      try {
        const res = await paymentApi.getMpesaStatus(state.checkoutRequestId);
        const s = res.data.data;
        if (s.status === 'SUCCESS') {
          setState({ phase: 'paid', receipt: s.receipt, amount: s.amount });
          onPaidRef.current(`M-Pesa payment of KES ${Number(s.amount).toLocaleString()} received${s.receipt ? ` (${s.receipt})` : ''}.`);
        } else if (s.status === 'ALREADY_RECORDED') {
          setState({ phase: 'paid', receipt: s.receipt, amount: s.amount });
          onPaidRef.current('This M-Pesa payment was already recorded with its code.');
        } else if (s.status === 'REFUND_REQUIRED') {
          setState({ phase: 'refund', receipt: s.receipt });
        } else if (s.status === 'FAILED') {
          setState({ phase: 'failed', reason: s.reason || 'The customer did not complete the payment.' });
        }
      } catch {
        // Keep waiting; a dropped request is retried on the next tick.
      }
    }, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [state]);

  const sendPrompt = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const res = await paymentApi.sendMpesaPrompt(orderId, { phoneNumber: phone, ...(amountEdited ? { amount: Number(amount) } : {}) });
      const d = res.data.data;
      setState({ phase: 'waiting', checkoutRequestId: d.checkoutRequestId, phone: d.phoneNumber, amount: d.amount, simulated: !!d.simulated, startedAt: Date.now() });
    } catch (err: any) {
      setError(err.response?.data?.message || 'Could not send the prompt');
    } finally {
      setBusy(false);
    }
  };

  const recordCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await paymentApi.recordPayment(orderId, { method: 'MOBILE_MONEY', amount: Number(amount), reference: code });
      onPaid(`M-Pesa payment of KES ${Number(amount).toLocaleString()} recorded (${code.toUpperCase()}).`);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Could not record the payment');
    } finally {
      setBusy(false);
    }
  };

  const simulate = async () => {
    if (state.phase !== 'waiting') return;
    try {
      await paymentApi.simulateMpesa(state.checkoutRequestId);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Simulation failed');
    }
  };

  if (state.phase === 'waiting') {
    return (
      <div className="space-y-3 rounded-lg border border-orange-200 bg-orange-50/60 p-4 dark:border-orange-900 dark:bg-orange-950/20" aria-live="polite">
        <div className="flex items-center gap-3">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-orange-500 border-t-transparent" aria-hidden="true" />
          <p className="text-sm font-medium">Waiting for the customer to enter their M-Pesa PIN on {state.phone}…</p>
        </div>
        <p className="text-xs text-gray-600 dark:text-gray-300">KES {state.amount.toLocaleString()} · This updates by itself when Safaricom confirms. You can close this window; the payment still records.</p>
        {state.simulated && (
          <button type="button" onClick={simulate} className="text-xs font-semibold text-orange-700 underline dark:text-orange-400">
            Test mode: pretend the customer paid
          </button>
        )}
        {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
      </div>
    );
  }
  if (state.phase === 'paid') {
    return (
      <div className="flex items-start gap-3 rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-800 dark:border-green-900 dark:bg-green-950/30 dark:text-green-300" role="status">
        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
        <span>Paid. KES {state.amount.toLocaleString()}{state.receipt ? `, M-Pesa receipt ${state.receipt}` : ''}.</span>
      </div>
    );
  }
  if (state.phase === 'refund') {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300" role="alert">
        The customer paid{state.receipt ? ` (${state.receipt})` : ''}, but the bill was already settled, cancelled, or paid in full by another payment. The payment is recorded and flagged on the Payments page: refund the customer (or the extra).
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {canEnterCode && (
        <div className="grid grid-cols-2 gap-2" role="group" aria-label="How is the customer paying by M-Pesa?">
          {([['prompt', 'Send prompt to phone'], ['code', 'Already paid: enter code']] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={mode === value}
              onClick={() => { setMode(value); setError(''); }}
              className={`h-10 rounded-md border text-xs font-semibold transition ${mode === value ? 'border-orange-500 bg-orange-500 text-white' : 'border-gray-300 text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-white/5'}`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {state.phase === 'failed' && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300" role="alert">
          <XCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{state.reason}</span>
        </div>
      )}

      {mode === 'prompt' ? (
        <form onSubmit={sendPrompt} className="space-y-3">
          <label className="block text-sm font-medium">
            Customer's M-Pesa number
            <input type="tel" inputMode="tel" autoComplete="off" required placeholder="0712 345 678" value={phone} onChange={(e) => setPhone(e.target.value)} className={field} />
          </label>
          <label className="block text-sm font-medium">
            Amount (KES)
            <input type="number" min="1" step="any" max={Math.ceil(balance)} required value={amount} onChange={(e) => { setAmount(e.target.value); setAmountEdited(true); }} className={field} />
            <span className="mt-1 block text-xs font-normal text-gray-500">Lower it to split the bill between several phones.</span>
          </label>
          {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
          <button type="submit" disabled={busy} className="flex h-10 w-full items-center justify-center gap-2 rounded-md bg-green-600 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50">
            <Smartphone className="h-4 w-4" aria-hidden="true" /> {busy ? 'Sending…' : state.phase === 'failed' ? 'Send the prompt again' : 'Send M-Pesa prompt'}
          </button>
        </form>
      ) : (
        <form onSubmit={recordCode} className="space-y-3">
          <label className="block text-sm font-medium">
            M-Pesa code from the customer's message
            <input
              required
              autoComplete="off"
              autoCapitalize="characters"
              maxLength={12}
              placeholder="e.g. SKL7H2X9QD"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
              className={`${field} font-mono tracking-widest`}
            />
            <span className="mt-1 block text-xs font-normal text-gray-500">Check the till phone or statement shows this payment. A code that was used before is refused.</span>
          </label>
          <label className="block text-sm font-medium">
            Amount (KES)
            <input type="number" min="1" step="0.01" required value={amount} onChange={(e) => setAmount(e.target.value)} className={field} />
          </label>
          {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
          <button type="submit" disabled={busy || code.length !== 10} className="h-10 w-full rounded-md bg-orange-600 text-sm font-semibold text-white hover:bg-orange-700 disabled:opacity-50">
            {busy ? 'Recording…' : 'Record M-Pesa payment'}
          </button>
        </form>
      )}
    </div>
  );
}
