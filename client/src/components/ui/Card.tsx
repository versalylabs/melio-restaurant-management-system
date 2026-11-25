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
        'glass-panel relative overflow-hidden rounded-2xl md:rounded-3xl transition-all duration-300',
        className
      )}
    >
      {(title || actions) && (
        <div className="relative z-10 px-6 py-4 border-b border-orange-500/10 dark:border-white/[0.07] flex items-center justify-between">
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
