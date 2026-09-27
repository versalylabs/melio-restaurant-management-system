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

export const preloadImages = (urls: (string | undefined | null)[]): void => {
  const valid = urls.filter((u): u is string => Boolean(u && typeof u === 'string'));
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
