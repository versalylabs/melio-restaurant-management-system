import { Request, Response as ExpressResponse } from 'express';
import {
  getKitchenStations,
  getKitchenStation,
  createKitchenStation,
  updateKitchenStation,
  deleteKitchenStation,
  assignMenuItemToStation,
  removeMenuItemFromStation,
} from '../services/kitchenService';
import { AuthRequest, authenticate, authorize } from '../middleware/auth';

export const getKitchenStationsController = async (req: AuthRequest, res: ExpressResponse) => getKitchenStations(req, res);
export const getKitchenStationController = async (req: AuthRequest, res: ExpressResponse) => getKitchenStation(req, res);
export const createKitchenStationController = async (req: AuthRequest, res: ExpressResponse) => createKitchenStation(req, res);
export const updateKitchenStationController = async (req: AuthRequest, res: ExpressResponse) => updateKitchenStation(req, res);
export const deleteKitchenStationController = async (req: AuthRequest, res: ExpressResponse) => deleteKitchenStation(req, res);
export const assignMenuItemToStationController = async (req: AuthRequest, res: ExpressResponse) => assignMenuItemToStation(req, res);
export const removeMenuItemFromStationController = async (req: AuthRequest, res: ExpressResponse) => removeMenuItemFromStation(req, res);
