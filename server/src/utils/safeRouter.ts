import { Router, RequestHandler, Router as ExpressRouter } from 'express';

const ASYNC_SAFE_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head'] as const;

type AsyncCompatibleHandler = (
  req: Parameters<RequestHandler>[0],
  res: Parameters<RequestHandler>[1],
  next: Parameters<RequestHandler>[2]
) => void | Promise<unknown>;

function asyncHandler(handler: AsyncCompatibleHandler): RequestHandler {
  return (req, res, next) => {
    try {
      const result = handler(req, res, next);
      if (result && typeof result.catch === 'function') {
        result.catch(next);
      }
    } catch (error) {
      next(error);
    }
  };
}

/** Express 4 does not forward rejected async route promises. This router wraps
 * route handlers so database/service failures reach the central error handler
 * instead of leaving the browser on an endless loading state. */
export function safeRouter(): ExpressRouter {
  const router = Router();
  for (const method of ASYNC_SAFE_METHODS) {
    const original = (router as any)[method].bind(router);
    (router as any)[method] = (path: any, ...handlers: any[]) => {
      return original(path, ...handlers.map((handler) => typeof handler === 'function' ? asyncHandler(handler) : handler));
    };
  }
  return router;
}
