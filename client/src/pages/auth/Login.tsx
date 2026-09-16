import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { authApi } from '../../services/api';
import {
  Lock,
  Mail,
  ShieldCheck,
  ArrowRight,
  UtensilsCrossed,
  AlertCircle,
  Home
} from 'lucide-react';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await authApi.login(email, password);
      if (response.data.success && response.data.data) {
        login(response.data.data.token, response.data.data.user);
        navigate('/dashboard');
      } else {
        setError(response.data.message || 'Invalid email or password.');
      }
    } catch (err: any) {
      setError(err.response?.data?.message || 'Login failed. Please verify your credentials.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0d0d11] text-gray-100 flex flex-col justify-between p-4 selection:bg-orange-500 selection:text-white relative overflow-hidden">
      {/* Background ambient lighting */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[700px] h-[400px] bg-gradient-to-b from-orange-500/15 via-amber-500/5 to-transparent blur-3xl pointer-events-none" />

      {/* Top Header */}
      <header className="mx-auto w-full max-w-6xl flex items-center justify-between py-4">
        <Link to="/" className="flex items-center gap-3 group">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-orange-500 text-white shadow-lg shadow-orange-500/25 group-hover:scale-105 transition">
            <UtensilsCrossed size={20} />
          </div>
          <div>
            <div className="font-serif font-extrabold text-lg text-white">Melio</div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-orange-400">Management System</div>
          </div>
        </Link>

        <Link
          to="/"
          className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3.5 py-2 text-xs font-semibold text-gray-300 hover:text-white hover:bg-white/10 transition"
        >
          <Home size={14} /> Back to Website
        </Link>
      </header>

      {/* Main Login Card */}
      <main className="mx-auto w-full max-w-md my-auto py-8">
        <div className="rounded-3xl border border-white/10 bg-gradient-to-b from-white/10 to-white/5 backdrop-blur-2xl p-6 sm:p-8 shadow-2xl">
          <div className="text-center mb-6">
            <div className="inline-flex items-center gap-1.5 rounded-full bg-orange-500/10 border border-orange-500/30 px-3 py-1 text-xs font-semibold text-orange-400 mb-3">
              <ShieldCheck size={14} /> Authorized Personnel
            </div>
            <h1 className="text-2xl font-serif font-bold text-white tracking-tight">Staff Sign In</h1>
            <p className="mt-1 text-xs text-gray-400">Access Point of Sale, Kitchen Display & Analytics</p>
          </div>

          {error && (
            <div className="mb-5 flex items-center gap-2 rounded-xl border border-red-500/40 bg-red-950/60 p-3.5 text-xs text-red-200">
              <AlertCircle size={16} className="shrink-0 text-red-400" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-gray-300 mb-1.5">Staff Email Address</label>
              <div className="relative flex items-center">
                <Mail size={16} className="absolute left-3.5 text-gray-400 pointer-events-none" />
                <input
                  id="email"
                  type="email"
                  required
                  placeholder="e.g. owner@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-xl bg-zinc-900/90 border border-white/10 pl-10 pr-3.5 py-3 text-sm text-white placeholder:text-gray-500 focus:border-orange-500 focus:outline-none transition"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-300 mb-1.5">Password</label>
              <div className="relative flex items-center">
                <Lock size={16} className="absolute left-3.5 text-gray-400 pointer-events-none" />
                <input
                  id="password"
                  type="password"
                  required
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-xl bg-zinc-900/90 border border-white/10 pl-10 pr-3.5 py-3 text-sm text-white placeholder:text-gray-500 focus:border-orange-500 focus:outline-none transition"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="mt-2 w-full flex items-center justify-center gap-2 rounded-xl bg-orange-500 py-3.5 text-xs font-bold uppercase tracking-wider text-white shadow-xl shadow-orange-500/25 hover:bg-orange-600 transition disabled:opacity-50"
            >
              {loading ? (
                <div className="flex items-center gap-2">
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  <span>Verifying Credentials...</span>
                </div>
              ) : (
                <>
                  Sign In to Dashboard <ArrowRight size={16} />
                </>
              )}
            </button>
          </form>


        </div>
      </main>

      {/* Footer */}
      <footer className="mx-auto w-full max-w-6xl py-4 text-center text-xs text-gray-500">
        © {new Date().getFullYear()} Melio Management System. All rights reserved.
      </footer>
    </div>
  );
}
