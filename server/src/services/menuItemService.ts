import prisma from '../config/database';
import { AuthRequest } from '../middleware/auth';
import { sendResponse, sendError } from '../utils/response';
import { Response as ExpressResponse } from 'express';
import { createAuditLog } from './auditLogService';

export const getMenuItems = async (req: AuthRequest, res: ExpressResponse) => {
  const restaurantId = req.user!.restaurantId;
  const { search, categoryId, status, available, branchId, page = '1', limit = '20' } = req.query;

  const skip = (parseInt(page as string) - 1) * parseInt(limit as string);

  const where: any = { restaurantId };
  if (search) {
    where.name = { contains: search as string };
  }
  if (categoryId) {
    where.categoryId = categoryId as string;
  }
  if (status) {
    where.status = status as string;
  }
  if (available !== undefined) {
    where.available = available === 'true';
  }
  if (branchId) {
    where.branchAvailabilities = { some: { branchId: branchId as string, available: true } };
  }

  const [items, total] = await Promise.all([
    prisma.menuItem.findMany({
      where,
      skip,
      take: parseInt(limit as string),
      orderBy: { displayOrder: 'asc' },
      include: {
        category: { select: { id: true, name: true } },
        branchAvailabilities: { include: { branch: { select: { id: true, name: true } } } },
        modifierGroups: { include: { modifierGroup: { select: { id: true, name: true } } } },
      },
    }),
    prisma.menuItem.count({ where }),
  ]);

  const showCostPrice = ['OWNER', 'ADMIN', 'MANAGER'].includes(req.user!.roleName);

  return sendResponse(res, true, 'Menu items retrieved', {
    items: items.map((item) => ({
      id: item.id,
      name: item.name,
      description: item.description,
      image: item.image,
      sku: item.sku,
      sellingPrice: item.sellingPrice,
      costPrice: showCostPrice ? item.costPrice : undefined,
      taxRate: item.taxRate,
      preparationTime: item.preparationTime,
      status: item.status,
      available: item.available,
      displayOrder: item.displayOrder,
      categoryId: item.categoryId,
      categoryName: item.category.name,
      branches: item.branchAvailabilities.map((b: any) => ({
        id: b.branch.id,
        name: b.branch.name,
        available: b.available,
      })),
      modifierGroups: item.modifierGroups.map((mg: any) => ({
        id: mg.modifierGroup.id,
        name: mg.modifierGroup.name,
      })),
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    })),
    pagination: {
      page: parseInt(page as string),
      limit: parseInt(limit as string),
      total,
      totalPages: Math.ceil(total / parseInt(limit as string)),
    },
  });
};

export const getMenuItem = async (req: AuthRequest, res: ExpressResponse) => {
  const { id } = req.params;
  const restaurantId = req.user!.restaurantId;

  const item = await prisma.menuItem.findFirst({
    where: { id, restaurantId },
    include: {
      category: { select: { id: true, name: true } },
      branchAvailabilities: { include: { branch: { select: { id: true, name: true, code: true } } } },
      modifierGroups: {
        include: {
          modifierGroup: {
            include: { options: { where: { status: 'ACTIVE' }, orderBy: { displayOrder: 'asc' } } },
          },
        },
      },
    },
  });

  if (!item) {
    return sendError(res, 'Menu item not found', undefined, 404);
  }

  const showCostPrice = ['OWNER', 'ADMIN', 'MANAGER'].includes(req.user!.roleName);

  return sendResponse(res, true, 'Menu item retrieved', {
    ...item,
    costPrice: showCostPrice ? item.costPrice : undefined,
  });
};

