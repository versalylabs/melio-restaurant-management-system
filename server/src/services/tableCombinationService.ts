import prisma from '../config/database';
import { AuthRequest } from '../middleware/auth';
import { sendResponse, sendError } from '../utils/response';
import { Response as ExpressResponse } from 'express';
import { createAuditLog } from './auditLogService';

export const getTableCombinations = async (req: AuthRequest, res: ExpressResponse) => {
  const restaurantId = req.user!.restaurantId;
  const requestedBranchId = typeof req.query.branchId === 'string' ? req.query.branchId : undefined;
  const branchId = req.user!.branchId || requestedBranchId;

  const where: any = { restaurantId };
  if (branchId) where.branchId = branchId;

  const combinations = await prisma.tableCombination.findMany({
    where,
    include: {
      branch: { select: { id: true, name: true } },
    },
    orderBy: { name: 'asc' },
  });

  return sendResponse(res, true, 'Table combinations retrieved', {
    combinations: combinations.map((c) => ({
      id: c.id,
      name: c.name,
      tableIds: JSON.parse(c.tableIds),
      status: c.status,
      branchId: c.branchId,
      branchName: c.branch.name,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    })),
  });
};

export const createTableCombination = async (req: AuthRequest, res: ExpressResponse) => {
  const { name, tableIds } = req.body;
  const restaurantId = req.user!.restaurantId;
  const branchId = req.user!.branchId || String(req.body?.branchId || '');

  const branch = await prisma.branch.findFirst({ where: { id: branchId, restaurantId } });
  if (!branch) {
    return sendError(res, 'Invalid branch');
  }

  const tables = await prisma.table.findMany({
    where: { id: { in: tableIds }, branchId, restaurantId, status: { not: 'INACTIVE' } },
  });

  if (tables.length !== tableIds.length) {
    return sendError(res, 'One or more tables are invalid');
  }

  const combination = await prisma.tableCombination.create({
    data: {
      restaurantId,
      branchId,
      name,
      tableIds: JSON.stringify(tableIds),
      status: 'ACTIVE',
    },
    include: {
      branch: { select: { id: true, name: true } },
    },
  });

  await createAuditLog(
    restaurantId,
    req.user!.id,
    'CREATE',
    'TableCombination',
    combination.id,
    `Created table combination ${combination.name}`
  );

  return sendResponse(res, true, 'Table combination created successfully', combination, 201);
};

export const updateTableCombination = async (req: AuthRequest, res: ExpressResponse) => {
  const { id } = req.params;
  const { name, tableIds, status } = req.body;
  const restaurantId = req.user!.restaurantId;

  const existing = await prisma.tableCombination.findFirst({ where: { id, restaurantId, ...(req.user!.branchId ? { branchId: req.user!.branchId } : {}) } });
  if (!existing) {
    return sendError(res, 'Table combination not found', undefined, 404);
  }

  const combination = await prisma.tableCombination.update({
    where: { id },
    data: {
      name,
      tableIds: tableIds ? JSON.stringify(tableIds) : undefined,
      status,
    },
    include: {
      branch: { select: { id: true, name: true } },
    },
  });

  await createAuditLog(
    restaurantId,
    req.user!.id,
    'UPDATE',
    'TableCombination',
    id,
    `Updated table combination ${combination.name}`
  );

  return sendResponse(res, true, 'Table combination updated successfully', combination);
};

export const deleteTableCombination = async (req: AuthRequest, res: ExpressResponse) => {
  const { id } = req.params;
  const restaurantId = req.user!.restaurantId;

  const existing = await prisma.tableCombination.findFirst({ where: { id, restaurantId, ...(req.user!.branchId ? { branchId: req.user!.branchId } : {}) } });
  if (!existing) {
    return sendError(res, 'Table combination not found', undefined, 404);
  }

  await prisma.tableCombination.update({ where: { id }, data: { status: 'INACTIVE' } });

  await createAuditLog(
    restaurantId,
    req.user!.id,
    'DELETE',
    'TableCombination',
    id,
    `Deactivated table combination ${existing.name}`
  );

  return sendResponse(res, true, 'Table combination deactivated successfully');
};
