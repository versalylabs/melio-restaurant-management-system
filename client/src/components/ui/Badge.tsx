import { cn } from '../../lib/utils';

interface BadgeProps {
  children: React.ReactNode;
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'info';
  className?: string;
}

export default function Badge({ children, variant = 'default', className }: BadgeProps) {
  const variants = {
    default: 'bg-gray-100 dark:bg-[#111116] text-gray-800 dark:text-gray-200',
    success: 'bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-300',
    warning: 'bg-yellow-100 dark:bg-yellow-900/40 text-yellow-800 dark:text-yellow-300',
    danger: 'bg-red-100 dark:bg-red-900/40 text-red-800 dark:text-red-300',
    info: 'bg-orange-100 dark:bg-orange-900/40 text-orange-800 dark:text-orange-300',
  };

  return (
    <span
      className={cn(
        'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
        variants[variant],
        className
      )}
    >
      {children}
    </span>
  );
}
