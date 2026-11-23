
import React, { useId } from 'react';
import { cn } from '../../lib/utils';
import { X } from 'lucide-react';
import { useDialogA11y } from '../../hooks/useDialogA11y';

interface ModalProps {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
}

/**
 * Accessible modal: role="dialog", labelled by its title, closes on Escape
 * (not on a backdrop click, so a half-filled form isn't lost by accident),
 * keeps keyboard focus inside, and returns focus to whatever opened it.
 */
export default function Modal({ title, onClose, children, className }: ModalProps) {
  const titleId = useId();
  const ref = useDialogA11y<HTMLDivElement>(onClose);

  return (
    <div className="fixed inset-0 bg-black/60 dark:bg-black/80 backdrop-blur-md flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cn(
          'relative w-full max-w-lg overflow-hidden rounded-2xl md:rounded-3xl border transition-all duration-300 outline-none',
          'bg-white/95 dark:bg-[#121218]/95 backdrop-blur-2xl',
          'border-orange-500/20 dark:border-white/15',
          'shadow-[0_20px_60px_-15px_rgba(0,0,0,0.3)] dark:shadow-[0_25px_65px_-15px_rgba(0,0,0,0.7)]',
          'liquid-glass-card max-h-[90vh] flex flex-col',
          className
        )}
      >
        {/* Specular glare top reflection bar */}
        <div className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-orange-400/50 dark:via-white/30 to-transparent pointer-events-none" />

        <div className="relative z-10 flex items-center justify-between px-6 py-4 border-b border-orange-100/60 dark:border-white/10 bg-white/40 dark:bg-white/[0.02] backdrop-blur-sm">
          <h3 id={titleId} className="text-lg font-bold text-gray-900 dark:text-gray-100">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-2 -m-1 rounded-xl text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-white hover:bg-orange-50 dark:hover:bg-white/10 transition-colors"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>
        <div className="relative z-10 p-6 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}
