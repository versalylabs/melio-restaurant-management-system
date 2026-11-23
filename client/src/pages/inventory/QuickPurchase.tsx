import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, ShoppingBasket } from 'lucide-react';
import { Link } from 'react-router-dom';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import { inventoryApi } from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';
import { getActiveBranchId } from '../../utils/branch';
import { confirmDialog } from '../../lib/dialogs';
import { newRequestId } from '../../lib/utils';

const field = 'mt-1 h-12 w-full rounded-xl border border-gray-300 bg-white px-3 text-base dark:border-gray-600 dark:bg-[#111116] sm:text-sm';
const kes = (n: number) => `KES ${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

/** Units a purchase can be entered in, by the ingredient's own unit family. */
const UNIT_CHOICES: Record<string, string[]> = {
  mass: ['kg', 'g'],
  volume: ['l', 'ml'],
  count: ['pieces', 'dozen'],
};
const familyOf = (unit: string) => {
  const u = unit.toLowerCase();
  if (['kg', 'g', 'kgs', 'gram', 'grams', 'kilogram', 'kilograms'].includes(u)) return 'mass';
  if (['l', 'ml', 'litre', 'litres', 'liter', 'liters', 'ltr'].includes(u)) return 'volume';
  return 'count';
};

/**
 * For the market run: what you bought, how much you paid, and where the money
 * came from. Stock, the ingredient's price and the expense are recorded at once.
 * Built for a phone held in one hand at the market.
 */
export default function QuickPurchase() {
  const { user } = useAuth();
  const [ingredients, setIngredients] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [ingredientId, setIngredientId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [unit, setUnit] = useState('');
  const [totalPaid, setTotalPaid] = useState('');
  const [paidFrom, setPaidFrom] = useState<'TILL_CASH' | 'MPESA' | 'OTHER'>('TILL_CASH');
  const [vendor, setVendor] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<any>(null);
  // One id per purchase: a retry after a dropped connection is not recorded twice.
  const [requestId, setRequestId] = useState(() => newRequestId());

  useEffect(() => {
    inventoryApi.getIngredients({ status: 'ACTIVE', limit: 500 }).then((r) => {
      const d = r.data.data;
      setIngredients(Array.isArray(d) ? d : d?.items || d?.ingredients || []);
    }).catch(() => setError('Could not load ingredients'));
  }, []);

  const ingredient = ingredients.find((i) => i.id === ingredientId);
  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? ingredients.filter((i) => i.name.toLowerCase().includes(q)).slice(0, 8) : [];
  }, [search, ingredients]);
  const units = ingredient ? Array.from(new Set([ingredient.unit, ...UNIT_CHOICES[familyOf(ingredient.unit)]])) : [];
  const perUnit = Number(quantity) > 0 && Number(totalPaid) > 0 ? Number(totalPaid) / Number(quantity) : 0;

  const choose = (i: any) => {
    setIngredientId(i.id);
    setUnit(i.unit);
    setSearch('');
    setResult(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const body = { ingredientId, quantity: Number(quantity), unit, totalPaid: Number(totalPaid), paidFrom, vendor, branchId: getActiveBranchId(user as any) || undefined, clientRequestId: requestId };
      let res;
      try {
        res = await inventoryApi.quickPurchase(body);
      } catch (err: any) {
        // A price far from the last one: show the server's check and ask before saving.
        if (err.response?.data?.errors?.price?.[0] !== 'PRICE_CHECK') throw err;
        if (!(await confirmDialog(err.response.data.message, { title: 'Check the price', confirmLabel: 'It is right, save it' }))) return;
        res = await inventoryApi.quickPurchase({ ...body, confirmPriceJump: true });
      }
      setResult({ ...res.data.data, name: ingredient?.name, quantity, unit, totalPaid });
      setQuantity('');
      setTotalPaid('');
      setVendor('');
      setIngredientId('');
      setRequestId(newRequestId());
    } catch (err: any) {
      setError(err.response?.data?.message || 'Could not record the purchase');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-xl space-y-5 p-4 sm:p-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900 dark:text-gray-100"><ShoppingBasket className="h-6 w-6 text-orange-500" aria-hidden="true" /> Quick purchase</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Record a market buy: the stock, the price and the money, in one go.</p>
      </div>

      {result && (
        <div className="space-y-2 rounded-2xl border border-green-200 bg-green-50 p-4 text-sm text-green-900 dark:border-green-900 dark:bg-green-950/30 dark:text-green-200" role="status">
          <p className="flex items-start gap-2 font-semibold"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> Recorded {result.quantity} {result.unit} {result.name} for {kes(result.totalPaid)}.</p>
          {result.priceChange && result.priceChange.changePct !== null && Math.abs(result.priceChange.changePct) >= 1 && (
            <p>
              Price now {kes(result.priceChange.now)} per {result.priceChange.unit}, {result.priceChange.changePct > 0 ? 'up' : 'down'} {Math.abs(result.priceChange.changePct)}% from {kes(result.priceChange.previous)}.
            </p>
          )}
          {result.expenseStatus === 'PENDING' && <p>The expense is waiting for a manager to approve it on the Expenses page.</p>}
          {result.marginAlerts?.length > 0 && (
            <div className="mt-2 rounded-xl bg-amber-100 p-3 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200">
              <p className="flex items-center gap-2 font-semibold"><AlertTriangle className="h-4 w-4" aria-hidden="true" /> Now over the food-cost target:</p>
              <ul className="mt-1 list-disc pl-5">
                {result.marginAlerts.map((a: any) => <li key={a.name}>{a.name}: {a.was}% → {a.now}% (target {a.target}%)</li>)}
              </ul>
              {['OWNER', 'ADMIN', 'MANAGER', 'INVENTORY_MANAGER'].includes(user?.roleName || '') && <Link to="/food-cost" className="mt-1 inline-block font-semibold underline">Review on Food Cost</Link>}
            </div>
          )}
        </div>
      )}

      <Card>
        <form onSubmit={submit} className="space-y-4">
          {ingredient ? (
            <div className="flex items-center justify-between rounded-xl bg-gray-50 px-4 py-3 dark:bg-white/5">
              <div>
                <p className="font-semibold">{ingredient.name}</p>
                <p className="text-xs text-gray-500">Counted in {ingredient.unit}</p>
              </div>
              <button type="button" onClick={() => setIngredientId('')} className="text-sm font-semibold text-orange-600">Change</button>
            </div>
          ) : (
            <div className="relative">
              <label htmlFor="qp-search" className="text-sm font-medium">What did you buy?</label>
              <input id="qp-search" autoComplete="off" placeholder="Start typing, e.g. tomatoes" value={search} onChange={(e) => setSearch(e.target.value)} className={field} />
              {matches.length > 0 && (
                <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-[#16161c]">
                  {matches.map((i) => (
                    <li key={i.id}><button type="button" onClick={() => choose(i)} className="block w-full px-4 py-3 text-left text-sm hover:bg-orange-50 dark:hover:bg-white/5">{i.name} <span className="text-gray-400">· {i.unit}</span></button></li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className="grid grid-cols-[1fr_120px] gap-3">
            <label className="text-sm font-medium">How much
              <input type="number" inputMode="decimal" min="0" step="any" required value={quantity} onChange={(e) => setQuantity(e.target.value)} className={field} disabled={!ingredient} />
            </label>
            <label className="text-sm font-medium">Unit
              <select value={unit} onChange={(e) => setUnit(e.target.value)} className={field} disabled={!ingredient}>
                {units.map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
            </label>
          </div>

          <label className="block text-sm font-medium">Total paid (KES)
            <input type="number" inputMode="decimal" min="0" step="any" required value={totalPaid} onChange={(e) => setTotalPaid(e.target.value)} className={field} disabled={!ingredient} />
            {perUnit > 0 && <span className="mt-1 block text-xs font-normal text-gray-500">That is {kes(perUnit)} per {unit}.</span>}
          </label>

          <fieldset>
            <legend className="text-sm font-medium">Paid from</legend>
            <div className="mt-1 grid grid-cols-3 gap-2">
              {([['TILL_CASH', 'Till cash'], ['MPESA', 'M-Pesa'], ['OTHER', 'Other']] as const).map(([v, label]) => (
                <button key={v} type="button" aria-pressed={paidFrom === v} onClick={() => setPaidFrom(v)}
                  className={`h-12 rounded-xl border text-sm font-semibold ${paidFrom === v ? 'border-orange-500 bg-orange-500 text-white' : 'border-gray-300 dark:border-gray-600'}`}>
                  {label}
                </button>
              ))}
            </div>
            {paidFrom === 'TILL_CASH' && <p className="mt-1 text-xs text-gray-500">Comes off your shift's expected cash.</p>}
          </fieldset>

          <label className="block text-sm font-medium">Bought from (optional)
            <input placeholder="e.g. Marikiti, Mama Wanjiru" value={vendor} onChange={(e) => setVendor(e.target.value)} className={field} />
          </label>

          {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
          <Button type="submit" loading={busy} disabled={!ingredient} className="h-12 w-full">Record purchase</Button>
        </form>
      </Card>
    </div>
  );
}
