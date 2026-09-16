import prisma from '../config/database';
import { AuthRequest } from '../middleware/auth';
import { sendResponse, sendError } from '../utils/response';
import { Response as ExpressResponse } from 'express';
import { createAuditLog } from './auditLogService';

const COST_ROLES = ['OWNER', 'ADMIN', 'MANAGER', 'INVENTORY_MANAGER'];

export const getIngredientCategories = async (req: AuthRequest, res: ExpressResponse) => {
  const restaurantId = req.user!.restaurantId;
  const { search, status } = req.query;

  const where: any = { restaurantId };
  if (search) {
    where.name = { contains: search as string };
  }
  if (status) {
    where.status = status as string;
  }

  const categories = await prisma.ingredientCategory.findMany({
    where,
    include: { _count: { select: { ingredients: true } } },
    orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
  });

  return sendResponse(res, true, 'Ingredient categories retrieved', {
    categories: categories.map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description,
      displayOrder: c.displayOrder,
      status: c.status,
      ingredientCount: c._count.ingredients,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    })),
  });
};

export const createIngredientCategory = async (req: AuthRequest, res: ExpressResponse) => {
  const { name, description, displayOrder, status } = req.body;
  const restaurantId = req.user!.restaurantId;

  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return sendError(res, 'Name is required');
  }

  const category = await prisma.ingredientCategory.create({
    data: {
      restaurantId,
      name: name.trim(),
      description,
      displayOrder: displayOrder ?? 0,
      status: status || 'ACTIVE',
    },
  });

  await createAuditLog(
    restaurantId,
    req.user!.id,
    'CREATE',
    'IngredientCategory',
    category.id,
    `Created ingredient category ${category.name}`
  );

  return sendResponse(res, true, 'Ingredient category created successfully', category, 201);
};

export const updateIngredientCategory = async (req: AuthRequest, res: ExpressResponse) => {
  const { id } = req.params;
  const { name, description, displayOrder, status } = req.body;
  const restaurantId = req.user!.restaurantId;

  const existing = await prisma.ingredientCategory.findFirst({ where: { id, restaurantId } });
  if (!existing) {
    return sendError(res, 'Ingredient category not found', undefined, 404);
  }

  const category = await prisma.ingredientCategory.update({
    where: { id },
    data: { name, description, displayOrder, status },
  });

  await createAuditLog(
    restaurantId,
    req.user!.id,
    'UPDATE',
    'IngredientCategory',
    id,
    `Updated ingredient category ${category.name}`
  );

  return sendResponse(res, true, 'Ingredient category updated successfully', category);
};

export const deleteIngredientCategory = async (req: AuthRequest, res: ExpressResponse) => {
  const { id } = req.params;
  const restaurantId = req.user!.restaurantId;

  const existing = await prisma.ingredientCategory.findFirst({ where: { id, restaurantId } });
  if (!existing) {
    return sendError(res, 'Ingredient category not found', undefined, 404);
  }

  const activeIngredients = await prisma.ingredient.count({
    where: { categoryId: id, restaurantId, status: 'ACTIVE' },
  });
  if (activeIngredients > 0) {
    return sendError(
      res,
      `Cannot deactivate: ${activeIngredients} active ingredient(s) are using this category`
    );
  }

  await prisma.ingredientCategory.update({ where: { id }, data: { status: 'INACTIVE' } });

  await createAuditLog(
    restaurantId,
    req.user!.id,
    'DELETE',
    'IngredientCategory',
    id,
    `Deactivated ingredient category ${existing.name}`
  );

  return sendResponse(res, true, 'Ingredient category deactivated successfully');
};

export const getIngredients = async (req: AuthRequest, res: ExpressResponse) => {
  const restaurantId = req.user!.restaurantId;
  const {
    search,
    categoryId,
    status,
    available,
    branchId,
    page = '1',
    limit = '20',
  } = req.query;

  const skip = (parseInt(page as string) - 1) * parseInt(limit as string);

  const where: any = { restaurantId };
  if (search) {
    where.OR = [
      { name: { contains: search as string } },
      { code: { contains: search as string } },
    ];
  }
  if (categoryId) where.categoryId = categoryId as string;
  if (status) where.status = status as string;
  if (available !== undefined) where.available = available === 'true';

  const [items, total] = await Promise.all([
    prisma.ingredient.findMany({
      where,
      skip,
      take: parseInt(limit as string),
      orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
      include: {
        category: { select: { id: true, name: true } },
        stocks: branchId
          ? { where: { branchId: branchId as string } }
          : true,
      },
    }),
    prisma.ingredient.count({ where }),
  ]);

  const showCost = COST_ROLES.includes(req.user!.roleName);

  return sendResponse(res, true, 'Ingredients retrieved', {
    items: items.map((i) => ({
      id: i.id,
      name: i.name,
      code: i.code,
      description: i.description,
      unit: i.unit,
      costPerUnit: showCost ? i.costPerUnit : undefined,
      minStockLevel: i.minStockLevel,
      reorderLevel: i.reorderLevel,
      status: i.status,
      available: i.available,
      displayOrder: i.displayOrder,
      categoryId: i.categoryId,
      categoryName: i.category.name,
      stocks: i.stocks.map((s: any) => ({
        id: s.id,
        branchId: s.branchId,
        quantity: s.quantity,
        unit: s.unit,
        minStockLevel: s.minStockLevel,
        reorderLevel: s.reorderLevel,
        lastRestockedAt: s.lastRestockedAt,
      })),
      createdAt: i.createdAt,
      updatedAt: i.updatedAt,
    })),
    pagination: {
      page: parseInt(page as string),
      limit: parseInt(limit as string),
      total,
      totalPages: Math.ceil(total / parseInt(limit as string)),
    },
  });
};

export const getIngredient = async (req: AuthRequest, res: ExpressResponse) => {
  const { id } = req.params;
  const restaurantId = req.user!.restaurantId;

  const ingredient = await prisma.ingredient.findFirst({
    where: { id, restaurantId },
    include: {
      category: { select: { id: true, name: true } },
      stocks: { include: { branch: { select: { id: true, name: true, code: true } } } },
    },
  });

  if (!ingredient) {
    return sendError(res, 'Ingredient not found', undefined, 404);
  }

  const showCost = COST_ROLES.includes(req.user!.roleName);

  return sendResponse(res, true, 'Ingredient retrieved', {
    ...ingredient,
    costPerUnit: showCost ? ingredient.costPerUnit : undefined,
    stocks: ingredient.stocks.map((s: any) => ({
      ...s,
      costPerUnit: showCost ? s.costPerUnit : undefined,
    })),
  });
};

export const createIngredient = async (req: AuthRequest, res: ExpressResponse) => {
  const {
    name,
    code,
    description,
    unit,
    costPerUnit,
    minStockLevel,
    reorderLevel,
    categoryId,
    available,
    status,
    displayOrder,
  } = req.body;
  const restaurantId = req.user!.restaurantId;

  if (!name || typeof name !== 'string') {
    return sendError(res, 'Name is required');
  }
  if (!categoryId) {
    return sendError(res, 'Category is required');
  }

  const category = await prisma.ingredientCategory.findFirst({
    where: { id: categoryId, restaurantId, status: 'ACTIVE' },
  });
  if (!category) {
    return sendError(res, 'Invalid ingredient category');
  }

  if (code) {
    const existingCode = await prisma.ingredient.findFirst({
      where: { restaurantId, code },
    });
    if (existingCode) {
      return sendError(res, 'Ingredient code already in use');
    }
  }

  const ingredient = await prisma.ingredient.create({
    data: {
      restaurantId,
      name,
      code,
      description,
      unit: unit || 'pieces',
      costPerUnit: costPerUnit ?? 0,
      minStockLevel: minStockLevel ?? 0,
      reorderLevel: reorderLevel ?? 0,
      categoryId,
      available: available ?? true,
      status: status || 'ACTIVE',
      displayOrder: displayOrder ?? 0,
    },
  });

  await createAuditLog(
    restaurantId,
    req.user!.id,
    'CREATE',
    'Ingredient',
    ingredient.id,
    `Created ingredient ${ingredient.name}`
  );

  return sendResponse(res, true, 'Ingredient created successfully', ingredient, 201);
};

export const updateIngredient = async (req: AuthRequest, res: ExpressResponse) => {
  const { id } = req.params;
  const {
    name,
    code,
    description,
    unit,
    costPerUnit,
    minStockLevel,
    reorderLevel,
    categoryId,
    available,
    status,
    displayOrder,
  } = req.body;
  const restaurantId = req.user!.restaurantId;

  const existing = await prisma.ingredient.findFirst({ where: { id, restaurantId } });
  if (!existing) {
    return sendError(res, 'Ingredient not found', undefined, 404);
  }

  if (categoryId && categoryId !== existing.categoryId) {
    const category = await prisma.ingredientCategory.findFirst({
      where: { id: categoryId, restaurantId },
    });
    if (!category) {
      return sendError(res, 'Invalid ingredient category');
    }
  }

  if (code && code !== existing.code) {
    const dup = await prisma.ingredient.findFirst({ where: { restaurantId, code } });
    if (dup) {
      return sendError(res, 'Ingredient code already in use');
    }
  }

  const updated = await prisma.ingredient.update({
    where: { id },
    data: {
      name,
      code,
      description,
      unit,
      costPerUnit,
      minStockLevel,
      reorderLevel,
      categoryId,
      available,
      status,
      displayOrder,
    },
  });

  await createAuditLog(
    restaurantId,
    req.user!.id,
    'UPDATE',
    'Ingredient',
    id,
    `Updated ingredient ${updated.name}`
  );

  return sendResponse(res, true, 'Ingredient updated successfully', updated);
};

export const deleteIngredient = async (req: AuthRequest, res: ExpressResponse) => {
  const { id } = req.params;
  const restaurantId = req.user!.restaurantId;

  const existing = await prisma.ingredient.findFirst({ where: { id, restaurantId } });
  if (!existing) {
    return sendError(res, 'Ingredient not found', undefined, 404);
  }

  const historicalMovements = await prisma.stockMovement.count({
    where: { ingredientId: id, restaurantId },
  });
  const historicalRecipes = await prisma.recipeIngredient.count({
    where: { ingredientId: id },
  });

  if (historicalMovements > 0 || historicalRecipes > 0) {
    await prisma.ingredient.update({
      where: { id },
      data: { status: 'INACTIVE', available: false },
    });
    await createAuditLog(
      restaurantId,
      req.user!.id,
      'DELETE',
      'Ingredient',
      id,
      `Deactivated ingredient ${existing.name} (has historical records)`
    );
    return sendResponse(res, true, 'Ingredient deactivated successfully');
  }

  await prisma.ingredient.delete({ where: { id } });
  await createAuditLog(
    restaurantId,
    req.user!.id,
    'DELETE',
    'Ingredient',
    id,
    `Deleted ingredient ${existing.name}`
  );

  return sendResponse(res, true, 'Ingredient deleted successfully');
};

