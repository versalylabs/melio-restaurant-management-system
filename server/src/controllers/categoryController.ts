import { Request, Response as ExpressResponse } from 'express';
import { getCategories, getCategory, createCategory, updateCategory, deleteCategory } from '../services/categoryService';
import { AuthRequest, authenticate, authorize } from '../middleware/auth';

export const getCategoriesController = async (req: AuthRequest, res: ExpressResponse) => getCategories(req, res);
export const getCategoryController = async (req: AuthRequest, res: ExpressResponse) => getCategory(req, res);
export const createCategoryController = async (req: AuthRequest, res: ExpressResponse) => createCategory(req, res);
export const updateCategoryController = async (req: AuthRequest, res: ExpressResponse) => updateCategory(req, res);
export const deleteCategoryController = async (req: AuthRequest, res: ExpressResponse) => deleteCategory(req, res);
