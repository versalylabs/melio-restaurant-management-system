import { Request, Response } from 'express';
import prisma from '../config/database';
import { safeRouter } from '../utils/safeRouter';

/*
 * GET /api/public/media/:id?f=image|logo&v=<hash>
 * Serves images that are stored inline (base64) in the database. URLs carry a
 * content hash, so responses are cached for a year by browsers and the CDN.
 * SVG is never served (it can contain scripts).
 */
const router = safeRouter();
const DATA_URI = /^data:(image\/(?:png|jpeg|jpg|webp|gif));base64,([A-Za-z0-9+/=\s]+)$/;

async function findStoredImage(id: string, field: string): Promise<string | null> {
  if (field === 'logo') {
    const restaurant = await prisma.restaurant.findUnique({ where: { id }, select: { logo: true } });
    return restaurant?.logo ?? null;
  }
  const menuItem = await prisma.menuItem.findUnique({ where: { id }, select: { image: true } });
  if (menuItem?.image) return menuItem.image;
  const galleryItem = await prisma.websiteGalleryItem.findUnique({ where: { id }, select: { image: true } });
  return galleryItem?.image ?? null;
}

router.get('/:id', async (req: Request, res: Response) => {
  const id = String(req.params.id || '');
  const field = req.query.f === 'logo' ? 'logo' : 'image';
  if (!/^[A-Za-z0-9-]{1,64}$/.test(id)) return res.status(400).end();

  const stored = await findStoredImage(id, field);
  if (!stored) return res.status(404).end();

  const match = stored.match(DATA_URI);
  if (!match) {
    // Not inline (e.g. an external URL or /images/... path): let the browser fetch it directly.
    if (/^(https?:)?\/\//.test(stored) || stored.startsWith('/')) return res.redirect(302, stored);
    return res.status(404).end();
  }

  const contentType = match[1] === 'image/jpg' ? 'image/jpeg' : match[1];
  const bytes = Buffer.from(match[2], 'base64');
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Length', bytes.length);
  // Versioned URL (?v=hash) => safe to cache "forever" in browsers and on the CDN.
  res.setHeader('Cache-Control', req.query.v
    ? 'public, max-age=31536000, s-maxage=31536000, immutable'
    : 'public, max-age=300, s-maxage=300');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  return res.end(bytes);
});

export default router;