export const getInventoryStock = async (req: AuthRequest, res: ExpressResponse) => {
  const restaurantId = req.user!.restaurantId;
  const requestedBranchId = typeof req.query.branchId === 'string' ? req.query.branchId : undefined;
  const branchId = req.user!.branchId || requestedBranchId;
  const { lowStock, outOfStock, page = '1', limit = '20' } = req.query;

  const where: any = { restaurantId, ...(branchId ? { branchId } : {}) };

  const all = await prisma.inventoryStock.findMany({
    where,
    include: {
      ingredient: {
        include: { category: { select: { id: true, name: true } } },
      },
      branch: { select: { id: true, name: true, code: true } },
    },
    orderBy: { updatedAt: 'desc' },
  });

  let filtered = all;
  if (lowStock === 'true') {
    filtered = filtered.filter((s) => s.quantity > 0 && s.quantity <= s.minStockLevel);
  }
  if (outOfStock === 'true') {
    filtered = filtered.filter((s) => s.quantity <= 0);
  }

  const total = filtered.length;
  const skip = (parseInt(page as string) - 1) * parseInt(limit as string);
  const paged = filtered.slice(skip, skip + parseInt(limit as string));

  const showCost = COST_ROLES.includes(req.user!.roleName);

  return sendResponse(res, true, 'Inventory stock retrieved', {
    items: paged.map((s) => ({
      id: s.id,
      branchId: s.branchId,
      branchName: s.branch.name,
      ingredientId: s.ingredientId,
      ingredientName: s.ingredient.name,
      ingredientCode: s.ingredient.code,
      categoryName: s.ingredient.category.name,
      unit: s.unit,
      quantity: s.quantity,
      costPerUnit: showCost ? s.costPerUnit : undefined,
      minStockLevel: s.minStockLevel,
      reorderLevel: s.reorderLevel,
      lastRestockedAt: s.lastRestockedAt,
      isLowStock: s.quantity > 0 && s.quantity <= s.minStockLevel,
      isOutOfStock: s.quantity <= 0,
      updatedAt: s.updatedAt,
    })),
    pagination: {
      page: parseInt(page as string),
      limit: parseInt(limit as string),
      total,
      totalPages: Math.ceil(total / parseInt(limit as string)),
    },
  });
};

export const getStockLevel = async (req: AuthRequest, res: ExpressResponse) => {
  const { id } = req.params;
  const restaurantId = req.user!.restaurantId;

  const stock = await prisma.inventoryStock.findFirst({
    where: { id, restaurantId },
    include: {
      ingredient: { include: { category: true } },
      branch: true,
    },
  });

  if (!stock) {
    return sendError(res, 'Stock level not found', undefined, 404);
  }

  const showCost = COST_ROLES.includes(req.user!.roleName);

  return sendResponse(res, true, 'Stock level retrieved', {
    ...stock,
    costPerUnit: showCost ? stock.costPerUnit : undefined,
  });
};

export const updateStockLevel = async (req: AuthRequest, res: ExpressResponse) => {
  const { id } = req.params;
  const { costPerUnit, minStockLevel, reorderLevel, unit } = req.body;
  const restaurantId = req.user!.restaurantId;

  const existing = await prisma.inventoryStock.findFirst({ where: { id, restaurantId } });
  if (!existing) {
    return sendError(res, 'Stock level not found', undefined, 404);
  }

  const updated = await prisma.inventoryStock.update({
    where: { id },
    data: {
      costPerUnit,
      minStockLevel,
      reorderLevel,
      unit,
    },
  });

  await createAuditLog(
    restaurantId,
    req.user!.id,
    'UPDATE',
    'InventoryStock',
    id,
    `Updated stock level for ${existing.ingredientId}`
  );

  return sendResponse(res, true, 'Stock level updated successfully', updated);
};

export const adjustStock = async (req: AuthRequest, res: ExpressResponse) => {
  const { id } = req.params;
  const { quantityChange, type, reason, notes } = req.body;
  const restaurantId = req.user!.restaurantId;
  const userId = req.user!.id;

  if (typeof quantityChange !== 'number' || isNaN(quantityChange)) {
    return sendError(res, 'quantityChange must be a number');
  }
  if (!type || !['ADJUSTMENT', 'PURCHASE', 'WASTAGE', 'RETURN', 'TRANSFER', 'PRODUCTION', 'RESTOCK', 'CONSUMPTION', 'STOCKTAKE'].includes(type)) {
    return sendError(res, 'Invalid movement type');
  }

  type TxResult = { __error?: string; [k: string]: any };

  const result = await prisma.$transaction(async (tx) => {
    const stock = await tx.inventoryStock.findFirst({ where: { id, restaurantId } });
    if (!stock) {
      const r: TxResult = { __error: 'NOT_FOUND' };
      return r;
    }

    const newQuantity = stock.quantity + quantityChange;
    if (newQuantity < 0) {
      const r: TxResult = { __error: 'INSUFFICIENT_STOCK' };
      return r;
    }

    const updatedStock = await tx.inventoryStock.update({
      where: { id },
      data: {
        quantity: newQuantity,
        lastRestockedAt: quantityChange > 0 ? new Date() : stock.lastRestockedAt,
      },
    });

    await tx.stockMovement.create({
      data: {
        restaurantId,
        branchId: stock.branchId,
        ingredientId: stock.ingredientId,
        quantity: quantityChange,
        unit: stock.unit,
        type,
        reason,
        userId,
        notes,
      },
    });

    return updatedStock as unknown as TxResult;
  });

  if ((result as TxResult).__error === 'NOT_FOUND') {
    return sendError(res, 'Stock level not found', undefined, 404);
  }
  if ((result as TxResult).__error === 'INSUFFICIENT_STOCK') {
    return sendError(res, 'Insufficient stock for this adjustment');
  }

  await createAuditLog(
    restaurantId,
    userId,
    'UPDATE',
    'InventoryStock',
    id,
    `Adjusted stock by ${quantityChange} (${type})${reason ? ': ' + reason : ''}`
  );

  return sendResponse(res, true, 'Stock adjusted successfully', result);
};

export const getStockMovements = async (req: AuthRequest, res: ExpressResponse) => {
  const restaurantId = req.user!.restaurantId;
  const requestedBranchId = typeof req.query.branchId === 'string' ? req.query.branchId : undefined;
  const branchId = req.user!.branchId || requestedBranchId;
  const {
    ingredientId,
    type,
    startDate,
    endDate,
    page = '1',
    limit = '20',
  } = req.query;

  const where: any = { restaurantId, ...(branchId ? { branchId } : {}) };
  if (ingredientId) where.ingredientId = ingredientId as string;
  if (type) where.type = type as string;
  if (startDate || endDate) {
    where.createdAt = {};
    if (startDate) where.createdAt.gte = new Date(startDate as string);
    if (endDate) where.createdAt.lte = new Date(endDate as string);
  }

  const skip = (parseInt(page as string) - 1) * parseInt(limit as string);

  const [items, total] = await Promise.all([
    prisma.stockMovement.findMany({
      where,
      skip,
      take: parseInt(limit as string),
      orderBy: { createdAt: 'desc' },
      include: {
        ingredient: { select: { id: true, name: true, unit: true } },
        branch: { select: { id: true, name: true } },
        user: { select: { id: true, firstName: true, lastName: true } },
      },
    }),
    prisma.stockMovement.count({ where }),
  ]);

  return sendResponse(res, true, 'Stock movements retrieved', {
    items: items.map((m) => ({
      id: m.id,
      type: m.type,
      quantity: m.quantity,
      unit: m.unit,
      reason: m.reason,
      notes: m.notes,
      referenceId: m.referenceId,
      referenceType: m.referenceType,
      ingredientId: m.ingredientId,
      ingredientName: m.ingredient.name,
      branchId: m.branchId,
      branchName: m.branch.name,
      userId: m.userId,
      userName: `${m.user.firstName} ${m.user.lastName}`,
      createdAt: m.createdAt,
    })),
    pagination: {
      page: parseInt(page as string),
      limit: parseInt(limit as string),
      total,
      totalPages: Math.ceil(total / parseInt(limit as string)),
    },
  });
};
export const getWastageRecords = async (req: AuthRequest, res: ExpressResponse) => {
  const restaurantId = req.user!.restaurantId;
  const requestedBranchId = typeof req.query.branchId === 'string' ? req.query.branchId : undefined;
  const branchId = req.user!.branchId || requestedBranchId;
  const { ingredientId, startDate, endDate, page = '1', limit = '20' } = req.query;

  const where: any = { restaurantId, ...(branchId ? { branchId } : {}) };
  if (ingredientId) where.ingredientId = ingredientId as string;
  if (startDate || endDate) {
    where.createdAt = {};
    if (startDate) where.createdAt.gte = new Date(startDate as string);
    if (endDate) where.createdAt.lte = new Date(endDate as string);
  }

  const skip = (parseInt(page as string) - 1) * parseInt(limit as string);

  const [items, total] = await Promise.all([
    prisma.wastageRecord.findMany({
      where,
      skip,
      take: parseInt(limit as string),
      orderBy: { createdAt: 'desc' },
      include: {
        ingredient: { select: { id: true, name: true } },
        branch: { select: { id: true, name: true } },
        user: { select: { id: true, firstName: true, lastName: true } },
      },
    }),
    prisma.wastageRecord.count({ where }),
  ]);

  return sendResponse(res, true, 'Wastage records retrieved', {
    items: items.map((w) => ({
      id: w.id,
      ingredientId: w.ingredientId,
      ingredientName: w.ingredient.name,
      branchId: w.branchId,
      branchName: w.branch.name,
      quantity: w.quantity,
      unit: w.unit,
      reason: w.reason,
      notes: w.notes,
      userId: w.userId,
      userName: `${w.user.firstName} ${w.user.lastName}`,
      createdAt: w.createdAt,
    })),
    pagination: {
      page: parseInt(page as string),
      limit: parseInt(limit as string),
      total,
      totalPages: Math.ceil(total / parseInt(limit as string)),
    },
  });
};

