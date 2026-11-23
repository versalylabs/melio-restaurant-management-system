import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';

const isProduction = process.env.NODE_ENV === 'production';

// HTTP Security Headers Middleware
export function securityHeaders(req: Request, res: Response, next: NextFunction) {
  // Prevent MIME type sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');

  // Allow same-origin frame rendering (needed for POS receipt preview/printing popups)
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');

  // Strict Referrer Policy
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  // Disable invasive browser APIs by default
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(self)');

  // Content Security Policy
  const cspDirectives = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: https: blob: http:",
    "connect-src 'self' https: wss: ws:",
    "frame-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
  ];
  res.setHeader('Content-Security-Policy', cspDirectives.join('; '));

  // Enforce HSTS (HTTP Strict Transport Security) in production
  if (isProduction) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  }

  // Assign request ID for distributed tracing
  const requestId = req.headers['x-request-id'] || randomUUID();
  res.setHeader('X-Request-ID', requestId);

  next();
}

// Recursive string sanitizer to prevent stored/reflected XSS
function sanitizeValue(value: any): any {
  if (typeof value === 'string') {
    // Remove script tag injections and javascript: pseudo protocols
    return value
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/javascript\s*:/gi, '')
      .trim();
  }
  if (Array.isArray(value)) {
    return value.map(sanitizeValue);
  }
  if (value !== null && typeof value === 'object') {
    const sanitizedObj: Record<string, any> = {};
    for (const [key, val] of Object.entries(value)) {
      sanitizedObj[key] = sanitizeValue(val);
    }
    return sanitizedObj;
  }
  return value;
}

// Request Body & Query Sanitizer Middleware
export function sanitizeInputs(req: Request, _res: Response, next: NextFunction) {
  if (req.body && typeof req.body === 'object') {
    req.body = sanitizeValue(req.body);
  }
  if (req.query && typeof req.query === 'object') {
    req.query = sanitizeValue(req.query);
  }
  next();
}

// CORS allowlist. Never allow wildcard domains such as *.vercel.app together
// with credentials: anyone can deploy a site on those domains.
function buildAllowedOrigins(): Set<string> {
  const configured = [process.env.ALLOWED_ORIGINS, process.env.FRONTEND_URL]
    .filter(Boolean)
    .join(',')
    .split(',')
    .map((o) => o.trim().replace(/\/+$/, ''))
    .filter((o) => o && o !== '*');

  // Vercel system env vars: this project's own production/preview hostnames.
  const vercelHosts = [process.env.VERCEL_URL, process.env.VERCEL_BRANCH_URL, process.env.VERCEL_PROJECT_PRODUCTION_URL]
    .filter((h): h is string => Boolean(h))
    .map((h) => `https://${h}`);

  // Known Melio production frontends (exact hosts only). The client on any
  // *.vercel.app host calls the API on melio-restaurant-management-system.vercel.app.
  const knownFrontends = [
    'https://melio-restaurant-management-system.vercel.app',
    'https://melio-restaurant-management-system-nine.vercel.app',
  ];

  return new Set([...configured, ...vercelHosts, ...knownFrontends]);
}

const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

export function getCorsOptionsDelegate(baseOptions: Record<string, unknown>) {
  const allowed = buildAllowedOrigins();
  if (process.env.ALLOWED_ORIGINS?.split(',').some((o) => o.trim() === '*')) {
    console.warn('[CORS] ALLOWED_ORIGINS contains "*", which is ignored. List explicit origins instead.');
  }

  return (req: Request, callback: (err: Error | null, options?: Record<string, unknown>) => void) => {
    const origin = req.headers.origin;
    let allow = false;

    if (!origin) {
      allow = true; // non-browser clients (curl, server-to-server, Safaricom callbacks)
    } else if (allowed.has(origin)) {
      allow = true;
    } else if (!isProduction && LOCAL_ORIGIN.test(origin)) {
      allow = true;
    } else {
      // Same-origin requests (client and API served from one deployment).
      try {
        const originHost = new URL(origin).host;
        const forwardedHost = String(req.headers['x-forwarded-host'] || '').split(',')[0].trim();
        allow = originHost === req.headers.host || (forwardedHost !== '' && originHost === forwardedHost);
      } catch {
        allow = false;
      }
    }

    callback(null, { ...baseOptions, origin: allow ? origin : false });
  };
}
