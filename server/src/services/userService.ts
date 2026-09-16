import prisma from '../config/database';
import { AuthRequest } from '../middleware/auth';
import { sendResponse, sendError } from '../utils/response';
import { Response as ExpressResponse } from 'express';
import { createAuditLog } from '../services/auditLogService';

export const getUsers = async (req: AuthRequest, res: ExpressResponse) => {
  const users = await prisma.user.findMany({
    where: { restaurantId: req.user!.restaurantId },
    include: {
      role: { select: { id: true, name: true } },
      branch: { select: { id: true, name: true } },
      userStations: { include: { station: { select: { id: true, name: true, branchId: true, status: true, branch: { select: { name: true } } } } } },
    },
    orderBy: { createdAt: 'desc' },
  });

  const formattedUsers = users.map((u) => ({
    id: u.id,
    firstName: u.firstName,
    lastName: u.lastName,
    email: u.email,
    phone: u.phone,
    roleId: u.roleId,
    roleName: u.role.name,
    branchId: u.branchId,
    branchName: u.branch?.name,
    stations: u.userStations.map((us) => ({ id: us.station.id, name: us.station.name, branchId: us.station.branchId, branchName: us.station.branch.name })),
    status: u.status,
    employeeCode: u.employeeCode,
    jobTitle: u.jobTitle,
    hireDate: u.hireDate,
    notes: u.notes,
    createdAt: u.createdAt,
  }));

  return sendResponse(res, true, 'Users retrieved', { users: formattedUsers });
};

export const createUser = async (req: AuthRequest, res: ExpressResponse) => {
  const { firstName, lastName, email, phone, roleId, branchId, password, stationIds, employeeCode, jobTitle, hireDate, notes } = req.body as {
    firstName: string;
    lastName: string;
    email: string;
    phone?: string;
    roleId: string;
    branchId?: string;
    password?: string;
    stationIds?: string[];
    employeeCode?: string;
    jobTitle?: string;
    hireDate?: string;
    notes?: string;
  };

  const existing = await prisma.user.findFirst({
    where: { restaurantId: req.user!.restaurantId, email },
  });

  if (existing) {
    return sendError(res, 'User with this email already exists');
  }

  const bcrypt = await import('bcryptjs');
  const passwordHash = await bcrypt.hash(password || 'melio@2026', 12);

  const user = await prisma.user.create({
    data: {
      restaurantId: req.user!.restaurantId,
      firstName,
      lastName,
      email,
      phone,
      roleId,
      branchId: branchId || undefined,
      passwordHash,
      status: 'ACTIVE',
      employeeCode: employeeCode || undefined,
      jobTitle: jobTitle || undefined,
      hireDate: hireDate ? new Date(hireDate) : undefined,
      notes: notes || undefined,
      passwordChangedAt: new Date(),
    },
    include: {
      role: { select: { id: true, name: true } },
      branch: { select: { id: true, name: true } },
    },
  });

  if (Array.isArray(stationIds) && stationIds.length) {
    const stations = await prisma.kitchenStation.findMany({ where: { id: { in: stationIds }, restaurantId: req.user!.restaurantId, ...(branchId ? { branchId } : {}) }, select: { id: true } });
    await prisma.userKitchenStation.createMany({ data: stations.map((station) => ({ userId: user.id, stationId: station.id })) });
  }

  await createAuditLog(
    req.user!.restaurantId,
    req.user!.id,
    'CREATE',
    'User',
    user.id,
    `Created user ${user.firstName} ${user.lastName}`
  );

  const createdStationLinks = await prisma.userKitchenStation.findMany({ where: { userId: user.id }, include: { station: { include: { branch: { select: { name: true } } } } } });

  return sendResponse(res, true, 'User created successfully', {
    id: user.id,
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    phone: user.phone,
    roleId: user.roleId,
    roleName: user.role.name,
    branchId: user.branchId,
    branchName: user.branch?.name,
    stations: createdStationLinks.map((us) => ({ id: us.station.id, name: us.station.name, branchId: us.station.branchId, branchName: us.station.branch.name })),
    status: user.status,
    employeeCode: user.employeeCode,
    jobTitle: user.jobTitle,
    hireDate: user.hireDate,
    notes: user.notes,
  }, 201);
};