async function consumeInventoryQuantity(tx: any, params: { restaurantId: string; branchId: string; ingredientId: string; quantity: number; unit: string; type: string; reason?: string; referenceId?: string; referenceType?: string; userId: string; notes?: string; }) {
  const { restaurantId, branchId, ingredientId, quantity, unit, type, reason, referenceId, referenceType, userId, notes } = params;
  const stock = await tx.inventoryStock.findUnique({ where: { branchId_ingredientId: { branchId, ingredientId } } });
  if (!stock || stock.quantity + 0.000001 < quantity) return false;

  let remaining = quantity;
  const batches = await tx.inventoryBatch.findMany({
    where: { restaurantId, branchId, ingredientId, status: 'ACTIVE', quantity: { gt: 0 } },
    orderBy: [{ expiryDate: 'asc' }, { receivedAt: 'asc' }, { createdAt: 'asc' }],
  });

  for (const batch of batches) {
    if (remaining <= 0.000001) break;
    const take = Math.min(batch.quantity, remaining);
    if (take <= 0) continue;
    const newBatchQty = batch.quantity - take;
    await tx.inventoryBatch.update({ where: { id: batch.id }, data: { quantity: newBatchQty, status: newBatchQty <= 0.000001 ? 'DEPLETED' : 'ACTIVE' } });
    await tx.stockMovement.create({
      data: { restaurantId, branchId, ingredientId, quantity: -take, unit, type, reason, referenceId, referenceType, batchId: batch.id, userId, notes },
    });
    remaining -= take;
  }

  // Legacy/unbatched stock can coexist with batches. Consume the remainder from the aggregate.
  if (remaining > 0.000001) {
    await tx.stockMovement.create({
      data: { restaurantId, branchId, ingredientId, quantity: -remaining, unit, type, reason, referenceId, referenceType, userId, notes: notes ? `${notes} (unbatched stock)` : 'Unbatched stock' },
    });
  }

  await tx.inventoryStock.update({ where: { id: stock.id }, data: { quantity: stock.quantity - quantity } });
  return true;
}

export const createWastageRecord = async (req: AuthRequest, res: ExpressResponse) => {
  const { ingredientId, quantity, unit, reason, notes, branchId: reqBranchId } = req.body;
  const restaurantId = req.user!.restaurantId;
  const userId = req.user!.id;

  if (!ingredientId || typeof quantity !== 'number' || quantity <= 0) {
    return sendError(res, 'ingredientId and positive quantity are required');
  }
  if (!reason) {
    return sendError(res, 'Reason is required');
  }

  const ingredient = await prisma.ingredient.findFirst({
    where: { id: ingredientId, restaurantId },
  });
  if (!ingredient) {
    return sendError(res, 'Ingredient not found', undefined, 404);
  }

  const branchId = reqBranchId || req.user!.branchId;
  if (!branchId) {
    return sendError(res, 'Branch is required');
  }

  const branch = await prisma.branch.findFirst({ where: { id: branchId, restaurantId } });
  if (!branch) {
    return sendError(res, 'Branch not found', undefined, 404);
  }

  const wastageUnit = unit || ingredient.unit;

  type WastageResult = { __error?: string; [k: string]: any };

  const result = await prisma.$transaction(async (tx) => {
    const consumed = await consumeInventoryQuantity(tx, {
      restaurantId, branchId, ingredientId, quantity, unit: wastageUnit,
      type: 'WASTAGE', reason, userId, notes,
    });
    if (!consumed) {
      const r: WastageResult = { __error: 'INSUFFICIENT_STOCK' };
      return r;
    }

    const record = await tx.wastageRecord.create({
      data: {
        restaurantId,
        branchId,
        ingredientId,
        quantity,
        unit: wastageUnit,
        reason,
        notes,
        userId,
      },
    });

    return record as unknown as WastageResult;
  });

  if ((result as WastageResult).__error === 'INSUFFICIENT_STOCK') {
    return sendError(res, 'Insufficient stock to record wastage');
  }

  await createAuditLog(
    restaurantId,
    userId,
    'CREATE',
    'WastageRecord',
    result.id,
    `Recorded wastage of ${quantity}${wastageUnit} of ${ingredient.name}: ${reason}`
  );

  return sendResponse(res, true, 'Wastage recorded successfully', result, 201);
};

export const getRecipes = async (req: AuthRequest, res: ExpressResponse) => {
  const restaurantId = req.user!.restaurantId;
  const { search, status, page = '1', limit = '20' } = req.query;

  const where: any = { restaurantId };
  if (status) where.status = status as string;
  if (search) {
    where.OR = [
      { name: { contains: search as string } },
      { menuItem: { name: { contains: search as string } } },
    ];
  }

  const skip = (parseInt(page as string) - 1) * parseInt(limit as string);

  const [items, total] = await Promise.all([
    prisma.recipe.findMany({
      where,
      skip,
      take: parseInt(limit as string),
      orderBy: { createdAt: 'desc' },
      include: {
        menuItem: { select: { id: true, name: true, sellingPrice: true, categoryId: true } },
        _count: { select: { ingredients: true } },
      },
    }),
    prisma.recipe.count({ where }),
  ]);

  return sendResponse(res, true, 'Recipes retrieved', {
    items: items.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      servings: r.servings,
      status: r.status,
      menuItemId: r.menuItemId,
      menuItemName: r.menuItem.name,
      menuItemPrice: r.menuItem.sellingPrice,
      ingredientCount: r._count.ingredients,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    })),
    pagination: {
      page: parseInt(page as string),
      limit: parseInt(limit as string),
      total,
      totalPages: Math.ceil(total / parseInt(limit as string)),
    },
  });
};

export const getRecipe = async (req: AuthRequest, res: ExpressResponse) => {
  const { menuItemId } = req.params;
  const restaurantId = req.user!.restaurantId;

  const recipe = await prisma.recipe.findFirst({
    where: { menuItemId, restaurantId },
    include: {
      menuItem: { select: { id: true, name: true, sellingPrice: true } },
      ingredients: {
        orderBy: { sortOrder: 'asc' },
        include: {
          ingredient: {
            include: { category: { select: { id: true, name: true } } },
          },
        },
      },
    },
  });

  if (!recipe) {
    return sendError(res, 'Recipe not found', undefined, 404);
  }

  return sendResponse(res, true, 'Recipe retrieved', recipe);
};

export const createRecipe = async (req: AuthRequest, res: ExpressResponse) => {
  const { menuItemId, name, description, servings, ingredients } = req.body;
  const restaurantId = req.user!.restaurantId;

  if (!menuItemId) {
    return sendError(res, 'menuItemId is required');
  }

  const menuItem = await prisma.menuItem.findFirst({
    where: { id: menuItemId, restaurantId },
  });
  if (!menuItem) {
    return sendError(res, 'Menu item not found', undefined, 404);
  }

  const existing = await prisma.recipe.findUnique({ where: { menuItemId } });
  if (existing) {
    return sendError(res, 'Recipe already exists for this menu item', undefined, 409);
  }

  if (ingredients && Array.isArray(ingredients) && ingredients.length > 0) {
    const ids = ingredients.map((i: any) => i.ingredientId).filter(Boolean);
    const valid = await prisma.ingredient.findMany({
      where: { id: { in: ids }, restaurantId },
      select: { id: true },
    });
    if (valid.length !== ids.length) {
      return sendError(res, 'One or more ingredients are invalid');
    }
  }

  const recipe = await prisma.recipe.create({
    data: {
      restaurantId,
      menuItemId,
      name: name || menuItem.name,
      description,
      servings: servings ?? 1,
      ingredients: ingredients
        ? {
            create: ingredients.map((i: any) => ({
              ingredientId: i.ingredientId,
              quantity: i.quantity,
              unit: i.unit,
              notes: i.notes,
              sortOrder: i.sortOrder ?? 0,
            })),
          }
        : undefined,
    },
    include: {
      ingredients: { include: { ingredient: true } },
    },
  });

  await createAuditLog(
    restaurantId,
    req.user!.id,
    'CREATE',
    'Recipe',
    recipe.id,
    `Created recipe for menu item ${menuItem.name}`
  );

  return sendResponse(res, true, 'Recipe created successfully', recipe, 201);
};

export const updateRecipe = async (req: AuthRequest, res: ExpressResponse) => {
  const { menuItemId } = req.params;
  const { name, description, servings, status } = req.body;
  const restaurantId = req.user!.restaurantId;

  const existing = await prisma.recipe.findFirst({ where: { menuItemId, restaurantId } });
  if (!existing) {
    return sendError(res, 'Recipe not found', undefined, 404);
  }

  const recipe = await prisma.recipe.update({
    where: { id: existing.id },
    data: { name, description, servings, status },
  });

  await createAuditLog(
    restaurantId,
    req.user!.id,
    'UPDATE',
    'Recipe',
    existing.id,
    `Updated recipe ${existing.name || existing.id}`
  );

  return sendResponse(res, true, 'Recipe updated successfully', recipe);
};

export const deleteRecipe = async (req: AuthRequest, res: ExpressResponse) => {
  const { menuItemId } = req.params;
  const restaurantId = req.user!.restaurantId;

  const existing = await prisma.recipe.findFirst({ where: { menuItemId, restaurantId } });
  if (!existing) {
    return sendError(res, 'Recipe not found', undefined, 404);
  }

  await prisma.recipe.update({
    where: { id: existing.id },
    data: { status: 'INACTIVE' },
  });

  await createAuditLog(
    restaurantId,
    req.user!.id,
    'DELETE',
    'Recipe',
    existing.id,
    `Deactivated recipe ${existing.name || existing.id}`
  );

  return sendResponse(res, true, 'Recipe deactivated successfully');
};

export const getRecipeIngredients = async (req: AuthRequest, res: ExpressResponse) => {
  const { menuItemId } = req.params;
  const restaurantId = req.user!.restaurantId;

  const recipe = await prisma.recipe.findFirst({
    where: { menuItemId, restaurantId },
    include: {
      ingredients: {
        orderBy: { sortOrder: 'asc' },
        include: { ingredient: true },
      },
    },
  });

  if (!recipe) {
    return sendError(res, 'Recipe not found', undefined, 404);
  }

  return sendResponse(res, true, 'Recipe ingredients retrieved', {
    recipeId: recipe.id,
    items: recipe.ingredients,
  });
};

export const addRecipeIngredient = async (req: AuthRequest, res: ExpressResponse) => {
  const { menuItemId } = req.params;
  const { ingredientId, quantity, unit, notes, sortOrder } = req.body;
  const restaurantId = req.user!.restaurantId;

  if (!ingredientId || typeof quantity !== 'number' || quantity <= 0) {
    return sendError(res, 'ingredientId and positive quantity are required');
  }

  const recipe = await prisma.recipe.findFirst({ where: { menuItemId, restaurantId } });
  if (!recipe) {
    return sendError(res, 'Recipe not found', undefined, 404);
  }

  const ingredient = await prisma.ingredient.findFirst({
    where: { id: ingredientId, restaurantId },
  });
  if (!ingredient) {
    return sendError(res, 'Ingredient not found', undefined, 404);
  }

  const dup = await prisma.recipeIngredient.findFirst({
    where: { recipeId: recipe.id, ingredientId },
  });
  if (dup) {
    return sendError(res, 'Ingredient already in recipe', undefined, 409);
  }

  const item = await prisma.recipeIngredient.create({
    data: {
      recipeId: recipe.id,
      ingredientId,
      quantity,
      unit: unit || ingredient.unit,
      notes,
      sortOrder: sortOrder ?? 0,
    },
    include: { ingredient: true },
  });

  await createAuditLog(
    restaurantId,
    req.user!.id,
    'CREATE',
    'RecipeIngredient',
    item.id,
    `Added ${ingredient.name} to recipe ${recipe.name || recipe.id}`
  );

  return sendResponse(res, true, 'Ingredient added to recipe', item, 201);
};

