import { Request, Response, NextFunction } from 'express';

/*
 * Rate limiting with a pluggable store.
 *
 * - With UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN set, counters live
 *   in Redis and are shared by every server instance. This is required on
 *   serverless hosts (Vercel), where each instance has its own memory and an
 *   in-memory limiter can be bypassed simply by hitting a fresh instance.
 * - Otherwise an in-memory store is used (fine for a single long-running
 *   server or local development).
 *
 * Fixed-window counters. If Redis is unreachable the request is allowed
 * (fail-open) so an outage of the limiter never takes the app down.
 */

interface HitResult {
  count: number;
  resetMs: number;
}

interface RateLimitStore {
  hit(key: string, windowMs: number): Promise<HitResult>;
}

class MemoryStore implements RateLimitStore {
  private windows = new Map<string, { count: number; resetAt: number }>();

  constructor() {
    const timer = setInterval(() => {
      const now = Date.now();
      for (const [key, w] of this.windows) if (w.resetAt <= now) this.windows.delete(key);
    }, 60_000);
    timer.unref?.();
  }

  async hit(key: string, windowMs: number): Promise<HitResult> {
    const now = Date.now();
    let w = this.windows.get(key);
    if (!w || w.resetAt <= now) {
      w = { count: 0, resetAt: now + windowMs };
      this.windows.set(key, w);
    }
    w.count += 1;
    return { count: w.count, resetMs: w.resetAt - now };
  }
}

class UpstashStore implements RateLimitStore {
  constructor(private url: string, private token: string) {}

  async hit(key: string, windowMs: number): Promise<HitResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1500);
    try {
      const res = await fetch(`${this.url.replace(/\/+$/, '')}/pipeline`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify([
          ['INCR', key],
          ['PEXPIRE', key, String(windowMs), 'NX'],
          ['PTTL', key],
        ]),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`Upstash HTTP ${res.status}`);
      const [incr, , pttl] = (await res.json()) as Array<{ result?: number; error?: string }>;
      if (incr?.error) throw new Error(incr.error);
      const ttl = Number(pttl?.result);
      return { count: Number(incr?.result || 0), resetMs: ttl > 0 ? ttl : windowMs };
    } finally {
      clearTimeout(timeout);
    }
  }
}

const upstashUrl = process.env.UPSTASH_REDIS_REST_URL;
const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN;
const store: RateLimitStore = upstashUrl && upstashToken ? new UpstashStore(upstashUrl, upstashToken) : new MemoryStore();
export const rateLimitBackend = store instanceof UpstashStore ? 'redis' : 'memory';

if (process.env.VERCEL && rateLimitBackend === 'memory') {
  console.warn('[RateLimit] Running on Vercel with an in-memory store: limits are per instance and easy to bypass. Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.');
}

/** Real client IP. On Vercel the edge sets these headers; clients cannot spoof them. */
export function clientIp(req: Request): string {
  if (process.env.VERCEL) {
    const vercelIp = req.headers['x-vercel-forwarded-for'] || req.headers['x-real-ip'];
    if (typeof vercelIp === 'string' && vercelIp) return vercelIp.split(',')[0].trim();
  }
  return req.ip || req.socket.remoteAddress || 'unknown';
}

interface RateLimitRule {
  name: string;
  windowMs: number;
  maxRequests: number;
  message?: string;
  /** Return null to skip limiting this request. */
  keyGenerator?: (req: Request) => string | null;
}

export function createRateLimiter(rule: RateLimitRule) {
  const {
    name,
    windowMs,
    maxRequests,
    message = 'Too many requests. Please try again shortly.',
    keyGenerator = (req: Request) => clientIp(req),
  } = rule;

  return async (req: Request, res: Response, next: NextFunction) => {
    const keyPart = keyGenerator(req);
    if (keyPart === null) return next();
    const key = `rl:${name}:${keyPart}`;

    let result: HitResult;
    try {
      result = await store.hit(key, windowMs);
    } catch (err) {
      console.error(`[RateLimit] Store error for ${name}; allowing request:`, (err as Error).message);
      return next();
    }

    const resetSeconds = Math.max(1, Math.ceil(result.resetMs / 1000));
    res.setHeader('X-RateLimit-Limit', maxRequests);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, maxRequests - result.count));
    res.setHeader('X-RateLimit-Reset', resetSeconds);

    if (result.count > maxRequests) {
      res.setHeader('Retry-After', resetSeconds);
      return res.status(429).json({
        success: false,
        error: 'TOO_MANY_REQUESTS',
        message,
        retryAfterSeconds: resetSeconds,
      });
    }
    return next();
  };
}

// 1. Auth endpoints per IP (login + setup): 20 attempts / 15 minutes
export const authRateLimiter = createRateLimiter({
  name: 'auth-ip',
  windowMs: 15 * 60 * 1000,
  maxRequests: 20,
  message: 'Too many authentication attempts. Please wait 15 minutes before trying again.',
});

// 1b. Login per account (stops password guessing spread across many IPs): 10 / 15 minutes
export const loginAccountRateLimiter = createRateLimiter({
  name: 'auth-account',
  windowMs: 15 * 60 * 1000,
  maxRequests: 10,
  message: 'Too many login attempts for this account. Please wait 15 minutes before trying again.',
  keyGenerator: (req) => {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    return email ? email.slice(0, 254) : null;
  },
});

// 2. Payment initiation (STK push flood protection): 5 / 2 minutes
export const paymentRateLimiter = createRateLimiter({
  name: 'payment',
  windowMs: 2 * 60 * 1000,
  maxRequests: 5,
  message: 'Too many payment requests initiated. Please wait 2 minutes before retrying.',
});

// 3. Public reservations: 10 / 15 minutes
export const reservationRateLimiter = createRateLimiter({
  name: 'reservation',
  windowMs: 15 * 60 * 1000,
  maxRequests: 10,
  message: 'Reservation limit reached for this session. Please wait before submitting another request.',
});

// 4. Public API: 150 / minute
export const publicApiRateLimiter = createRateLimiter({
  name: 'public',
  windowMs: 60 * 1000,
  maxRequests: 150,
  message: 'Public rate limit reached. Please slow down your requests.',
});

// 5. Global burst limiter: 600 / minute per IP (a menu page loads many images)
export const globalRateLimiter = createRateLimiter({
  name: 'global',
  windowMs: 60 * 1000,
  maxRequests: 600,
  message: 'Global request threshold exceeded.',
  // Health checks and cached media should not consume the budget.
  keyGenerator: (req) => (req.path.startsWith('/api/public/media/') || req.path.endsWith('/health') ? null : clientIp(req)),
});
