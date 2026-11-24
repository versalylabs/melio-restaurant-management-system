import prisma from '../config/database';
import { AuthRequest } from '../middleware/auth';
import { sendResponse, sendError } from '../utils/response';
import { Response as ExpressResponse } from 'express';
import { createAuditLog } from './auditLogService';
import { lockTables, SEATED_ORDER_STATUSES, syncTableStatus } from './tableFloorService';
import { realtimeService } from './realtimeService';

export const getTables = async (req: AuthRequest, res: ExpressResponse) => {
  const restaurantId = req.user!.restaurantId;
  const requestedBranchId = typeof req.query.branchId === 'string' ? req.query.branchId : undefined;
  const branchId = req.user!.branchId || requestedBranchId;
  const { sectionId, status, search, page = '1', limit = '50' } = req.query;

  const skip = (parseInt(page as string) - 1) * parseInt(limit as string);

  const where: any = { restaurantId, ...(branchId ? { branchId } : {}) };
  if (sectionId) {
    where.sectionId = sectionId as string;
  }
  if (status) {
    where.status = status as string;
  } else {
    where.status = { not: 'INACTIVE' };
  }
  if (search) {
    where.tableNumber = { contains: search as string };
  }

  const [tables, total] = await Promise.all([
    prisma.table.findMany({
      where,
      skip,
      take: parseInt(limit as string),
      orderBy: { displayOrder: 'asc' },
      include: {
        branch: { select: { id: true, name: true, code: true } },
        section: { select: { id: true, name: true } },
      },
    }),
    prisma.table.count({ where }),
  ]);

  return sendResponse(res, true, 'Tables retrieved', {
    tables: tables.map((t) => ({
      id: t.id,
      tableNumber: t.tableNumber,
      name: t.name,
      capacity: t.capacity,
      shape: t.shape,
      status: t.status,
      positionX: t.positionX,
      positionY: t.positionY,
      width: t.width,
      height: t.height,
      rotation: t.rotation,
      displayOrder: t.displayOrder,
      branchId: t.branchId,
      branchName: t.branch.name,
      sectionId: t.sectionId,
      sectionName: t.section?.name,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    })),
    pagination: {
      page: parseInt(page as string),
      limit: parseInt(limit as string),
      total,
      totalPages: Math.ceil(total / parseInt(limit as string)),
    },
  });
};

export const getTable = async (req: AuthRequest, res: ExpressResponse) => {
  const { id } = req.params;
  const restaurantId = req.user!.restaurantId;

  const table = await prisma.table.findFirst({
    where: { id, restaurantId, ...(req.user!.branchId ? { branchId: req.user!.branchId } : {}) },
    include: {
      branch: { select: { id: true, name: true, code: true } },
      section: { select: { id: true, name: true } },
    },
  });

  if (!table) {
    return sendError(res, 'Table not found', undefined, 404);
  }

  return sendResponse(res, true, 'Table retrieved', table);
};

export const createTable = async (req: AuthRequest, res: ExpressResponse) => {
  const {
    tableNumber,
    name,
    capacity,
    shape,
    sectionId,
    positionX,
    positionY,
    width,
    height,
    rotation,
    displayOrder,
    status,
  } = req.body;
  const restaurantId = req.user!.restaurantId;
  const branchId = req.user!.branchId || String(req.body?.branchId || '');

  const branch = await prisma.branch.findFirst({ where: { id: branchId, restaurantId } });
  if (!branch) {
    return sendError(res, 'Invalid branch');
  }

  if (sectionId) {
    const section = await prisma.section.findFirst({ where: { id: sectionId, branchId, restaurantId } });
    if (!section) {
      return sendError(res, 'Invalid section for this branch');
    }
  }

  const existing = await prisma.table.findFirst({ where: { branchId, tableNumber, status: { not: 'INACTIVE' } } });
  if (existing) {
    return sendError(res, 'Table number already exists in this branch');
  }

  const table = await prisma.table.create({
    data: {
      restaurantId,
      branchId,
      sectionId: sectionId || null,
      tableNumber,
      name: name || tableNumber,
      capacity: capacity || 2,
      shape: shape || 'SQUARE',
      status: status || 'AVAILABLE',
      positionX: positionX ?? 0,
      positionY: positionY ?? 0,
      width: width || 80,
      height: height || 80,
      rotation: rotation || 0,
      displayOrder: displayOrder ?? 0,
    },
    include: {
      branch: { select: { id: true, name: true } },
      section: { select: { id: true, name: true } },
    },
  });

  await createAuditLog(
    restaurantId,
    req.user!.id,
    'CREATE',
    'Table',
    table.id,
    `Created table ${table.tableNumber}`
  );

  return sendResponse(res, true, 'Table created successfully', table, 201);
};

