import { useTheme } from '../../../context/ThemeContext';
import { cn } from '../../../lib/utils';
import { Activity, ShieldCheck, Zap, Cpu, TrendingUp, RefreshCw } from 'lucide-react';

const OptimizationActions = ({ telemetry, isEnabled }) => {
  const { isDark } = useTheme();

  return (
    <div className="xl:col-span-1 space-y-8">
      <div
        className={cn(
          'rounded-[3rem] border p-8 shadow-2xl relative overflow-hidden group transition-all',
          isDark
            ? 'bg-slate-950/40 border-white/5 backdrop-blur-3xl'
            : 'bg-white border-black/5 shadow-sm'
        )}
      >
        <div className="absolute top-0 right-0 p-8 opacity-10">
          <TrendingUp size={64} className={cn('text-indigo-600')} />
        </div>
        <h3
          className={cn(
            'text-lg font-black uppercase mb-8 flex items-center gap-3 transition-colors',
            isDark ? 'text-white' : 'text-slate-900'
          )}
        >
          <ShieldCheck size={20} className="text-emerald-400" /> Metrics Tunnel
        </h3>
        <div className="space-y-6">
          {[
            {
              label: 'Jitter Buffer',
              val: `${telemetry.jitter}ms`,
              status: isEnabled ? 'Optimal' : 'Standard',
              icon: Activity,
            },
            {
              label: 'Bufferbloat',
              val: telemetry.bufferbloat || 'A+',
              status: isEnabled ? 'Ultra-Stable' : 'Unmanaged',
              icon: Zap,
            },
            { label: 'Tunneling MTU', val: `${telemetry.mtu}B`, status: 'Fixed', icon: Cpu },
          ].map((m, i) => (
            <div
              key={i}
              className={cn(
                'flex items-center justify-between p-4 rounded-2xl border transition-colors',
                isDark
                  ? 'bg-white/5 border-white/5 hover:border-white/10'
                  : 'bg-slate-50 border-black/5 hover:border-indigo-500/20'
              )}
            >
              <div className="flex items-center gap-3">
                <m.icon size={16} className="text-slate-500" />
                <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                  {m.label}
                </div>
              </div>
              <div className="text-right">
                <div
                  className={cn(
                    'text-xs font-mono font-black transition-colors',
                    isDark ? 'text-white' : 'text-slate-900'
                  )}
                >
                  {m.val}
                </div>
                <div
                  className={cn(
                    'text-[8px] font-black uppercase tracking-widest',
                    m.status === 'Optimal' ||
                      m.status === 'Ultra-Stable' ||
                      m.status === 'Fixed'
                      ? 'text-emerald-500'
                      : 'text-slate-500'
                  )}
                >
                  {m.status}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div
        className={cn(
          'border rounded-[3rem] p-10 shadow-2xl relative group overflow-hidden transition-all',
          isDark
            ? 'bg-gradient-to-br from-indigo-900/20 to-slate-900/60 border-white/10 backdrop-blur-3xl'
            : 'bg-white border-black/5 shadow-sm'
        )}
      >
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(99,102,241,0.1),transparent_70%)] opacity-0 group-hover:opacity-100 transition-opacity duration-1000" />
        <div className="p-4 rounded-[1.5rem] bg-indigo-600 shadow-2xl shadow-indigo-600/30 text-white w-fit mb-6">
          <RefreshCw size={24} className="hover:rotate-180 transition-transform duration-700" />
        </div>
        <h3
          className={cn(
            'text-2xl font-black tracking-widest italic uppercase mb-2 transition-colors',
            isDark ? 'text-white' : 'text-slate-900'
          )}
        >
          Sync Neural
        </h3>
        <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest leading-loose mb-8">
          Maintenance heuristique du noyau système active. Surveillance en temps réel des fuites
          mémoires.
        </p>
        <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
          <div
            className="h-full w-full bg-gradient-to-r from-emerald-500 via-indigo-500 to-emerald-500 animate-[loading_4s_linear_infinite]"
            style={{ backgroundSize: '200% 100%' }}
          />
        </div>
      </div>
    </div>
  );
};

export default OptimizationActions;