export const createMenuItem = async (req: AuthRequest, res: ExpressResponse) => {
  const {
    name,
    description,
    image,
    sku,
    sellingPrice,
    costPrice,
    taxRate,
    preparationTime,
    categoryId,
    available,
    status,
    displayOrder,
    branchIds,
    modifierGroupIds,
  } = req.body;
  const restaurantId = req.user!.restaurantId;

  const category = await prisma.menuCategory.findFirst({ where: { id: categoryId, restaurantId } });
  if (!category) {
    return sendError(res, 'Invalid category');
  }

  const uniqueBranchIds = Array.isArray(branchIds) ? [...new Set(branchIds.map(String).filter(Boolean))] : [];
  const uniqueModifierGroupIds = Array.isArray(modifierGroupIds) ? [...new Set(modifierGroupIds.map(String).filter(Boolean))] : [];

  if (uniqueBranchIds.length > 0) {
    const validBranches = await prisma.branch.findMany({
      where: { id: { in: uniqueBranchIds }, restaurantId },
      select: { id: true },
    });
    if (validBranches.length !== uniqueBranchIds.length) {
      return sendError(res, 'One or more branch IDs are invalid');
    }
  }

  if (uniqueModifierGroupIds.length > 0) {
    const validGroups = await prisma.modifierGroup.findMany({
      where: { id: { in: uniqueModifierGroupIds }, restaurantId },
      select: { id: true },
    });
    if (validGroups.length !== uniqueModifierGroupIds.length) {
      return sendError(res, 'One or more modifier group IDs are invalid');
    }
  }

  const item = await prisma.menuItem.create({
    data: {
      restaurantId,
      name,
      description,
      image,
      sku,
      sellingPrice,
      costPrice,
      taxRate: taxRate ?? 0,
      preparationTime,
      categoryId,
      available: available ?? true,
      status: status || 'ACTIVE',
      displayOrder: displayOrder ?? 0,
      branchAvailabilities: {
        create: uniqueBranchIds.map((branchId: string) => ({ branchId, available: true })),
      },
      modifierGroups: {
        create: uniqueModifierGroupIds.map((modifierGroupId: string) => ({ modifierGroupId })),
      },
    },
    include: {
      branchAvailabilities: { include: { branch: true } },
      modifierGroups: { include: { modifierGroup: true } },
    },
  });

  await createAuditLog(
    restaurantId,
    req.user!.id,
    'CREATE',
    'MenuItem',
    item.id,
    `Created menu item ${item.name}`
  );

  return sendResponse(res, true, 'Menu item created successfully', item, 201);
};

export const updateMenuItem = async (req: AuthRequest, res: ExpressResponse) => {
  const { id } = req.params;
  const {
    name,
    description,
    image,
    sku,
    sellingPrice,
    costPrice,
    taxRate,
    preparationTime,
    categoryId,
    available,
    status,
    displayOrder,
    branchIds,
    modifierGroupIds,
  } = req.body;
  const restaurantId = req.user!.restaurantId;

  const existing = await prisma.menuItem.findFirst({ where: { id, restaurantId } });
  if (!existing) {
    return sendError(res, 'Menu item not found', undefined, 404);
  }

  if (categoryId) {
    const category = await prisma.menuCategory.findFirst({ where: { id: categoryId, restaurantId } });
    if (!category) {
      return sendError(res, 'Invalid category');
    }
  }

  const uniqueBranchIds = Array.isArray(branchIds) ? [...new Set(branchIds.map(String).filter(Boolean))] : undefined;
  const uniqueModifierGroupIds = Array.isArray(modifierGroupIds) ? [...new Set(modifierGroupIds.map(String).filter(Boolean))] : undefined;

  if (uniqueBranchIds && uniqueBranchIds.length > 0) {
    const validBranches = await prisma.branch.findMany({
      where: { id: { in: uniqueBranchIds }, restaurantId },
      select: { id: true },
    });
    if (validBranches.length !== uniqueBranchIds.length) {
      return sendError(res, 'One or more branch IDs are invalid');
    }
  }

  if (uniqueModifierGroupIds && uniqueModifierGroupIds.length > 0) {
    const validGroups = await prisma.modifierGroup.findMany({
      where: { id: { in: uniqueModifierGroupIds }, restaurantId },
      select: { id: true },
    });
    if (validGroups.length !== uniqueModifierGroupIds.length) {
      return sendError(res, 'One or more modifier group IDs are invalid');
    }
  }

  const updated = await prisma.menuItem.update({
    where: { id },
    data: {
      name,
      description,
      image,
      sku,
      sellingPrice,
      costPrice,
      taxRate,
      preparationTime,
      categoryId,
      available,
      status,
      displayOrder,
      ...(uniqueBranchIds !== undefined
        ? {
            branchAvailabilities: {
              deleteMany: {},
              create: uniqueBranchIds.map((branchId: string) => ({ branchId, available: true })),
            },
          }
        : {}),
      ...(uniqueModifierGroupIds !== undefined
        ? {
            modifierGroups: {
              deleteMany: {},
              create: uniqueModifierGroupIds.map((modifierGroupId: string) => ({ modifierGroupId })),
            },
          }
        : {}),
    },
    include: {
      branchAvailabilities: { include: { branch: true } },
      modifierGroups: { include: { modifierGroup: true } },
    },
  });

  await createAuditLog(
    restaurantId,
    req.user!.id,
    'UPDATE',
    'MenuItem',
    id,
    `Updated menu item ${updated.name}`
  );

  return sendResponse(res, true, 'Menu item updated successfully', updated);
};

