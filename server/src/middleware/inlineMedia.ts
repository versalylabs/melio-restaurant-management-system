import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';

/*
 * On serverless hosts (Vercel) uploaded images are stored in the database as
 * base64 data URIs. Returning them inline made every menu response several
 * megabytes. These helpers keep the storage as-is but:
 *   - replace inline images in JSON responses with a small, cacheable URL
 *     served by GET /api/public/media/:id (see routes/media.ts), and
 *   - drop those URLs when a form echoes them back, so saving an edit form
 *     never overwrites the real stored image with a link to itself.
 */

export const MEDIA_FIELDS = ['image', 'logo'] as const;
const MEDIA_PATH = '/api/public/media/';

const hashCache = new Map<string, string>();

/** Short content hash used as a cache-busting version in the media URL. */
export function mediaVersion(dataUri: string): string {
  // Key by length + head + tail to avoid re-hashing the same large string on every request.
  const key = `${dataUri.length}:${dataUri.slice(0, 64)}:${dataUri.slice(-64)}`;
  let version = hashCache.get(key);
  if (!version) {
    version = crypto.createHash('sha1').update(dataUri).digest('hex').slice(0, 12);
    if (hashCache.size > 2000) hashCache.clear();
    hashCache.set(key, version);
  }
  return version;
}

/** Absolute origin of this API (the client may load the page from a different host). */
export function requestOrigin(req: Request): string {
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0].trim();
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  return host ? `${proto}://${host}` : '';
}

export function isInlineImage(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('data:image/');
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype;

/** Returns a copy of `body` with inline images replaced by media URLs. */
export function rewriteInlineImages(body: unknown, origin: string): unknown {
  if (Array.isArray(body)) return body.map((v) => rewriteInlineImages(v, origin));
  if (!isPlainObject(body)) return body;

  const out: Record<string, unknown> = {};
  const id = typeof body.id === 'string' ? body.id : undefined;
  for (const [key, value] of Object.entries(body)) {
    if (id && (MEDIA_FIELDS as readonly string[]).includes(key) && isInlineImage(value)) {
      out[key] = `${origin}${MEDIA_PATH}${encodeURIComponent(id)}?f=${key}&v=${mediaVersion(value)}`;
    } else {
      out[key] = rewriteInlineImages(value, origin);
    }
  }
  return out;
}

/** Express middleware: rewrite inline images in every JSON response. */
export function inlineMediaResponses(req: Request, res: Response, next: NextFunction) {
  const originalJson = res.json.bind(res);
  res.json = (body?: unknown) => originalJson(rewriteInlineImages(body, requestOrigin(req)));
  next();
}

/** Removes image/logo fields whose value is one of our own media URLs ("unchanged"). */
export function stripEchoedMediaUrls(body: unknown): unknown {
  if (Array.isArray(body)) return body.map(stripEchoedMediaUrls);
  if (!isPlainObject(body)) return body;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    if ((MEDIA_FIELDS as readonly string[]).includes(key) && typeof value === 'string' && value.includes(MEDIA_PATH)) continue;
    out[key] = stripEchoedMediaUrls(value);
  }
  return out;
}

export function ignoreEchoedMediaUrls(req: Request, _res: Response, next: NextFunction) {
  if (req.body && typeof req.body === 'object' && ['POST', 'PUT', 'PATCH'].includes(req.method)) {
    req.body = stripEchoedMediaUrls(req.body);
  }
  next();
}