export const updateRecipeIngredient = async (req: AuthRequest, res: ExpressResponse) => {
  const { menuItemId, ingredientId: riId } = req.params;
  const { quantity, unit, notes, sortOrder } = req.body;
  const restaurantId = req.user!.restaurantId;

  const recipe = await prisma.recipe.findFirst({ where: { menuItemId, restaurantId } });
  if (!recipe) {
    return sendError(res, 'Recipe not found', undefined, 404);
  }

  const existing = await prisma.recipeIngredient.findFirst({
    where: { id: riId, recipeId: recipe.id },
  });
  if (!existing) {
    return sendError(res, 'Recipe ingredient not found', undefined, 404);
  }

  const updated = await prisma.recipeIngredient.update({
    where: { id: riId },
    data: {
      quantity: quantity ?? existing.quantity,
      unit: unit ?? existing.unit,
      notes: notes ?? existing.notes,
      sortOrder: sortOrder ?? existing.sortOrder,
    },
  });

  await createAuditLog(
    restaurantId,
    req.user!.id,
    'UPDATE',
    'RecipeIngredient',
    riId,
    `Updated recipe ingredient ${riId}`
  );

  return sendResponse(res, true, 'Recipe ingredient updated successfully', updated);
};

export const removeRecipeIngredient = async (req: AuthRequest, res: ExpressResponse) => {
  const { menuItemId, ingredientId: riId } = req.params;
  const restaurantId = req.user!.restaurantId;

  const recipe = await prisma.recipe.findFirst({ where: { menuItemId, restaurantId } });
  if (!recipe) {
    return sendError(res, 'Recipe not found', undefined, 404);
  }

  const existing = await prisma.recipeIngredient.findFirst({
    where: { id: riId, recipeId: recipe.id },
  });
  if (!existing) {
    return sendError(res, 'Recipe ingredient not found', undefined, 404);
  }

  await prisma.recipeIngredient.delete({ where: { id: riId } });

  await createAuditLog(
    restaurantId,
    req.user!.id,
    'DELETE',
    'RecipeIngredient',
    riId,
    `Removed recipe ingredient ${riId}`
  );

  return sendResponse(res, true, 'Recipe ingredient removed successfully');
};

export const getFoodCost = async (req: AuthRequest, res: ExpressResponse) => {
  const { menuItemId } = req.params;
  const restaurantId = req.user!.restaurantId;

  const menuItem = await prisma.menuItem.findFirst({
    where: { id: menuItemId, restaurantId },
    include: {
      recipe: {
        include: { ingredients: { include: { ingredient: true } } },
      },
    },
  });

  if (!menuItem) {
    return sendError(res, 'Menu item not found', undefined, 404);
  }

  if (!menuItem.recipe) {
    return sendError(res, 'No recipe defined for this menu item', undefined, 404);
  }

  let totalCost = 0;
  const breakdown = menuItem.recipe.ingredients.map((ri) => {
    const cost = ri.quantity * ri.ingredient.costPerUnit;
    totalCost += cost;
    return {
      ingredientId: ri.ingredientId,
      ingredientName: ri.ingredient.name,
      quantity: ri.quantity,
      unit: ri.unit,
      costPerUnit: ri.ingredient.costPerUnit,
      lineCost: cost,
    };
  });

  const servings = menuItem.recipe.servings || 1;
  const costPerServing = totalCost / servings;
  const foodCostPercentage = menuItem.sellingPrice > 0
    ? (costPerServing / menuItem.sellingPrice) * 100
    : 0;
  const grossMargin = menuItem.sellingPrice - costPerServing;
  const grossMarginPercentage = menuItem.sellingPrice > 0
    ? (grossMargin / menuItem.sellingPrice) * 100
    : 0;

  return sendResponse(res, true, 'Food cost calculated', {
    menuItemId: menuItem.id,
    menuItemName: menuItem.name,
    sellingPrice: menuItem.sellingPrice,
    recipeName: menuItem.recipe.name,
    servings,
    totalCost,
    costPerServing,
    foodCostPercentage,
    grossMargin,
    grossMarginPercentage,
    breakdown,
  });
};

export const getInventoryDashboard = async (req: AuthRequest, res: ExpressResponse) => {
  const restaurantId = req.user!.restaurantId;
  const branchId = req.query.branchId as string | undefined;

  const [
    totalIngredients,
    activeIngredients,
    lowStockRows,
    outOfStock,
    stockAgg,
    recentMovements,
    recentWastage,
    pendingPOs,
    pendingApprovals,
    partiallyReceived,
    recentPurchases,
    purchaseAgg,
  ] = await Promise.all([
    prisma.ingredient.count({ where: { restaurantId } }),
    prisma.ingredient.count({ where: { restaurantId, status: 'ACTIVE' } }),
    prisma.inventoryStock.findMany({
      where: {
        restaurantId,
        ...(branchId && { branchId }),
        quantity: { gt: 0 },
      },
      select: {
        id: true,
        quantity: true,
        minStockLevel: true,
        ingredientId: true,
        unit: true,
        ingredient: { select: { name: true } },
        branch: { select: { name: true } },
      },
    }),
    prisma.inventoryStock.count({
      where: {
        restaurantId,
        ...(branchId && { branchId }),
        quantity: { lte: 0 },
      },
    }),
    prisma.inventoryStock.findMany({
      where: {
        restaurantId,
        ...(branchId && { branchId }),
      },
      select: { quantity: true, costPerUnit: true },
    }),
    prisma.stockMovement.findMany({
      where: { restaurantId, ...(branchId && { branchId }) },
      take: 10,
      orderBy: { createdAt: 'desc' },
      include: {
        ingredient: { select: { name: true } },
        branch: { select: { name: true } },
        user: { select: { firstName: true, lastName: true } },
      },
    }),
    prisma.wastageRecord.findMany({
      where: { restaurantId, ...(branchId && { branchId }) },
      take: 10,
      orderBy: { createdAt: 'desc' },
      include: {
        ingredient: { select: { name: true } },
        branch: { select: { name: true } },
      },
    }),
    prisma.purchaseOrder.count({
      where: { restaurantId, status: { in: ['DRAFT', 'SUBMITTED', 'APPROVED'] } },
    }),
    prisma.purchaseOrder.count({
      where: { restaurantId, status: 'SUBMITTED' },
    }),
    prisma.purchaseOrder.count({
      where: { restaurantId, status: 'PARTIALLY_RECEIVED' },
    }),
    prisma.purchaseOrder.findMany({
      where: { restaurantId, status: { in: ['RECEIVED', 'PARTIALLY_RECEIVED'] } },
      take: 5,
      orderBy: { createdAt: 'desc' },
      include: {
        supplier: { select: { name: true } },
        branch: { select: { name: true } },
      },
    }),
    prisma.purchaseOrder.findMany({
      where: {
        restaurantId,
        status: { in: ['RECEIVED', 'PARTIALLY_RECEIVED'] },
      },
      select: { totalAmount: true, status: true },
    }),
  ]);

  const lowStockCount = lowStockRows.filter((s) => s.quantity <= s.minStockLevel).length;
  const stockValue = stockAgg.reduce((sum, s) => sum + s.quantity * s.costPerUnit, 0);

  const showCost = COST_ROLES.includes(req.user!.roleName);
  const purchaseSpending = purchaseAgg.reduce((sum, p) => sum + p.totalAmount, 0);

  return sendResponse(res, true, 'Inventory dashboard retrieved', {
    totalIngredients,
    activeIngredients,
    lowStockCount,
    outOfStockCount: outOfStock,
    totalStockValue: showCost ? stockValue : undefined,
    pendingPurchaseOrders: pendingPOs,
    pendingApprovals,
    partiallyReceivedOrders: partiallyReceived,
    purchaseSpending: showCost ? purchaseSpending : undefined,
    recentPurchases: recentPurchases.map((p) => ({
      id: p.id,
      orderNumber: p.orderNumber,
      supplierName: p.supplier.name,
      branchName: p.branch.name,
      totalAmount: showCost ? p.totalAmount : undefined,
      status: p.status,
      orderDate: p.orderDate,
      receivedAt: p.receivedAt,
    })),
    reorderItems: lowStockRows.filter((s) => s.quantity <= s.minStockLevel).map((s) => ({
      id: s.id,
      ingredientId: s.ingredientId,
      ingredientName: s.ingredient.name,
      branchName: s.branch.name,
      unit: s.unit,
      stockStatus: s.quantity <= 0 ? 'OUT_OF_STOCK' : 'LOW_STOCK',
      quantity: s.quantity,
      reorderLevel: s.minStockLevel,
    })),
    recentMovements: recentMovements.map((m) => ({
      id: m.id,
      type: m.type,
      quantity: m.quantity,
      unit: m.unit,
      ingredientName: m.ingredient.name,
      branchName: m.branch.name,
      userName: `${m.user.firstName} ${m.user.lastName}`,
      reason: m.reason,
      createdAt: m.createdAt,
    })),
    recentWastage: recentWastage.map((w) => ({
      id: w.id,
      ingredientName: w.ingredient.name,
      branchName: w.branch.name,
      quantity: w.quantity,
      unit: w.unit,
      reason: w.reason,
      notes: w.notes,
      createdAt: w.createdAt,
    })),
  });
};

export const getSuppliers = async (req: AuthRequest, res: ExpressResponse) => {
  const restaurantId = req.user!.restaurantId;
  const { search, status, page = '1', limit = '20' } = req.query;

  const where: any = { restaurantId };
  if (search) {
    where.OR = [
      { name: { contains: search as string } },
      { contactName: { contains: search as string } },
      { email: { contains: search as string } },
    ];
  }
  if (status) where.status = status as string;

  const skip = (parseInt(page as string) - 1) * parseInt(limit as string);

  const [items, total] = await Promise.all([
    prisma.supplier.findMany({
      where,
      skip,
      take: parseInt(limit as string),
      orderBy: { name: 'asc' },
      include: { _count: { select: { purchaseOrders: true, supplierIngredients: true } } },
    }),
    prisma.supplier.count({ where }),
  ]);

  return sendResponse(res, true, 'Suppliers retrieved', {
    items: items.map((s) => ({
      id: s.id,
      name: s.name,
      contactName: s.contactName,
      email: s.email,
      phone: s.phone,
      address: s.address,
      city: s.city,
      taxNumber: s.taxNumber,
      businessRegNumber: s.businessRegNumber,
      notes: s.notes,
      status: s.status,
      purchaseOrderCount: s._count.purchaseOrders,
      supplierIngredientCount: s._count.supplierIngredients,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    })),
    pagination: {
      page: parseInt(page as string),
      limit: parseInt(limit as string),
      total,
      totalPages: Math.ceil(total / parseInt(limit as string)),
    },
  });
};

