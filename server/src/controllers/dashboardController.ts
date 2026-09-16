import { Request, Response as ExpressResponse } from 'express';
import { getDashboardMetrics } from '../services/dashboardService';
import { AuthRequest, authenticate } from '../middleware/auth';

export const getDashboardController = async (req: AuthRequest, res: ExpressResponse) => {
  return getDashboardMetrics(req, res);
};
