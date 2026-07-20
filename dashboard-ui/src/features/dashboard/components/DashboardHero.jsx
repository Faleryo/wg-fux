import React from 'react';
import {
  Server,
  Shield,
  Users,
  Activity,
  Wifi,
  ShieldCheck,
  ArrowDown,
  ArrowUp,
} from 'lucide-react';
import { useTheme } from '../../../context/ThemeContext';
import { useLang } from '../../../context/LanguageContext';
import { cn, COLOR_MAP } from '../../../lib/utils';
import { StatBlock } from './StatCards';
import GlassCard from '../../../components/ui/Card';
import InterfaceSelector from '../../../components/SRE/InterfaceSelector';

const DashboardHero = ({
  stats,
  config,
  health,
  activeInterface,
  setActiveInterface,
  isManager = true,
}) => {
  const { theme, isDark } = useTheme();
  const { t } = useLang();

  return (
    <GlassCard className="p-6 md:p-10 flex flex-col justify-between group min-h-[320px]">
      <div className="absolute -right-10 -bottom-10 pointer-events-none">
        <Server
          className={cn(
            'w-[200px] h-[200px] md:w-[300px] md:h-[300px] group-hover:scale-110 group-hover:rotate-6 transition-transform duration-1000 ease-in-out',
            isDark ? 'text-white/[0.015]' : 'text-black/[0.015]'
          )}
        />
      </div>

      <div className="space-y-6 md:space-y-10">
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <Shield
                className="fill-current opacity-80"
                size={28}
                style={{ color: COLOR_MAP[theme]?.[500] || '#6366f1' }}
              />
              <h2
                className={cn(
                  'text-2xl sm:text-3xl lg:text-4xl 2xl:text-5xl font-black tracking-widest italic transition-colors shrink-0',
                  isDark ? 'text-white' : 'text-slate-900'
                )}
              >
                {t('dash_active_protocol')}
              </h2>
            </div>
            <p className="text-slate-500 font-mono text-[11px] tracking-[0.3em] uppercase opacity-60">
              System Security Integrated: 100% Integrity
            </p>
          </div>
          <div className="flex items-center gap-4 flex-wrap">
            {/* InterfaceSelector appelle /system/interfaces (manager+) */}
            {isManager && (
              <InterfaceSelector onSelect={setActiveInterface} current={activeInterface} />
            )}
            <div
              className={cn(
                'px-4 py-2 rounded-full text-[11px] font-black tracking-[0.2em] border whitespace-nowrap transition-all duration-500',
                health.status === 'healthy' && health.ready
                  ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400 animate-pulse'
                  : health.status === 'healthy'
                    ? 'bg-blue-500/10 border-blue-500/20 text-blue-400'
                    : 'bg-amber-500/10 border-amber-500/20 text-amber-400'
              )}
            >
              {health.status === 'healthy' && health.ready
                ? 'OPERATIONAL'
                : health.status === 'healthy'
                  ? 'READY'
                  : 'CHECKING'}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-8">
          <StatBlock
            label={t('dash_active_peers')}
            value={stats.connectedClients ?? 0}
            sub={t('dash_connected')}
            icon={Users}
            delay={0}
          />
          <StatBlock label="MTU Tunnel" value={config?.mtu || '1420'} icon={Activity} delay={0.1} />
          <StatBlock
            label={t('dash_port_link')}
            value={config?.port || '51820'}
            icon={Wifi}
            delay={0.2}
          />
          <StatBlock
            label="Health Shield"
            value={health.status === 'healthy' ? 'Optimal' : 'Checking'}
            sub={health.status === 'healthy' ? 'STABLE' : 'PENDING'}
            icon={ShieldCheck}
            delay={0.3}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div
            className={cn(
              'backdrop-blur-xl p-5 md:p-8 rounded-[1.5rem] flex items-center justify-between group/rx transition-all duration-500',
              isDark
                ? 'bg-slate-950/40 border-white/5 hover:border-emerald-500/20'
                : 'bg-white/80 border-black/5 hover:border-emerald-500/30 shadow-sm'
            )}
          >
            <div>
              <p className="text-[11px] font-black text-emerald-500/70 uppercase tracking-widest mb-1">
                Total Download (RX)
              </p>
              <p
                className={cn(
                  'text-2xl md:text-4xl font-mono font-black tracking-tighter transition-colors',
                  isDark ? 'text-white' : 'text-slate-900'
                )}
              >
                {stats?.totalDownload || '0 B'}
              </p>
            </div>
            <div className="p-3 md:p-4 rounded-2xl bg-emerald-500/10 text-emerald-500 group-hover/rx:scale-110 group-hover/rx:rotate-12 transition-transform shadow-2xl">
              <ArrowDown size={24} />
            </div>
          </div>
          <div
            className={cn(
              'backdrop-blur-xl p-5 md:p-8 rounded-[1.5rem] flex items-center justify-between group/tx transition-all duration-500',
              isDark
                ? 'bg-slate-950/40 border-white/5 hover:border-indigo-500/20'
                : 'bg-white/80 border-black/5 hover:border-indigo-500/30 shadow-sm'
            )}
          >
            <div>
              <p className="text-[11px] font-black text-indigo-500/70 uppercase tracking-widest mb-1">
                Total Upload (TX)
              </p>
              <p
                className={cn(
                  'text-2xl md:text-4xl font-mono font-black tracking-tighter transition-colors',
                  isDark ? 'text-white' : 'text-slate-900'
                )}
              >
                {stats?.totalUpload || '0 B'}
              </p>
            </div>
            <div className="p-3 md:p-4 rounded-2xl bg-indigo-500/10 text-indigo-500 group-hover/tx:scale-110 group-hover/tx:rotate-12 transition-transform shadow-2xl">
              <ArrowUp size={24} />
            </div>
          </div>
        </div>
      </div>
    </GlassCard>
  );
};

export default DashboardHero;
