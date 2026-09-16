import { useState, useEffect } from 'react';
import { restaurantApi, api } from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';
import type { Restaurant } from '../../types';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import Card from '../../components/ui/Card';

export default function Settings() {
  const [, setRestaurant] = useState<Restaurant | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [passwords, setPasswords] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [passwordSaving, setPasswordSaving] = useState(false);
  const { logout } = useAuth();

  const [formData, setFormData] = useState({
    name: '',
    legalName: '',
    description: '',
    phone: '',
    email: '',
    address: '',
    city: '',
    country: 'Kenya',
    currency: 'KES',
    logo: '',
    timezone: 'Africa/Nairobi',
    taxRate: 0,
    serviceChargeRate: 0,
  });

  useEffect(() => {
    const fetchRestaurant = async () => {
      try {
        const response = await restaurantApi.get();
        if (response.data.success && response.data.data) {
          const data = response.data.data;
          setRestaurant(data);
          setFormData({
            name: data.name || '',
            legalName: data.legalName || '',
            description: data.description || '',
            phone: data.phone || '',
            email: data.email || '',
            address: data.address || '',
            city: data.city || '',
            country: data.country || 'Kenya',
            currency: data.currency || 'KES',
            logo: data.logo || '',
            timezone: data.timezone || 'Africa/Nairobi',
            taxRate: (data.taxRate || 0) * 100,
            serviceChargeRate: (data.serviceChargeRate || 0) * 100,
          });
        }
      } catch (err: any) {
        setError(err.response?.data?.message || 'Failed to load settings');
      } finally {
        setLoading(false);
      }
    };

    fetchRestaurant();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setSaving(true);

    try {
      const response = await restaurantApi.update(formData);
      if (response.data.success) {
        setSuccess('Settings updated successfully');
      } else {
        setError(response.data.message || 'Failed to update settings');
      }
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to update settings');
    } finally {
      setSaving(false);
    }
  };


  const changePassword = async (e: React.FormEvent) => {
    e.preventDefault(); setError(''); setSuccess('');
    if (passwords.newPassword.length < 8) return setError('New password must be at least 8 characters');
    if (passwords.newPassword !== passwords.confirmPassword) return setError('New passwords do not match');
    setPasswordSaving(true);
    try {
      await api.post('/users/me/change-password', { currentPassword: passwords.currentPassword, newPassword: passwords.newPassword });
      setPasswords({ currentPassword: '', newPassword: '', confirmPassword: '' });
      setSuccess('Password changed successfully. Signing you out...');
      setTimeout(() => { logout(); }, 700);
    } catch (err: any) { setError(err.response?.data?.message || 'Failed to change password'); }
    finally { setPasswordSaving(false); }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-gray-500 dark:text-gray-400">Loading settings...</div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Settings</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Manage your restaurant information</p>
      </div>

      <Card title="Restaurant Information" description="Basic information about your restaurant">
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 px-4 py-3 rounded-md text-sm">
              {error}
            </div>
          )}

          {success && (
            <div className="bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800 text-green-700 dark:text-green-400 px-4 py-3 rounded-md text-sm">
              {success}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              id="name"
              label="Restaurant Name"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              required
            />
            <Input
              id="legalName"
              label="Legal Business Name"
              value={formData.legalName}
              onChange={(e) => setFormData({ ...formData, legalName: e.target.value })}
            />
          </div>

          <Input
            id="description"
            label="Description"
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
          />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              id="phone"
              label="Phone"
              value={formData.phone}
              onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
            />
            <Input
              id="email"
              type="email"
              label="Email"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              id="address"
              label="Address"
              value={formData.address}
              onChange={(e) => setFormData({ ...formData, address: e.target.value })}
            />
            <Input
              id="city"
              label="City"
              value={formData.city}
              onChange={(e) => setFormData({ ...formData, city: e.target.value })}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Input
              id="country"
              label="Country"
              value={formData.country}
              onChange={(e) => setFormData({ ...formData, country: e.target.value })}
            />
            <Input
              id="currency"
              label="Currency"
              value={formData.currency}
              onChange={(e) => setFormData({ ...formData, currency: e.target.value })}
            />
            <Input
              id="timezone"
              label="Timezone"
              value={formData.timezone}
              onChange={(e) => setFormData({ ...formData, timezone: e.target.value })}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input id="taxRate" type="number" min="0" max="100" step="0.01" label="Tax Rate (%)" value={formData.taxRate} onChange={e=>setFormData({...formData,taxRate:Number(e.target.value)})} />
            <Input id="serviceChargeRate" type="number" min="0" max="100" step="0.01" label="Service Charge (%)" value={formData.serviceChargeRate} onChange={e=>setFormData({...formData,serviceChargeRate:Number(e.target.value)})} />
          </div>

          <Input
            id="logo"
            label="Logo URL"
            value={formData.logo}
            onChange={(e) => setFormData({ ...formData, logo: e.target.value })}
            placeholder="https://example.com/logo.png"
          />

          <div className="flex justify-end">
            <Button type="submit" loading={saving}>
              Save Changes
            </Button>
          </div>
        </form>
      </Card>

      <Card title="My Password" description="Change your own sign-in password. Changing it signs out existing sessions for this account.">
        <form onSubmit={changePassword} className="space-y-4">
          <Input id="currentPassword" type="password" label="Current Password" value={passwords.currentPassword} onChange={e=>setPasswords({...passwords,currentPassword:e.target.value})} required />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input id="newPassword" type="password" label="New Password" value={passwords.newPassword} onChange={e=>setPasswords({...passwords,newPassword:e.target.value})} required minLength={8} />
            <Input id="confirmPassword" type="password" label="Confirm New Password" value={passwords.confirmPassword} onChange={e=>setPasswords({...passwords,confirmPassword:e.target.value})} required minLength={8} />
          </div>
          <div className="flex justify-end"><Button type="submit" loading={passwordSaving}>Change Password</Button></div>
        </form>
      </Card>
    </div>
  );
}

