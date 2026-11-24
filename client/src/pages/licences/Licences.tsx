import { useEffect, useState } from 'react';
import { FileText, Pencil, Plus, Trash2 } from 'lucide-react';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import Modal from '../../components/ui/Modal';
import Input from '../../components/ui/Input';
import { branchApi, licenceApi } from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';
import { confirmDialog, notify } from '../../lib/dialogs';

type Licence = { id: string; name: string; authority: string | null; number: string | null; notes: string | null; branchId: string | null; expiresAt: string; daysLeft: number; hasDocument: boolean; documentName: string | null };

const COMMON = ['Single Business Permit', 'Public Health Licence', 'Food Hygiene Certificate', 'Fire Safety Certificate', 'Liquor Licence', 'Tourism Regulatory Authority Licence', 'Medical certificates (food handlers)'];
const dateOf = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' });

function Status({ days }: { days: number }) {
  const [cls, text] =
    days < 0 ? ['bg-red-600 text-white', `Expired ${-days} ${days === -1 ? 'day' : 'days'} ago`]
    : days <= 7 ? ['bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300', days === 0 ? 'Expires today' : `${days} ${days === 1 ? 'day' : 'days'} left`]
    : days <= 30 ? ['bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200', `${days} days left`]
    : ['bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300', 'Valid'];
  return <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${cls}`}>{text}</span>;
}

/** Licences and permits, with reminders 30 and 7 days before they expire. */
export default function Licences() {
  const { user } = useAuth();
  const [licences, setLicences] = useState<Licence[]>([]);
  const [branches, setBranches] = useState<Array<{ id: string; name: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<Licence | null | undefined>(undefined);

  const load = async () => {
    try {
      const res = await licenceApi.list();
      setLicences(res.data.data.licences);
      setError('');
    } catch (e: any) {
      setError(e.response?.data?.message || 'Could not load licences');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
    if (!user?.branchId) branchApi.getBranches().then((r) => setBranches(r.data?.data?.branches || [])).catch(() => undefined);
  }, []);

  const view = async (l: Licence) => {
    // Open the tab during the tap: Safari blocks tabs opened after waiting for the download.
    const tab = window.open('', '_blank');
    if (!tab) { notify('Allow pop-ups for this site to view documents'); return; }
    try {
      const res = await licenceApi.document(l.id);
      const url = URL.createObjectURL(res.data);
      tab.location.href = url;
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      tab.close();
      notify('Could not open the document');
    }
  };
  const remove = async (l: Licence) => {
    if (!(await confirmDialog(`Remove ${l.name}? Its reminders and document are deleted too.`, { danger: true, confirmLabel: 'Remove' }))) return;
    try {
      await licenceApi.remove(l.id);
      await load();
    } catch (e: any) {
      notify(e.response?.data?.message || 'Could not remove the licence');
    }
  };

  const branchName = (id: string | null) => (id ? branches.find((b) => b.id === id)?.name || 'This branch' : 'All branches');
  const attention = licences.filter((l) => l.daysLeft <= 30).length;

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Licences &amp; permits</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Owners and managers are reminded 30 days and 7 days before each one expires.</p>
        </div>
        <Button onClick={() => setEditing(null)}><Plus className="mr-1 h-4 w-4" aria-hidden="true" />Add licence</Button>
      </div>

      {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">{error}</div>}
      {attention > 0 && <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">{attention} {attention === 1 ? 'licence needs' : 'licences need'} renewing within 30 days.</p>}

      <Card>
        {loading ? (
          <p className="py-10 text-center text-sm text-gray-500">Loading…</p>
        ) : !licences.length ? (
          <div className="py-10 text-center text-sm text-gray-500">
            <p>No licences yet. Add your business permit, health and fire certificates and liquor licence to get reminders before they expire.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-800">
              <thead>
                <tr className="text-left text-xs font-semibold uppercase text-gray-500">
                  <th className="px-3 py-2">Licence</th>
                  <th className="px-3 py-2">Issued by</th>
                  {!user?.branchId && <th className="px-3 py-2">Covers</th>}
                  <th className="px-3 py-2">Expires</th>
                  <th className="px-3 py-2">Document</th>
                  <th className="px-3 py-2"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {licences.map((l) => (
                  <tr key={l.id}>
                    <td className="px-3 py-3"><p className="font-semibold text-gray-900 dark:text-gray-100">{l.name}</p>{l.number && <p className="text-xs text-gray-500">No. {l.number}</p>}</td>
                    <td className="px-3 py-3 text-gray-600 dark:text-gray-300">{l.authority || '—'}</td>
                    {!user?.branchId && <td className="px-3 py-3 text-gray-600 dark:text-gray-300">{branchName(l.branchId)}</td>}
                    <td className="px-3 py-3"><p className="tabular-nums">{dateOf(l.expiresAt)}</p><Status days={l.daysLeft} /></td>
                    <td className="px-3 py-3">{l.hasDocument ? <button type="button" onClick={() => view(l)} className="inline-flex items-center gap-1 text-orange-600 underline dark:text-orange-400"><FileText className="h-4 w-4" aria-hidden="true" />View</button> : <span className="text-gray-400">—</span>}</td>
                    <td className="px-3 py-3 text-right whitespace-nowrap">
                      <button type="button" aria-label={`Edit ${l.name}`} onClick={() => setEditing(l)} className="mr-3 text-gray-500 hover:text-gray-800 dark:hover:text-gray-200"><Pencil className="h-4 w-4" aria-hidden="true" /></button>
                      <button type="button" aria-label={`Remove ${l.name}`} onClick={() => remove(l)} className="text-red-600"><Trash2 className="h-4 w-4" aria-hidden="true" /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {editing !== undefined && (
        <LicenceForm licence={editing} branches={user?.branchId ? [] : branches} onClose={() => setEditing(undefined)} onSaved={async () => { setEditing(undefined); await load(); }} />
      )}
    </div>
  );
}

function LicenceForm({ licence, branches, onClose, onSaved }: { licence: Licence | null; branches: Array<{ id: string; name: string }>; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    name: licence?.name || '', authority: licence?.authority || '', number: licence?.number || '',
    expiresAt: licence ? dateOf(licence.expiresAt) : '', branchId: licence?.branchId || '', notes: licence?.notes || '',
  });
  const [file, setFile] = useState<File | null>(null);
  const [removeDoc, setRemoveDoc] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (file && file.size > 3 * 1024 * 1024) { setError('The document must be under 3 MB'); return; }
    setBusy(true);
    setError('');
    const data = new FormData();
    Object.entries(form).forEach(([k, v]) => data.append(k, v));
    if (file) data.append('document', file);
    if (removeDoc) data.append('removeDocument', 'true');
    try {
      if (licence) await licenceApi.update(licence.id, data);
      else await licenceApi.create(data);
      onSaved();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Could not save the licence');
      setBusy(false);
    }
  };

  return (
    <Modal title={licence ? `Edit ${licence.name}` : 'Add a licence'} onClose={onClose}>
      <form onSubmit={save} className="space-y-4">
        <Input id="licence-name" label="Licence" list="licence-names" required maxLength={120} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Single Business Permit" />
        <datalist id="licence-names">{COMMON.map((n) => <option key={n} value={n} />)}</datalist>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input id="licence-authority" label="Issued by (optional)" maxLength={120} value={form.authority} onChange={(e) => setForm({ ...form, authority: e.target.value })} placeholder="e.g. Nairobi County" />
          <Input id="licence-number" label="Number (optional)" maxLength={80} value={form.number} onChange={(e) => setForm({ ...form, number: e.target.value })} />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input id="licence-expires" type="date" label="Expires on" required value={form.expiresAt} onChange={(e) => setForm({ ...form, expiresAt: e.target.value })} />
          {branches.length > 0 && (
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Covers
              <select value={form.branchId} onChange={(e) => setForm({ ...form, branchId: e.target.value })} className="rms-control mt-1 w-full">
                <option value="">All branches</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </label>
          )}
        </div>
        <Input id="licence-notes" label="Notes (optional)" maxLength={500} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="e.g. renew at the county offices, fee KES 30,000" />
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
          Scan or photo of the licence (optional)
          <input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(e) => setFile(e.target.files?.[0] || null)} className="mt-1 block w-full text-sm" />
          <span className="mt-1 block text-xs font-normal text-gray-500">PDF or photo, up to 3 MB.{licence?.hasDocument ? ` Current: ${licence.documentName}. A new file replaces it.` : ''}</span>
        </label>
        {licence?.hasDocument && !file && (
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={removeDoc} onChange={(e) => setRemoveDoc(e.target.checked)} /> Remove the current document</label>
        )}
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={busy}>{licence ? 'Save' : 'Add licence'}</Button>
        </div>
      </form>
    </Modal>
  );
}
