import { Request, Response as ExpressResponse } from 'express';
import { getRestaurant, updateRestaurant } from '../services/restaurantService';
import { AuthRequest, authenticate } from '../middleware/auth';

export const getRestaurantController = async (req: AuthRequest, res: ExpressResponse) => {
  return getRestaurant(req, res);
};

export const updateRestaurantController = async (req: AuthRequest, res: ExpressResponse) => {
  return updateRestaurant(req, res);
};
