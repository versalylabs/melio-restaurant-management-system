import { Prisma } from '@prisma/client';
import { Response } from 'express';
import prisma from '../config/database';
import { AuthRequest } from '../middleware/auth';
import { sendError, sendResponse } from '../utils/response';
import { convertQuantity } from '../utils/units';
import { createAuditLog } from './auditLogService';
import { alertMarginChanges, COST_ROLES, QUICK_PURCHASE_PAID_FROM, recordIngredientPrice } from './foodCostService';

type Tx = Prisma.TransactionClient;

/** Only these approve their own purchases (the same people who approve expenses). */
const APPROVER_ROLES = ['OWNER', 'ADMIN', 'MANAGER'];
const MAX_QUANTITY = 100_000;
const MAX_TOTAL = 10_000_000;
/** A price this many times higher or lower than last time is probably a typo: ask first. */
const PRICE_JUMP_FACTOR = 5;
const round2 = (n: number) => Math.round(n * 100) / 100;
const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

/**
 * POST /inventory/quick-purchase
 * { ingredientId, quantity, unit?, totalPaid, paidFrom: TILL_CASH | MPESA | OTHER, vendor?, notes?, clientRequestId?, confirmPriceJump? }
 *
 * One step for a market run: the stock goes up, the price paid is recorded
 * (and becomes the ingredient's cost), and the money is recorded as an
 * expense. Cash taken from the till is tied to the buyer's open shift, so it
 * comes off their expected cash straight away (even before a manager approves
 * it); if the manager rejects it, the purchase is reversed.
 */
