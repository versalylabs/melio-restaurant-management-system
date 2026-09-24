import prisma from '../config/database';
import { AuthRequest } from '../middleware/auth';
import { sendResponse, sendError } from '../utils/response';
import { Response as ExpressResponse } from 'express';

export const getAuditLogs = async (req: AuthRequest, res: ExpressResponse) => {
  const { page = '1', limit = '20', entity, action, userId } = req.query;
  const restaurantId = req.user!.restaurantId;

  const skip = (parseInt(page as string) - 1) * parseInt(limit as string);

  const where: any = { restaurantId };

  if (entity) {
    where.entity = entity;
  }

  if (action) {
    where.action = action;
  }

  if (userId) {
    where.userId = userId;
  }

  const [logs, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      skip,
      take: parseInt(limit as string),
      orderBy: { createdAt: 'desc' },
      include: {
        user: {
          select: {
            firstName: true,
            lastName: true,
            email: true,
          },
        },
      },
    }),
    prisma.auditLog.count({ where }),
  ]);

  const formattedLogs = logs.map((log) => ({
    id: log.id,
    action: log.action,
    entity: log.entity,
    entityId: log.entityId,
    description: log.description,
    metadata: log.metadata ? JSON.parse(log.metadata) : null,
    user: log.user,
    createdAt: log.createdAt,
  }));

  return sendResponse(res, true, 'Audit logs retrieved', {
    logs: formattedLogs,
    pagination: {
      page: parseInt(page as string),
      limit: parseInt(limit as string),
      total,
      totalPages: Math.ceil(total / parseInt(limit as string)),
    },
  });
};

export const createAuditLog = async (
  restaurantId: string,
  userId?: string | null,
  action?: string,
  entity?: string,
  entityId?: string,
  description?: string,
  metadata?: any
) => {
  try {
    let validUserId: string | undefined = undefined;
    if (userId && userId !== 'system' && userId !== 'SYSTEM') {
      try {
        const userExists = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
        if (userExists) validUserId = userId;
      } catch {}
    }
    await prisma.auditLog.create({
      data: {
        restaurantId,
        userId: validUserId,
        action: action || 'UNKNOWN',
        entity: entity || 'SYSTEM',
        entityId,
        description,
        metadata: metadata ? JSON.stringify(metadata) : undefined,
      },
    });
  } catch (err) {
    console.warn('createAuditLog skipped due to error:', err);
  }
};
