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
    <div className={cn('bg-white dark:bg-[#111116] rounded-lg border border-orange-100 dark:border-gray-700 shadow-sm', className)}>
      {(title || actions) && (
        <div className="px-6 py-4 border-b border-orange-100 dark:border-gray-700 flex items-center justify-between">
          <div>
            {title && <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{title}</h3>}
            {description && <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{description}</p>}
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className="p-6">{children}</div>
    </div>
  );
}
