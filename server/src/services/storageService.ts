import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const bucketName = process.env.SUPABASE_STORAGE_BUCKET || 'menu-images';

const supabase = supabaseUrl && supabaseSecretKey
  ? createClient(supabaseUrl, supabaseSecretKey, { auth: { persistSession: false, autoRefreshToken: false } })
  : null;

const assertConfigured = () => {
  if (!supabase) {
    throw new Error('Supabase Storage is not configured. Set SUPABASE_URL and SUPABASE_SECRET_KEY on the server.');
  }
  return supabase;
};

export const ensureMenuImageBucket = async () => {
  const client = assertConfigured();
  const { data } = await client.storage.getBucket(bucketName);
  if (!data) {
    const { error } = await client.storage.createBucket(bucketName, {
      public: true,
      allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
      fileSizeLimit: '6MB',
    });
    if (error && !/already exists/i.test(error.message)) throw error;
  } else if (!data.public) {
    const { error } = await client.storage.updateBucket(bucketName, {
      public: true,
      allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
      fileSizeLimit: '6MB',
    });
    if (error) throw error;
  }
};

export const uploadMenuImage = async (path: string, buffer: Buffer, contentType: string) => {
  const client = assertConfigured();
  await ensureMenuImageBucket();
  const { error } = await client.storage.from(bucketName).upload(path, buffer, {
    contentType,
    cacheControl: '31536000',
    upsert: true,
  });
  if (error) throw error;
  return client.storage.from(bucketName).getPublicUrl(path).data.publicUrl;
};

export const deleteMenuImage = async (path: string) => {
  const client = assertConfigured();
  const { error } = await client.storage.from(bucketName).remove([path]);
  if (error) throw error;
};

export const extractMenuImagePath = (url?: string | null) => {
  if (!url || !supabaseUrl) return null;
  const marker = `/storage/v1/object/public/${bucketName}/`;
  const index = url.indexOf(marker);
  return index >= 0 ? decodeURIComponent(url.slice(index + marker.length)) : null;
};