export const getSupplier = async (req: AuthRequest, res: ExpressResponse) => {
  const { id } = req.params;
  const restaurantId = req.user!.restaurantId;

  const supplier = await prisma.supplier.findFirst({
    where: { id, restaurantId },
    include: {
      supplierIngredients: { include: { ingredient: { select: { id: true, name: true, unit: true } } } },
      _count: { select: { purchaseOrders: true } },
    },
  });

  if (!supplier) {
    return sendError(res, 'Supplier not found', undefined, 404);
  }

  return sendResponse(res, true, 'Supplier retrieved', supplier);
};

export const createSupplier = async (req: AuthRequest, res: ExpressResponse) => {
  const { name, contactName, email, phone, address, city, taxNumber, businessRegNumber, notes, status } = req.body;
  const restaurantId = req.user!.restaurantId;

  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return sendError(res, 'Name is required');
  }

  const supplier = await prisma.supplier.create({
    data: {
      restaurantId,
      name: name.trim(),
      contactName,
      email,
      phone,
      address,
      city,
      taxNumber,
      businessRegNumber,
      notes,
      status: status || 'ACTIVE',
    },
  });

  await createAuditLog(
    restaurantId,
    req.user!.id,
    'CREATE',
    'Supplier',
    supplier.id,
    `Created supplier ${supplier.name}`
  );

  return sendResponse(res, true, 'Supplier created successfully', supplier, 201);
};

export const updateSupplier = async (req: AuthRequest, res: ExpressResponse) => {
  const { id } = req.params;
  const { name, contactName, email, phone, address, city, taxNumber, businessRegNumber, notes, status } = req.body;
  const restaurantId = req.user!.restaurantId;

  const existing = await prisma.supplier.findFirst({ where: { id, restaurantId } });
  if (!existing) {
    return sendError(res, 'Supplier not found', undefined, 404);
  }

  const updated = await prisma.supplier.update({
    where: { id },
    data: { name, contactName, email, phone, address, city, taxNumber, businessRegNumber, notes, status },
  });

  await createAuditLog(
    restaurantId,
    req.user!.id,
    'UPDATE',
    'Supplier',
    id,
    `Updated supplier ${updated.name}`
  );

  return sendResponse(res, true, 'Supplier updated successfully', updated);
};

export const deleteSupplier = async (req: AuthRequest, res: ExpressResponse) => {
  const { id } = req.params;
  const restaurantId = req.user!.restaurantId;

  const existing = await prisma.supplier.findFirst({ where: { id, restaurantId } });
  if (!existing) {
    return sendError(res, 'Supplier not found', undefined, 404);
  }

  const poCount = await prisma.purchaseOrder.count({
    where: { supplierId: id, restaurantId },
  });
  if (poCount > 0) {
    return sendError(
      res,
      `Cannot deactivate: supplier has ${poCount} purchase order(s)`
    );
  }

  await prisma.supplier.update({ where: { id }, data: { status: 'INACTIVE' } });

  await createAuditLog(
    restaurantId,
    req.user!.id,
    'DELETE',
    'Supplier',
    id,
    `Deactivated supplier ${existing.name}`
  );

  return sendResponse(res, true, 'Supplier deactivated successfully');
};

export const getPurchaseOrders = async (req: AuthRequest, res: ExpressResponse) => {
  const restaurantId = req.user!.restaurantId;
  const requestedBranchId = typeof req.query.branchId === 'string' ? req.query.branchId : undefined;
  const branchId = req.user!.branchId || requestedBranchId;
  const { supplierId, status, startDate, endDate, page = '1', limit = '20' } = req.query;

  const where: any = { restaurantId, ...(branchId ? { branchId } : {}) };
  if (supplierId) where.supplierId = supplierId as string;
  if (status) where.status = status as string;
  if (startDate || endDate) {
    where.orderDate = {};
    if (startDate) where.orderDate.gte = new Date(startDate as string);
    if (endDate) where.orderDate.lte = new Date(endDate as string);
  }

  const skip = (parseInt(page as string) - 1) * parseInt(limit as string);

  const [items, total] = await Promise.all([
    prisma.purchaseOrder.findMany({
      where,
      skip,
      take: parseInt(limit as string),
      orderBy: { createdAt: 'desc' },
      include: {
        supplier: { select: { id: true, name: true } },
        branch: { select: { id: true, name: true } },
        items: true,
        createdByUser: { select: { id: true, firstName: true, lastName: true } },
      },
    }),
    prisma.purchaseOrder.count({ where }),
  ]);

  const showCost = COST_ROLES.includes(req.user!.roleName);

  return sendResponse(res, true, 'Purchase orders retrieved', {
    items: items.map((po) => ({
      id: po.id,
      orderNumber: po.orderNumber,
      status: po.status,
      subtotal: showCost ? po.subtotal : undefined,
      taxAmount: showCost ? po.taxAmount : undefined,
      discountAmount: showCost ? po.discountAmount : undefined,
      totalAmount: showCost ? po.totalAmount : undefined,
      orderDate: po.orderDate,
      expectedDeliveryDate: po.expectedDeliveryDate,
      notes: po.notes,
      receivedAt: po.receivedAt,
      submittedAt: po.submittedAt,
      approvedAt: po.approvedAt,
      supplierId: po.supplierId,
      supplierName: po.supplier.name,
      branchId: po.branchId,
      branchName: po.branch.name,
      itemCount: po.items.length,
      createdBy: po.createdByUser ? `${po.createdByUser.firstName} ${po.createdByUser.lastName}` : null,
      createdAt: po.createdAt,
      updatedAt: po.updatedAt,
    })),
    pagination: {
      page: parseInt(page as string),
      limit: parseInt(limit as string),
      total,
      totalPages: Math.ceil(total / parseInt(limit as string)),
    },
  });
};

export const getPurchaseOrder = async (req: AuthRequest, res: ExpressResponse) => {
  const { id } = req.params;
  const restaurantId = req.user!.restaurantId;

  const po = await prisma.purchaseOrder.findFirst({
    where: { id, restaurantId },
    include: {
      supplier: true,
      branch: true,
      items: { include: { ingredient: { select: { id: true, name: true, unit: true } } } },
      corrections: true,
      createdByUser: { select: { id: true, firstName: true, lastName: true } },
    },
  });

  if (!po) {
    return sendError(res, 'Purchase order not found', undefined, 404);
  }

  const showCost = COST_ROLES.includes(req.user!.roleName);

  return sendResponse(res, true, 'Purchase order retrieved', {
    ...po,
    subtotal: showCost ? po.subtotal : undefined,
    taxAmount: showCost ? po.taxAmount : undefined,
    discountAmount: showCost ? po.discountAmount : undefined,
    totalAmount: showCost ? po.totalAmount : undefined,
    items: po.items.map((it) => ({
      ...it,
      orderedQuantity: it.orderedQuantity,
      unitPrice: showCost ? it.unitPrice : undefined,
      totalPrice: showCost ? it.totalPrice : undefined,
      tax: showCost ? it.tax : undefined,
      discount: showCost ? it.discount : undefined,
    })),
  });
};

export const createPurchaseOrder = async (req: AuthRequest, res: ExpressResponse) => {
  const { supplierId, orderNumber, notes, expectedDeliveryDate, items } = req.body;
  const restaurantId = req.user!.restaurantId;
  const userId = req.user!.id;
  const branchId = req.user!.branchId || String(req.body?.branchId || '');

  if (!branchId || !supplierId) {
    return sendError(res, 'branchId and supplierId are required');
  }
  if (!items || !Array.isArray(items) || items.length === 0) {
    return sendError(res, 'At least one item is required');
  }

  const branch = await prisma.branch.findFirst({ where: { id: branchId, restaurantId } });
  if (!branch) return sendError(res, 'Branch not found', undefined, 404);

  const supplier = await prisma.supplier.findFirst({ where: { id: supplierId, restaurantId } });
  if (!supplier) return sendError(res, 'Supplier not found', undefined, 404);

  const ingredientIds = items.map((i: any) => i.ingredientId).filter(Boolean);
  const validIngredients = await prisma.ingredient.findMany({
    where: { id: { in: ingredientIds }, restaurantId },
    select: { id: true },
  });
  if (validIngredients.length !== ingredientIds.length) {
    return sendError(res, 'One or more ingredient IDs are invalid');
  }

  const finalOrderNumber = orderNumber || `PO-${Date.now()}`;

  let subtotal = 0;
  let taxAmount = 0;
  let discountAmount = 0;
  const lineItems = items.map((i: any) => {
    const qty = i.quantity || 0;
    const price = i.unitPrice || 0;
    const tax = i.tax || 0;
    const discount = i.discount || 0;
    const lineSubtotal = qty * price;
    const lineTotal = lineSubtotal + tax - discount;
    subtotal += lineSubtotal;
    taxAmount += tax;
    discountAmount += discount;
    return {
      ingredientId: i.ingredientId,
      orderedQuantity: qty,
      unit: i.unit || 'pieces',
      unitPrice: price,
      totalPrice: lineTotal,
      tax,
      discount,
      notes: i.notes,
    };
  });
  const totalAmount = subtotal + taxAmount - discountAmount;

  const po = await prisma.purchaseOrder.create({
    data: {
      restaurantId,
      branchId,
      supplierId,
      orderNumber: finalOrderNumber,
      status: 'DRAFT',
      subtotal,
      taxAmount,
      discountAmount,
      totalAmount,
      orderDate: new Date(),
      expectedDeliveryDate: expectedDeliveryDate ? new Date(expectedDeliveryDate) : null,
      notes,
      createdBy: userId,
      items: { create: lineItems },
    },
    include: { items: true, supplier: true, branch: true },
  });

  await createAuditLog(
    restaurantId,
    userId,
    'CREATE',
    'PurchaseOrder',
    po.id,
    `Created purchase order ${po.orderNumber} for ${supplier.name}`
  );

  return sendResponse(res, true, 'Purchase order created successfully', po, 201);
};

