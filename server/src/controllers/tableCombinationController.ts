import { Request, Response as ExpressResponse } from 'express';
import { getTableCombinations, createTableCombination, updateTableCombination, deleteTableCombination } from '../services/tableCombinationService';
import { AuthRequest, authenticate, authorize } from '../middleware/auth';

export const getTableCombinationsController = async (req: AuthRequest, res: ExpressResponse) => getTableCombinations(req, res);
export const createTableCombinationController = async (req: AuthRequest, res: ExpressResponse) => createTableCombination(req, res);
export const updateTableCombinationController = async (req: AuthRequest, res: ExpressResponse) => updateTableCombination(req, res);
export const deleteTableCombinationController = async (req: AuthRequest, res: ExpressResponse) => deleteTableCombination(req, res);
