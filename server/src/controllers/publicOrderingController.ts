import { Request, Response } from 'express';
import {
  getPublicRestaurants,
  getPublicMenu,
  createPublicOrder,
  confirmPublicPayment,
  getPublicOrderTracking,
  createPublicReservation,
  getPublicReservationTracking,
  getPublicReservationAvailability
} from '../services/publicOrderingService';

export const getPublicRestaurantsController = (req: Request, res: Response) => getPublicRestaurants(req, res);
export const getPublicMenuController = (req: Request, res: Response) => getPublicMenu(req, res);
export const createPublicOrderController = (req: Request, res: Response) => createPublicOrder(req, res);
export const confirmPublicPaymentController = (req: Request, res: Response) => confirmPublicPayment(req, res);
export const getPublicOrderTrackingController = (req: Request, res: Response) => getPublicOrderTracking(req, res);
export const createPublicReservationController = (req: Request, res: Response) => createPublicReservation(req, res);
export const getPublicReservationTrackingController = (req: Request, res: Response) => getPublicReservationTracking(req, res);
export const getPublicReservationAvailabilityController = (req: Request, res: Response) => getPublicReservationAvailability(req, res);

