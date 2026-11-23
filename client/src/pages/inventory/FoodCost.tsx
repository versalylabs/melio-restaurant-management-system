import { useEffect, useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import Badge from '../../components/ui/Badge';
import { inventoryApi } from '../../services/api';
import { notify } from '../../lib/dialogs';

const kes = (n: number | null | undefined) => `KES ${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const th = 'px-3 py-2 text-left text-xs font-semibold uppercase text-gray-500';
const td = 'px-3 py-2 text-sm tabular-nums';

/**
 * What each dish costs to make at today's ingredient prices, against its
 * selling price and food-cost target, plus what was paid for each ingredient.
 */
export default function FoodCost() {
  const [dishes, setDishes] = useState<any[]>([]);
  const [defaultTarget, setDefaultTarget] = useState(35);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [onlyOver, setOnlyOver] = useState(false);
  const [ingredients, setIngredients] = useState<any[]>([]);
  const [historyFor, setHistoryFor] = useState('');
  const [history, setHistory] = useState<any>(null);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await inventoryApi.getFoodCostOverview();
      setDishes(res.data.data.dishes || []);
      setDefaultTarget(res.data.data.defaultTargetPct || 35);
    } catch (e: any) {
      setError(e.response?.data?.message || 'Could not load food costs');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    load();
    inventoryApi.getIngredients({ status: 'ACTIVE', limit: 500 }).then((r) => setIngredients(r.data.data?.items || [])).catch(() => {});
  }, []);
  useEffect(() => {
    if (!historyFor) return setHistory(null);
    inventoryApi.getPriceHistory(historyFor).then((r) => setHistory(r.data.data)).catch(() => setHistory(null));
  }, [historyFor]);

  const saveTarget = async (menuItemId: string, value: string) => {
    try {
      await inventoryApi.setFoodCostTarget(menuItemId, value === '' ? null : Number(value));
      await load();
    } catch (e: any) {
      notify(e.response?.data?.message || 'Could not save the target');
    }
  };

  const shown = useMemo(() => (onlyOver ? dishes.filter((d) => d.overTarget) : dishes), [dishes, onlyOver]);
  const over = dishes.filter((d) => d.overTarget).length;

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Food cost</h1>
          <p className="mt-1 max-w-2xl text-sm text-gray-500 dark:text-gray-400">
            What each dish costs to make at the latest prices paid, compared with what you sell it for. Dishes without their own target use {defaultTarget}%.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={onlyOver} onChange={(e) => setOnlyOver(e.target.checked)} /> Only over target ({over})</label>
          <Button variant="secondary" onClick={load}><RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />Refresh</Button>
        </div>
      </div>
      {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      <Card title="Dishes">
        {loading ? (
          <p className="py-8 text-center text-sm text-gray-500">Loading…</p>
        ) : shown.length === 0 ? (
          <p className="py-8 text-center text-sm text-gray-500">{dishes.length ? 'No dishes over their target.' : 'No dishes have recipes yet. Add recipes in Inventory to see their cost.'}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
              <thead><tr>{['Dish', 'Price', 'Cost to make', 'Food cost', 'Target %', 'Margin', ''].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {shown.map((d) => (
                  <tr key={d.menuItemId}>
                    <td className="px-3 py-2 text-sm font-medium">
                      {d.name}
                      {d.unconvertible?.length > 0 && <div className="text-xs text-amber-600">Units don't match for {d.unconvertible.join(', ')}: fix the recipe</div>}
                    </td>
                    <td className={td}>{kes(d.sellingPrice)}</td>
                    <td className={td}>{kes(d.costPerServing)}</td>
                    <td className={td}><Badge variant={d.overTarget ? 'danger' : 'success'}>{d.foodCostPct}%</Badge></td>
                    <td className={td}>
                      <input
                        type="number" min="1" max="99" step="1" aria-label={`Food-cost target for ${d.name}`}
                        defaultValue={d.targetIsDefault ? '' : d.targetPct} placeholder={String(defaultTarget)}
                        onBlur={(e) => { if (e.target.value !== (d.targetIsDefault ? '' : String(d.targetPct))) saveTarget(d.menuItemId, e.target.value); }}
                        className="h-9 w-20 rounded-lg border border-gray-300 bg-white px-2 text-sm dark:border-gray-600 dark:bg-[#111116]"
                      />
                    </td>
                    <td className={td}>{kes(d.grossMargin)}</td>
                    <td className="px-3 py-2 text-xs text-gray-600 dark:text-gray-300">{d.suggestedPrice ? `Price for ${d.targetPct}%: ${kes(d.suggestedPrice)}` : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="What you paid">
        <label className="block max-w-sm text-sm font-medium">
          Ingredient
          <select value={historyFor} onChange={(e) => setHistoryFor(e.target.value)} className="mt-1 h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm dark:border-gray-600 dark:bg-[#111116]">
            <option value="">Choose an ingredient</option>
            {ingredients.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
        </label>
        {history && (
          history.history.length === 0 ? (
            <p className="mt-4 text-sm text-gray-500">No purchases recorded yet. Prices are recorded from Quick purchase and received purchase orders.</p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                <thead><tr>{['Date', `Price per ${history.ingredient.unit}`, 'Bought', 'Paid', 'From', 'Recorded by'].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {history.history.map((h: any, idx: number) => {
                    const older = history.history[idx + 1];
                    const change = older && older.unitCost > 0 ? Math.round(((h.unitCost - older.unitCost) / older.unitCost) * 1000) / 10 : null;
                    return (
                      <tr key={h.id}>
                        <td className={td}>{new Date(h.createdAt).toLocaleDateString()}</td>
                        <td className={td}>
                          {kes(h.unitCost)}
                          {change !== null && change !== 0 && <span className={`ml-2 text-xs ${change > 0 ? 'text-red-600' : 'text-green-600'}`}>{change > 0 ? '▲' : '▼'} {Math.abs(change)}%</span>}
                        </td>
                        <td className={td}>{h.quantity} {h.unit}</td>
                        <td className={td}>{kes(h.totalPaid)}</td>
                        <td className="px-3 py-2 text-sm">{h.vendor || (h.source === 'PURCHASE_ORDER' ? 'Purchase order' : 'Market')}</td>
                        <td className="px-3 py-2 text-sm">{h.recordedByName || '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )
        )}
      </Card>
    </div>
  );
}
