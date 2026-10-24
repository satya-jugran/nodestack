import React from 'react';
import { Sparkles, Database, Zap, ShieldCheck, ArrowRight } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

interface HeroBannerProps {
  onExplore: () => void;
}

export const HeroBanner: React.FC<HeroBannerProps> = ({ onExplore }) => {
  const { isAuthenticated, demoLogin } = useAuth();

  return (
    <div className="relative overflow-hidden bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 text-white rounded-3xl my-6 mx-4 sm:mx-6 lg:mx-8 shadow-2xl border border-slate-800">
      {/* Background ambient lighting */}
      <div className="absolute top-0 right-0 -mr-20 -mt-20 w-96 h-96 bg-brand-500/20 rounded-full blur-3xl pointer-events-none"></div>
      <div className="absolute bottom-0 left-1/3 -mb-20 w-80 h-80 bg-indigo-500/20 rounded-full blur-3xl pointer-events-none"></div>

      <div className="relative max-w-7xl mx-auto px-6 py-12 sm:px-12 sm:py-16 lg:py-20 flex flex-col md:flex-row items-center justify-between gap-8">
        
        <div className="max-w-2xl space-y-6">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/10 backdrop-blur-md border border-white/10 text-xs font-semibold text-brand-300">
            <Sparkles className="w-3.5 h-3.5 text-brand-400" />
            <span>Full-Stack Demo Powered by NodeStack Backend</span>
          </div>

          <h1 className="text-3xl sm:text-5xl font-black tracking-tight leading-tight">
            Curated Gear & Hardware <br />
            <span className="bg-gradient-to-r from-brand-400 via-indigo-300 to-sky-300 bg-clip-text text-transparent">
              Engineered to Perfection.
            </span>
          </h1>

          <p className="text-base sm:text-lg text-slate-300 leading-relaxed">
            Experience an instant, full-featured retail storefront connected directly to 
            <span className="text-white font-semibold"> NodeStack</span>. Explore products, real-time cart, checkout orders, and submit customer reviews.
          </p>

          <div className="flex flex-wrap items-center gap-3 pt-2">
            <button
              onClick={onExplore}
              className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-brand-500 hover:bg-brand-600 active:scale-95 text-white font-bold text-sm transition-all shadow-lg shadow-brand-500/25"
            >
              Browse Catalog <ArrowRight className="w-4 h-4" />
            </button>

            {!isAuthenticated && (
              <button
                onClick={demoLogin}
                className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-white/10 hover:bg-white/15 active:scale-95 text-white font-semibold text-sm backdrop-blur-sm border border-white/15 transition-all"
              >
                Sign In as Demo User
              </button>
            )}
          </div>
        </div>

        {/* Feature stats cards */}
        <div className="grid grid-cols-2 gap-3 sm:gap-4 w-full md:w-auto">
          <div className="p-4 rounded-2xl bg-white/5 border border-white/10 backdrop-blur-md">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center mb-2">
              <Database className="w-4 h-4" />
            </div>
            <div className="text-xl font-extrabold text-white">node:sqlite</div>
            <div className="text-xs text-slate-400">Zero-Config Embedded DB</div>
          </div>

          <div className="p-4 rounded-2xl bg-white/5 border border-white/10 backdrop-blur-md">
            <div className="w-8 h-8 rounded-lg bg-amber-500/20 text-amber-400 flex items-center justify-center mb-2">
              <Zap className="w-4 h-4" />
            </div>
            <div className="text-xl font-extrabold text-white">Instant CRUD</div>
            <div className="text-xs text-slate-400">Fastify REST + Realtime SSE</div>
          </div>

          <div className="p-4 rounded-2xl bg-white/5 border border-white/10 backdrop-blur-md">
            <div className="w-8 h-8 rounded-lg bg-sky-500/20 text-sky-400 flex items-center justify-center mb-2">
              <Sparkles className="w-4 h-4" />
            </div>
            <div className="text-xl font-extrabold text-white">20 Products</div>
            <div className="text-xs text-slate-400">Relational Starter Template</div>
          </div>

          <div className="p-4 rounded-2xl bg-white/5 border border-white/10 backdrop-blur-md">
            <div className="w-8 h-8 rounded-lg bg-indigo-500/20 text-indigo-400 flex items-center justify-center mb-2">
              <ShieldCheck className="w-4 h-4" />
            </div>
            <div className="text-xl font-extrabold text-white">Full Auth</div>
            <div className="text-xs text-slate-400">JWT & Row Access Rules</div>
          </div>
        </div>

      </div>
    </div>
  );
};
