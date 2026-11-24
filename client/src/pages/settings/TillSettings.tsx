import { useEffect, useState } from 'react';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import { branchApi, paymentApi } from '../../services/api';
import { notify } from '../../lib/dialogs';

type Branch = { id: string; name: string; mpesaShortcode: string | null; mpesaShortcodeType: string | null; mpesaRegisteredAt: string | null };

/**
 * Each branch's M-Pesa till or paybill. Once connected, payments customers
 * send to it appear at the POS ("Paid to till") and in the daily M-Pesa check.
 */
export default function TillSettings() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [edits, setEdits] = useState<Record<string, { code: string; type: string }>>({});
  const [busy, setBusy] = useState('');

  const load = () => branchApi.getBranches().then((r) => {
    const list: Branch[] = (r.data?.data?.branches || []).filter((b: any) => b.status !== 'INACTIVE');
    setBranches(list);
    setEdits(Object.fromEntries(list.map((b) => [b.id, { code: b.mpesaShortcode || '', type: b.mpesaShortcodeType || 'TILL' }])));
  }).catch(() => undefined);
  useEffect(() => { void load(); }, []);

  const run = async (key: string, work: () => Promise<any>, ok: string) => {
    setBusy(key);
    try {
      const res = await work();
      notify(res?.data?.message || ok, 'success');
      await load();
    } catch (e: any) {
      notify(e.response?.data?.message || 'That did not work');
    } finally {
      setBusy('');
    }
  };

  if (!branches.length) return null;
  return (
    <Card title="M-Pesa tills" description="The till or paybill each branch takes M-Pesa on. Connect it so payments customers send appear in Melio, ready to attach to bills.">
      <div className="space-y-4">
        <p className="text-xs text-gray-500">For a Buy Goods till, Safaricom may connect the store number (on your till's paperwork) rather than the till number customers pay. If connecting fails, try the store number.</p>
        {branches.map((b) => {
          const e = edits[b.id] || { code: '', type: 'TILL' };
          const changed = e.code !== (b.mpesaShortcode || '') || e.type !== (b.mpesaShortcodeType || 'TILL');
          return (
            <div key={b.id} className="rounded-xl border border-gray-200 p-3 dark:border-gray-800">
              <div className="flex flex-wrap items-end gap-2">
                <p className="w-full text-sm font-semibold sm:w-40">{b.name}</p>
                <label className="text-xs text-gray-500">Number
                  <input inputMode="numeric" value={e.code} onChange={(ev) => setEdits({ ...edits, [b.id]: { ...e, code: ev.target.value.replace(/\D/g, '').slice(0, 7) } })} placeholder="e.g. 5123456" className="mt-1 block h-10 w-32 rounded-lg border border-gray-300 bg-white px-3 text-sm dark:border-gray-600 dark:bg-[#111116]" />
                </label>
                <label className="text-xs text-gray-500">Type
                  <select value={e.type} onChange={(ev) => setEdits({ ...edits, [b.id]: { ...e, type: ev.target.value } })} className="mt-1 block h-10 rounded-lg border border-gray-300 bg-white px-2 text-sm dark:border-gray-600 dark:bg-[#111116]">
                    <option value="TILL">Till (Buy Goods)</option>
                    <option value="PAYBILL">Paybill</option>
                  </select>
                </label>
                <Button size="sm" variant="secondary" disabled={!changed || busy === `s${b.id}`} onClick={() => run(`s${b.id}`, () => branchApi.updateBranch(b.id, { mpesaShortcode: e.code, mpesaShortcodeType: e.type }), 'Saved')}>Save</Button>
                {b.mpesaShortcode && !changed && (
                  <>
                    <Button size="sm" disabled={busy === `r${b.id}`} onClick={() => run(`r${b.id}`, () => paymentApi.registerTill(b.id), 'Connected')}>{b.mpesaRegisteredAt ? 'Connect again' : 'Connect to Safaricom'}</Button>
                    <Button size="sm" variant="ghost" disabled={busy === `t${b.id}`} onClick={() => run(`t${b.id}`, () => paymentApi.simulateTill(b.id, 10), 'Test payment sent')}>Send a test payment</Button>
                  </>
                )}
              </div>
              <p className="mt-2 text-xs text-gray-500">
                {!b.mpesaShortcode ? 'Not set.' : b.mpesaRegisteredAt ? `Connected ${new Date(b.mpesaRegisteredAt).toLocaleDateString()}. Payments to ${b.mpesaShortcode} appear at the POS under "Paid to till".` : 'Saved, not connected yet. Connecting needs Safaricom to have approved this till for Daraja (or the sandbox for testing).'}
              </p>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
