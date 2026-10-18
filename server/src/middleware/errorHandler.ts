import { Request, Response, NextFunction } from 'express';

export const errorHandler = (
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  console.error('Error:', err);

  if (err.name === 'PrismaClientKnownRequestError') {
    const isProd = process.env.NODE_ENV === 'production';
    const prismaCode = (err as any).code as string | undefined;
    const metaTarget = Array.isArray((err as any).meta?.target)
      ? ((err as any).meta.target as string[]).join(', ')
      : String((err as any).meta?.target || '');

    if (prismaCode === 'P2002') {
      return res.status(409).json({
        success: false,
        message: metaTarget
          ? `A record with this ${metaTarget} already exists`
          : 'A record with these details already exists',
        ...(isProd ? {} : { errors: { database: err.message } }),
      });
    }

    if (prismaCode === 'P2003') {
      return res.status(409).json({
        success: false,
        message: 'This operation cannot be completed because the record is linked to other active data',
        ...(isProd ? {} : { errors: { database: err.message } }),
      });
    }

    if (prismaCode === 'P2025') {
      return res.status(404).json({
        success: false,
        message: 'The requested record was not found',
        ...(isProd ? {} : { errors: { database: err.message } }),
      });
    }

    return res.status(400).json({
      success: false,
      message: 'Database operation failed',
      ...(isProd ? {} : { errors: { database: err.message } }),
    });
  }

  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({
      success: false,
      message: 'Invalid token',
    });
  }

  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({
      success: false,
      message: 'Token expired',
    });
  }

  const isProdVercel = process.env.NODE_ENV === 'production' && !!process.env.VERCEL;
  res.status(500).json({
    success: false,
    message: isProdVercel ? 'Internal server error' : (err.message || 'Internal server error'),
  });
};

export const notFound = (req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.method} ${req.path} not found`,
  });
};
