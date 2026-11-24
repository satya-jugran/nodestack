import React, { useState } from 'react';
import {
  useAuth,
  STORE_MANAGER_EMAIL,
  STORE_MANAGER_PASSWORD,
  DEMO_CUSTOMER_EMAIL,
  DEMO_CUSTOMER_PASSWORD,
} from '../context/AuthContext';
import {
  X,
  Sparkles,
  LogIn,
  UserPlus,
  ShieldCheck,
  ShoppingBag,
  Shield,
  Copy,
  CheckCheck,
} from 'lucide-react';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
}

export const AuthModal: React.FC<AuthModalProps> = ({ isOpen, onClose, title, subtitle }) => {
  const { login, register, demoLogin, managerDemoLogin, isLoading } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    try {
      if (mode === 'login') {
        await login(email.trim(), password);
      } else {
        await register(email.trim(), password, name.trim());
      }
      onClose();
    } catch (err: any) {
      setErrorMsg(err.message || 'Authentication failed. Please check credentials.');
    }
  };

  const handleDemoSignIn = async () => {
    setErrorMsg('');
    try {
      await demoLogin();
      onClose();
    } catch (err: any) {
      setErrorMsg(err.message || 'Demo customer login failed.');
    }
  };

  const handleManagerDemoSignIn = async () => {
    setErrorMsg('');
    try {
      await managerDemoLogin();
      onClose();
    } catch (err: any) {
      setErrorMsg(err.message || 'Demo store manager login failed.');
    }
  };

  const handleFillCredentials = (fillEmail: string, fillPass: string) => {
    setMode('login');
    setEmail(fillEmail);
    setPassword(fillPass);
  };

  const handleCopyText = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="fixed inset-0" onClick={onClose} />

      <div className="relative bg-white rounded-3xl max-w-lg w-full max-h-[92vh] overflow-y-auto shadow-2xl z-10 border border-slate-100 p-6 sm:p-8">
        
        {/* Close */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 hover:text-slate-800 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        {title && (
          <div className="mb-4 pr-8">
            <h3 className="text-base font-extrabold text-slate-900">{title}</h3>
            {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
          </div>
        )}

        {/* 1-Click Demo Accounts Box */}
        <div className="mb-6 p-4 rounded-2xl bg-gradient-to-br from-amber-50 via-orange-50 to-amber-100/40 border border-amber-200/90 space-y-3 shadow-xs">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs font-bold text-amber-950 uppercase tracking-wide">
              <Sparkles className="w-4 h-4 text-amber-600" /> Instant Demo Access
            </div>
            <span className="text-[10px] font-semibold text-amber-800 bg-amber-100 px-2 py-0.5 rounded-full border border-amber-200">
              Pre-Configured
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {/* Customer Demo Account Card */}
            <div className="p-3 rounded-xl bg-white/90 border border-amber-200/80 shadow-2xs space-y-2 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-bold text-slate-900 flex items-center gap-1">
                    <ShoppingBag className="w-3.5 h-3.5 text-brand-600" /> Customer User
                  </span>
                  <button
                    type="button"
                    onClick={() => handleFillCredentials(DEMO_CUSTOMER_EMAIL, DEMO_CUSTOMER_PASSWORD)}
                    className="text-[10px] text-brand-600 hover:text-brand-800 font-bold hover:underline"
                  >
                    Fill
                  </button>
                </div>
                <div className="text-[11px] font-mono text-slate-600 space-y-0.5 bg-slate-50 p-1.5 rounded-lg border border-slate-200/70">
                  <div className="truncate select-all">{DEMO_CUSTOMER_EMAIL}</div>
                  <div className="text-[10px] text-slate-500 flex items-center justify-between">
                    <span>{DEMO_CUSTOMER_PASSWORD}</span>
                    <button
                      type="button"
                      onClick={() => handleCopyText(DEMO_CUSTOMER_PASSWORD, 'cust-pass')}
                      className="text-slate-400 hover:text-slate-700"
                      title="Copy customer password"
                    >
                      {copiedKey === 'cust-pass' ? (
                        <CheckCheck className="w-3 h-3 text-emerald-600" />
                      ) : (
                        <Copy className="w-3 h-3" />
                      )}
                    </button>
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={handleDemoSignIn}
                disabled={isLoading}
                className="w-full py-2 px-3 rounded-lg bg-amber-600 hover:bg-amber-700 active:scale-95 text-white font-bold text-xs flex items-center justify-center gap-1.5 transition-all shadow-xs shadow-amber-600/20 disabled:opacity-50"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>Sign In as Shopper</span>
              </button>
            </div>

            {/* Store Manager Demo Account Card */}
            <div className="p-3 rounded-xl bg-white/90 border border-amber-200/80 shadow-2xs space-y-2 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-bold text-slate-900 flex items-center gap-1">
                    <Shield className="w-3.5 h-3.5 text-amber-600" /> Store Manager
                  </span>
                  <button
                    type="button"
                    onClick={() => handleFillCredentials(STORE_MANAGER_EMAIL, STORE_MANAGER_PASSWORD)}
                    className="text-[10px] text-amber-700 hover:text-amber-900 font-bold hover:underline"
                  >
                    Fill
                  </button>
                </div>
                <div className="text-[11px] font-mono text-slate-600 space-y-0.5 bg-slate-50 p-1.5 rounded-lg border border-slate-200/70">
                  <div className="truncate select-all">{STORE_MANAGER_EMAIL}</div>
                  <div className="text-[10px] text-slate-500 flex items-center justify-between">
                    <span>{STORE_MANAGER_PASSWORD}</span>
                    <button
                      type="button"
                      onClick={() => handleCopyText(STORE_MANAGER_PASSWORD, 'mgr-pass')}
                      className="text-slate-400 hover:text-slate-700"
                      title="Copy manager password"
                    >
                      {copiedKey === 'mgr-pass' ? (
                        <CheckCheck className="w-3 h-3 text-emerald-600" />
                      ) : (
                        <Copy className="w-3 h-3" />
                      )}
                    </button>
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={handleManagerDemoSignIn}
                disabled={isLoading}
                className="w-full py-2 px-3 rounded-lg bg-slate-900 hover:bg-slate-800 active:scale-95 text-white font-bold text-xs flex items-center justify-center gap-1.5 transition-all shadow-xs disabled:opacity-50"
              >
                <ShieldCheck className="w-3.5 h-3.5 text-amber-400" />
                <span>Sign In as Manager</span>
              </button>
            </div>
          </div>
        </div>

        <div className="relative flex py-1 items-center mb-4">
          <div className="flex-grow border-t border-slate-200"></div>
          <span className="flex-shrink mx-4 text-xs uppercase font-bold text-slate-400">Or Manual Authentication</span>
          <div className="flex-grow border-t border-slate-200"></div>
        </div>

        {/* Mode Tabs */}
        <div className="flex bg-slate-100 p-1 rounded-xl mb-4">
          <button
            type="button"
            onClick={() => {
              setMode('login');
              setErrorMsg('');
            }}
            className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${
              mode === 'login'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            Sign In
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('register');
              setErrorMsg('');
            }}
            className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${
              mode === 'register'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            Create Account
          </button>
        </div>

        {errorMsg && (
          <div className="mb-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-medium">
            {errorMsg}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === 'register' && (
            <div>
              <label className="text-xs font-semibold text-slate-700 mb-1 block">Full Name</label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Alex Vance"
                className="w-full px-3.5 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-brand-500 outline-none"
              />
            </div>
          )}

          <div>
            <label className="text-xs font-semibold text-slate-700 mb-1 block">Email Address</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full px-3.5 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-brand-500 outline-none"
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-slate-700 mb-1 block">Password</label>
            <input
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full px-3.5 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-brand-500 outline-none"
            />
            <span className="text-[10px] text-slate-400 mt-1 block">
              At least 8 characters
            </span>
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full py-3 rounded-xl bg-slate-900 hover:bg-slate-800 active:scale-95 text-white font-bold text-sm flex items-center justify-center gap-2 transition-all shadow-md shadow-slate-900/10 disabled:opacity-50"
          >
            {mode === 'login' ? (
              <>
                <LogIn className="w-4 h-4" />
                <span>{isLoading ? 'Signing In...' : 'Sign In'}</span>
              </>
            ) : (
              <>
                <UserPlus className="w-4 h-4" />
                <span>{isLoading ? 'Creating Account...' : 'Register Account'}</span>
              </>
            )}
          </button>
        </form>

        <div className="mt-5 text-center text-[11px] text-slate-400 flex items-center justify-center gap-1">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
          <span>Secured with NodeStack Bcrypt & JWT Auth</span>
        </div>

      </div>
    </div>
  );
};
