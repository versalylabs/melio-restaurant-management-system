import React from 'react';
import { cn } from '../../lib/utils';

interface CardProps {
  className?: string;
  children: React.ReactNode;
  title?: string;
  description?: string;
  actions?: React.ReactNode;
}

export default function Card({ className, children, title, description, actions }: CardProps) {
  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-2xl border transition-all duration-300',
        'bg-white/80 dark:bg-[#121218]/85 backdrop-blur-xl',
        'border-orange-500/15 dark:border-white/10',
        'shadow-[0_8px_30px_rgb(0,0,0,0.04)] dark:shadow-[0_8px_32px_0_rgba(0,0,0,0.35)]',
        'liquid-glass-card',
        className
      )}
    >
      {/* Specular glare reflection top sheen */}
      <div className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-orange-400/40 dark:via-white/20 to-transparent pointer-events-none" />

      {(title || actions) && (
        <div className="relative z-10 px-6 py-4 border-b border-orange-100/60 dark:border-white/10 flex items-center justify-between bg-white/40 dark:bg-white/[0.02] backdrop-blur-md">
          <div>
            {title && <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 tracking-tight">{title}</h3>}
            {description && <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{description}</p>}
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className="relative z-10 p-6">{children}</div>
    </div>
  );
}
