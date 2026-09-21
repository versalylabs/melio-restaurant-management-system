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

/**
 * Uploads an image to Supabase Storage if configured and valid.
 * Automatically falls back to a high-fidelity data URI if Supabase credentials are not provided or reject the request.
 */
export const uploadMenuImage = async (path: string, buffer: Buffer, contentType: string): Promise<string> => {
  if (supabase) {
    try {
      await ensureMenuImageBucket();
      const { error } = await supabase.storage.from(bucketName).upload(path, buffer, {
        contentType,
        cacheControl: '31536000',
        upsert: true,
      });

      if (!error) {
        const publicUrl = supabase.storage.from(bucketName).getPublicUrl(path).data?.publicUrl;
        if (publicUrl) return publicUrl;
      } else {
        console.warn('Supabase storage upload error, falling back to embedded image storage:', error.message);
      }
    } catch (supabaseError: any) {
      console.warn('Supabase upload exception, falling back to embedded image storage:', supabaseError?.message || supabaseError);
    }
  }

  // Resilient fallback: Return inline Base64 data URI permanently persisted in PostgreSQL
  return `data:${contentType};base64,${buffer.toString('base64')}`;
};

export const deleteMenuImage = async (path: string) => {
  if (!supabase) return;
  try {
    await supabase.storage.from(bucketName).remove([path]);
  } catch (err: any) {
    console.warn('Could not delete image from Supabase storage:', err?.message || err);
  }
};

export const extractMenuImagePath = (url?: string | null) => {
  if (!url || !supabaseUrl) return null;
  const marker = `/storage/v1/object/public/${bucketName}/`;
  const index = url.indexOf(marker);
  return index >= 0 ? decodeURIComponent(url.slice(index + marker.length)) : null;
};
