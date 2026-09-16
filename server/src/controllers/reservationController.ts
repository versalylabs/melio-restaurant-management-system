import { AuthRequest } from '../middleware/auth';
import { Response } from 'express';
import { getReservations, getReservation, createReservation, updateReservation, updateReservationStatus, deleteReservation } from '../services/reservationService';
export const getReservationsController = (req: AuthRequest, res: Response) => getReservations(req, res);
export const getReservationController = (req: AuthRequest, res: Response) => getReservation(req, res);
export const createReservationController = (req: AuthRequest, res: Response) => createReservation(req, res);
export const updateReservationController = (req: AuthRequest, res: Response) => updateReservation(req, res);
export const updateReservationStatusController = (req: AuthRequest, res: Response) => updateReservationStatus(req, res);
export const deleteReservationController = (req: AuthRequest, res: Response) => deleteReservation(req, res);
