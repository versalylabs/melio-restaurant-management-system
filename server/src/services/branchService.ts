import prisma from '../config/database';
import { AuthRequest } from '../middleware/auth';
import { sendResponse, sendError } from '../utils/response';
import { Response as ExpressResponse } from 'express';
import { createAuditLog } from './auditLogService';

export const getBranches = async (req: AuthRequest, res: ExpressResponse) => {
  const restaurantId = req.user!.restaurantId;

  const branches = await prisma.branch.findMany({
    where: { restaurantId },
    select: { id: true, name: true, code: true, address: true, city: true, status: true },
    orderBy: { name: 'asc' },
  });

  return sendResponse(res, true, 'Branches retrieved', { branches });
};


export const getStockTransfers = async (req: AuthRequest, res: ExpressResponse) => {
  const restaurantId = req.user!.restaurantId;
  const branchId = req.user!.branchId;
  const where: any = { restaurantId };
  if (branchId) where.OR = [{ fromBranchId: branchId }, { toBranchId: branchId }];
  const transfers = await prisma.stockTransfer.findMany({
    where,
    include: {
      fromBranch: { select: { id: true, name: true, code: true } },
      toBranch: { select: { id: true, name: true, code: true } },
      createdByUser: { select: { firstName: true, lastName: true } },
      items: { include: { ingredient: { select: { id: true, name: true, unit: true } } } },
    },
    orderBy: { createdAt: 'desc' },
  });
  return sendResponse(res, true, 'Stock transfers retrieved', {
    transfers: transfers.map((t) => ({
      ...t,
      createdByName: `${t.createdByUser.firstName} ${t.createdByUser.lastName}`,
    })),
  });
};

export const createBranch = async (req: AuthRequest, res: ExpressResponse) => {
  const restaurantId = req.user!.restaurantId;
  const { name, code, phone, email, address, city, callPhone, diningHours, status } = req.body || {};

  const trimmedName = String(name || '').trim();
  if (!trimmedName) return sendError(res, 'Branch name is required');

  const trimmedCode = String(code || '').trim().toUpperCase();
  if (!trimmedCode) return sendError(res, 'Branch code is required');

  const duplicate = await prisma.branch.findUnique({
    where: { restaurantId_code: { restaurantId, code: trimmedCode } },
  });
  if (duplicate) return sendError(res, 'Branch code already exists', undefined, 409);

  const branch = await prisma.branch.create({
    data: {
      restaurantId,
      name: trimmedName,
      code: trimmedCode,
      phone: phone ? String(phone).trim() : null,
      email: email ? String(email).trim().toLowerCase() : null,
      address: address ? String(address).trim() : null,
      city: city ? String(city).trim() : null,
      callPhone: callPhone ? String(callPhone).trim() : null,
      diningHours: diningHours ? (typeof diningHours === 'object' ? JSON.stringify(diningHours) : String(diningHours)) : null,
      status: status || 'ACTIVE',
    },
  });

  await createAuditLog(restaurantId, req.user!.id, 'CREATE', 'Branch', branch.id, `Created branch ${branch.name} (${branch.code})`);
  return sendResponse(res, true, 'Branch created successfully', branch, 201);
};

export const updateBranch = async (req: AuthRequest, res: ExpressResponse) => {
  const { id } = req.params;
  const restaurantId = req.user!.restaurantId;
  const existing = await prisma.branch.findFirst({ where: { id, restaurantId } });
  if (!existing) return sendError(res, 'Branch not found', undefined, 404);

  const { name, code, phone, email, address, city, callPhone, diningHours, status } = req.body || {};

  let trimmedName = existing.name;
  if (name !== undefined) {
    trimmedName = String(name).trim();
    if (!trimmedName) return sendError(res, 'Branch name cannot be empty');
  }

  let trimmedCode = existing.code;
  if (code !== undefined) {
    trimmedCode = String(code).trim().toUpperCase();
    if (!trimmedCode) return sendError(res, 'Branch code cannot be empty');
    if (trimmedCode !== existing.code) {
      const duplicate = await prisma.branch.findUnique({
        where: { restaurantId_code: { restaurantId, code: trimmedCode } },
      });
      if (duplicate) return sendError(res, 'Branch code already exists', undefined, 409);
    }
  }

  const branch = await prisma.branch.update({
    where: { id },
    data: {
      name: trimmedName,
      code: trimmedCode,
      phone: phone !== undefined ? (phone ? String(phone).trim() : null) : existing.phone,
      email: email !== undefined ? (email ? String(email).trim().toLowerCase() : null) : existing.email,
      address: address !== undefined ? (address ? String(address).trim() : null) : existing.address,
      city: city !== undefined ? (city ? String(city).trim() : null) : existing.city,
      callPhone: callPhone !== undefined ? (callPhone ? String(callPhone).trim() : null) : existing.callPhone,
      diningHours: diningHours !== undefined ? (typeof diningHours === 'object' ? JSON.stringify(diningHours) : String(diningHours)) : existing.diningHours,
      status: status !== undefined ? status : existing.status,
    },
  });

  await createAuditLog(restaurantId, req.user!.id, 'UPDATE', 'Branch', branch.id, `Updated branch ${branch.name}`);
  return sendResponse(res, true, 'Branch updated successfully', branch);
};

