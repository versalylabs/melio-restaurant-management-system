import { useState, useEffect } from 'react';
import { resolveImageUrl } from '../../utils/imageUtils';

interface OptimizedImageProps extends Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src'> {
  src?: string | null;
  fallbackIcon?: React.ReactNode;
  aspectRatio?: string;
  containerClassName?: string;
}

export function OptimizedImage({
  src,
  alt = '',
  className = '',
  containerClassName = '',
  fallbackIcon,
  aspectRatio,
  ...props
}: OptimizedImageProps) {
  const [currentSrc, setCurrentSrc] = useState(() => resolveImageUrl(src, alt));
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    setCurrentSrc(resolveImageUrl(src, alt));
    setLoaded(false);
    setError(false);
  }, [src, alt]);

  const handleError = () => {
    const localFallback = resolveImageUrl(null, alt);
    if (localFallback && currentSrc !== localFallback) {
      setCurrentSrc(localFallback);
      setError(false);
    } else {
      setError(true);
    }
  };

  if (!currentSrc || error) {
    return (
      <div
        className={`flex h-full w-full items-center justify-center bg-orange-500/5 dark:bg-white/5 text-orange-400 ${containerClassName}`}
        style={aspectRatio ? { aspectRatio } : undefined}
      >
        {fallbackIcon || <span className="text-2xl drop-shadow-sm select-none">🍽️</span>}
      </div>
    );
  }

  return (
    <div
      className={`relative overflow-hidden ${containerClassName}`}
      style={aspectRatio ? { aspectRatio } : undefined}
    >
      {/* Shimmer Placeholder while loading */}
      {!loaded && (
        <div className="absolute inset-0 bg-gradient-to-r from-orange-500/5 via-orange-500/10 to-orange-500/5 dark:from-white/5 dark:via-white/10 dark:to-white/5 animate-pulse" />
      )}

      <img
        src={currentSrc}
        alt={alt}
        loading="lazy"
        decoding="async"
        onLoad={() => setLoaded(true)}
        onError={handleError}
        className={`${className} transition-opacity duration-300 ${
          loaded ? 'opacity-100' : 'opacity-0'
        }`}
        {...props}
      />
    </div>
  );
}

export default OptimizedImage;