export async function createQuickPurchase(req: AuthRequest, res: Response) {
  const restaurantId = req.user!.restaurantId;
  // Staff tied to a branch buy for it; owners and admins name the branch.
  let branchId = req.user!.branchId || null;
  if (!branchId && typeof req.body?.branchId === 'string' && req.body.branchId) {
    const branch = await prisma.branch.findFirst({ where: { id: req.body.branchId, restaurantId }, select: { id: true } });
    branchId = branch?.id || null;
  }
  if (!branchId) return sendError(res, 'Choose your branch before recording a purchase');

  const { ingredientId, notes } = req.body || {};
  const quantity = Number(req.body?.quantity);
  const totalPaid = Number(req.body?.totalPaid);
  const paidFrom = String(req.body?.paidFrom || 'TILL_CASH');
  const vendor = typeof req.body?.vendor === 'string' ? req.body.vendor.trim().slice(0, 120) : '';
  const requestId = typeof req.body?.clientRequestId === 'string' ? req.body.clientRequestId.trim().slice(0, 64) : '';
  if (typeof ingredientId !== 'string' || !ingredientId) return sendError(res, 'Choose what you bought');
  if (!Number.isFinite(quantity) || quantity <= 0 || quantity > MAX_QUANTITY) return sendError(res, 'Enter how much you bought');
  if (!Number.isFinite(totalPaid) || totalPaid <= 0 || totalPaid > MAX_TOTAL) return sendError(res, 'Enter how much you paid in total');
  if (!(QUICK_PURCHASE_PAID_FROM as readonly string[]).includes(paidFrom)) return sendError(res, 'Choose how it was paid');

  // A retry of the same purchase (dropped network at the market) returns the first one.
  const reference = requestId ? `QP:${requestId}` : null;
  if (reference) {
    const already = await prisma.expense.findFirst({ where: { restaurantId, reference }, select: { id: true, status: true } });
    if (already) return sendResponse(res, true, 'Purchase already recorded', { expenseId: already.id, expenseStatus: already.status, duplicate: true }, 200);
  }

  const ingredient = await prisma.ingredient.findFirst({ where: { id: ingredientId, restaurantId, status: 'ACTIVE' } });
  if (!ingredient) return sendError(res, 'Ingredient not found', undefined, 404);
  const unit = typeof req.body?.unit === 'string' && req.body.unit.trim() ? req.body.unit.trim() : ingredient.unit;

  // A price far from the last one is usually swapped fields or a missing zero.
  const inIngredientUnit = convertQuantity(quantity, unit, ingredient.unit);
  if (inIngredientUnit && ingredient.costPerUnit > 0 && req.body?.confirmPriceJump !== true) {
    const newCost = totalPaid / inIngredientUnit;
    const ratio = newCost / ingredient.costPerUnit;
    if (ratio > PRICE_JUMP_FACTOR || ratio < 1 / PRICE_JUMP_FACTOR) {
      return sendError(res, `That works out to KES ${round2(newCost).toLocaleString()} per ${ingredient.unit}, against KES ${round2(ingredient.costPerUnit).toLocaleString()} last time. Check the amount and total, or confirm it is right.`, { price: ['PRICE_CHECK'] }, 409);
    }
  }

  const shift = await prisma.shift.findFirst({ where: { restaurantId, branchId, userId: req.user!.id, status: 'OPEN' }, select: { id: true } });
  if (paidFrom === 'TILL_CASH' && !shift) return sendError(res, 'Open your shift first: cash taken from the till is recorded against it');

  const result = await prisma.$transaction(async (tx) => {
    // Make sure the stock row exists, then lock it, so a sale deducting at the same moment isn't lost.
    await tx.inventoryStock.upsert({
      where: { branchId_ingredientId: { branchId: branchId!, ingredientId } },
      create: { restaurantId, branchId: branchId!, ingredientId, quantity: 0, unit: ingredient.unit, costPerUnit: 0 },
      update: {},
    });
    await tx.$queryRaw`SELECT "id" FROM "inventory_stocks" WHERE "branchId" = ${branchId} AND "ingredientId" = ${ingredientId} FOR UPDATE`;
    const stock = (await tx.inventoryStock.findUnique({ where: { branchId_ingredientId: { branchId: branchId!, ingredientId } } }))!;
    const added = convertQuantity(quantity, unit, stock.unit);
    if (added === null) throw new Error(`UNIT:${unit}:${stock.unit}`);
    const unitCostInStockUnit = totalPaid / added;

    // Weighted average cost; stock below zero or with no cost yet doesn't dilute it.
    const valued = stock.costPerUnit > 0 ? Math.max(0, stock.quantity) : 0;
    const newCost = (valued * stock.costPerUnit + added * unitCostInStockUnit) / (valued + added);
    await tx.inventoryStock.update({
      where: { id: stock.id },
      data: { quantity: { increment: added }, costPerUnit: round6(newCost), lastRestockedAt: new Date() },
    });

    const approved = APPROVER_ROLES.includes(req.user!.roleName);
    const expense = await tx.expense.create({
      data: {
        restaurantId,
        branchId: branchId!,
        shiftId: shift?.id,
        category: 'Food purchases',
        description: `${quantity} ${unit} ${ingredient.name}`,
        amount: round2(totalPaid),
        paymentMethod: paidFrom === 'TILL_CASH' ? 'CASH' : paidFrom === 'MPESA' ? 'MOBILE_MONEY' : 'OTHER',
        vendor: vendor || undefined,
        reference: reference || undefined,
        notes: typeof notes === 'string' && notes.trim() ? notes.trim().slice(0, 500) : 'Quick purchase',
        status: approved ? 'APPROVED' : 'PENDING',
        createdBy: req.user!.id,
        ...(approved ? { approvedBy: req.user!.id, approvedAt: new Date() } : {}),
      },
    });

    await tx.stockMovement.create({
      data: {
        restaurantId, branchId: branchId!, ingredientId, quantity: added, unit: stock.unit, type: 'PURCHASE',
        reason: `Quick purchase${vendor ? ` from ${vendor}` : ''}`, referenceId: expense.id, referenceType: 'QuickPurchase', userId: req.user!.id,
      },
    });

    const priceChange = await recordIngredientPrice(tx, {
      restaurantId, branchId, ingredientId, vendor, quantity, unit, totalPaid, source: 'QUICK_PURCHASE', referenceId: expense.id, recordedBy: req.user!.id,
    });
    return { expense, priceChange, added, stockUnit: stock.unit };
  }).catch((err: any) => {
    if (typeof err?.message === 'string' && err.message.startsWith('UNIT:')) {
      const [, from, to] = err.message.split(':');
      return { unitError: `"${from}" can't be converted to "${to}", the unit this stock is counted in. Enter the amount in ${to}.` } as const;
    }
    throw err;
  });
  if ('unitError' in result) return sendError(res, result.unitError as string);

  // Saved: nothing after this point may turn the reply into an error (the buyer would record it twice).
  const alerts = await alertMarginChanges(restaurantId, branchId, [result.priceChange]).catch((err) => {
    console.error('Margin alert failed:', err);
    return [];
  });
  await createAuditLog(restaurantId, req.user!.id, 'CREATE', 'QuickPurchase', result.expense.id,
    `Bought ${quantity} ${unit} ${ingredient.name} for KES ${round2(totalPaid).toLocaleString()} (${paidFrom.replace('_', ' ').toLowerCase()})`).catch(() => {});

  // Costs and margins are for those who may see costs.
  const seesCosts = COST_ROLES.includes(req.user!.roleName);
  const previous = result.priceChange?.previousCost ?? null;
  const now = result.priceChange?.newCost ?? null;
  return sendResponse(res, true, 'Purchase recorded', {
    expenseId: result.expense.id,
    expenseStatus: result.expense.status,
    stockAdded: result.added,
    stockUnit: result.stockUnit,
    priceChange: seesCosts && previous !== null && now !== null ? { previous, now, unit: ingredient.unit, changePct: previous > 0 ? round2(((now - previous) / previous) * 100) : null } : null,
    marginAlerts: seesCosts ? alerts : [],
  }, 201);
}

