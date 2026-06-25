import { useTheme } from '../../../context/ThemeContext';
import { cn } from '../../../lib/utils';
import { Zap } from 'lucide-react';

const OptimizationSummary = ({ isEnabled, handleToggleSync }) => {
  const { isDark } = useTheme();

  return (
    <div
      className={cn(
        'flex flex-col lg:flex-row justify-between items-center p-8 rounded-[3rem] border shadow-2xl gap-8 transition-all',
        isDark ? 'bg-slate-900/40 border-white/5 backdrop-blur-3xl' : 'bg-white border-black/5'
      )}
    >
      <div className="flex items-center gap-6">
        <div
          className={cn(
            'p-5 rounded-[2rem] border shadow-2xl transition-all',
            isDark
              ? 'bg-indigo-600/20 text-indigo-400 border-indigo-500/20'
              : 'bg-indigo-50 text-indigo-600 border-indigo-100'
          )}
        >
          <Zap size={36} className={cn(isEnabled && 'animate-pulse')} />
        </div>
        <div>
          <h2
            className={cn(
              'text-4xl font-black tracking-tighter italic uppercase transition-colors',
              isDark ? 'text-white' : 'text-slate-900'
            )}
          >
            Neural Optimizer
          </h2>
          <p className="text-slate-500 text-[10px] font-black tracking-[0.4em] uppercase opacity-60">
            Advanced Flow Shaping & Latency Control
          </p>
        </div>
      </div>
      <div className="flex items-center gap-4">
        <label
          className={cn(
            'flex items-center gap-4 p-4 rounded-2xl border cursor-pointer group transition-all',
            isDark
              ? 'bg-slate-950/60 border-white/5 backdrop-blur-3xl'
              : 'bg-slate-50 border-black/5 shadow-sm'
          )}
        >
          <span
            className={cn(
              'text-[10px] font-black uppercase tracking-widest transition-colors',
              isDark
                ? 'text-slate-500 group-hover:text-white'
                : 'text-slate-400 group-hover:text-slate-900'
            )}
          >
            Système Optimisé
          </span>
          <div
            onClick={handleToggleSync}
            className={cn(
              'w-12 h-6 rounded-full transition-all relative border shadow-inner',
              isEnabled
                ? 'bg-emerald-600 border-emerald-500/20'
                : isDark
                  ? 'bg-slate-900 border-white/10'
                  : 'bg-slate-100 border-slate-200'
            )}
          >
            <div
              className={cn(
                'absolute top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-white shadow-2xl transition-all',
                isEnabled ? 'left-[calc(100%-1.25rem)]' : 'left-1'
              )}
            />
          </div>
        </label>
      </div>
    </div>
  );
};

export default OptimizationSummary;