export const updateTable = async (req: AuthRequest, res: ExpressResponse) => {
  const { id } = req.params;
  const {
    tableNumber,
    name,
    capacity,
    shape,
    sectionId,
    positionX,
    positionY,
    width,
    height,
    rotation,
    displayOrder,
    status,
  } = req.body;
  const restaurantId = req.user!.restaurantId;
  const requestedBranchId = String(req.body?.branchId || '');
  const branchId = req.user!.branchId || requestedBranchId || undefined;

  const existing = await prisma.table.findFirst({ where: { id, restaurantId, ...(req.user!.branchId ? { branchId: req.user!.branchId } : {}) } });
  if (!existing) {
    return sendError(res, 'Table not found', undefined, 404);
  }

  if (branchId && branchId !== existing.branchId) {
    const branch = await prisma.branch.findFirst({ where: { id: branchId, restaurantId } });
    if (!branch) {
      return sendError(res, 'Invalid branch');
    }
  }

  const targetBranchId = branchId || existing.branchId;
  if (sectionId) {
    const section = await prisma.section.findFirst({ where: { id: sectionId, branchId: targetBranchId, restaurantId } });
    if (!section) {
      return sendError(res, 'Invalid section for this branch');
    }
  }

  if (tableNumber && tableNumber !== existing.tableNumber) {
    const duplicate = await prisma.table.findFirst({
      where: {
        branchId: targetBranchId,
        tableNumber,
        status: { not: 'INACTIVE' },
        id: { not: id },
      },
    });
    if (duplicate) {
      return sendError(res, 'Table number already exists in this branch');
    }
  }

  const table = await prisma.table.update({
    where: { id },
    data: {
      tableNumber,
      name,
      capacity,
      shape,
      branchId: branchId || existing.branchId,
      sectionId: sectionId === undefined ? undefined : sectionId || null,
      positionX,
      positionY,
      width,
      height,
      rotation,
      displayOrder,
    },
    include: {
      branch: { select: { id: true, name: true } },
      section: { select: { id: true, name: true } },
    },
  });

  await createAuditLog(
    restaurantId,
    req.user!.id,
    'UPDATE',
    'Table',
    id,
    `Updated table ${table.tableNumber}`
  );

  return sendResponse(res, true, 'Table updated successfully', table);
};

export const updateTablePosition = async (req: AuthRequest, res: ExpressResponse) => {
  const { id } = req.params;
  const { positionX, positionY, width, height, rotation } = req.body;
  const restaurantId = req.user!.restaurantId;

  const existing = await prisma.table.findFirst({ where: { id, restaurantId, ...(req.user!.branchId ? { branchId: req.user!.branchId } : {}) } });
  if (!existing) {
    return sendError(res, 'Table not found', undefined, 404);
  }

  const table = await prisma.table.update({
    where: { id },
    // Keep updatedAt: the board times "seated" and "needs cleaning" from it.
    data: { positionX, positionY, width, height, rotation, updatedAt: existing.updatedAt },
  });

  await createAuditLog(
    restaurantId,
    req.user!.id,
    'UPDATE',
    'Table',
    id,
    `Updated table ${table.tableNumber} position`
  );

  return sendResponse(res, true, 'Table position updated', table);
};