export const updatePurchaseOrder = async (req: AuthRequest, res: ExpressResponse) => {
  const { id } = req.params;
  const { notes, expectedDeliveryDate, items } = req.body;
  const restaurantId = req.user!.restaurantId;

  const existing = await prisma.purchaseOrder.findFirst({
    where: { id, restaurantId },
    include: { items: true },
  });
  if (!existing) {
    return sendError(res, 'Purchase order not found', undefined, 404);
  }

  if (!['DRAFT', 'SUBMITTED'].includes(existing.status)) {
    return sendError(res, `Cannot edit a ${existing.status} purchase order`);
  }

  let subtotal = existing.subtotal;
  let taxAmount = existing.taxAmount;
  let discountAmount = existing.discountAmount;
  let totalAmount = existing.totalAmount;
  let itemsData: any = undefined;

  if (items && Array.isArray(items) && items.length > 0) {
    const ingredientIds = items.map((i: any) => i.ingredientId).filter(Boolean);
    const validIngredients = await prisma.ingredient.findMany({
      where: { id: { in: ingredientIds }, restaurantId },
      select: { id: true },
    });
    if (validIngredients.length !== ingredientIds.length) {
      return sendError(res, 'One or more ingredient IDs are invalid');
    }

    subtotal = 0;
    taxAmount = 0;
    discountAmount = 0;
    const lineItems = items.map((i: any) => {
      const qty = i.quantity || 0;
      const price = i.unitPrice || 0;
      const tax = i.tax || 0;
      const discount = i.discount || 0;
      const lineSubtotal = qty * price;
      const lineTotal = lineSubtotal + tax - discount;
      subtotal += lineSubtotal;
      taxAmount += tax;
      discountAmount += discount;
      return {
        ingredientId: i.ingredientId,
        orderedQuantity: qty,
        receivedQuantity: 0,
        unit: i.unit || 'pieces',
        unitPrice: price,
        totalPrice: lineTotal,
        tax,
        discount,
        notes: i.notes,
      };
    });
    totalAmount = subtotal + taxAmount - discountAmount;

    itemsData = {
      deleteMany: {},
      create: lineItems,
    };
  }

  const updated = await prisma.purchaseOrder.update({
    where: { id },
    data: {
      notes,
      expectedDeliveryDate: expectedDeliveryDate ? new Date(expectedDeliveryDate) : existing.expectedDeliveryDate,
      subtotal,
      taxAmount,
      discountAmount,
      totalAmount,
      items: itemsData,
    },
    include: { items: true, supplier: true, branch: true },
  });

  await createAuditLog(
    restaurantId,
    req.user!.id,
    'UPDATE',
    'PurchaseOrder',
    id,
    `Updated purchase order ${existing.orderNumber}`
  );

  return sendResponse(res, true, 'Purchase order updated successfully', updated);
};

export const receivePurchaseOrder = async (req: AuthRequest, res: ExpressResponse) => {
  const { id } = req.params;
  const { items: receiveItems, receivedAt } = req.body;
  const restaurantId = req.user!.restaurantId;
  const userId = req.user!.id;

  if (!receiveItems || !Array.isArray(receiveItems) || receiveItems.length === 0) {
    return sendError(res, 'items array is required with purchaseOrderItemId and receivedQuantity');
  }

  type ReceiveResult = { __error?: string; po?: any };

  const result = await prisma.$transaction(async (tx) => {
    const po = await tx.purchaseOrder.findFirst({
      where: { id, restaurantId },
      include: { items: { include: { ingredient: true } } },
    });

    if (!po) {
      const r: ReceiveResult = { __error: 'NOT_FOUND' };
      return r;
    }
    if (po.status === 'RECEIVED') {
      const r: ReceiveResult = { __error: 'ALREADY_RECEIVED' };
      return r;
    }
    if (po.status === 'CANCELLED') {
      const r: ReceiveResult = { __error: 'CANCELLED' };
      return r;
    }
    if (!['APPROVED', 'PARTIALLY_RECEIVED'].includes(po.status)) {
      const r: ReceiveResult = { __error: 'NOT_APPROVED' };
      return r;
    }

    let anyReceived = false;
    let allReceived = true;
    const receiveTimestamp = receivedAt ? new Date(receivedAt) : new Date();

    for (const ri of receiveItems) {
      const itemId = ri.purchaseOrderItemId;
      const qty = parseFloat(ri.receivedQuantity);
      if (!itemId || isNaN(qty) || qty <= 0) continue;

      const item = po.items.find((i: any) => i.id === itemId);
      if (!item) continue;

      const newReceived = (item.receivedQuantity || 0) + qty;
      if (newReceived > item.orderedQuantity + 0.0001) {
        const r: ReceiveResult = { __error: 'OVER_RECEIVE' };
        return r;
      }

      const existingStock = await tx.inventoryStock.findUnique({
        where: { branchId_ingredientId: { branchId: po.branchId, ingredientId: item.ingredientId } },
      });

      if (existingStock) {
        const newQty = existingStock.quantity + qty;
        const newCost = newQty > 0
          ? ((existingStock.quantity * existingStock.costPerUnit) + (qty * item.unitPrice)) / newQty
          : existingStock.costPerUnit;
        await tx.inventoryStock.update({
          where: { id: existingStock.id },
          data: {
            quantity: newQty,
            costPerUnit: newCost,
            lastRestockedAt: receiveTimestamp,
          },
        });
      } else {
        await tx.inventoryStock.create({
          data: {
            restaurantId,
            branchId: po.branchId,
            ingredientId: item.ingredientId,
            quantity: qty,
            unit: item.unit,
            costPerUnit: item.unitPrice,
            lastRestockedAt: receiveTimestamp,
          },
        });
      }

      const batchNumber = ri.batchNumber || ri.batch || null;
      const expiryDate = ri.expiryDate ? new Date(ri.expiryDate) : null;
      const batch = await tx.inventoryBatch.create({
        data: {
          restaurantId,
          branchId: po.branchId,
          ingredientId: item.ingredientId,
          batchNumber,
          expiryDate,
          quantity: qty,
          unit: item.unit,
          costPerUnit: item.unitPrice,
          receivedAt: receiveTimestamp,
        },
      });

      await tx.stockMovement.create({
        data: {
          restaurantId,
          branchId: po.branchId,
          ingredientId: item.ingredientId,
          quantity: qty,
          unit: item.unit,
          type: 'PURCHASE',
          reason: `Received PO ${po.orderNumber}${item.receivedQuantity > 0 ? ' (partial)' : ''}`,
          referenceId: po.id,
          referenceType: 'PurchaseOrder',
          batchId: batch.id,
          userId,
        },
      });

      await tx.purchaseOrderItem.update({
        where: { id: item.id },
        data: { receivedQuantity: newReceived },
      });

      anyReceived = true;
    }

    if (!anyReceived) {
      const r: ReceiveResult = { __error: 'NO_QUANTITY' };
      return r;
    }

    const refreshed = await tx.purchaseOrder.findUnique({
      where: { id },
      include: { items: true },
    });
    if (refreshed) {
      allReceived = refreshed.items.every((it: any) => (it.receivedQuantity || 0) >= it.orderedQuantity);
    }

    const newStatus = allReceived ? 'RECEIVED' : 'PARTIALLY_RECEIVED';
    const updatedPo = await tx.purchaseOrder.update({
      where: { id },
      data: {
        status: newStatus,
        receivedAt: allReceived ? receiveTimestamp : po.receivedAt,
      },
      include: { items: true, supplier: true, branch: true },
    });

    return { po: updatedPo } as ReceiveResult;
  });

  if (result.__error === 'NOT_FOUND') {
    return sendError(res, 'Purchase order not found', undefined, 404);
  }
  if (result.__error === 'ALREADY_RECEIVED') {
    return sendError(res, 'Purchase order already received', undefined, 409);
  }
  if (result.__error === 'CANCELLED') {
    return sendError(res, 'Cannot receive a cancelled purchase order', undefined, 409);
  }
  if (result.__error === 'NOT_APPROVED') {
    return sendError(res, 'Only approved purchase orders can be received', undefined, 409);
  }
  if (result.__error === 'OVER_RECEIVE') {
    return sendError(res, 'Received quantity exceeds ordered quantity', undefined, 409);
  }
  if (result.__error === 'NO_QUANTITY') {
    return sendError(res, 'No valid items with positive quantity to receive');
  }

  await createAuditLog(
    restaurantId,
    userId,
    'UPDATE',
    'PurchaseOrder',
    id,
    `Received purchase order ${(result.po as any).orderNumber} (status: ${(result.po as any).status})`
  );

  return sendResponse(res, true, 'Purchase order received and stock updated', result.po);
};

export const submitPurchaseOrder = async (req: AuthRequest, res: ExpressResponse) => {
  const { id } = req.params;
  const restaurantId = req.user!.restaurantId;
  const userId = req.user!.id;

  const existing = await prisma.purchaseOrder.findFirst({
    where: { id, restaurantId },
    include: { items: true },
  });
  if (!existing) {
    return sendError(res, 'Purchase order not found', undefined, 404);
  }
  if (existing.status !== 'DRAFT') {
    return sendError(res, `Only DRAFT orders can be submitted (current: ${existing.status})`);
  }
  if (existing.items.length === 0) {
    return sendError(res, 'Cannot submit an empty purchase order');
  }

  const po = await prisma.purchaseOrder.update({
    where: { id },
    data: {
      status: 'SUBMITTED',
      submittedBy: userId,
      submittedAt: new Date(),
    },
    include: { items: true, supplier: true, branch: true },
  });

  await createAuditLog(
    restaurantId,
    userId,
    'UPDATE',
    'PurchaseOrder',
    id,
    `Submitted purchase order ${existing.orderNumber}`
  );

  return sendResponse(res, true, 'Purchase order submitted successfully', po);
};

export const approvePurchaseOrder = async (req: AuthRequest, res: ExpressResponse) => {
  const { id } = req.params;
  const restaurantId = req.user!.restaurantId;
  const userId = req.user!.id;

  const existing = await prisma.purchaseOrder.findFirst({
    where: { id, restaurantId },
    include: { items: true },
  });
  if (!existing) {
    return sendError(res, 'Purchase order not found', undefined, 404);
  }
  if (existing.status !== 'SUBMITTED') {
    return sendError(res, `Only SUBMITTED orders can be approved (current: ${existing.status})`);
  }
  if (existing.items.length === 0) {
    return sendError(res, 'Cannot approve an empty purchase order');
  }

  const po = await prisma.purchaseOrder.update({
    where: { id },
    data: {
      status: 'APPROVED',
      approvedBy: userId,
      approvedAt: new Date(),
    },
    include: { items: true, supplier: true, branch: true },
  });

  await createAuditLog(
    restaurantId,
    userId,
    'UPDATE',
    'PurchaseOrder',
    id,
    `Approved purchase order ${existing.orderNumber}`
  );

  return sendResponse(res, true, 'Purchase order approved successfully', po);
};

