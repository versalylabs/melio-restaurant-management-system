import { Request, Response as ExpressResponse } from 'express';
import { getSections, getSection, createSection, updateSection, deleteSection } from '../services/sectionService';
import { AuthRequest, authenticate, authorize } from '../middleware/auth';

export const getSectionsController = async (req: AuthRequest, res: ExpressResponse) => getSections(req, res);
export const getSectionController = async (req: AuthRequest, res: ExpressResponse) => getSection(req, res);
export const createSectionController = async (req: AuthRequest, res: ExpressResponse) => createSection(req, res);
export const updateSectionController = async (req: AuthRequest, res: ExpressResponse) => updateSection(req, res);
export const deleteSectionController = async (req: AuthRequest, res: ExpressResponse) => deleteSection(req, res);
