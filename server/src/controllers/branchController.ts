import { Response as ExpressResponse } from 'express';
import { getBranches } from '../services/branchService';
import { AuthRequest } from '../middleware/auth';

export const getBranchesController = async (req: AuthRequest, res: ExpressResponse) => getBranches(req, res);
