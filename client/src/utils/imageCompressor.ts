/**
 * High-performance client-side image compression utility.
 * Compresses raw high-resolution images (JPEG, PNG, etc.) down to optimized WebP/JPEG
 * before uploading to Supabase or the server, drastically reducing upload time and bandwidth.
 */

export interface CompressionOptions {
  maxWidth?: number;
  maxHeight?: number;
  quality?: number;
  mimeType?: 'image/webp' | 'image/jpeg';
}

export const compressImage = async (
  file: File,
  options: CompressionOptions = {}
): Promise<File> => {
  const {
    maxWidth = 1200,
    maxHeight = 1200,
    quality = 0.82,
    mimeType = 'image/webp',
  } = options;

  // Don't process non-image files or SVG
  if (!file.type.startsWith('image/') || file.type === 'image/svg+xml') {
    return file;
  }

  // If already under 120KB and WebP, no need to compress further
  if (file.size < 120 * 1024 && file.type === 'image/webp') {
    return file;
  }

  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);

    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target?.result as string;

      img.onload = () => {
        let { width, height } = img;

        // Calculate aspect-ratio-preserved bounding box
        if (width > maxWidth || height > maxHeight) {
          if (width > height) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          } else {
            width = Math.round((width * maxHeight) / height);
            height = maxHeight;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          return resolve(file);
        }

        // Enable high quality image smoothing
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';

        // Draw and compress
        ctx.drawImage(img, 0, 0, width, height);

        // Check if browser supports WebP canvas export
        const targetMime = canvas.toDataURL('image/webp').startsWith('data:image/webp')
          ? mimeType
          : 'image/jpeg';

        canvas.toBlob(
          (blob) => {
            if (!blob) {
              return resolve(file);
            }

            // Only use compressed blob if it's actually smaller than original
            if (blob.size >= file.size && file.type === targetMime) {
              return resolve(file);
            }

            const extension = targetMime === 'image/webp' ? '.webp' : '.jpg';
            const baseName = file.name.substring(0, file.name.lastIndexOf('.')) || file.name;
            const newFileName = `${baseName}${extension}`;

            const compressedFile = new File([blob], newFileName, {
              type: targetMime,
              lastModified: Date.now(),
            });

            resolve(compressedFile);
          },
          targetMime,
          quality
        );
      };

      img.onerror = () => {
        resolve(file);
      };
    };

    reader.onerror = () => {
      resolve(file);
    };
  });
};