export const updateUser = async (req: AuthRequest, res: ExpressResponse) => {
  const { id } = req.params;
  const { firstName, lastName, email, phone, roleId, branchId, status, stationIds, employeeCode, jobTitle, hireDate, notes } = req.body as {
    firstName: string;
    lastName: string;
    email: string;
    phone?: string;
    roleId: string;
    branchId?: string;
    status?: string;
    stationIds?: string[];
    employeeCode?: string;
    jobTitle?: string;
    hireDate?: string;
    notes?: string;
  };

  const user = await prisma.user.findFirst({
    where: { id, restaurantId: req.user!.restaurantId },
  });

  if (!user) {
    return sendError(res, 'User not found', undefined, 404);
  }

  if (id === req.user!.id && status === 'INACTIVE') return sendError(res, 'You cannot deactivate your own account');
  const targetRole = await prisma.role.findUnique({ where: { id: user.roleId } });
  if (targetRole?.name === 'OWNER' && req.user!.roleName !== 'OWNER' && (status === 'INACTIVE' || roleId !== user.roleId)) return sendError(res, 'Only an owner can modify an owner account', undefined, 403);

  const updated = await prisma.user.update({
    where: { id },
    data: {
      firstName,
      lastName,
      email,
      phone,
      roleId,
      branchId: branchId || undefined,
      status: status || user.status,
      employeeCode: employeeCode || undefined,
      jobTitle: jobTitle || undefined,
      hireDate: hireDate ? new Date(hireDate) : undefined,
      notes: notes || undefined,
    },
    include: {
      role: { select: { id: true, name: true } },
      branch: { select: { id: true, name: true } },
    },
  });

  if (Array.isArray(stationIds)) {
    const stations = await prisma.kitchenStation.findMany({ where: { id: { in: stationIds }, restaurantId: req.user!.restaurantId, ...(branchId ? { branchId } : {}) }, select: { id: true } });
    await prisma.userKitchenStation.deleteMany({ where: { userId: id } });
    if (stations.length) await prisma.userKitchenStation.createMany({ data: stations.map((station) => ({ userId: id, stationId: station.id })) });
  }

  await createAuditLog(
    req.user!.restaurantId,
    req.user!.id,
    'UPDATE',
    'User',
    id,
    `Updated user ${updated.firstName} ${updated.lastName}`
  );

  const updatedStationLinks = await prisma.userKitchenStation.findMany({ where: { userId: updated.id }, include: { station: { include: { branch: { select: { name: true } } } } } });

  return sendResponse(res, true, 'User updated successfully', {
    id: updated.id,
    firstName: updated.firstName,
    lastName: updated.lastName,
    email: updated.email,
    phone: updated.phone,
    roleId: updated.roleId,
    roleName: updated.role.name,
    branchId: updated.branchId,
    branchName: updated.branch?.name,
    stations: updatedStationLinks.map((us) => ({ id: us.station.id, name: us.station.name, branchId: us.station.branchId, branchName: us.station.branch.name })),
    status: updated.status,
    employeeCode: updated.employeeCode,
    jobTitle: updated.jobTitle,
    hireDate: updated.hireDate,
    notes: updated.notes,
  });
};

export const deleteUser = async (req: AuthRequest, res: ExpressResponse) => {
  const { id } = req.params;

  const user = await prisma.user.findFirst({
    where: { id, restaurantId: req.user!.restaurantId },
  });

  if (!user) {
    return sendError(res, 'User not found', undefined, 404);
  }

  if (id === req.user!.id) {
    return sendError(res, 'You cannot delete your own account');
  }

  if (user.roleId === req.user!.roleId && user.roleId) {
    const role = await prisma.role.findUnique({ where: { id: user.roleId } });
    if (role?.name === 'OWNER') return sendError(res, 'Owner accounts cannot be deleted');
  }

  await prisma.user.delete({ where: { id } });

  await createAuditLog(
    req.user!.restaurantId,
    req.user!.id,
    'DELETE',
    'User',
    id,
    `Deleted user ${user.firstName} ${user.lastName}`
  );

  return sendResponse(res, true, 'User deleted successfully');
};


export const changeOwnPassword = async (req: AuthRequest, res: ExpressResponse) => {
  const { currentPassword, newPassword } = req.body as { currentPassword: string; newPassword: string };
  if (!currentPassword || !newPassword || newPassword.length < 8) return sendError(res, 'A new password of at least 8 characters is required');
  const user = await prisma.user.findFirst({ where: { id: req.user!.id, restaurantId: req.user!.restaurantId } });
  if (!user) return sendError(res, 'User not found', undefined, 404);
  const bcrypt = await import('bcryptjs');
  if (!(await bcrypt.compare(currentPassword, user.passwordHash))) return sendError(res, 'Current password is incorrect', undefined, 400);
  const passwordHash = await bcrypt.hash(newPassword, 12);
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash, passwordChangedAt: new Date(), tokenVersion: { increment: 1 } } });
  await createAuditLog(req.user!.restaurantId, req.user!.id, 'PASSWORD_CHANGE', 'User', user.id, `Changed password for ${user.firstName} ${user.lastName}`);
  return sendResponse(res, true, 'Password changed successfully. Please sign in again.');
};

export const resetUserPassword = async (req: AuthRequest, res: ExpressResponse) => {
  const { id } = req.params;
  const { newPassword } = req.body as { newPassword: string };
  if (!newPassword || newPassword.length < 8) return sendError(res, 'Password must be at least 8 characters');
  const user = await prisma.user.findFirst({ where: { id, restaurantId: req.user!.restaurantId } });
  if (!user) return sendError(res, 'User not found', undefined, 404);
  if (user.roleId) {
    const targetRole = await prisma.role.findUnique({ where: { id: user.roleId } });
    if (targetRole?.name === 'OWNER' && req.user!.roleName !== 'OWNER') return sendError(res, 'Only an owner can reset an owner password', undefined, 403);
  }
  const bcrypt = await import('bcryptjs');
  const passwordHash = await bcrypt.hash(newPassword, 12);
  await prisma.user.update({ where: { id }, data: { passwordHash, passwordChangedAt: new Date(), tokenVersion: { increment: 1 } } });
  await createAuditLog(req.user!.restaurantId, req.user!.id, 'PASSWORD_RESET', 'User', id, `Reset password for ${user.firstName} ${user.lastName}`);
  return sendResponse(res, true, 'Password reset successfully.');
};
