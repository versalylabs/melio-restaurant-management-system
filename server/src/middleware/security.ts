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

// Multi-Origin Dynamic CORS Origin Validator
export function getCorsOriginValidator() {
  const rawOrigins = process.env.ALLOWED_ORIGINS || process.env.FRONTEND_URL || 'http://localhost:5173,http://localhost:3000,http://127.0.0.1:5173';
  const allowedList = rawOrigins
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  const localPatterns = [
    /^http:\/\/localhost(:\d+)?$/,
    /^http:\/\/127\.0\.0\.1(:\d+)?$/,
    /\.vercel\.app$/,
  ];

  return (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
    // Allow requests with no origin (like mobile apps, curl, server-to-server, Postman)
    if (!origin) return callback(null, true);

    if (
      allowedList.includes('*') ||
      allowedList.includes(origin) ||
      localPatterns.some((pattern) => pattern.test(origin))
    ) {
      return callback(null, true);
    }

    // Safely deny unauthorized origins without throwing 500 internal server errors
    callback(null, false);
  };
}
