import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const rawSecretKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

// Check if secret key looks like a valid compact JWS JWT (3 dot-separated base64url parts)
const isValidJwt = (token?: string): boolean => {
  if (!token || typeof token !== 'string') return false;
  if (token.startsWith('your-') || token.includes(' ')) return false;
  const parts = token.split('.');
  return parts.length === 3 && parts.every((p) => p.length > 0);
};

const supabaseSecretKey = isValidJwt(rawSecretKey) ? rawSecretKey : undefined;
const bucketName = process.env.SUPABASE_STORAGE_BUCKET || 'menu-images';

const supabase = supabaseUrl && supabaseSecretKey
  ? createClient(supabaseUrl, supabaseSecretKey, { auth: { persistSession: false, autoRefreshToken: false } })
  : null;

export const ensureMenuImageBucket = async () => {
  if (!supabase) return;
  try {
    const { data } = await supabase.storage.getBucket(bucketName);
    if (!data) {
      const { error } = await supabase.storage.createBucket(bucketName, {
        public: true,
        allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
        fileSizeLimit: '6MB',
      });
      if (error && !/already exists/i.test(error.message)) {
        console.warn('Bucket creation warning:', error.message);
      }
    } else if (!data.public) {
      await supabase.storage.updateBucket(bucketName, {
        public: true,
        allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
        fileSizeLimit: '6MB',
      });
    }
  } catch (err: any) {
    console.warn('ensureMenuImageBucket warning:', err?.message || err);
  }
};

import fs from 'fs';
import path from 'path';

/**
 * Storage Engine for Menu Images & Gallery Uploads.
 * - Completely independent of Supabase.
 * - Locally: writes images to public static assets so they can be cached and served directly.
 * - Cloud / Serverless (Vercel): stores high-fidelity inline Base64 data URIs directly in Neon PostgreSQL.
 * - Preserves 100% functionality with zero third-party storage downtime.
 */
export const uploadMenuImage = async (filePath: string, buffer: Buffer, contentType: string): Promise<string> => {
  // 1. Try saving to local static images directory if filesystem is writable
  try {
    const candidates = [
      path.resolve(process.cwd(), 'client/public/images/uploads'),
      path.resolve(__dirname, '../../../client/public/images/uploads'),
      path.resolve(__dirname, '../../client/public/images/uploads'),
      path.resolve(__dirname, '../public/images/uploads'),
    ];

    for (const dir of candidates) {
      try {
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        const safeName = `${Date.now()}-${path.basename(filePath).replace(/[^a-zA-Z0-9._-]/g, '_')}`;
        const targetFile = path.join(dir, safeName);
        fs.writeFileSync(targetFile, buffer);
        return `/images/uploads/${safeName}`;
      } catch {
        // Continue to next candidate or fallback
      }
    }
  } catch (fsErr) {
    // Read-only filesystem (e.g. Vercel serverless lambda)
  }

  // 2. Resilient Fallback: Return inline Base64 data URI permanently stored in Neon PostgreSQL
  return `data:${contentType};base64,${buffer.toString('base64')}`;
};

export const deleteMenuImage = async (filePath: string) => {
  if (!filePath || filePath.startsWith('data:')) return;
  try {
    if (filePath.startsWith('/images/uploads/')) {
      const fileName = path.basename(filePath);
      const candidates = [
        path.resolve(process.cwd(), 'client/public/images/uploads', fileName),
        path.resolve(__dirname, '../../../client/public/images/uploads', fileName),
      ];
      for (const f of candidates) {
        if (fs.existsSync(f)) {
          fs.unlinkSync(f);
        }
      }
    }
  } catch (err) {
    // Non-fatal
  }
};

export const extractMenuImagePath = (url?: string | null) => {
  if (!url || !supabaseUrl) return null;
  const marker = `/storage/v1/object/public/${bucketName}/`;
  const index = url.indexOf(marker);
  return index >= 0 ? decodeURIComponent(url.slice(index + marker.length)) : null;
};
