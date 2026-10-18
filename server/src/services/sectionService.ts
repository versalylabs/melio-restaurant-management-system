import prisma from '../config/database';
import { AuthRequest } from '../middleware/auth';
import { sendResponse, sendError } from '../utils/response';
import { Response as ExpressResponse } from 'express';
import { createAuditLog } from './auditLogService';

export const getSections = async (req: AuthRequest, res: ExpressResponse) => {
  const restaurantId = req.user!.restaurantId;
  const requestedBranchId = typeof req.query.branchId === 'string' ? req.query.branchId : undefined;
  const branchId = req.user!.branchId || requestedBranchId;
  const { status } = req.query;

  const where: any = { restaurantId, ...(branchId ? { branchId } : {}) };
  if (status) {
    where.status = status as string;
  }

  const sections = await prisma.section.findMany({
    where,
    include: {
      _count: { select: { tables: true } },
    },
    orderBy: { displayOrder: 'asc' },
  });

  return sendResponse(res, true, 'Sections retrieved', {
    sections: sections.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      displayOrder: s.displayOrder,
      status: s.status,
      branchId: s.branchId,
      tableCount: s._count.tables,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    })),
  });
};

export const getSection = async (req: AuthRequest, res: ExpressResponse) => {
  const { id } = req.params;
  const restaurantId = req.user!.restaurantId;

  const section = await prisma.section.findFirst({
    where: { id, restaurantId, ...(req.user!.branchId ? { branchId: req.user!.branchId } : {}) },
    include: {
      tables: {
        where: { restaurantId },
        select: { id: true, tableNumber: true, name: true, status: true, capacity: true },
      },
    },
  });

  if (!section) {
    return sendError(res, 'Section not found', undefined, 404);
  }

  return sendResponse(res, true, 'Section retrieved', section);
};

export const createSection = async (req: AuthRequest, res: ExpressResponse) => {
  const { name, description, displayOrder, status } = req.body;
  const restaurantId = req.user!.restaurantId;
  const branchId = req.user!.branchId || String(req.body?.branchId || '');

  const trimmedName = name ? String(name).trim() : '';
  if (!trimmedName) {
    return sendError(res, 'Section name is required');
  }

  const branch = await prisma.branch.findFirst({ where: { id: branchId, restaurantId } });
  if (!branch) {
    return sendError(res, 'Invalid branch');
  }

  const existingSections = await prisma.section.findMany({
    where: {
      branchId,
      restaurantId,
      status: { not: 'INACTIVE' },
    },
    select: { id: true, name: true },
  });
  if (existingSections.some((s) => s.name.toLowerCase() === trimmedName.toLowerCase())) {
    return sendError(res, 'A section with this name already exists in this branch', undefined, 409);
  }

  const section = await prisma.section.create({
    data: {
      restaurantId,
      branchId,
      name: trimmedName,
      description: description ? String(description).trim() : null,
      displayOrder: displayOrder ?? 0,
      status: status || 'ACTIVE',
    },
  });

  await createAuditLog(
    restaurantId,
    req.user!.id,
    'CREATE',
    'Section',
    section.id,
    `Created section ${section.name}`
  );

  return sendResponse(res, true, 'Section created successfully', section, 201);
};

export const updateSection = async (req: AuthRequest, res: ExpressResponse) => {
  const { id } = req.params;
  const { name, description, displayOrder, status } = req.body;
  const restaurantId = req.user!.restaurantId;

  const existing = await prisma.section.findFirst({ where: { id, restaurantId, ...(req.user!.branchId ? { branchId: req.user!.branchId } : {}) } });
  if (!existing) {
    return sendError(res, 'Section not found', undefined, 404);
  }

  let trimmedName = existing.name;
  if (name !== undefined) {
    trimmedName = String(name).trim();
    if (!trimmedName) {
      return sendError(res, 'Section name cannot be empty');
    }

    const existingSections = await prisma.section.findMany({
      where: {
        branchId: existing.branchId,
        restaurantId,
        id: { not: id },
        status: { not: 'INACTIVE' },
      },
      select: { id: true, name: true },
    });
    if (existingSections.some((s) => s.name.toLowerCase() === trimmedName.toLowerCase())) {
      return sendError(res, 'A section with this name already exists in this branch', undefined, 409);
    }
  }

  const section = await prisma.section.update({
    where: { id },
    data: {
      name: trimmedName,
      description: description !== undefined ? (description ? String(description).trim() : null) : undefined,
      displayOrder: displayOrder !== undefined ? displayOrder : undefined,
      status: status !== undefined ? status : undefined,
    },
  });

  await createAuditLog(
    restaurantId,
    req.user!.id,
    'UPDATE',
    'Section',
    id,
    `Updated section ${section.name}`
  );

  return sendResponse(res, true, 'Section updated successfully', section);
};

export const deleteSection = async (req: AuthRequest, res: ExpressResponse) => {
  const { id } = req.params;
  const restaurantId = req.user!.restaurantId;

  const existing = await prisma.section.findFirst({ where: { id, restaurantId, ...(req.user!.branchId ? { branchId: req.user!.branchId } : {}) } });
  if (!existing) {
    return sendError(res, 'Section not found', undefined, 404);
  }

  const activeTables = await prisma.table.count({
    where: { sectionId: id, status: { not: 'INACTIVE' } },
  });
  if (activeTables > 0) {
    return sendError(res, `Cannot deactivate section with ${activeTables} active table(s). Please reassign or delete the tables first.`, undefined, 400);
  }

  await prisma.section.update({ where: { id }, data: { status: 'INACTIVE' } });

  await createAuditLog(
    restaurantId,
    req.user!.id,
    'DELETE',
    'Section',
    id,
    `Deactivated section ${existing.name}`
  );

  return sendResponse(res, true, 'Section deactivated successfully');
};