export const deletePurchaseOrder = async (req: AuthRequest, res: ExpressResponse) => {
  const { id } = req.params;
  const restaurantId = req.user!.restaurantId;
  const userId = req.user!.id;

  const existing = await prisma.purchaseOrder.findFirst({
    where: { id, restaurantId },
    include: { items: true },
  });

  if (!existing) return sendError(res, 'Purchase order not found', undefined, 404);

  // Preserve purchasing and inventory history. Only orders that have never
  // been submitted or received may be permanently deleted.
  if (!['DRAFT', 'CANCELLED'].includes(existing.status)) {
    return sendError(res, 'Only draft or cancelled purchase orders can be deleted. Received orders must remain for audit history.', undefined, 409);
  }

  await prisma.purchaseOrder.delete({ where: { id } });

  await createAuditLog(
    restaurantId,
    userId,
    'DELETE',
    'PurchaseOrder',
    id,
    `Deleted purchase order ${existing.orderNumber}`
  );

  return sendResponse(res, true, 'Purchase order deleted successfully');
};

export const cancelPurchaseOrder = async (req: AuthRequest, res: ExpressResponse) => {
  const { id } = req.params;
  const { reason } = req.body;
  const restaurantId = req.user!.restaurantId;
  const userId = req.user!.id;

  const existing = await prisma.purchaseOrder.findFirst({ where: { id, restaurantId } });
  if (!existing) {
    return sendError(res, 'Purchase order not found', undefined, 404);
  }
  if (!['DRAFT', 'SUBMITTED'].includes(existing.status)) {
    return sendError(res, `Cannot cancel a ${existing.status} purchase order`);
  }

  const po = await prisma.purchaseOrder.update({
    where: { id },
    data: {
      status: 'CANCELLED',
      notes: reason ? `${existing.notes || ''}\nCancelled: ${reason}`.trim() : existing.notes,
    },
    include: { items: true, supplier: true, branch: true },
  });

  await createAuditLog(
    restaurantId,
    userId,
    'UPDATE',
    'PurchaseOrder',
    id,
    `Cancelled purchase order ${existing.orderNumber}${reason ? `: ${reason}` : ''}`
  );

  return sendResponse(res, true, 'Purchase order cancelled successfully', po);
};

export const createPurchaseCorrection = async (req: AuthRequest, res: ExpressResponse) => {
  const { id } = req.params;
  const { purchaseOrderItemId, type, quantity, unit, reason, notes } = req.body;
  const restaurantId = req.user!.restaurantId;
  const userId = req.user!.id;

  if (!type || !['RETURN', 'ADJUSTMENT', 'DAMAGE'].includes(type)) {
    return sendError(res, 'Invalid correction type');
  }
  if (typeof quantity !== 'number' || quantity <= 0) {
    return sendError(res, 'quantity must be a positive number');
  }

  const po = await prisma.purchaseOrder.findFirst({
    where: { id, restaurantId },
    include: { items: true },
  });
  if (!po) {
    return sendError(res, 'Purchase order not found', undefined, 404);
  }
  if (po.status === 'CANCELLED') {
    return sendError(res, 'Cannot correct a cancelled purchase order');
  }

  let ingredientId: string | undefined;
  let correctionUnit = unit;
  if (purchaseOrderItemId) {
    const item = po.items.find((i: any) => i.id === purchaseOrderItemId);
    if (!item) {
      return sendError(res, 'Purchase order item not found', undefined, 404);
    }
    ingredientId = item.ingredientId;
    correctionUnit = correctionUnit || item.unit;
  }

  type CorrectionResult = { __error?: string; correction?: any };

  const result = await prisma.$transaction(async (tx) => {
    const correction = await tx.purchaseCorrection.create({
      data: {
        restaurantId,
        purchaseOrderId: id,
        purchaseOrderItemId: purchaseOrderItemId || null,
        type,
        quantity,
        unit: correctionUnit || 'pieces',
        reason,
        notes,
        createdBy: userId,
      },
    });

    if (ingredientId) {
      const stock = await tx.inventoryStock.findUnique({
        where: { branchId_ingredientId: { branchId: po.branchId, ingredientId } },
      });
      if (stock) {
        const qtyChange = type === 'RETURN' ? -quantity : -quantity;
        const newQty = Math.max(0, stock.quantity + qtyChange);
        await tx.inventoryStock.update({
          where: { id: stock.id },
          data: { quantity: newQty },
        });
        await tx.stockMovement.create({
          data: {
            restaurantId,
            branchId: po.branchId,
            ingredientId,
            quantity: qtyChange,
            unit: correctionUnit || stock.unit,
            type: type === 'RETURN' ? 'RETURN' : type === 'DAMAGE' ? 'WASTAGE' : 'ADJUSTMENT',
            reason: `${type} from PO ${po.orderNumber}`,
            referenceId: id,
            referenceType: 'PurchaseCorrection',
            userId,
            notes: reason || notes,
          },
        });
      }
    }

    return { correction } as CorrectionResult;
  });

  await createAuditLog(
    restaurantId,
    userId,
    'CREATE',
    'PurchaseCorrection',
    (result.correction as any).id,
    `Created ${type} correction of ${quantity}${(result.correction as any).unit} for PO ${po.orderNumber}`
  );

  return sendResponse(res, true, 'Purchase correction created successfully', result.correction, 201);
};

export const deductInventoryForOrder = async (orderId: string, restaurantId: string, branchId: string) => {
  const order = await prisma.sale.findFirst({
    where: { id: orderId, restaurantId, branchId },
    include: { items: true },
  });
  if (!order || order.status !== 'COMPLETED') return;

  const existingDeduction = await prisma.stockMovement.findFirst({
    where: { restaurantId, branchId, referenceId: orderId, referenceType: 'ORDER_DEDUCTION' },
  });
  if (existingDeduction) return;

  const menuItemIds = order.items.map((i) => i.menuItemId);
  const menuItems = await prisma.menuItem.findMany({
    where: { id: { in: menuItemIds }, restaurantId },
    include: { recipe: { include: { ingredients: { include: { ingredient: true } } } } },
  });
  const menuItemMap = new Map(menuItems.map((m) => [m.id, m]));

  await prisma.$transaction(async (tx) => {
    for (const item of order.items) {
      const recipe = menuItemMap.get(item.menuItemId)?.recipe;
      if (!recipe || recipe.status === 'INACTIVE') continue;
      for (const ri of recipe.ingredients) {
        if (ri.ingredient.status === 'INACTIVE' || !ri.ingredient.available) continue;
        const totalQty = ri.quantity * item.quantity;
        const ok = await consumeInventoryQuantity(tx, {
          restaurantId, branchId, ingredientId: ri.ingredientId, quantity: totalQty, unit: ri.unit,
          type: 'CONSUMPTION', reason: 'Order consumption', referenceId: orderId,
          referenceType: 'ORDER_DEDUCTION', userId: order.createdBy, notes: `Deducted for order ${order.orderNumber}`,
        });
        if (!ok) throw new Error(`INSUFFICIENT_STOCK:${ri.ingredient.name}`);
      }
    }
  });
};

export const getSupplierIngredients = async (req: AuthRequest, res: ExpressResponse) => {
  const restaurantId = req.user!.restaurantId;
  const { supplierId, ingredientId, page = '1', limit = '50' } = req.query;

  const where: any = { restaurantId };
  if (supplierId) where.supplierId = supplierId as string;
  if (ingredientId) where.ingredientId = ingredientId as string;

  const skip = (parseInt(page as string) - 1) * parseInt(limit as string);

  const [items, total] = await Promise.all([
    prisma.supplierIngredient.findMany({
      where,
      skip,
      take: parseInt(limit as string),
      orderBy: [{ supplierId: 'asc' }, { createdAt: 'desc' }],
      include: {
        supplier: { select: { id: true, name: true } },
        ingredient: { select: { id: true, name: true, unit: true, costPerUnit: true } },
      },
    }),
    prisma.supplierIngredient.count({ where }),
  ]);

  const showCost = COST_ROLES.includes(req.user!.roleName);

  return sendResponse(res, true, 'Supplier ingredients retrieved', {
    items: items.map((si) => ({
      id: si.id,
      supplierId: si.supplierId,
      supplierName: si.supplier.name,
      ingredientId: si.ingredientId,
      ingredientName: si.ingredient.name,
      ingredientUnit: si.ingredient.unit,
      supplierItemCode: si.supplierItemCode,
      preferredUnit: si.preferredUnit,
      lastPurchasePrice: showCost ? si.lastPurchasePrice : undefined,
      defaultPurchasePrice: showCost ? si.defaultPurchasePrice : undefined,
      minOrderQuantity: si.minOrderQuantity,
      notes: si.notes,
      createdAt: si.createdAt,
      updatedAt: si.updatedAt,
    })),
    pagination: {
      page: parseInt(page as string),
      limit: parseInt(limit as string),
      total,
      totalPages: Math.ceil(total / parseInt(limit as string)),
    },
  });
};

export const createSupplierIngredient = async (req: AuthRequest, res: ExpressResponse) => {
  const {
    supplierId,
    ingredientId,
    supplierItemCode,
    preferredUnit,
    lastPurchasePrice,
    defaultPurchasePrice,
    minOrderQuantity,
    notes,
  } = req.body;
  const restaurantId = req.user!.restaurantId;

  if (!supplierId || !ingredientId) {
    return sendError(res, 'supplierId and ingredientId are required');
  }

  const supplier = await prisma.supplier.findFirst({ where: { id: supplierId, restaurantId } });
  if (!supplier) return sendError(res, 'Supplier not found', undefined, 404);

  const ingredient = await prisma.ingredient.findFirst({ where: { id: ingredientId, restaurantId } });
  if (!ingredient) return sendError(res, 'Ingredient not found', undefined, 404);

  const existing = await prisma.supplierIngredient.findUnique({
    where: { supplierId_ingredientId: { supplierId, ingredientId } },
  });
  if (existing) {
    return sendError(res, 'This ingredient is already linked to this supplier', undefined, 409);
  }

  const link = await prisma.supplierIngredient.create({
    data: {
      restaurantId,
      supplierId,
      ingredientId,
      supplierItemCode,
      preferredUnit: preferredUnit || ingredient.unit,
      lastPurchasePrice,
      defaultPurchasePrice: defaultPurchasePrice ?? ingredient.costPerUnit,
      minOrderQuantity,
      notes,
    },
    include: {
      supplier: { select: { name: true } },
      ingredient: { select: { name: true } },
    },
  });

  await createAuditLog(
    restaurantId,
    req.user!.id,
    'CREATE',
    'SupplierIngredient',
    link.id,
    `Linked ${link.ingredient.name} to supplier ${link.supplier.name}`
  );

  return sendResponse(res, true, 'Supplier ingredient linked successfully', link, 201);
};

