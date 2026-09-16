import { Request, Response as ExpressResponse } from 'express';
import {
  getOrders,
  getOrder,
  createOrder,
  updateOrder,
  updateOrderStatus,
  holdOrder,
  resumeOrder,
  submitOrder,
  cancelOrder,
  getPosMenu,
  getPosTables,
} from '../services/orderService';
import { AuthRequest, authenticate, authorize } from '../middleware/auth';

export const getOrdersController = async (req: AuthRequest, res: ExpressResponse) => getOrders(req, res);
export const getOrderController = async (req: AuthRequest, res: ExpressResponse) => getOrder(req, res);
export const createOrderController = async (req: AuthRequest, res: ExpressResponse) => createOrder(req, res);
export const updateOrderController = async (req: AuthRequest, res: ExpressResponse) => updateOrder(req, res);
export const updateOrderStatusController = async (req: AuthRequest, res: ExpressResponse) => updateOrderStatus(req, res);
export const holdOrderController = async (req: AuthRequest, res: ExpressResponse) => holdOrder(req, res);
export const resumeOrderController = async (req: AuthRequest, res: ExpressResponse) => resumeOrder(req, res);
export const submitOrderController = async (req: AuthRequest, res: ExpressResponse) => submitOrder(req, res);
export const cancelOrderController = async (req: AuthRequest, res: ExpressResponse) => cancelOrder(req, res);
export const getPosMenuController = async (req: AuthRequest, res: ExpressResponse) => getPosMenu(req, res);
export const getPosTablesController = async (req: AuthRequest, res: ExpressResponse) => getPosTables(req, res);