export const createStockTransfer = async (req: AuthRequest, res: ExpressResponse) => {
  const restaurantId = req.user!.restaurantId;
  const fromBranchId = req.user!.branchId;
  const { toBranchId, items, notes } = req.body;
  if (!fromBranchId) return sendError(res, 'You must be assigned to a branch to create a transfer');
  if (!toBranchId || toBranchId === fromBranchId) return sendError(res, 'Select a different destination branch');
  if (!Array.isArray(items) || !items.length) return sendError(res, 'At least one ingredient is required');

  const uniqueItemsMap = new Map<string, any>();
  for (const i of items) {
    const qty = Number(i.quantity);
    if (qty <= 0) continue;
    if (uniqueItemsMap.has(i.ingredientId)) {
      uniqueItemsMap.get(i.ingredientId).quantity += qty;
    } else {
      uniqueItemsMap.set(i.ingredientId, { ...i, quantity: qty });
    }
  }
  const deduplicatedItems = Array.from(uniqueItemsMap.values());
  if (!deduplicatedItems.length) return sendError(res, 'At least one valid ingredient quantity is required');

  const destination = await prisma.branch.findFirst({ where: { id: toBranchId, restaurantId, status: 'ACTIVE' } });
  if (!destination) return sendError(res, 'Destination branch not found', undefined, 404);

  const ingredients = await prisma.ingredient.findMany({
    where: { restaurantId, id: { in: deduplicatedItems.map((i: any) => i.ingredientId) }, status: 'ACTIVE' },
    select: { id: true, unit: true },
  });
  if (ingredients.length !== deduplicatedItems.length) return sendError(res, 'One or more ingredients are invalid');

  const reference = `TRF-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${Math.random().toString(36).slice(2,7).toUpperCase()}`;
  const transfer = await prisma.stockTransfer.create({
    data: {
      restaurantId, fromBranchId, toBranchId, reference, notes, createdBy: req.user!.id,
      items: { create: deduplicatedItems.map((i: any) => ({ ingredientId: i.ingredientId, quantity: Number(i.quantity), unit: i.unit })) },
    },
    include: { items: true, fromBranch: true, toBranch: true },
  });
  await createAuditLog(restaurantId, req.user!.id, 'CREATE', 'StockTransfer', transfer.id, `Created stock transfer ${reference}`);
  return sendResponse(res, true, 'Stock transfer created', transfer, 201);
};

export const completeStockTransfer = async (req: AuthRequest, res: ExpressResponse) => {
  const restaurantId = req.user!.restaurantId;
  const userId = req.user!.id;
  const transfer = await prisma.stockTransfer.findFirst({
    where: { id: req.params.id, restaurantId },
    include: { items: true, fromBranch: true, toBranch: true },
  });
  if (!transfer) return sendError(res, 'Stock transfer not found', undefined, 404);
  if (transfer.status !== 'DRAFT') return sendError(res, 'Only draft transfers can be completed');
  if (req.user!.branchId && req.user!.branchId !== transfer.fromBranchId) return sendError(res, 'You can only complete transfers from your active branch', undefined, 403);

  await prisma.$transaction(async (tx) => {
    for (const item of transfer.items) {
      if (item.quantity <= 0) throw new Error('Transfer quantities must be greater than zero');
      const source = await tx.inventoryStock.findUnique({ where: { branchId_ingredientId: { branchId: transfer.fromBranchId, ingredientId: item.ingredientId } } });
      if (!source || source.quantity < item.quantity) throw new Error(`Insufficient stock for ingredient ${item.ingredientId}`);
      const dest = await tx.inventoryStock.findUnique({ where: { branchId_ingredientId: { branchId: transfer.toBranchId, ingredientId: item.ingredientId } } });
      await tx.inventoryStock.update({ where: { id: source.id }, data: { quantity: { decrement: item.quantity } } });
      if (dest) {
        await tx.inventoryStock.update({ where: { id: dest.id }, data: { quantity: { increment: item.quantity } } });
      } else {
        await tx.inventoryStock.create({ data: { restaurantId, branchId: transfer.toBranchId, ingredientId: item.ingredientId, quantity: item.quantity, unit: item.unit, costPerUnit: source.costPerUnit, minStockLevel: source.minStockLevel, reorderLevel: source.reorderLevel } });
      }
      await tx.stockMovement.create({ data: { restaurantId, branchId: transfer.fromBranchId, ingredientId: item.ingredientId, quantity: -item.quantity, unit: item.unit, type: 'TRANSFER_OUT', reason: transfer.reference, referenceId: transfer.id, referenceType: 'STOCK_TRANSFER', userId } });
      await tx.stockMovement.create({ data: { restaurantId, branchId: transfer.toBranchId, ingredientId: item.ingredientId, quantity: item.quantity, unit: item.unit, type: 'TRANSFER_IN', reason: transfer.reference, referenceId: transfer.id, referenceType: 'STOCK_TRANSFER', userId } });
    }
    await tx.stockTransfer.update({ where: { id: transfer.id }, data: { status: 'COMPLETED', completedBy: userId, completedAt: new Date() } });
  });
  await createAuditLog(restaurantId, userId, 'COMPLETE', 'StockTransfer', transfer.id, `Completed stock transfer ${transfer.reference}`);
  return sendResponse(res, true, 'Stock transfer completed');
};

export const cancelStockTransfer = async (req: AuthRequest, res: ExpressResponse) => {
  const restaurantId = req.user!.restaurantId;
  const transfer = await prisma.stockTransfer.findFirst({ where: { id: req.params.id, restaurantId, status: 'DRAFT' } });
  if (!transfer) return sendError(res, 'Draft stock transfer not found', undefined, 404);
  await prisma.stockTransfer.update({ where: { id: transfer.id }, data: { status: 'CANCELLED' } });
  await createAuditLog(restaurantId, req.user!.id, 'CANCEL', 'StockTransfer', transfer.id, `Cancelled stock transfer ${transfer.reference}`);
  return sendResponse(res, true, 'Stock transfer cancelled');
};
