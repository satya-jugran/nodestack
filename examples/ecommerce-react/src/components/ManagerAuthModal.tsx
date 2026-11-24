import React, { useState } from 'react';
import {
  ShieldAlert,
  ShieldCheck,
  Lock,
  X,
  ArrowRight,
  KeyRound,
  Copy,
  CheckCheck,
  Sparkles,
} from 'lucide-react';
import { useAuth, STORE_MANAGER_EMAIL, STORE_MANAGER_PASSWORD } from '../context/AuthContext';
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
  const { user, isAuthenticated, isStoreManager, login, managerDemoLogin, isLoading } = useAuth();
  const [email, setEmail] = useState(STORE_MANAGER_EMAIL);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [hasCopiedPass, setHasCopiedPass] = useState(false);

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

  const handleInstantDemoLogin = async () => {
    setError(null);
    try {
      await managerDemoLogin();
      setPassword('');
      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Failed to authenticate as demo store manager.');
    }
  };

  const handleCopyPassword = () => {
    navigator.clipboard.writeText(STORE_MANAGER_PASSWORD);
    setHasCopiedPass(true);
    setTimeout(() => setHasCopiedPass(false), 2000);
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

        <div className="text-center space-y-2 mb-5">
          <h3 className="text-xl font-black text-slate-900 tracking-tight">
            Store Manager Authentication
          </h3>
          <p className="text-xs text-slate-500 leading-relaxed max-w-sm mx-auto">
            Live catalog editing, inventory restocking, and pricing controls are restricted to the authorized manager account:
          </p>
        </div>

        {/* 1-Click Demo Manager Access Box */}
        <div className="mb-5 p-4 rounded-2xl bg-gradient-to-br from-amber-50 via-orange-50 to-amber-100/50 border border-amber-200/90 space-y-3 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-xs font-bold text-amber-950 uppercase tracking-wide">
              <Sparkles className="w-4 h-4 text-amber-600" /> Default Demo Credentials
            </span>
            <span className="text-[10px] font-semibold text-amber-800 bg-amber-100/80 px-2 py-0.5 rounded-full border border-amber-200">
              Pre-Seeded
            </span>
          </div>

          <div className="space-y-1.5 text-xs font-mono bg-white/80 p-2.5 rounded-xl border border-amber-200/70">
            <div className="flex items-center justify-between text-slate-700">
              <span className="text-[11px] text-slate-500 font-sans">User:</span>
              <span className="font-bold text-slate-900 select-all">{STORE_MANAGER_EMAIL}</span>
            </div>
            <div className="flex items-center justify-between text-slate-700 pt-1 border-t border-amber-100">
              <span className="text-[11px] text-slate-500 font-sans">Pass:</span>
              <div className="flex items-center gap-2">
                <span className="font-bold text-slate-900 select-all">{STORE_MANAGER_PASSWORD}</span>
                <button
                  type="button"
                  onClick={handleCopyPassword}
                  className="p-1 hover:bg-slate-100 rounded text-slate-400 hover:text-slate-700 transition-colors"
                  title="Copy password"
                >
                  {hasCopiedPass ? (
                    <CheckCheck className="w-3.5 h-3.5 text-emerald-600" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={handleInstantDemoLogin}
            disabled={isLoading}
            className="w-full py-2.5 px-4 rounded-xl bg-amber-600 hover:bg-amber-700 active:scale-95 text-white font-bold text-xs flex items-center justify-center gap-2 transition-all shadow-sm shadow-amber-600/20 disabled:opacity-50"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>1-Click Sign In as Store Manager</span>
          </button>
        </div>

        {/* Current status display */}
        <div className="bg-slate-50 border border-slate-200/80 rounded-2xl p-3 mb-4 text-xs space-y-1.5">
          <div className="flex items-center justify-between text-slate-500">
            <span>Current session:</span>
            <span className="font-semibold text-slate-700">
              {isAuthenticated && user ? user.email : 'Guest / Unauthenticated'}
            </span>
          </div>

          {isAuthenticated && user && !isStoreManager && (
            <div className="flex items-center gap-1.5 pt-1 border-t border-slate-200 text-[11px] text-amber-800">
              <span>⚠️ Signed in as Customer. Use credentials above to unlock Manager mode.</span>
            </div>
          )}
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2 font-medium">
            <ShieldAlert className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Manager Credentials Manual Form */}
        <form onSubmit={handleManagerLogin} className="space-y-3.5">
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
            <div className="flex items-center justify-between mb-1">
              <label className="block text-xs font-bold text-slate-700">
                Manager Password
              </label>
              <button
                type="button"
                onClick={() => setPassword(STORE_MANAGER_PASSWORD)}
                className="text-[10px] text-amber-700 hover:text-amber-900 font-bold hover:underline"
              >
                Auto-fill Demo Password
              </button>
            </div>
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

          <div className="space-y-2 pt-1">
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
              className="w-full py-2 px-4 rounded-xl font-semibold text-xs text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-colors"
            >
              Cancel (Stay as Shopper)
            </button>
          </div>
        </form>

        <p className="mt-4 text-[11px] text-center text-slate-400">
          Enforced by NodeStack SQLite rule: <code className="text-[10px] text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded">@request.auth.email = "{STORE_MANAGER_EMAIL}"</code>
        </p>
      </div>
    </div>
  );
};
