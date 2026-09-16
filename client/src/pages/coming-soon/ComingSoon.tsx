import { Inbox } from 'lucide-react';
import Button from '../../components/ui/Button';
import { useNavigate } from 'react-router-dom';

interface ComingSoonProps {
  title: string;
}

export default function ComingSoon({ title }: ComingSoonProps) {
  const navigate = useNavigate();

  return (
    <div className="flex flex-col items-center justify-center h-full p-6 text-center">
      <div className="p-4 bg-gray-100 dark:bg-[#111116] rounded-full mb-4">
        <Inbox className="w-12 h-12 text-gray-400 dark:text-gray-500" />
      </div>
      <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">{title}</h2>
      <p className="text-gray-500 dark:text-gray-400 max-w-md mb-6">
        This module is not yet available in the current phase. It will be implemented in a future update.
      </p>
      <div className="flex gap-3">
        <Button variant="secondary" onClick={() => navigate('/dashboard')}>
          Back to Dashboard
        </Button>
        <Button onClick={() => navigate(-1)}>Go Back</Button>
      </div>
    </div>
  );
}
