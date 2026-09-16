import { Request, Response as ExpressResponse } from 'express';
import { getAuditLogs } from '../services/auditLogService';
import { AuthRequest, authenticate, authorize } from '../middleware/auth';

export const getAuditLogsController = async (req: AuthRequest, res: ExpressResponse) => {
  return getAuditLogs(req, res);
};