export const updateTableStatus = async (req: AuthRequest, res: ExpressResponse) => {
  const { id } = req.params;
  const { status } = req.body;
  const restaurantId = req.user!.restaurantId;

  const existing = await prisma.table.findFirst({ where: { id, restaurantId, status: { not: 'INACTIVE' }, ...(req.user!.branchId ? { branchId: req.user!.branchId } : {}) } });
  if (!existing) {
    return sendError(res, 'Table not found', undefined, 404);
  }
  if (!['AVAILABLE', 'RESERVED', 'CLEANING', 'OUT_OF_SERVICE'].includes(status)) {
    return sendError(res, 'Choose available, reserved, cleaning or out of service');
  }
  const result = await prisma.$transaction(async (tx) => {
    await lockTables(tx, [id]);
    const current = await tx.table.findUnique({ where: { id }, select: { status: true } });
    const openOrders = await tx.sale.count({ where: { tableId: id, status: { in: SEATED_ORDER_STATUSES } } });
    // Back in service with guests still on the bill: it becomes occupied again.
    const leavingOutOfService = current?.status === 'OUT_OF_SERVICE' && status === 'AVAILABLE';
    if (openOrders > 0 && status !== 'OUT_OF_SERVICE' && !leavingOutOfService) return null;
    await tx.table.update({ where: { id }, data: { status } });
    if (leavingOutOfService) await syncTableStatus(tx, id);
    return tx.table.findUnique({ where: { id } });
  });
  if (!result) {
    return sendError(res, `Table ${existing.tableNumber} has an open order. Close or move it first.`, undefined, 409);
  }
  const table = result;
  realtimeService.broadcast(`orders:${existing.branchId}`, 'table_updated', { tableId: id });

  await createAuditLog(
    restaurantId,
    req.user!.id,
    'UPDATE',
    'Table',
    id,
    `Changed table ${table.tableNumber} status to ${status}`
  );

  return sendResponse(res, true, 'Table status updated', table);
};

export const deleteTable = async (req: AuthRequest, res: ExpressResponse) => {
  const { id } = req.params;
  const restaurantId = req.user!.restaurantId;

  const existing = await prisma.table.findFirst({ where: { id, restaurantId, ...(req.user!.branchId ? { branchId: req.user!.branchId } : {}) } });
  if (!existing) {
    return sendError(res, 'Table not found', undefined, 404);
  }

  const activeOrdersCount = await prisma.sale.count({
    where: {
      tableId: id,
      status: { in: ['DRAFT', 'HELD', 'SUBMITTED', 'PREPARING', 'READY', 'SERVED'] },
    },
  });
  if (activeOrdersCount > 0) {
    return sendError(res, `Cannot deactivate table with ${activeOrdersCount} active order(s)`, undefined, 400);
  }

  const suffixedTableNumber = `${existing.tableNumber}__INACTIVE_${Date.now().toString().slice(-6)}`;
  await prisma.table.update({
    where: { id },
    data: { status: 'INACTIVE', tableNumber: suffixedTableNumber },
  });

  await createAuditLog(
    restaurantId,
    req.user!.id,
    'DELETE',
    'Table',
    id,
    `Deactivated table ${existing.tableNumber}`
  );

  return sendResponse(res, true, 'Table deactivated successfully');
};

export const getFloorLayout = async (req: AuthRequest, res: ExpressResponse) => {
  const restaurantId = req.user!.restaurantId;
  const { branchId } = req.query;

  const where: any = { restaurantId, status: { not: 'INACTIVE' } };
  const scopedBranch = req.user!.branchId || (typeof branchId === 'string' ? branchId : '');
  if (scopedBranch) {
    where.branchId = scopedBranch;
  }

  const tables = await prisma.table.findMany({
    where,
    include: {
      branch: { select: { id: true, name: true, code: true } },
      section: { select: { id: true, name: true } },
    },
    orderBy: { displayOrder: 'asc' },
  });

  const sections = await prisma.section.findMany({
    where: { restaurantId, status: 'ACTIVE', ...(scopedBranch ? { branchId: scopedBranch } : {}) },
    include: {
      _count: { select: { tables: true } },
    },
    orderBy: { displayOrder: 'asc' },
  });

  return sendResponse(res, true, 'Floor layout retrieved', {
    tables: tables.map((t) => ({
      id: t.id,
      tableNumber: t.tableNumber,
      name: t.name,
      capacity: t.capacity,
      shape: t.shape,
      status: t.status,
      positionX: t.positionX,
      positionY: t.positionY,
      width: t.width,
      height: t.height,
      rotation: t.rotation,
      branchId: t.branchId,
      branchName: t.branch.name,
      sectionId: t.sectionId,
      sectionName: t.section?.name,
    })),
    sections: sections.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      displayOrder: s.displayOrder,
      status: s.status,
      branchId: s.branchId,
      tableCount: s._count.tables,
    })),
  });
};
