import { Request, Response } from 'express';
import {
  registerCustomer,
  loginCustomer,
  getCustomerProfile,
  updateCustomerProfile,
  getCustomerOrders,
  getCustomerReservations,
  getCustomerLoyalty,
  toggleFavoriteItem,
  CustomerAuthRequest
} from '../services/customerAuthService';

export const registerCustomerController = (req: Request, res: Response) => registerCustomer(req, res);
export const loginCustomerController = (req: Request, res: Response) => loginCustomer(req, res);
export const getCustomerProfileController = (req: CustomerAuthRequest, res: Response) => getCustomerProfile(req, res);
export const updateCustomerProfileController = (req: CustomerAuthRequest, res: Response) => updateCustomerProfile(req, res);
export const getCustomerOrdersController = (req: CustomerAuthRequest, res: Response) => getCustomerOrders(req, res);
export const getCustomerReservationsController = (req: CustomerAuthRequest, res: Response) => getCustomerReservations(req, res);
export const getCustomerLoyaltyController = (req: CustomerAuthRequest, res: Response) => getCustomerLoyalty(req, res);
export const toggleFavoriteItemController = (req: CustomerAuthRequest, res: Response) => toggleFavoriteItem(req, res);
