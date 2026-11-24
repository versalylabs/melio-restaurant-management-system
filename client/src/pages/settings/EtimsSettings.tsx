import { useEffect, useState } from 'react';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import { etimsApi } from '../../services/api';
import { confirmDialog, notify } from '../../lib/dialogs';

type Device = { bhfId: string; serialNumber: string; itemClassCode: string; environment: string; sdcId: string | null; lastInvoiceNo: number; createdAt: string };
type Unsigned = { id: string; branchId: string; kind: string; status: string; attempts: number; lastError: string | null; createdAt: string; invoiceNo: number | null; sale: { orderNumber: string; totalAmount: number } };
type Status = { environment: string; hasKraPin: boolean; branches: Array<{ id: string; name: string; device: Device | null }>; unsigned: Unsigned[]; unsignedCount: number; signedCount: number };

const field = 'mt-1 block h-10 rounded-lg border border-gray-300 bg-white px-3 text-sm dark:border-gray-600 dark:bg-[#111116]';

/**
 * Each branch's KRA eTIMS device, and the receipts and credit notes KRA hasn't
 * signed yet (waiting to be sent again, or refused and needing a look).
 */
export default function EtimsSettings() {
  const [status, setStatus] = useState<Status | null>(null);
  const [forms, setForms] = useState<Record<string, { bhfId: string; serialNumber: string; itemClassCode: string }>>({});
  const [busy, setBusy] = useState('');

  // resetForms: only on first load and after a successful set-up, so a failed attempt keeps what was typed.
  const load = (resetForms = false) => etimsApi.status().then((r) => {
    const s: Status = r.data.data;
    setStatus(s);
    if (resetForms) setForms(Object.fromEntries(s.branches.map((b) => [b.id, { bhfId: b.device?.bhfId || '00', serialNumber: b.device?.serialNumber || '', itemClassCode: b.device?.itemClassCode || '' }])));
  }).catch(() => undefined);
  useEffect(() => { void load(true); }, []);

  const run = async (key: string, work: () => Promise<any>, resetForms = false) => {
    setBusy(key);
    try {
      const res = await work();
      notify(res?.data?.message || 'Done', 'success');
      await load(resetForms);
    } catch (e: any) {
      notify(e.response?.data?.message || 'That did not work');
      await load();
    } finally {
      setBusy('');
    }
  };
  const connect = async (b: Status['branches'][number], f: { bhfId: string; serialNumber: string; itemClassCode: string }) => {
    if (b.device && b.device.bhfId !== f.bhfId && !(await confirmDialog(`Switch ${b.name} from KRA branch ${b.device.bhfId} to ${f.bhfId}? Receipts not yet signed will be sent under the new branch number.`, { confirmLabel: 'Switch' }))) return;
    await run(b.id, () => etimsApi.setUpDevice({ branchId: b.id, ...f }), true);
  };

  if (!status) return null;
  const test = status.environment !== 'production';
  const names = Object.fromEntries(status.branches.map((b) => [b.id, b.name]));
  return (
    <Card
      title="KRA eTIMS"
      description={`Each receipt and credit note is sent to KRA to be signed, and the receipt shows KRA's invoice number and QR code.${test ? " This is KRA's test system: receipts are marked as test invoices, not valid for tax." : ''}`}
    >
      <div className="space-y-4">
        {!status.hasKraPin && <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">Add the business's KRA PIN under Restaurant Information first.</p>}

        {status.branches.map((b) => {
          const f = forms[b.id] || { bhfId: '00', serialNumber: '', itemClassCode: '' };
          const set = (k: keyof typeof f, v: string) => setForms({ ...forms, [b.id]: { ...f, [k]: v } });
          return (
            <div key={b.id} className="rounded-xl border border-gray-200 p-3 dark:border-gray-800">
              <div className="flex flex-wrap items-end gap-2">
                <p className="w-full text-sm font-semibold sm:w-40">{b.name}</p>
                <label className="text-xs text-gray-500">KRA branch no.
                  <input inputMode="numeric" value={f.bhfId} onChange={(e) => set('bhfId', e.target.value.replace(/\D/g, '').slice(0, 2))} className={`${field} w-20`} />
                </label>
                <label className="text-xs text-gray-500">Device serial
                  <input value={f.serialNumber} onChange={(e) => set('serialNumber', e.target.value.slice(0, 100))} placeholder="As registered with KRA" className={`${field} w-44`} />
                </label>
                <label className="text-xs text-gray-500">Item class code
                  <input inputMode="numeric" value={f.itemClassCode} onChange={(e) => set('itemClassCode', e.target.value.replace(/\D/g, '').slice(0, 10))} placeholder="10 digits" className={`${field} w-32`} />
                </label>
                <Button size="sm" disabled={!status.hasKraPin || busy === b.id || !f.serialNumber || f.itemClassCode.length !== 10 || f.bhfId.length !== 2}
                  onClick={() => connect(b, f)}>
                  {b.device ? 'Connect again' : 'Connect to KRA'}
                </Button>
              </div>
              <p className="mt-2 text-xs text-gray-500">
                {b.device
                  ? `Connected ${new Date(b.device.createdAt).toLocaleDateString()} (${b.device.environment === 'production' ? 'live' : 'KRA test system'})${b.device.sdcId ? `, device ${b.device.sdcId}` : ''}. Last KRA invoice number: ${b.device.lastInvoiceNo}.`
                  : 'Not connected. Use the branch number and device serial number from your KRA eTIMS (OSCU) registration.'}
              </p>
            </div>
          );
        })}

        <div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">Not signed by KRA ({status.unsignedCount})</h3>
            {status.unsigned.length > 0 && <Button size="sm" variant="secondary" disabled={busy === 'all'} onClick={() => run('all', () => etimsApi.retry())}>Send now</Button>}
          </div>
          {!status.unsigned.length ? (
            <p className="mt-1 text-sm text-gray-500">{status.signedCount ? `All ${status.signedCount} sent to KRA are signed.` : 'Nothing waiting.'}</p>
          ) : (
            <ul className="mt-2 divide-y divide-gray-100 rounded-lg border border-gray-200 text-sm dark:divide-gray-800 dark:border-gray-700">
              {status.unsigned.map((u) => (
                <li key={u.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                  <span>
                    <span className="font-semibold">{u.kind === 'SALE' ? 'Receipt' : 'Credit note'} · order {u.sale.orderNumber}</span>
                    <span className="text-gray-500"> · {names[u.branchId] || ''} · {new Date(u.createdAt).toLocaleString()}</span>
                    <span className={`block text-xs ${u.status === 'REJECTED' ? 'text-red-600' : 'text-gray-500'}`}>
                      {u.status === 'REJECTED' ? `Refused by KRA: ${u.lastError || 'no reason given'}` : u.lastError ? `Will try again: ${u.lastError}` : 'Waiting to be sent'}
                    </span>
                  </span>
                  {u.status === 'REJECTED' && <Button size="sm" variant="ghost" disabled={busy === u.id} onClick={() => run(u.id, () => etimsApi.retry(u.id))}>Send again</Button>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Card>
  );
}
