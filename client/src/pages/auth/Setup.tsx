import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { authApi } from '../../services/api';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import Card from '../../components/ui/Card';

export default function Setup() {
  const [formData, setFormData] = useState({
    restaurantName: '',
    ownerFirstName: '',
    ownerLastName: '',
    ownerEmail: '',
    ownerPassword: '',
    ownerPhone: '',
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await authApi.setup(formData);
      if (response.data.success) {
        navigate('/login');
      } else {
        setError(response.data.message || 'Setup failed');
      }
    } catch (err: any) {
      setError(err.response?.data?.message || 'Setup failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#faf9f7] dark:bg-[#0d0d11] px-4 py-8">
      <Card className="w-full max-w-lg" title="Initial Setup">
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">
          Create your first restaurant and owner account.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 px-4 py-3 rounded-md text-sm">
              {error}
            </div>
          )}

          <Input
            id="restaurantName"
            label="Restaurant Name"
            value={formData.restaurantName}
            onChange={(e) => setFormData({ ...formData, restaurantName: e.target.value })}
            placeholder="Melio"
            required
          />

          <div className="grid grid-cols-2 gap-4">
            <Input
              id="ownerFirstName"
              label="Owner First Name"
              value={formData.ownerFirstName}
              onChange={(e) => setFormData({ ...formData, ownerFirstName: e.target.value })}
              required
            />
            <Input
              id="ownerLastName"
              label="Owner Last Name"
              value={formData.ownerLastName}
              onChange={(e) => setFormData({ ...formData, ownerLastName: e.target.value })}
              required
            />
          </div>

          <Input
            id="ownerEmail"
            type="email"
            label="Owner Email"
            value={formData.ownerEmail}
            onChange={(e) => setFormData({ ...formData, ownerEmail: e.target.value })}
            placeholder="owner@example.com"
            required
          />

          <Input
            id="ownerPassword"
            type="password"
            label="Password"
            value={formData.ownerPassword}
            onChange={(e) => setFormData({ ...formData, ownerPassword: e.target.value })}
            placeholder="••••••••"
            required
          />

          <Input
            id="ownerPhone"
            label="Phone (optional)"
            value={formData.ownerPhone}
            onChange={(e) => setFormData({ ...formData, ownerPhone: e.target.value })}
            placeholder="+254 700 000 000"
          />

          <Button type="submit" className="w-full" loading={loading}>
            Create Restaurant
          </Button>
        </form>
      </Card>
    </div>
  );
}
