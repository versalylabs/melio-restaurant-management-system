import { Request, Response as ExpressResponse } from 'express';
import { getMenuItems, getMenuItem, createMenuItem, updateMenuItem, deleteMenuItem, duplicateMenuItem } from '../services/menuItemService';
import { AuthRequest, authenticate, authorize } from '../middleware/auth';

export const getMenuItemsController = async (req: AuthRequest, res: ExpressResponse) => getMenuItems(req, res);
export const getMenuItemController = async (req: AuthRequest, res: ExpressResponse) => getMenuItem(req, res);
export const createMenuItemController = async (req: AuthRequest, res: ExpressResponse) => createMenuItem(req, res);
export const updateMenuItemController = async (req: AuthRequest, res: ExpressResponse) => updateMenuItem(req, res);
export const deleteMenuItemController = async (req: AuthRequest, res: ExpressResponse) => deleteMenuItem(req, res);
export const duplicateMenuItemController = async (req: AuthRequest, res: ExpressResponse) => duplicateMenuItem(req, res);
