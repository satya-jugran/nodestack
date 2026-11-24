import React, { useState } from 'react';
import { ShieldAlert, ShieldCheck, Lock, X, ArrowRight, UserCheck } from 'lucide-react';
import { useAuth, STORE_MANAGER_EMAIL } from '../context/AuthContext';

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
  const { user, isAuthenticated, managerLogin, isLoading } = useAuth();
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleManagerLogin = async () => {
    setError(null);
    try {
      await managerLogin();
      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Failed to authenticate as Store Manager');
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
            Store Manager Access Restricted
          </h3>
          <p className="text-xs text-slate-500 leading-relaxed max-w-sm mx-auto">
            Live inventory editing, product management, and flash sale controls are protected and restricted to the designated manager account:
          </p>
          <div className="inline-block bg-slate-100 text-slate-800 font-mono text-xs font-semibold px-3 py-1 rounded-full border border-slate-200">
            {STORE_MANAGER_EMAIL}
          </div>
        </div>

        {/* Current status display */}
        <div className="bg-slate-50 border border-slate-200/80 rounded-2xl p-4 mb-6 text-xs space-y-2">
          <div className="flex items-center justify-between text-slate-500">
            <span>Your current session:</span>
            <span className="font-semibold text-slate-700">
              {isAuthenticated && user ? 'Authenticated' : 'Guest / Unsigned'}
            </span>
          </div>

          {isAuthenticated && user && (
            <div className="flex items-center gap-2 pt-1 border-t border-slate-200">
              <div className="w-6 h-6 rounded-full bg-slate-200 text-slate-700 flex items-center justify-center font-bold text-[10px]">
                {user.name ? user.name[0] : user.email[0]}
              </div>
              <div className="flex-1 truncate">
                <p className="font-bold text-slate-800 truncate">{user.name || 'Shopper'}</p>
                <p className="text-[11px] text-slate-400 truncate">{user.email}</p>
              </div>
              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800">
                Shopper Role
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

        {/* 1-Click Manager Sign-in CTA */}
        <div className="space-y-3">
          <button
            onClick={handleManagerLogin}
            disabled={isLoading}
            className="w-full py-3 px-4 rounded-xl font-bold text-xs text-white bg-gradient-to-r from-amber-600 to-amber-700 hover:from-amber-700 hover:to-amber-800 shadow-md shadow-amber-600/20 flex items-center justify-center gap-2 transition-all active:scale-[0.98] disabled:opacity-60"
          >
            {isLoading ? (
              <span className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
            ) : (
              <>
                <ShieldCheck className="w-4 h-4" />
                <span>1-Click Sign In as Store Manager</span>
                <ArrowRight className="w-4 h-4 ml-1" />
              </>
            )}
          </button>

          <button
            onClick={onClose}
            className="w-full py-2.5 px-4 rounded-xl font-semibold text-xs text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-colors"
          >
            Stay in Shopper View
          </button>
        </div>

        <p className="mt-5 text-[11px] text-center text-slate-400">
          Enforced by NodeStack SQLite rule: <code className="text-[10px] text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded">@request.auth.email = "{STORE_MANAGER_EMAIL}"</code>
        </p>

      </div>
    </div>
  );
};
