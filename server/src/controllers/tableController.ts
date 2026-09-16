import { Request, Response as ExpressResponse } from 'express';
import { getTables, getTable, createTable, updateTable, updateTablePosition, updateTableStatus, deleteTable, getFloorLayout } from '../services/tableService';
import { AuthRequest, authenticate, authorize } from '../middleware/auth';

export const getTablesController = async (req: AuthRequest, res: ExpressResponse) => getTables(req, res);
export const getTableController = async (req: AuthRequest, res: ExpressResponse) => getTable(req, res);
export const createTableController = async (req: AuthRequest, res: ExpressResponse) => createTable(req, res);
export const updateTableController = async (req: AuthRequest, res: ExpressResponse) => updateTable(req, res);
export const updateTablePositionController = async (req: AuthRequest, res: ExpressResponse) => updateTablePosition(req, res);
export const updateTableStatusController = async (req: AuthRequest, res: ExpressResponse) => updateTableStatus(req, res);
export const deleteTableController = async (req: AuthRequest, res: ExpressResponse) => deleteTable(req, res);
export const getFloorLayoutController = async (req: AuthRequest, res: ExpressResponse) => getFloorLayout(req, res);
