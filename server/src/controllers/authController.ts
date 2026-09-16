import { Request, Response as ExpressResponse } from 'express';
import { login, createInitialAdmin, getMe } from '../services/authService';
import { sendResponse, sendError } from '../utils/response';
import { AuthRequest } from '../middleware/auth';
import { createAuditLog } from '../services/auditLogService';
import prisma from '../config/database';

export const loginController = async (req: Request, res: ExpressResponse) => {
  try {
    const { email, password } = req.body as { email: string; password: string };

    if (!email || !password) {
      const errors: Record<string, string[]> = {};
      if (!email) errors.email = ['Email is required'];
      if (!password) errors.password = ['Password is required'];
      return sendError(res, 'Email and password are required', errors);
    }

    const result = await login(email, password);

    await createAuditLog(
      result.user.restaurantId,
      result.user.id,
      'LOGIN',
      'User',
      result.user.id,
      'User logged in'
    );

    return sendResponse(res, true, 'Login successful', result);
  } catch (error) {
    return sendError(res, error instanceof Error ? error.message : 'Login failed');
  }
};

export const setupController = async (req: Request, res: ExpressResponse) => {
  try {
    const { restaurantName, ownerFirstName, ownerLastName, ownerEmail, ownerPassword, ownerPhone } = req.body as {
      restaurantName: string;
      ownerFirstName: string;
      ownerLastName: string;
      ownerEmail: string;
      ownerPassword: string;
      ownerPhone?: string;
    };

    if (!restaurantName || !ownerFirstName || !ownerLastName || !ownerEmail || !ownerPassword) {
      return sendError(res, 'All fields are required');
    }

    const result = await createInitialAdmin({
      restaurantName,
      ownerFirstName,
      ownerLastName,
      ownerEmail,
      ownerPassword,
      ownerPhone,
    });

    return sendResponse(res, true, 'Initial setup completed', result, 201);
  } catch (error) {
    return sendError(res, error instanceof Error ? error.message : 'Setup failed');
  }
};

export const getMeController = async (req: AuthRequest, res: ExpressResponse) => {
  try {
    const user = await getMe(req.user!.id);
    return sendResponse(res, true, 'User retrieved', user);
  } catch (error) {
    return sendError(res, error instanceof Error ? error.message : 'Failed to retrieve user', undefined, 404);
  }
};


export const logoutController = async (req: AuthRequest, res: ExpressResponse) => {
  try {
    await prisma.user.update({ where: { id: req.user!.id }, data: { tokenVersion: { increment: 1 } } });
    await createAuditLog(req.user!.restaurantId, req.user!.id, 'LOGOUT', 'User', req.user!.id, 'User logged out');
    return sendResponse(res, true, 'Logged out successfully');
  } catch (error) {
    return sendError(res, error instanceof Error ? error.message : 'Logout failed');
  }
};