/** Is this expense the money side of a quick purchase? */
export async function quickPurchaseMovement(tx: Tx | typeof prisma, expenseId: string) {
  return tx.stockMovement.findFirst({ where: { referenceType: 'QuickPurchase', referenceId: expenseId, type: 'PURCHASE' } });
}

/**
 * A rejected quick purchase is undone: the stock comes back out and, unless a
 * newer purchase has set the price since, the ingredient returns to its old cost.
 */
export async function reverseQuickPurchase(tx: Tx, expenseId: string, userId: string) {
  const movement = await quickPurchaseMovement(tx, expenseId);
  if (!movement) return false;
  await tx.$queryRaw`SELECT "id" FROM "inventory_stocks" WHERE "branchId" = ${movement.branchId} AND "ingredientId" = ${movement.ingredientId} FOR UPDATE`;
  await tx.inventoryStock.updateMany({
    where: { branchId: movement.branchId, ingredientId: movement.ingredientId },
    data: { quantity: { decrement: movement.quantity } },
  });
  await tx.stockMovement.create({
    data: {
      restaurantId: movement.restaurantId, branchId: movement.branchId, ingredientId: movement.ingredientId,
      quantity: -movement.quantity, unit: movement.unit, type: 'ADJUSTMENT', reason: 'Quick purchase rejected',
      referenceId: expenseId, referenceType: 'QuickPurchase', userId,
    },
  });
  const entry = await tx.ingredientPriceHistory.findFirst({ where: { referenceId: expenseId, source: 'QUICK_PURCHASE', reversedAt: null } });
  if (entry) {
    await tx.ingredientPriceHistory.update({ where: { id: entry.id }, data: { reversedAt: new Date() } });
    const newer = await tx.ingredientPriceHistory.count({ where: { ingredientId: entry.ingredientId, createdAt: { gt: entry.createdAt }, reversedAt: null } });
    if (!newer && entry.previousUnitCost != null) {
      await tx.ingredient.update({ where: { id: entry.ingredientId }, data: { costPerUnit: entry.previousUnitCost } });
    }
  }
  return true;
}

/** GET /inventory/ingredients/:id/price-history — what was paid, most recent first. */
export async function getIngredientPriceHistory(req: AuthRequest, res: Response) {
  if (!COST_ROLES.includes(req.user!.roleName)) return sendError(res, 'Only managers can see ingredient prices', undefined, 403);
  const ingredient = await prisma.ingredient.findFirst({ where: { id: req.params.id, restaurantId: req.user!.restaurantId }, select: { id: true, name: true, unit: true, costPerUnit: true } });
  if (!ingredient) return sendError(res, 'Ingredient not found', undefined, 404);
  const history = await prisma.ingredientPriceHistory.findMany({
    where: { ingredientId: ingredient.id, restaurantId: req.user!.restaurantId, reversedAt: null },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  const userIds = [...new Set(history.map((h) => h.recordedBy))];
  const users = userIds.length ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, firstName: true, lastName: true } }) : [];
  const name = new Map(users.map((u) => [u.id, `${u.firstName} ${u.lastName}`.trim()]));
  return sendResponse(res, true, 'Price history', {
    ingredient,
    history: history.map((h) => ({ ...h, recordedByName: name.get(h.recordedBy) || null })),
  });
}
