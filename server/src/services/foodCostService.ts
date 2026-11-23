import { Prisma } from '@prisma/client';
import prisma from '../config/database';
import { convertQuantity } from '../utils/units';
import { createNotification } from './notificationService';

type Tx = Prisma.TransactionClient;
const round2 = (n: number) => Math.round(n * 100) / 100;
// Unit costs keep six decimals: a gram of spice can cost a fraction of a cent.
const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

/** Roles that may see ingredient costs and margins (same as Inventory). */
export const COST_ROLES = ['OWNER', 'ADMIN', 'MANAGER', 'INVENTORY_MANAGER'];

/** Used when a dish has no target of its own. */
export const DEFAULT_TARGET_FOOD_COST_PCT = 35;

type RecipeLine = { quantity: number; unit: string; ingredient: { id: string; name: string; unit: string; costPerUnit: number } };

/**
 * Cost of one serving: each recipe line converted into the ingredient's own
 * unit (250 g of beef costed at a per-kg price) times its current cost.
 * Lines whose units can't be converted are listed, not guessed.
 */
export function costOfRecipe(lines: RecipeLine[], servings: number, priceOverride?: Map<string, number>) {
  let total = 0;
  const unconvertible: string[] = [];
  const breakdown = lines.map((l) => {
    const qty = convertQuantity(l.quantity, l.unit, l.ingredient.unit);
    const unitCost = priceOverride?.get(l.ingredient.id) ?? l.ingredient.costPerUnit;
    if (qty === null) unconvertible.push(l.ingredient.name);
    const lineCost = qty === null ? 0 : qty * unitCost;
    total += lineCost;
    return { ingredientId: l.ingredient.id, ingredientName: l.ingredient.name, quantity: l.quantity, unit: l.unit, costPerUnit: unitCost, costUnit: l.ingredient.unit, lineCost: round2(lineCost) };
  });
  return { costPerServing: round2(total / Math.max(1, servings || 1)), breakdown, unconvertible };
}

const recipeInclude = { recipe: { include: { ingredients: { include: { ingredient: { select: { id: true, name: true, unit: true, costPerUnit: true } } } } } } } as const;

/** Every dish with a recipe: price, cost per serving, cost %, its target and whether it is over. */
export async function foodCostOverview(restaurantId: string) {
  const items = await prisma.menuItem.findMany({
    where: { restaurantId, status: 'ACTIVE', recipe: { isNot: null } },
    include: recipeInclude,
    orderBy: { name: 'asc' },
  });
  return items.map((m) => {
    const { costPerServing, unconvertible } = costOfRecipe(m.recipe!.ingredients, m.recipe!.servings);
    const rawPct = m.sellingPrice > 0 ? (costPerServing / m.sellingPrice) * 100 : 0;
    const pct = round2(rawPct);
    const target = m.targetFoodCostPct ?? DEFAULT_TARGET_FOOD_COST_PCT;
    return {
      menuItemId: m.id,
      name: m.name,
      sellingPrice: m.sellingPrice,
      costPerServing,
      foodCostPct: pct,
      grossMargin: round2(m.sellingPrice - costPerServing),
      targetPct: target,
      targetIsDefault: m.targetFoodCostPct == null,
      overTarget: m.sellingPrice > 0 && rawPct > target,
      // Price to bring this dish back to its target, rounded up to the next KES 10.
      suggestedPrice: pct > target && target > 0 ? Math.ceil(costPerServing / (target / 100) / 10) * 10 : null,
      unconvertible,
    };
  });
}

/**
 * Records what was paid for an ingredient and makes it the ingredient's
 * current cost (per its own unit). Returns the previous cost for alerts.
 */