export const deleteMenuItem = async (req: AuthRequest, res: ExpressResponse) => {
  const { id } = req.params;
  const restaurantId = req.user!.restaurantId;

  const existing = await prisma.menuItem.findFirst({ where: { id, restaurantId } });
  if (!existing) {
    return sendError(res, 'Menu item not found', undefined, 404);
  }

  const saleItemCount = await prisma.saleItem.count({ where: { menuItemId: id } });

  await prisma.$transaction(async (tx) => {
    await tx.websiteSettings.updateMany({
      where: { restaurantId, featuredMenuItemId: id },
      data: { featuredMenuItemId: null },
    });

    await tx.promotion.updateMany({
      where: { restaurantId, menuItemId: id },
      data: { menuItemId: null, active: false },
    });

    if (saleItemCount > 0) {
      await tx.menuItem.update({
        where: { id },
        data: { status: 'INACTIVE', available: false },
      });
    } else {
      await tx.menuItem.delete({ where: { id } });
    }
  });

  await createAuditLog(
    restaurantId,
    req.user!.id,
    'DELETE',
    'MenuItem',
    id,
    saleItemCount > 0
      ? `Deactivated menu item ${existing.name} (has historical sales)`
      : `Permanently deleted menu item ${existing.name}`
  );

  return sendResponse(
    res,
    true,
    saleItemCount > 0
      ? 'Menu item deactivated to preserve historical sales records'
      : 'Menu item permanently deleted successfully'
  );
};

export const duplicateMenuItem = async (req: AuthRequest, res: ExpressResponse) => {
  const { id } = req.params;
  const { name } = req.body;
  const restaurantId = req.user!.restaurantId;

  const existing = await prisma.menuItem.findFirst({
    where: { id, restaurantId },
    include: {
      branchAvailabilities: true,
      modifierGroups: true,
    },
  });

  if (!existing) {
    return sendError(res, 'Menu item not found', undefined, 404);
  }

  const newName = name || `${existing.name} (Copy)`;

  const duplicated = await prisma.menuItem.create({
    data: {
      restaurantId,
      name: newName,
      description: existing.description,
      image: existing.image,
      sku: existing.sku ? `${existing.sku}-copy` : undefined,
      sellingPrice: existing.sellingPrice,
      costPrice: existing.costPrice,
      taxRate: existing.taxRate,
      preparationTime: existing.preparationTime,
      categoryId: existing.categoryId,
      available: existing.available,
      status: 'ACTIVE',
      displayOrder: existing.displayOrder,
      branchAvailabilities: {
        create: existing.branchAvailabilities.map((b) => ({
          branchId: b.branchId,
          available: b.available,
        })),
      },
      modifierGroups: {
        create: existing.modifierGroups.map((mg) => ({
          modifierGroupId: mg.modifierGroupId,
        })),
      },
    },
    include: {
      branchAvailabilities: { include: { branch: true } },
      modifierGroups: { include: { modifierGroup: true } },
    },
  });

  await createAuditLog(
    restaurantId,
    req.user!.id,
    'CREATE',
    'MenuItem',
    duplicated.id,
    `Duplicated menu item ${existing.name} as ${duplicated.name}`
  );

  return sendResponse(res, true, 'Menu item duplicated successfully', duplicated, 201);
};
