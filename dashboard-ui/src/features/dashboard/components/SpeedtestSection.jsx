import React from 'react';
import { Gauge, RefreshCw, ArrowDown, ArrowUp } from 'lucide-react';
import { useTheme } from '../../../context/ThemeContext';
import { cn, COLOR_MAP } from '../../../lib/utils';
import GlassCard from '../../../components/ui/Card';
import VibeButton from '../../../components/ui/Button';

const formatSpeed = (val) => {
  if (val >= 1000) return (val / 1000).toFixed(2);
  return val.toFixed(1);
};
const speedUnit = (val) => (val >= 1000 ? 'Gbps' : 'Mbps');

const SpeedtestSection = ({ speedtest, onRunSpeedtest }) => {
  const { theme, isDark } = useTheme();

  return (
    <GlassCard className="p-6 group flex-1" hover={true}>
      <div
        className={cn(
          'absolute top-0 right-0 p-6 opacity-[0.02] pointer-events-none',
          isDark ? 'text-white' : 'text-black'
        )}
      >
        <Gauge size={80} />
      </div>
      <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-[0.25em] mb-5">
        System Speedtest
      </h3>

      {speedtest?.loading ? (
        <div className="flex flex-col items-center justify-center py-4 gap-3">
          <RefreshCw
            size={36}
            className="animate-spin"
            style={{ color: COLOR_MAP[theme]?.[600] || '#4f46e5' }}
          />
          <p
            className={cn(
              'text-[10px] font-black animate-pulse uppercase tracking-[0.3em] transition-colors',
              isDark ? 'text-white' : 'text-slate-900'
            )}
          >
            Test en cours...
          </p>
        </div>
      ) : speedtest?.data ? (
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-emerald-400">
              <ArrowDown size={13} /> <span className="text-[9px] font-black uppercase">Down</span>
            </div>
            <div
              className={cn(
                'text-2xl md:text-3xl font-mono font-black transition-colors',
                isDark ? 'text-white' : 'text-slate-900'
              )}
            >
              {formatSpeed(speedtest.data?.download || 0)}
            </div>
            <div className="text-[9px] text-slate-500 font-bold uppercase">
              {speedUnit(speedtest.data?.download || 0)}
            </div>
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-indigo-400">
              <ArrowUp size={13} /> <span className="text-[9px] font-black uppercase">Up</span>
            </div>
            <div
              className={cn(
                'text-2xl md:text-3xl font-mono font-black transition-colors',
                isDark ? 'text-white' : 'text-slate-900'
              )}
            >
              {formatSpeed(speedtest.data?.upload || 0)}
            </div>
            <div className="text-[9px] text-slate-500 font-bold uppercase">
              {speedUnit(speedtest.data?.upload || 0)}
            </div>
          </div>
          <div className="col-span-2 pt-3 border-t border-white/5 flex justify-between items-center">
            <span className="text-[10px] font-mono text-slate-500 uppercase">
              Ping: {speedtest.data?.ping ? `${speedtest.data.ping.toFixed(0)}ms` : 'N/A'}
            </span>
            <VibeButton
              variant="ghost"
              size="sm"
              onClick={onRunSpeedtest}
              className="text-indigo-400 text-[10px]"
            >
              Relancer
            </VibeButton>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-4 gap-4">
          <div
            className={cn(
              'text-3xl font-black italic transition-colors',
              isDark ? 'text-white/10' : 'text-black/5'
            )}
          >
            --Mbps
          </div>
          <VibeButton variant="primary" onClick={onRunSpeedtest} className="w-full">
            Lancer Test de Flux
          </VibeButton>
        </div>
      )}
    </GlassCard>
  );
};

export default SpeedtestSection;