export async function recordIngredientPrice(
  tx: Tx,
  input: {
    restaurantId: string; branchId?: string | null; ingredientId: string; supplierId?: string | null; vendor?: string | null;
    quantity: number; unit: string; totalPaid: number; source: 'PURCHASE_ORDER' | 'QUICK_PURCHASE'; referenceId?: string | null; recordedBy: string;
  }
) {
  const ingredient = await tx.ingredient.findUnique({ where: { id: input.ingredientId }, select: { unit: true, costPerUnit: true } });
  if (!ingredient) return null;
  const inIngredientUnit = convertQuantity(input.quantity, input.unit, ingredient.unit);
  if (inIngredientUnit === null || inIngredientUnit <= 0) return null; // can't compare prices across unrelated units
  const unitCost = round6(input.totalPaid / inIngredientUnit);
  await tx.ingredientPriceHistory.create({
    data: {
      restaurantId: input.restaurantId,
      branchId: input.branchId || null,
      ingredientId: input.ingredientId,
      supplierId: input.supplierId || null,
      vendor: input.vendor || null,
      unitCost,
      previousUnitCost: ingredient.costPerUnit,
      quantity: input.quantity,
      unit: input.unit,
      totalPaid: round2(input.totalPaid),
      source: input.source,
      referenceId: input.referenceId || null,
      recordedBy: input.recordedBy,
    },
  });
  await tx.ingredient.update({ where: { id: input.ingredientId }, data: { costPerUnit: unitCost } });
  return { ingredientId: input.ingredientId, previousCost: ingredient.costPerUnit, newCost: unitCost };
}

/**
 * After ingredient prices change, tells the restaurant about dishes that
 * have just gone over their food-cost target (not ones that already were).
 */
export async function alertMarginChanges(restaurantId: string, branchId: string | null, changes: Array<{ ingredientId: string; previousCost: number; newCost: number } | null>) {
  // Only real rises from a known price (a first price has nothing to compare with).
  const real = changes.filter((c): c is { ingredientId: string; previousCost: number; newCost: number } => !!c && c.previousCost > 0 && c.newCost > c.previousCost * 1.000001);
  if (!real.length) return [];
  // The same ingredient on several lines: compare with the price before the first of them.
  const before = new Map<string, number>();
  for (const c of real) if (!before.has(c.ingredientId)) before.set(c.ingredientId, c.previousCost);
  const dishes = await prisma.menuItem.findMany({
    where: { restaurantId, status: 'ACTIVE', recipe: { ingredients: { some: { ingredientId: { in: [...before.keys()] } } } } },
    include: recipeInclude,
  });
  const alerts: { name: string; was: number; now: number; target: number }[] = [];
  for (const m of dishes) {
    if (!m.recipe || m.sellingPrice <= 0) continue;
    const target = m.targetFoodCostPct ?? DEFAULT_TARGET_FOOD_COST_PCT;
    const now = costOfRecipe(m.recipe.ingredients, m.recipe.servings).costPerServing;
    const was = costOfRecipe(m.recipe.ingredients, m.recipe.servings, before).costPerServing;
    const nowPct = (now / m.sellingPrice) * 100;
    const wasPct = (was / m.sellingPrice) * 100;
    if (nowPct > target && wasPct <= target) alerts.push({ name: m.name, was: round2(wasPct), now: round2(nowPct), target });
  }
  if (alerts.length) {
    const list = alerts.map((a) => `${a.name} (${a.was}% → ${a.now}%, target ${a.target}%)`).join('; ');
    // Costs and margins go to those who may see them, not to every member of staff.
    const managers = await prisma.user.findMany({
      where: { restaurantId, status: 'ACTIVE', role: { name: { in: COST_ROLES } }, OR: [{ branchId: null }, ...(branchId ? [{ branchId }] : [])] },
      select: { id: true },
    });
    await Promise.all(managers.map((u) => createNotification({
      restaurantId, branchId, userId: u.id, type: 'MARGIN_ALERT', title: 'Dishes over their food-cost target',
      message: `Ingredient prices went up. Now over target: ${list}. Review prices or portions in Inventory → Food Cost.`, referenceType: 'FOOD_COST',
    }))).catch((err) => console.error('Margin alert notification failed:', err));
  }
  return alerts;
}

export const QUICK_PURCHASE_PAID_FROM = ['TILL_CASH', 'MPESA', 'OTHER'] as const;
