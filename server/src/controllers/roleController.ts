import { getRoles, createRole, updateRole, deleteRole, getPermissionCatalog } from '../services/roleService';
import { AuthRequest } from '../middleware/auth';
import { Response as ExpressResponse } from 'express';
export const getRolesController = (req: AuthRequest, res: ExpressResponse) => getRoles(req, res);
export const createRoleController = (req: AuthRequest, res: ExpressResponse) => createRole(req, res);
export const updateRoleController = (req: AuthRequest, res: ExpressResponse) => updateRole(req, res);
export const deleteRoleController = (req: AuthRequest, res: ExpressResponse) => deleteRole(req, res);
export const getPermissionCatalogController = (req: AuthRequest, res: ExpressResponse) => getPermissionCatalog(req, res);
