import { cn } from '../../lib/utils';
import { X } from 'lucide-react';

interface ModalProps {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
}

export default function Modal({ title, onClose, children, className }: ModalProps) {
  return (
    <div className="fixed inset-0 bg-black/50 dark:bg-black/70 flex items-center justify-center z-50 p-4">
      <div className={cn('bg-white dark:bg-[#111116] rounded-lg shadow-xl max-h-[90vh] overflow-y-auto border border-orange-100 dark:border-gray-700', className)}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-orange-100 dark:border-gray-700">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{title}</h3>
          <button
            onClick={onClose}
            className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}
