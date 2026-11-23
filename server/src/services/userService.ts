import prisma from '../config/database';
import { canAssignRole, canManageAccount } from '../utils/roleGuards';
import { parsePermissions } from '../middleware/permissions';

const permCtx = (req: AuthRequest, rolePermissions?: string | null) => ({
  actorPermissions: req.user!.permissions || [],
  targetPermissions: parsePermissions(rolePermissions),
});
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

  if (!firstName?.trim() || !lastName?.trim() || !email?.trim() || !roleId) {
    return sendError(res, 'First name, last name, email, and role are required');
  }

  // No default password: a shared fallback would let anyone sign in to new accounts.
  if (typeof password !== 'string' || password.length < 8) {
    return sendError(res, 'An initial password of at least 8 characters is required');
  }

  const normalizedEmail = email.trim().toLowerCase();

  const existing = await prisma.user.findFirst({
    where: {
      restaurantId: req.user!.restaurantId,
      email: normalizedEmail,
    },
  });

  if (existing) {
    return sendError(res, 'User with this email already exists', undefined, 409);
  }

  const role = await prisma.role.findUnique({ where: { id: roleId } });
  if (!role) {
    return sendError(res, 'Selected role does not exist', undefined, 400);
  }
  if (!canAssignRole(req.user!.roleName, role.name, permCtx(req, role.permissions))) {
    return sendError(res, `Only an owner can create ${role.name} accounts`, undefined, 403);
  }

  if (branchId) {
    const validBranch = await prisma.branch.findFirst({
      where: { id: branchId, restaurantId: req.user!.restaurantId },
    });
    if (!validBranch) {
      return sendError(res, 'Selected branch does not belong to this restaurant', undefined, 400);
    }
  }

  const bcrypt = await import('bcryptjs');
  const passwordHash = await bcrypt.hash(password!, 12);
  const uniqueStationIds = Array.isArray(stationIds) ? [...new Set(stationIds)] : [];

  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        restaurantId: req.user!.restaurantId,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: normalizedEmail,
        phone: phone?.trim() || undefined,
        roleId,
        branchId: branchId || undefined,
        passwordHash,
        status: 'ACTIVE',
        employeeCode: employeeCode?.trim() || undefined,
        jobTitle: jobTitle?.trim() || undefined,
        hireDate: hireDate ? new Date(hireDate) : undefined,
        notes: notes?.trim() || undefined,
        passwordChangedAt: new Date(),
      },
      include: {
        role: { select: { id: true, name: true } },
        branch: { select: { id: true, name: true } },
      },
    });

    if (uniqueStationIds.length) {
      const stations = await tx.kitchenStation.findMany({
        where: { id: { in: uniqueStationIds }, restaurantId: req.user!.restaurantId, ...(branchId ? { branchId } : {}) },
        select: { id: true },
      });
      if (stations.length) {
        await tx.userKitchenStation.createMany({
          data: stations.map((station) => ({ userId: created.id, stationId: station.id })),
        });
      }
    }

    return created;
  });

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
  const isSelf = id === req.user!.id;
  if (!isSelf && !canManageAccount(req.user!.roleName, targetRole?.name, permCtx(req, targetRole?.permissions))) {
    return sendError(res, `Only an owner can modify ${targetRole?.name} accounts`, undefined, 403);
  }
  if (roleId && roleId !== user.roleId && isSelf) {
    return sendError(res, 'You cannot change your own role', undefined, 403);
  }

  const normalizedEmail = email ? email.trim().toLowerCase() : user.email;
  if (normalizedEmail !== user.email.toLowerCase()) {
    const emailConflict = await prisma.user.findFirst({
      where: {
        restaurantId: req.user!.restaurantId,
        id: { not: id },
        email: normalizedEmail,
      },
    });
    if (emailConflict) {
      return sendError(res, 'Another user with this email already exists', undefined, 409);
    }
  }

  if (roleId && roleId !== user.roleId) {
    const validRole = await prisma.role.findUnique({ where: { id: roleId } });
    if (!validRole) return sendError(res, 'Selected role does not exist', undefined, 400);
    if (!canAssignRole(req.user!.roleName, validRole.name, permCtx(req, validRole.permissions))) {
      return sendError(res, `Only an owner can assign the ${validRole.name} role`, undefined, 403);
    }
  }

  if (branchId) {
    const validBranch = await prisma.branch.findFirst({
      where: { id: branchId, restaurantId: req.user!.restaurantId },
    });
    if (!validBranch) {
      return sendError(res, 'Selected branch does not belong to this restaurant', undefined, 400);
    }
  }

  const uniqueStationIds = Array.isArray(stationIds) ? [...new Set(stationIds)] : undefined;

  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.user.update({
      where: { id },
      data: {
        firstName: firstName !== undefined ? firstName.trim() : user.firstName,
        lastName: lastName !== undefined ? lastName.trim() : user.lastName,
        email: normalizedEmail,
        phone: phone !== undefined ? (phone?.trim() || null) : user.phone,
        roleId: roleId || user.roleId,
        branchId: branchId === '' ? null : (branchId !== undefined ? branchId : user.branchId),
        status: status || user.status,
        ...(status === 'INACTIVE' ? { tokenVersion: { increment: 1 } } : {}),
        employeeCode: employeeCode !== undefined ? (employeeCode?.trim() || null) : user.employeeCode,
        jobTitle: jobTitle !== undefined ? (jobTitle?.trim() || null) : user.jobTitle,
        hireDate: hireDate ? new Date(hireDate) : (hireDate === '' ? null : user.hireDate),
        notes: notes !== undefined ? (notes?.trim() || null) : user.notes,
      },
      include: {
        role: { select: { id: true, name: true } },
        branch: { select: { id: true, name: true } },
      },
    });

    if (uniqueStationIds !== undefined) {
      const effectiveBranchId = branchId === '' ? null : (branchId !== undefined ? branchId : user.branchId);
      const stations = uniqueStationIds.length
        ? await tx.kitchenStation.findMany({
            where: { id: { in: uniqueStationIds }, restaurantId: req.user!.restaurantId, ...(effectiveBranchId ? { branchId: effectiveBranchId } : {}) },
            select: { id: true },
          })
        : [];
      await tx.userKitchenStation.deleteMany({ where: { userId: id } });
      if (stations.length) {
        await tx.userKitchenStation.createMany({
          data: stations.map((station) => ({ userId: id, stationId: station.id })),
        });
      }
    }

    return u;
  });

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

  const role = await prisma.role.findUnique({ where: { id: user.roleId } });
  if (role?.name === 'OWNER') {
    return sendError(res, 'Owner accounts cannot be deleted', undefined, 403);
  }
  if (!canManageAccount(req.user!.roleName, role?.name, permCtx(req, role?.permissions))) {
    return sendError(res, `Only an owner can delete ${role?.name} accounts`, undefined, 403);
  }

  const openShiftCount = await prisma.shift.count({
    where: { userId: id, status: 'OPEN' },
  });
  if (openShiftCount > 0) {
    return sendError(res, 'Cannot remove user while they have an open shift. Please close their shift first.', undefined, 409);
  }

  // Check if user is referenced by historical operational/financial records
  const [
    reservationCount,
    promotionCount,
    movementCount,
    stocktakeCount,
    poCount,
    wastageCount,
    shiftCount,
    expenseCount,
    transferCount,
  ] = await Promise.all([
    prisma.reservation.count({ where: { createdBy: id } }),
    prisma.promotion.count({ where: { createdBy: id } }),
    prisma.stockMovement.count({ where: { userId: id } }),
    prisma.stocktake.count({ where: { OR: [{ createdBy: id }, { completedBy: id }] } }),
    prisma.purchaseOrder.count({ where: { createdBy: id } }),
    prisma.wastageRecord.count({ where: { userId: id } }),
    prisma.shift.count({ where: { OR: [{ userId: id }, { createdBy: id }, { closedBy: id }] } }),
    prisma.expense.count({ where: { OR: [{ createdBy: id }, { approvedBy: id }] } }),
    prisma.stockTransfer.count({ where: { OR: [{ createdBy: id }, { approvedBy: id }, { completedBy: id }] } }),
  ]);

  const totalReferences =
    reservationCount +
    promotionCount +
    movementCount +
    stocktakeCount +
    poCount +
    wastageCount +
    shiftCount +
    expenseCount +
    transferCount;

  if (totalReferences > 0) {
    await prisma.user.update({
      where: { id },
      data: {
        status: 'INACTIVE',
        tokenVersion: { increment: 1 },
      },
    });

    await createAuditLog(
      req.user!.restaurantId,
      req.user!.id,
      'DEACTIVATE',
      'User',
      id,
      `Deactivated user ${user.firstName} ${user.lastName} (preserved ${totalReferences} historical records)`
    );

    return sendResponse(res, true, 'User has historical activity and was safely deactivated', {
      deactivated: true,
    });
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
    if (id !== req.user!.id && !canManageAccount(req.user!.roleName, targetRole?.name, permCtx(req, targetRole?.permissions))) return sendError(res, `Only an owner can reset a ${targetRole?.name} password`, undefined, 403);
  }
  const bcrypt = await import('bcryptjs');
  const passwordHash = await bcrypt.hash(newPassword, 12);
  await prisma.user.update({ where: { id }, data: { passwordHash, passwordChangedAt: new Date(), tokenVersion: { increment: 1 } } });
  await createAuditLog(req.user!.restaurantId, req.user!.id, 'PASSWORD_RESET', 'User', id, `Reset password for ${user.firstName} ${user.lastName}`);
  return sendResponse(res, true, 'Password reset successfully.');
};
