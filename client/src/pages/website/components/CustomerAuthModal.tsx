import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  X,
  Lock,
  Mail,
  Phone,
  User,
  MapPin,
  Sparkles,
  AlertCircle,
  ArrowRight,
  ShieldCheck,
  UtensilsCrossed,
  KeyRound
} from 'lucide-react';
import { useCustomerAuth } from '../../../contexts/CustomerAuthContext';
import { useAuth } from '../../../contexts/AuthContext';
import { authApi } from '../../../services/api';

interface CustomerAuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  restaurantId: string;
  onSuccess?: () => void;
  initialTab?: 'CUSTOMER' | 'STAFF';
}

export default function CustomerAuthModal({
  isOpen,
  onClose,
  restaurantId,
  onSuccess,
  initialTab = 'CUSTOMER',
}: CustomerAuthModalProps) {
  const navigate = useNavigate();
  const { login: customerLogin, register: customerRegister } = useCustomerAuth();
  const { login: staffLogin } = useAuth();

  const [authType, setAuthType] = useState<'CUSTOMER' | 'STAFF'>(initialTab);
  const [mode, setMode] = useState<'LOGIN' | 'REGISTER'>('LOGIN');

  // Form Fields
  const [name, setName] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (authType === 'STAFF') {
        // Direct Staff Authentication
        const staffEmail = identifier || email;
        const res = await authApi.login(staffEmail, password);
        if (res.data.success && res.data.data) {
          staffLogin(res.data.data.token, res.data.data.user);
          onClose();
          navigate('/dashboard');
          return;
        } else {
          setError(res.data.message || 'Invalid staff credentials');
        }
      } else {
        // Customer / Diner Authentication
        if (mode === 'LOGIN') {
          try {
            await customerLogin(identifier, password, restaurantId);
            onClose();
            if (onSuccess) onSuccess();
            return;
          } catch (custErr: any) {
            // Smart Fallback: Check if user accidentally entered Staff Credentials in Customer tab
            try {
              const staffRes = await authApi.login(identifier, password);
              if (staffRes.data.success && staffRes.data.data) {
                staffLogin(staffRes.data.data.token, staffRes.data.data.user);
                onClose();
                navigate('/dashboard');
                return;
              }
            } catch {
              // Both customer and staff auth failed, show standard customer error
            }
            throw custErr;
          }
        } else {
          await customerRegister({
            restaurantId,
            name,
            email,
            phone,
            password,
            address,
          });
          onClose();
          if (onSuccess) onSuccess();
        }
      }
    } catch (err: any) {
      setError(err.response?.data?.message || err.message || 'Authentication failed. Please verify your details.');
    } finally {
      setLoading(false);
    }
  };



  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4 overflow-y-auto animate-in fade-in duration-200">
      <div className="relative w-full max-w-md rounded-3xl bg-zinc-950 border border-orange-500/20 text-white shadow-2xl p-6 sm:p-8">
        <button
          onClick={onClose}
          className="absolute top-5 right-5 text-gray-400 hover:text-white transition p-1"
          aria-label="Close modal"
        >
          <X size={20} />
        </button>

        {/* Auth Type Switcher (Guest vs Staff) */}
        <div className="flex rounded-2xl bg-white/5 p-1 border border-white/10 mb-6">
          <button
            type="button"
            onClick={() => {
              setAuthType('CUSTOMER');
              setError('');
            }}
            className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-xl text-xs font-bold transition ${
              authType === 'CUSTOMER'
                ? 'bg-orange-500 text-white shadow-lg shadow-orange-500/30'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            <Sparkles size={14} /> Guest & Rewards
          </button>
          <button
            type="button"
            onClick={() => {
              setAuthType('STAFF');
              setError('');
            }}
            className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-xl text-xs font-bold transition ${
              authType === 'STAFF'
                ? 'bg-orange-500 text-white shadow-lg shadow-orange-500/30'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            <ShieldCheck size={14} /> Staff / Manager
          </button>
        </div>

        {/* Modal Header */}
        <div>
          <div className="flex items-center gap-2 text-orange-400 text-xs font-bold uppercase tracking-widest">
            {authType === 'CUSTOMER' ? (
              <>
                <UtensilsCrossed size={14} /> Diners Club & Loyalty
              </>
            ) : (
              <>
                <KeyRound size={14} /> Operations & Back-Office
              </>
            )}
          </div>
          <h2 className="font-serif text-2xl font-bold text-white mt-1">
            {authType === 'CUSTOMER'
              ? mode === 'LOGIN'
                ? 'Welcome Back'
                : 'Join Diners Club'
              : 'Staff Portal Sign In'}
          </h2>
          <p className="text-xs text-gray-400 mt-1">
            {authType === 'CUSTOMER'
              ? mode === 'LOGIN'
                ? 'Sign in to access order history, table bookings, and loyalty points.'
                : 'Create your guest profile to earn rewards and enjoy 1-click ordering.'
              : 'Authorized access for restaurant owners, managers, chefs, cashiers, and waitstaff.'}
          </p>
        </div>

        {error && (
          <div className="mt-4 flex items-center gap-2 rounded-xl border border-red-500/40 bg-red-950/50 p-3 text-xs text-red-300 animate-in fade-in">
            <AlertCircle size={16} className="shrink-0 text-red-400" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          {authType === 'CUSTOMER' && mode === 'REGISTER' && (
            <div>
              <label className="block text-xs font-semibold text-gray-300 mb-1">Full Name</label>
              <div className="relative flex items-center">
                <User size={16} className="absolute left-3.5 text-gray-400 pointer-events-none" />
                <input
                  type="text"
                  required
                  placeholder="e.g. Lady Sarah"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full rounded-xl bg-zinc-900 border border-white/10 pl-10 pr-4 py-2.5 text-sm text-white placeholder:text-gray-500 focus:border-orange-500 focus:outline-none"
                />
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-gray-300 mb-1">
              {authType === 'CUSTOMER' && mode === 'REGISTER'
                ? 'Email Address'
                : authType === 'STAFF'
                ? 'Staff Email Address'
                : 'Email or Phone Number'}
            </label>
            <div className="relative flex items-center">
              <Mail size={16} className="absolute left-3.5 text-gray-400 pointer-events-none" />
              <input
                type={authType === 'CUSTOMER' && mode === 'REGISTER' ? 'email' : 'text'}
                required
                placeholder={
                  authType === 'STAFF'
                    ? 'e.g. owner@example.com'
                    : 'e.g. guest@example.com or 0712345678'
                }
                value={authType === 'CUSTOMER' && mode === 'REGISTER' ? email : identifier}
                onChange={(e) => {
                  if (authType === 'CUSTOMER' && mode === 'REGISTER') setEmail(e.target.value);
                  else setIdentifier(e.target.value);
                }}
                className="w-full rounded-xl bg-zinc-900 border border-white/10 pl-10 pr-4 py-2.5 text-sm text-white placeholder:text-gray-500 focus:border-orange-500 focus:outline-none"
              />
            </div>
          </div>

          {authType === 'CUSTOMER' && mode === 'REGISTER' && (
            <>
              <div>
                <label className="block text-xs font-semibold text-gray-300 mb-1">Phone Number (Optional)</label>
                <div className="relative flex items-center">
                  <Phone size={16} className="absolute left-3.5 text-gray-400 pointer-events-none" />
                  <input
                    type="tel"
                    placeholder="e.g. 0712345678"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="w-full rounded-xl bg-zinc-900 border border-white/10 pl-10 pr-4 py-2.5 text-sm text-white placeholder:text-gray-500 focus:border-orange-500 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-300 mb-1">Delivery Address (Optional)</label>
                <div className="relative flex items-center">
                  <MapPin size={16} className="absolute left-3.5 text-gray-400 pointer-events-none" />
                  <input
                    type="text"
                    placeholder="e.g. Apartment 4B, Riverside Drive"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    className="w-full rounded-xl bg-zinc-900 border border-white/10 pl-10 pr-4 py-2.5 text-sm text-white placeholder:text-gray-500 focus:border-orange-500 focus:outline-none"
                  />
                </div>
              </div>
            </>
          )}

          <div>
            <label className="block text-xs font-semibold text-gray-300 mb-1">Password</label>
            <div className="relative flex items-center">
              <Lock size={16} className="absolute left-3.5 text-gray-400 pointer-events-none" />
              <input
                type="password"
                required
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-xl bg-zinc-900 border border-white/10 pl-10 pr-4 py-2.5 text-sm text-white placeholder:text-gray-500 focus:border-orange-500 focus:outline-none"
              />
            </div>
          </div>



          <button
            type="submit"
            disabled={loading}
            className="mt-5 w-full flex items-center justify-center gap-2 rounded-xl bg-orange-500 py-3.5 text-sm font-bold text-white hover:bg-orange-600 transition shadow-xl shadow-orange-500/25 disabled:opacity-50"
          >
            {loading ? (
              <div className="flex items-center gap-2">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                <span>Authenticating...</span>
              </div>
            ) : authType === 'STAFF' ? (
              <>
                Enter Management Dashboard <ArrowRight size={16} />
              </>
            ) : mode === 'LOGIN' ? (
              <>
                Sign In to Account <ArrowRight size={16} />
              </>
            ) : (
              <>
                Join Diners Club <ArrowRight size={16} />
              </>
            )}
          </button>
        </form>

        {/* Footer Mode Switcher */}
        {authType === 'CUSTOMER' && (
          <div className="mt-6 text-center text-xs text-gray-400 border-t border-white/10 pt-4">
            {mode === 'LOGIN' ? (
              <p>
                New guest?{' '}
                <button
                  type="button"
                  onClick={() => {
                    setError('');
                    setMode('REGISTER');
                  }}
                  className="font-bold text-orange-400 hover:underline"
                >
                  Create guest account
                </button>
              </p>
            ) : (
              <p>
                Already have a guest account?{' '}
                <button
                  type="button"
                  onClick={() => {
                    setError('');
                    setMode('LOGIN');
                  }}
                  className="font-bold text-orange-400 hover:underline"
                >
                  Sign in here
                </button>
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
