/**
 * High-performance Image Preloader utility.
 * Preloads critical menu images, logos, and gallery photos into browser cache.
 */

const preloadedUrls = new Set<string>();

export const preloadImage = (url?: string | null): Promise<void> => {
  if (!url || typeof url !== 'string' || preloadedUrls.has(url)) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const img = new Image();
    img.src = url;
    img.decode?.()
      .then(() => {
        preloadedUrls.add(url);
        resolve();
      })
      .catch(() => {
        img.onload = () => {
          preloadedUrls.add(url);
          resolve();
        };
        img.onerror = () => resolve();
      });
  });
};

/** Images are full size (~150 KB each); never fetch a whole menu up front. */
const MAX_PRELOAD = 8;

/** Skip preloading on metered or slow connections. */
const onConstrainedConnection = (): boolean => {
  const conn = typeof navigator !== 'undefined' ? (navigator as any).connection : undefined;
  if (!conn) return false;
  return Boolean(conn.saveData) || /(^|-)2g$|^3g$/.test(String(conn.effectiveType || ''));
};

/**
 * Warms the browser cache with the first few images (what the user sees
 * first). Everything else loads lazily as it scrolls into view.
 */
export const preloadImages = (urls: (string | undefined | null)[], limit = MAX_PRELOAD): void => {
  if (onConstrainedConnection()) return;
  const valid = [...new Set(urls.filter((u): u is string => Boolean(u && typeof u === 'string')))].slice(0, limit);
  if (!valid.length) return;

  // Use requestIdleCallback if available for zero-main-thread impact
  if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
    (window as any).requestIdleCallback(() => {
      valid.forEach((url) => preloadImage(url));
    }, { timeout: 2000 });
  } else {
    setTimeout(() => {
      valid.forEach((url) => preloadImage(url));
    }, 100);
  }
};
