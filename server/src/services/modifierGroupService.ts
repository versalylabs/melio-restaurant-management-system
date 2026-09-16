import prisma from '../config/database';
import { AuthRequest } from '../middleware/auth';
import { sendResponse, sendError } from '../utils/response';
import { Response as ExpressResponse } from 'express';
import { createAuditLog } from './auditLogService';

export const getModifierGroups = async (req: AuthRequest, res: ExpressResponse) => {
  const restaurantId = req.user!.restaurantId;
  const { search, status } = req.query;

  const where: any = { restaurantId };
  if (search) {
    where.name = { contains: search as string };
  }
  if (status) {
    where.status = status as string;
  }

  const groups = await prisma.modifierGroup.findMany({
    where,
    include: {
      options: { orderBy: { displayOrder: 'asc' } },
      _count: { select: { menuItemLinks: true } },
    },
    orderBy: { displayOrder: 'asc' },
  });

  return sendResponse(res, true, 'Modifier groups retrieved', {
    groups: groups.map((g) => ({
      id: g.id,
      name: g.name,
      description: g.description,
      selectionType: g.selectionType,
      isRequired: g.isRequired,
      displayOrder: g.displayOrder,
      status: g.status,
      optionCount: g.options.length,
      menuItemCount: g._count.menuItemLinks,
      options: g.options,
      createdAt: g.createdAt,
      updatedAt: g.updatedAt,
    })),
  });
};

export const getModifierGroup = async (req: AuthRequest, res: ExpressResponse) => {
  const { id } = req.params;
  const restaurantId = req.user!.restaurantId;

  const group = await prisma.modifierGroup.findFirst({
    where: { id, restaurantId },
    include: {
      options: { orderBy: { displayOrder: 'asc' } },
    },
  });

  if (!group) {
    return sendError(res, 'Modifier group not found', undefined, 404);
  }

  return sendResponse(res, true, 'Modifier group retrieved', group);
};

export const createModifierGroup = async (req: AuthRequest, res: ExpressResponse) => {
  const { name, description, selectionType, isRequired, displayOrder, status, options } = req.body;
  const restaurantId = req.user!.restaurantId;

  const group = await prisma.modifierGroup.create({
    data: {
      restaurantId,
      name,
      description,
      selectionType: selectionType || 'SINGLE',
      isRequired: isRequired ?? false,
      displayOrder: displayOrder ?? 0,
      status: status || 'ACTIVE',
      options: {
        create: (options || []).map((opt: any) => ({
          name: opt.name,
          priceAdjustment: opt.priceAdjustment ?? 0,
          displayOrder: opt.displayOrder ?? 0,
          status: opt.status || 'ACTIVE',
        })),
      },
    },
    include: { options: true },
  });

  await createAuditLog(
    restaurantId,
    req.user!.id,
    'CREATE',
    'ModifierGroup',
    group.id,
    `Created modifier group ${group.name}`
  );

  return sendResponse(res, true, 'Modifier group created successfully', group, 201);
};

export const updateModifierGroup = async (req: AuthRequest, res: ExpressResponse) => {
  const { id } = req.params;
  const { name, description, selectionType, isRequired, displayOrder, status, options } = req.body;
  const restaurantId = req.user!.restaurantId;

  const existing = await prisma.modifierGroup.findFirst({ where: { id, restaurantId } });
  if (!existing) {
    return sendError(res, 'Modifier group not found', undefined, 404);
  }

  const updated = await prisma.modifierGroup.update({
    where: { id },
    data: {
      name,
      description,
      selectionType,
      isRequired,
      displayOrder,
      status,
      options: {
        deleteMany: {},
        create: (options || []).map((opt: any) => ({
          name: opt.name,
          priceAdjustment: opt.priceAdjustment ?? 0,
          displayOrder: opt.displayOrder ?? 0,
          status: opt.status || 'ACTIVE',
        })),
      },
    },
    include: { options: true },
  });

  await createAuditLog(
    restaurantId,
    req.user!.id,
    'UPDATE',
    'ModifierGroup',
    id,
    `Updated modifier group ${updated.name}`
  );

  return sendResponse(res, true, 'Modifier group updated successfully', updated);
};

export const deleteModifierGroup = async (req: AuthRequest, res: ExpressResponse) => {
  const { id } = req.params;
  const restaurantId = req.user!.restaurantId;

  const existing = await prisma.modifierGroup.findFirst({ where: { id, restaurantId } });
  if (!existing) {
    return sendError(res, 'Modifier group not found', undefined, 404);
  }

  await prisma.modifierGroup.update({ where: { id }, data: { status: 'INACTIVE' } });

  await createAuditLog(
    restaurantId,
    req.user!.id,
    'DELETE',
    'ModifierGroup',
    id,
    `Deactivated modifier group ${existing.name}`
  );

  return sendResponse(res, true, 'Modifier group deactivated successfully');
};
