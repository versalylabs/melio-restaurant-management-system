import { Request, Response as ExpressResponse } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

export const generateToken = (userId: string, restaurantId: string, tokenVersion: number = 0): string => {
  return jwt.sign(
    { userId, restaurantId, tokenVersion },
    process.env.JWT_SECRET!,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' } as any
  );
};

export const hashPassword = async (password: string): Promise<string> => {
  const saltRounds = 12;
  return bcrypt.hash(password, saltRounds);
};

export const comparePassword = async (password: string, hash: string): Promise<boolean> => {
  return bcrypt.compare(password, hash);
};

export const sendResponse = <T>(
  res: ExpressResponse,
  success: boolean,
  message: string,
  data?: T,
  statusCode: number = 200
) => {
  res.status(statusCode).json({
    success,
    message,
    ...(data && { data }),
  });
};

export const sendError = (
  res: ExpressResponse,
  message: string,
  errors?: Record<string, string[]>,
  statusCode: number = 400
) => {
  res.status(statusCode).json({
    success: false,
    message,
    ...(errors && { errors }),
  });
};
