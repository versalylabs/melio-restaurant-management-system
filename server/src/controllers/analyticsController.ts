import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { buildAdvancedAnalytics } from '../services/analyticsService';
import { sendError, sendResponse } from '../utils/response';
export const getAdvancedAnalytics = async (req: AuthRequest, res: Response) => {
  try {
    const data = await buildAdvancedAnalytics(req.user!.restaurantId, { startDate:req.query.startDate as string|undefined, endDate:req.query.endDate as string|undefined, branchId:req.query.branchId as string|undefined });
    return sendResponse(res,true,'Advanced analytics retrieved',data);
  } catch (error) { console.error(error); return sendError(res,'Unable to generate advanced analytics.',undefined,500); }
};
