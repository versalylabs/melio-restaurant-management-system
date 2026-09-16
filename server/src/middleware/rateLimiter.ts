import { Request, Response, NextFunction } from 'express';

interface RateLimitRule {
  windowMs: number;
  maxRequests: number;
  message?: string;
  keyGenerator?: (req: Request) => string;
}

interface RequestRecord {
  timestamps: number[];
}

class SlidingWindowRateLimiter {
  private store: Map<string, RequestRecord> = new Map();
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    // Periodically sweep expired IP records every 5 minutes
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 5 * 60 * 1000);
  }

  private cleanup() {
    const now = Date.now();
    for (const [key, record] of this.store.entries()) {
      // Remove records older than 1 hour
      record.timestamps = record.timestamps.filter((t) => now - t < 3600000);
      if (record.timestamps.length === 0) {
        this.store.delete(key);
      }
    }
  }

  public createLimiter(rule: RateLimitRule) {
    const {
      windowMs,
      maxRequests,
      message = 'Too many requests. Please try again shortly.',
      keyGenerator = (req: Request) => {
        const ip = req.ip || req.socket.remoteAddress || 'unknown';
        return `${ip}:${req.baseUrl || req.path}`;
      },
    } = rule;

    return (req: Request, res: Response, next: NextFunction) => {
      const now = Date.now();
      const key = keyGenerator(req);

      let record = this.store.get(key);
      if (!record) {
        record = { timestamps: [] };
        this.store.set(key, record);
      }

      // Filter timestamps within the current sliding window
      record.timestamps = record.timestamps.filter((t) => now - t < windowMs);

      const count = record.timestamps.length;
      const remaining = Math.max(0, maxRequests - count - 1);
      const resetTime = record.timestamps.length > 0
        ? Math.ceil((record.timestamps[0] + windowMs - now) / 1000)
        : Math.ceil(windowMs / 1000);

      // Set standard RateLimit headers
      res.setHeader('X-RateLimit-Limit', maxRequests);
      res.setHeader('X-RateLimit-Remaining', remaining);
      res.setHeader('X-RateLimit-Reset', resetTime);

      if (count >= maxRequests) {
        res.setHeader('Retry-After', resetTime);
        return res.status(429).json({
          success: false,
          error: 'TOO_MANY_REQUESTS',
          message,
          retryAfterSeconds: resetTime,
        });
      }

      record.timestamps.push(now);
      next();
    };
  }
}

const limiterFactory = new SlidingWindowRateLimiter();

// 1. Strict Auth Rate Limiter (Brute-force protection: 60 attempts / 15 minutes)
export const authRateLimiter = limiterFactory.createLimiter({
  windowMs: 15 * 60 * 1000,
  maxRequests: 60,
  message: 'Too many authentication attempts. Please wait 15 minutes before trying again.',
  keyGenerator: (req) => `auth:${req.ip || 'unknown'}`,
});

// 2. Payment Rate Limiter (STK push flood protection: 5 attempts / 2 minutes)
export const paymentRateLimiter = limiterFactory.createLimiter({
  windowMs: 2 * 60 * 1000,
  maxRequests: 5,
  message: 'Too many payment requests initiated. Please wait 2 minutes before retrying.',
  keyGenerator: (req) => `payment:${req.ip || 'unknown'}`,
});

// 3. Reservation Rate Limiter (10 requests / 15 minutes)
export const reservationRateLimiter = limiterFactory.createLimiter({
  windowMs: 15 * 60 * 1000,
  maxRequests: 10,
  message: 'Reservation limit reached for this session. Please wait before submitting another request.',
  keyGenerator: (req) => `res:${req.ip || 'unknown'}`,
});

// 4. Public API Rate Limiter (150 requests / minute)
export const publicApiRateLimiter = limiterFactory.createLimiter({
  windowMs: 60 * 1000,
  maxRequests: 150,
  message: 'Public rate limit reached. Please slow down your requests.',
  keyGenerator: (req) => `pub:${req.ip || 'unknown'}`,
});

// 5. Global API Burst Limiter (300 requests / minute)
export const globalRateLimiter = limiterFactory.createLimiter({
  windowMs: 60 * 1000,
  maxRequests: 300,
  message: 'Global request threshold exceeded.',
});