export const updateSupplierIngredient = async (req: AuthRequest, res: ExpressResponse) => {
  const { id } = req.params;
  const {
    supplierItemCode,
    preferredUnit,
    lastPurchasePrice,
    defaultPurchasePrice,
    minOrderQuantity,
    notes,
  } = req.body;
  const restaurantId = req.user!.restaurantId;

  const existing = await prisma.supplierIngredient.findFirst({ where: { id, restaurantId } });
  if (!existing) return sendError(res, 'Supplier ingredient link not found', undefined, 404);

  const updated = await prisma.supplierIngredient.update({
    where: { id },
    data: {
      supplierItemCode,
      preferredUnit,
      lastPurchasePrice,
      defaultPurchasePrice,
      minOrderQuantity,
      notes,
    },
    include: {
      supplier: { select: { name: true } },
      ingredient: { select: { name: true } },
    },
  });

  await createAuditLog(
    restaurantId,
    req.user!.id,
    'UPDATE',
    'SupplierIngredient',
    id,
    `Updated supplier ingredient link ${id}`
  );

  return sendResponse(res, true, 'Supplier ingredient updated successfully', updated);
};

export const deleteSupplierIngredient = async (req: AuthRequest, res: ExpressResponse) => {
  const { id } = req.params;
  const restaurantId = req.user!.restaurantId;

  const existing = await prisma.supplierIngredient.findFirst({ where: { id, restaurantId } });
  if (!existing) return sendError(res, 'Supplier ingredient link not found', undefined, 404);

  await prisma.supplierIngredient.delete({ where: { id } });

  await createAuditLog(
    restaurantId,
    req.user!.id,
    'DELETE',
    'SupplierIngredient',
    id,
    `Deleted supplier ingredient link ${id}`
  );

  return sendResponse(res, true, 'Supplier ingredient link deleted successfully');
};

export const getInventoryBatches = async (req: AuthRequest, res: ExpressResponse) => {
  const restaurantId = req.user!.restaurantId;
  const requestedBranchId = typeof req.query.branchId === 'string' ? req.query.branchId : undefined;
  const branchId = req.user!.branchId || requestedBranchId;
  const { ingredientId, expiringDays = '30', status = 'ACTIVE' } = req.query;
  const where: any = { restaurantId, ...(branchId ? { branchId } : {}) };
  if (ingredientId) where.ingredientId = ingredientId as string;
  if (status) where.status = status as string;
  const days = Math.max(0, parseInt(expiringDays as string) || 30);
  const cutoff = new Date(Date.now() + days * 86400000);
  const batches = await prisma.inventoryBatch.findMany({
    where,
    orderBy: [{ expiryDate: 'asc' }, { receivedAt: 'asc' }],
    include: {
      ingredient: { select: { id: true, name: true, unit: true } },
      branch: { select: { id: true, name: true } },
    },
  });
  const showCost = COST_ROLES.includes(req.user!.roleName);
  return sendResponse(res, true, 'Inventory batches retrieved', {
    items: batches.map((b) => ({
      id: b.id, batchNumber: b.batchNumber, expiryDate: b.expiryDate, quantity: b.quantity,
      unit: b.unit, costPerUnit: showCost ? b.costPerUnit : undefined, receivedAt: b.receivedAt,
      status: b.status, ingredientId: b.ingredientId, ingredientName: b.ingredient.name,
      branchId: b.branchId, branchName: b.branch.name,
      isExpired: !!b.expiryDate && b.expiryDate < new Date(),
      isExpiringSoon: !!b.expiryDate && b.expiryDate >= new Date() && b.expiryDate <= cutoff,
    })),
  });
};

export const createInventoryBatch = async (req: AuthRequest, res: ExpressResponse) => {
  const restaurantId = req.user!.restaurantId;
  const { branchId: reqBranchId, ingredientId, batchNumber, expiryDate, quantity, unit, costPerUnit, receivedAt } = req.body;
  const branchId = reqBranchId || req.user!.branchId;
  if (!branchId || !ingredientId || typeof quantity !== 'number' || quantity <= 0) return sendError(res, 'branchId, ingredientId and positive quantity are required');
  const ingredient = await prisma.ingredient.findFirst({ where: { id: ingredientId, restaurantId } });
  if (!ingredient) return sendError(res, 'Ingredient not found', undefined, 404);
  const branch = await prisma.branch.findFirst({ where: { id: branchId, restaurantId } });
  if (!branch) return sendError(res, 'Branch not found', undefined, 404);
  const batch = await prisma.$transaction(async (tx) => {
    const stock = await tx.inventoryStock.findUnique({ where: { branchId_ingredientId: { branchId, ingredientId } } });
    if (stock) await tx.inventoryStock.update({ where: { id: stock.id }, data: { quantity: { increment: quantity }, costPerUnit: costPerUnit ?? stock.costPerUnit, lastRestockedAt: new Date() } });
    else await tx.inventoryStock.create({ data: { restaurantId, branchId, ingredientId, quantity, unit: unit || ingredient.unit, costPerUnit: costPerUnit ?? ingredient.costPerUnit, lastRestockedAt: new Date() } });
    const created = await tx.inventoryBatch.create({ data: { restaurantId, branchId, ingredientId, batchNumber: batchNumber || null, expiryDate: expiryDate ? new Date(expiryDate) : null, quantity, unit: unit || ingredient.unit, costPerUnit: costPerUnit ?? ingredient.costPerUnit, receivedAt: receivedAt ? new Date(receivedAt) : new Date() } });
    await tx.stockMovement.create({ data: { restaurantId, branchId, ingredientId, quantity, unit: unit || ingredient.unit, type: 'RESTOCK', reason: 'Manual batch receipt', referenceId: created.id, referenceType: 'INVENTORY_BATCH', userId: req.user!.id, batchId: created.id } });
    return created;
  });
  await createAuditLog(restaurantId, req.user!.id, 'CREATE', 'InventoryBatch', batch.id, `Created inventory batch ${batch.batchNumber || batch.id}`);
  return sendResponse(res, true, 'Inventory batch created successfully', batch, 201);
};

export const getStocktakes = async (req: AuthRequest, res: ExpressResponse) => {
  const restaurantId = req.user!.restaurantId;
  const requestedBranchId = typeof req.query.branchId === 'string' ? req.query.branchId : undefined;
  const branchId = req.user!.branchId || requestedBranchId;
  const { status } = req.query;
  const where: any = { restaurantId, ...(branchId ? { branchId } : {}) };
  if (status) where.status = status as string;
  const stocktakes = await prisma.stocktake.findMany({ where, orderBy: { createdAt: 'desc' }, include: { branch: { select: { name: true } }, items: { include: { ingredient: { select: { name: true, unit: true } } } } } });
  return sendResponse(res, true, 'Stocktakes retrieved', { items: stocktakes });
};

export const createStocktake = async (req: AuthRequest, res: ExpressResponse) => {
  const restaurantId = req.user!.restaurantId;
  const branchId = req.body.branchId || req.user!.branchId;
  const notes = req.body.notes;
  if (!branchId) return sendError(res, 'Branch is required');
  const branch = await prisma.branch.findFirst({ where: { id: branchId, restaurantId } });
  if (!branch) return sendError(res, 'Branch not found', undefined, 404);
  const stocks = await prisma.inventoryStock.findMany({ where: { restaurantId, branchId } });
  const reference = `ST-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${Math.random().toString(36).slice(2,7).toUpperCase()}`;
  const stocktake = await prisma.stocktake.create({ data: { restaurantId, branchId, reference, notes, createdBy: req.user!.id, items: { create: stocks.map((s) => ({ ingredientId: s.ingredientId, expectedQty: s.quantity, countedQty: s.quantity, variance: 0, unit: s.unit })) } }, include: { items: true, branch: true } });
  return sendResponse(res, true, 'Stocktake created successfully', stocktake, 201);
};

export const updateStocktake = async (req: AuthRequest, res: ExpressResponse) => {
  const restaurantId = req.user!.restaurantId;
  const id = req.params.id;
  const stocktake = await prisma.stocktake.findFirst({ where: { id, restaurantId } });
  if (!stocktake) return sendError(res, 'Stocktake not found', undefined, 404);
  if (stocktake.status !== 'DRAFT') return sendError(res, 'Only draft stocktakes can be edited', undefined, 409);
  const items = Array.isArray(req.body.items) ? req.body.items : [];
  for (const item of items) {
    const countedQty = Number(item.countedQty);
    if (!item.ingredientId || !Number.isFinite(countedQty) || countedQty < 0) continue;
    const existing = await prisma.stocktakeItem.findUnique({ where: { stocktakeId_ingredientId: { stocktakeId: id, ingredientId: item.ingredientId } } });
    if (existing) await prisma.stocktakeItem.update({ where: { id: existing.id }, data: { countedQty, variance: countedQty - existing.expectedQty, notes: item.notes } });
  }
  const updated = await prisma.stocktake.findUnique({ where: { id }, include: { items: { include: { ingredient: true } }, branch: true } });
  return sendResponse(res, true, 'Stocktake updated successfully', updated);
};

export const completeStocktake = async (req: AuthRequest, res: ExpressResponse) => {
  const restaurantId = req.user!.restaurantId;
  const id = req.params.id;
  const result = await prisma.$transaction(async (tx) => {
    const st = await tx.stocktake.findFirst({ where: { id, restaurantId }, include: { items: true } });
    if (!st) return { error: 'NOT_FOUND' };
    if (st.status !== 'DRAFT') return { error: 'NOT_DRAFT' };
    for (const item of st.items) {
      const stock = await tx.inventoryStock.findUnique({ where: { branchId_ingredientId: { branchId: st.branchId, ingredientId: item.ingredientId } } });
      if (!stock) continue;
      const variance = item.countedQty - stock.quantity;
      if (Math.abs(variance) > 0.000001) {
        await tx.inventoryStock.update({ where: { id: stock.id }, data: { quantity: item.countedQty } });
        await tx.stockMovement.create({ data: { restaurantId, branchId: st.branchId, ingredientId: item.ingredientId, quantity: variance, unit: item.unit, type: 'STOCKTAKE', reason: `Stocktake ${st.reference}`, referenceId: st.id, referenceType: 'STOCKTAKE', userId: req.user!.id, notes: 'Physical count adjustment' } });
      }
      await tx.stocktakeItem.update({ where: { id: item.id }, data: { expectedQty: stock.quantity, variance } });
    }
    return await tx.stocktake.update({ where: { id }, data: { status: 'COMPLETED', completedBy: req.user!.id, completedAt: new Date() }, include: { items: true, branch: true } });
  });
  if ((result as any).error === 'NOT_FOUND') return sendError(res, 'Stocktake not found', undefined, 404);
  if ((result as any).error === 'NOT_DRAFT') return sendError(res, 'Stocktake is already completed', undefined, 409);
  await createAuditLog(restaurantId, req.user!.id, 'UPDATE', 'Stocktake', id, `Completed stocktake ${(result as any).reference}`);
  return sendResponse(res, true, 'Stocktake completed and inventory adjusted', result);
};
