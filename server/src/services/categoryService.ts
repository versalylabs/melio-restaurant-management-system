import prisma from '../config/database';
import { AuthRequest } from '../middleware/auth';
import { sendResponse, sendError } from '../utils/response';
import { Response as ExpressResponse } from 'express';
import { createAuditLog } from './auditLogService';

export const getCategories = async (req: AuthRequest, res: ExpressResponse) => {
  const restaurantId = req.user!.restaurantId;
  const { search, status } = req.query;

  const where: any = { restaurantId };
  if (search) {
    where.name = { contains: search as string };
  }
  if (status) {
    where.status = status as string;
  }

  const categories = await prisma.menuCategory.findMany({
    where,
    include: {
      _count: { select: { menuItems: true } },
    },
    orderBy: { displayOrder: 'asc' },
  });

  return sendResponse(res, true, 'Categories retrieved', {
    categories: categories.map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description,
      displayOrder: c.displayOrder,
      status: c.status,
      itemCount: c._count.menuItems,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    })),
  });
};

export const getCategory = async (req: AuthRequest, res: ExpressResponse) => {
  const { id } = req.params;
  const restaurantId = req.user!.restaurantId;

  const category = await prisma.menuCategory.findFirst({
    where: { id, restaurantId },
    include: {
      menuItems: {
        where: { restaurantId },
        select: { id: true, name: true, sellingPrice: true, status: true, available: true },
      },
    },
  });

  if (!category) {
    return sendError(res, 'Category not found', undefined, 404);
  }

  return sendResponse(res, true, 'Category retrieved', category);
};

export const createCategory = async (req: AuthRequest, res: ExpressResponse) => {
  const { name, description, displayOrder, status } = req.body;
  const restaurantId = req.user!.restaurantId;

  const trimmedName = name ? String(name).trim() : '';
  if (!trimmedName) {
    return sendError(res, 'Category name is required');
  }

  const existingCategories = await prisma.menuCategory.findMany({
    where: {
      restaurantId,
      status: { not: 'INACTIVE' },
    },
    select: { id: true, name: true },
  });
  if (existingCategories.some((c) => c.name.toLowerCase() === trimmedName.toLowerCase())) {
    return sendError(res, 'A category with this name already exists', undefined, 409);
  }

  const category = await prisma.menuCategory.create({
    data: {
      restaurantId,
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
    'MenuCategory',
    category.id,
    `Created category ${category.name}`
  );

  return sendResponse(res, true, 'Category created successfully', category, 201);
};

export const updateCategory = async (req: AuthRequest, res: ExpressResponse) => {
  const { id } = req.params;
  const { name, description, displayOrder, status } = req.body;
  const restaurantId = req.user!.restaurantId;

  const existing = await prisma.menuCategory.findFirst({ where: { id, restaurantId } });
  if (!existing) {
    return sendError(res, 'Category not found', undefined, 404);
  }

  let trimmedName = existing.name;
  if (name !== undefined) {
    trimmedName = String(name).trim();
    if (!trimmedName) {
      return sendError(res, 'Category name cannot be empty');
    }

    const existingCategories = await prisma.menuCategory.findMany({
      where: {
        restaurantId,
        id: { not: id },
        status: { not: 'INACTIVE' },
      },
      select: { id: true, name: true },
    });
    if (existingCategories.some((c) => c.name.toLowerCase() === trimmedName.toLowerCase())) {
      return sendError(res, 'A category with this name already exists', undefined, 409);
    }
  }

  const category = await prisma.menuCategory.update({
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
    'MenuCategory',
    id,
    `Updated category ${category.name}`
  );

  return sendResponse(res, true, 'Category updated successfully', category);
};

export const deleteCategory = async (req: AuthRequest, res: ExpressResponse) => {
  const { id } = req.params;
  const restaurantId = req.user!.restaurantId;

  const existing = await prisma.menuCategory.findFirst({ where: { id, restaurantId } });
  if (!existing) {
    return sendError(res, 'Category not found', undefined, 404);
  }

  const activeItemsCount = await prisma.menuItem.count({
    where: { categoryId: id, status: { not: 'INACTIVE' } },
  });
  if (activeItemsCount > 0) {
    return sendError(res, `Cannot deactivate category with ${activeItemsCount} active menu item(s). Please reassign or deactivate the items first.`, undefined, 400);
  }

  await prisma.menuCategory.update({ where: { id }, data: { status: 'INACTIVE' } });

  await createAuditLog(
    restaurantId,
    req.user!.id,
    'DELETE',
    'MenuCategory',
    id,
    `Deactivated category ${existing.name}`
  );

  return sendResponse(res, true, 'Category deactivated successfully');
};
