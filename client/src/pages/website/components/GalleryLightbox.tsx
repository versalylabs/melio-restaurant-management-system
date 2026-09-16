import { useEffect } from 'react';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';

export type GalleryItem = {
  id: string;
  title: string;
  category: 'dishes' | 'cocktails' | 'ambience' | 'culinary';
  image: string;
  description?: string;
};

interface GalleryLightboxProps {
  items: GalleryItem[];
  currentIndex: number;
  isOpen: boolean;
  onClose: () => void;
  onNavigate: (index: number) => void;
}

export default function GalleryLightbox({
  items,
  currentIndex,
  isOpen,
  onClose,
  onNavigate,
}: GalleryLightboxProps) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft') onNavigate((currentIndex - 1 + items.length) % items.length);
      if (e.key === 'ArrowRight') onNavigate((currentIndex + 1) % items.length);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, currentIndex, items.length, onClose, onNavigate]);

  if (!isOpen || !items[currentIndex]) return null;

  const current = items[currentIndex];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-md p-4 sm:p-6 transition-all duration-300">
      {/* Close button */}
      <button
        onClick={onClose}
        className="absolute top-5 right-5 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur-md transition hover:bg-white/20"
        aria-label="Close lightbox"
      >
        <X size={22} />
      </button>

      {/* Prev button */}
      <button
        onClick={() => onNavigate((currentIndex - 1 + items.length) % items.length)}
        className="absolute left-4 top-1/2 z-10 -translate-y-1/2 flex h-12 w-12 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur-md transition hover:bg-orange-500 hover:text-white"
        aria-label="Previous image"
      >
        <ChevronLeft size={26} />
      </button>

      {/* Next button */}
      <button
        onClick={() => onNavigate((currentIndex + 1) % items.length)}
        className="absolute right-4 top-1/2 z-10 -translate-y-1/2 flex h-12 w-12 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur-md transition hover:bg-orange-500 hover:text-white"
        aria-label="Next image"
      >
        <ChevronRight size={26} />
      </button>

      {/* Image & Details Container */}
      <div className="max-w-4xl max-h-[85vh] flex flex-col items-center overflow-hidden rounded-2xl bg-zinc-950 border border-white/10 shadow-2xl">
        <div className="relative max-h-[68vh] w-full flex items-center justify-center overflow-hidden bg-black">
          <img
            src={current.image}
            alt={current.title}
            className="max-h-[68vh] w-auto max-w-full object-contain"
          />
        </div>

        <div className="w-full p-5 text-center bg-zinc-950/90 border-t border-white/10">
          <div className="inline-block rounded-full bg-orange-500/20 px-3 py-1 text-xs font-bold uppercase tracking-wider text-orange-400">
            {current.category}
          </div>
          <h3 className="mt-2 text-xl font-serif font-bold text-white">{current.title}</h3>
          {current.description && (
            <p className="mt-1 text-sm text-gray-300 max-w-xl mx-auto">{current.description}</p>
          )}
          <div className="mt-2 text-xs text-gray-400">
            {currentIndex + 1} of {items.length}
          </div>
        </div>
      </div>
    </div>
  );
}
