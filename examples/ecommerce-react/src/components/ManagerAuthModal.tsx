import React, { useState } from 'react';
import { ShieldAlert, ShieldCheck, Lock, X, ArrowRight, KeyRound } from 'lucide-react';
import { useAuth, STORE_MANAGER_EMAIL } from '../context/AuthContext';
import { client } from '../lib/nodestack';

interface ManagerAuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export const ManagerAuthModal: React.FC<ManagerAuthModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
}) => {
  const { user, isAuthenticated, isStoreManager, login, isLoading } = useAuth();
  const [email, setEmail] = useState(STORE_MANAGER_EMAIL);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleManagerLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!password.trim()) {
      setError('Please enter your manager password.');
      return;
    }

    try {
      await login(email.trim(), password);
      
      const authedEmail = client.authStore.model?.email?.toLowerCase();
      if (authedEmail === STORE_MANAGER_EMAIL) {
        setPassword('');
        onSuccess();
        onClose();
      } else {
        setError(
          `Logged in as ${authedEmail}, but Store Manager access is restricted to ${STORE_MANAGER_EMAIL}.`
        );
      }
    } catch (err: any) {
      setError(err?.message || 'Invalid Store Manager credentials.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in">
      <div className="bg-white rounded-3xl shadow-2xl border border-slate-100 max-w-md w-full overflow-hidden p-6 sm:p-8 relative">
        
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-5 right-5 p-2 rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Header Icon */}
        <div className="w-14 h-14 rounded-2xl bg-amber-50 border border-amber-200/80 text-amber-600 flex items-center justify-center mb-5 mx-auto">
          <Lock className="w-7 h-7" />
        </div>

        <div className="text-center space-y-2 mb-6">
          <h3 className="text-xl font-black text-slate-900 tracking-tight">
            Store Manager Authentication
          </h3>
          <p className="text-xs text-slate-500 leading-relaxed max-w-sm mx-auto">
            Live inventory editing, product management, and flash sale controls are protected. Enter your server-provisioned manager credentials:
          </p>
          <div className="inline-block bg-slate-100 text-slate-800 font-mono text-xs font-semibold px-3 py-1 rounded-full border border-slate-200">
            {STORE_MANAGER_EMAIL}
          </div>
        </div>

        {/* Current status display */}
        <div className="bg-slate-50 border border-slate-200/80 rounded-2xl p-4 mb-5 text-xs space-y-2">
          <div className="flex items-center justify-between text-slate-500">
            <span>Current session:</span>
            <span className="font-semibold text-slate-700">
              {isAuthenticated && user ? user.email : 'Guest / Unauthenticated'}
            </span>
          </div>

          {isAuthenticated && user && !isStoreManager && (
            <div className="flex items-center gap-2 pt-1 border-t border-slate-200">
              <span className="text-[11px] text-amber-700 font-medium">
                ⚠️ Current account is a Customer. Please authenticate as the authorized Store Manager below.
              </span>
            </div>
          )}
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2 font-medium">
            <ShieldAlert className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Manager Credentials Form */}
        <form onSubmit={handleManagerLogin} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Manager Email
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3.5 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 outline-none transition-all font-mono"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Manager Password
            </label>
            <div className="relative">
              <KeyRound className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="password"
                required
                placeholder="Enter store manager secret..."
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full pl-10 pr-3.5 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 outline-none transition-all"
              />
            </div>
          </div>

          <div className="space-y-2 pt-2">
            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-3 px-4 rounded-xl font-bold text-xs text-white bg-gradient-to-r from-amber-600 to-amber-700 hover:from-amber-700 hover:to-amber-800 shadow-md shadow-amber-600/20 flex items-center justify-center gap-2 transition-all active:scale-[0.98] disabled:opacity-60"
            >
              {isLoading ? (
                <span className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
              ) : (
                <>
                  <ShieldCheck className="w-4 h-4" />
                  <span>Verify & Unlock Store Manager</span>
                  <ArrowRight className="w-4 h-4 ml-1" />
                </>
              )}
            </button>

            <button
              type="button"
              onClick={onClose}
              className="w-full py-2.5 px-4 rounded-xl font-semibold text-xs text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-colors"
            >
              Cancel (Stay as Shopper)
            </button>
          </div>
        </form>

        <p className="mt-5 text-[11px] text-center text-slate-400">
          Enforced by NodeStack SQLite rule: <code className="text-[10px] text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded">@request.auth.email = "{STORE_MANAGER_EMAIL}"</code>
        </p>

      </div>
    </div>
  );
};
