import { Request, Response as ExpressResponse } from 'express';
import { getModifierGroups, getModifierGroup, createModifierGroup, updateModifierGroup, deleteModifierGroup } from '../services/modifierGroupService';
import { AuthRequest, authenticate, authorize } from '../middleware/auth';

export const getModifierGroupsController = async (req: AuthRequest, res: ExpressResponse) => getModifierGroups(req, res);
export const getModifierGroupController = async (req: AuthRequest, res: ExpressResponse) => getModifierGroup(req, res);
export const createModifierGroupController = async (req: AuthRequest, res: ExpressResponse) => createModifierGroup(req, res);
export const updateModifierGroupController = async (req: AuthRequest, res: ExpressResponse) => updateModifierGroup(req, res);
export const deleteModifierGroupController = async (req: AuthRequest, res: ExpressResponse) => deleteModifierGroup(req, res);
