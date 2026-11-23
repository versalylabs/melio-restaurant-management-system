import { useEffect, useState } from 'react';
import Modal from '../ui/Modal';
import Input from '../ui/Input';
import Button from '../ui/Button';
import { approvalApi } from '../../services/api';
import { notify } from '../../lib/dialogs';

/**
 * Lets an owner, admin or manager set the PIN they type to approve voids,
 * big discounts and refunds on someone else's screen. Needs their password.
 */
export default function ApprovalPinModal({ onClose }: { onClose: () => void }) {
  const [hasPin, setHasPin] = useState<boolean | null>(null);
  const [password, setPassword] = useState('');
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    approvalApi.getPinStatus().then((r) => setHasPin(!!r.data.data?.hasPin)).catch(() => setHasPin(false));
  }, []);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!/^\d{4,6}$/.test(pin)) return setError('The PIN must be 4 to 6 digits.');
    if (pin !== confirm) return setError("The two PINs don't match.");
    setSaving(true);
    try {
      await approvalApi.setPin({ currentPassword: password, pin });
      notify('Approval PIN saved. Keep it to yourself.', 'success');
      onClose();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Could not save the PIN');
    } finally {
      setSaving(false);
    }
  };

  const digits = (value: string) => value.replace(/\D/g, '').slice(0, 6);

  return (
    <Modal title={hasPin ? 'Change your approval PIN' : 'Set your approval PIN'} onClose={onClose}>
      <form onSubmit={save} className="space-y-4">
        <p className="text-sm text-gray-600 dark:text-gray-300">
          You'll type this PIN on a cashier's or waiter's screen to approve removing an item the kitchen already has, a discount above their limit, or a refund. Every approval is recorded under your name.
        </p>
        <Input id="pin-password" type="password" label="Your password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        <Input id="pin-new" type="password" inputMode="numeric" autoComplete="off" label="New PIN (4–6 digits)" value={pin} onChange={(e) => setPin(digits(e.target.value))} required />
        <Input id="pin-confirm" type="password" inputMode="numeric" autoComplete="off" label="Type the PIN again" value={confirm} onChange={(e) => setConfirm(digits(e.target.value))} required />
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={saving}>Save PIN</Button>
        </div>
      </form>
    </Modal>
  );
}
