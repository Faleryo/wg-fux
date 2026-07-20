import React, { useMemo } from 'react';
import { Shield, ShieldCheck, Activity, Cpu, Zap, HardDrive, Users, Timer } from 'lucide-react';
import { useTheme } from '../../../context/ThemeContext';
import { useLang } from '../../../context/LanguageContext';
import { cn, formatBytes, COLOR_MAP } from '../../../lib/utils';
import { CircularProgress } from './StatCards';
import GlassCard from '../../../components/ui/Card';

// Agrégats métier (helper module : Date.now interdit dans le rendu React).
const computeClientStats = (clients) => {
  const now = Date.now();
  const list = Array.isArray(clients) ? clients : [];
  const online = list.filter((c) => c.isOnline).length;
  const expSoon = list.filter((c) => {
    if (!c.expiry) return false;
    const d = (new Date(c.expiry).getTime() - now) / 86400000;
    return d > 0 && d <= 7;
  }).length;
  const expired = list.filter((c) => c.expiry && new Date(c.expiry).getTime() <= now).length;
  return { total: list.length, online, expSoon, expired };
};

const StatusPanel = ({
  sentinel,
  adguardStatus,
  systemStats,
  clients,
  isManager = true,
  // Instance licenciée : l'admin EST le revendeur — sa page d'accueil parle
  // business (abonnés/échéances) avec les jauges système en compact. La vue
  // sysadmin complète (Sentinel/AdGuard en grand) reste pour la plateforme mère.
  businessMode = false,
}) => {
  const { theme, isDark } = useTheme();
  const { t } = useLang();
  const cpu = systemStats?.cpu || 0;
  const ram = systemStats?.memory || 0;
  const disk = systemStats?.disk || 0;

  // Vue NON-manager (revendeur/vendeur) : les widgets système (Sentinel,
  // AdGuard, CPU/RAM/DISK) n'ont aucun sens pour lui — ses endpoints sont
  // interdits (403) et affichaient des états rouges/0 % trompeurs. On lui
  // montre SON activité : abonnés, en ligne, échéances.
  const clientStats = useMemo(() => computeClientStats(clients), [clients]);

  const { topClient, topClientRate } = useMemo(() => {
    if (!clients || !Array.isArray(clients) || clients.length === 0) {
      return { topClient: { name: t('none'), downloadRate: 0, uploadRate: 0 }, topClientRate: 0 };
    }
    const top = clients.reduce(
      (prev, current) => {
        const prevRate = (prev.downloadRate || 0) + (prev.uploadRate || 0);
        const currRate = (current.downloadRate || 0) + (current.uploadRate || 0);
        return currRate > prevRate ? current : prev;
      },
      { name: t('none'), downloadRate: 0, uploadRate: 0 }
    );
    const rate = (top.downloadRate || 0) + (top.uploadRate || 0);
    return { topClient: top, topClientRate: rate };
  }, [clients]);

  // Panneau métier du revendeur/vendeur : ses abonnés, pas la machine.
  if (!isManager || businessMode) {
    const bizCards = [
      { icon: Users, label: t('subscribers'), value: clientStats.total, color: 'text-sky-400' },
      {
        icon: Activity,
        label: t('status_online'),
        value: clientStats.online,
        color: 'text-emerald-400',
      },
      {
        icon: Timer,
        label: t('expire_soon_days'),
        value: clientStats.expSoon,
        color: clientStats.expSoon > 0 ? 'text-amber-400' : 'text-slate-400',
      },
      {
        icon: Shield,
        label: t('expired_count'),
        value: clientStats.expired,
        color: clientStats.expired > 0 ? 'text-red-400' : 'text-slate-400',
      },
    ];
    return (
      <div className="flex flex-col gap-6">
        <div className="grid grid-cols-2 gap-4">
          {bizCards.map((c) => (
            <GlassCard key={c.label} className="p-5" hover={false}>
              <div className="flex items-center gap-2 mb-2 text-slate-500">
                <c.icon size={14} />
                <span className="text-[11px] font-black uppercase tracking-widest">{c.label}</span>
              </div>
              <div className={cn('text-3xl font-black font-mono', c.color)}>{c.value}</div>
            </GlassCard>
          ))}
        </div>

        {/* L'admin de l'instance garde un œil sur SA machine (jauges compactes) —
            un vendeur (non-manager) n'a pas accès à ces métriques. */}
        {isManager && (
          <GlassCard className="p-5 md:p-6" hover={false}>
            <div className="flex justify-around items-center py-1">
              <CircularProgress label="CPU" value={cpu} color="text-indigo-500" icon={Cpu} />
              <CircularProgress label="RAM" value={ram} color="text-purple-500" icon={Zap} />
              <CircularProgress
                label="DISK"
                value={disk}
                color="text-emerald-500"
                icon={HardDrive}
              />
            </div>
          </GlassCard>
        )}

        <GlassCard
          className={cn(
            'p-5 md:p-6 flex items-center gap-4 group transition-all',
            isDark
              ? 'bg-gradient-to-br from-slate-900/60 to-indigo-900/20'
              : 'bg-white/80 border-indigo-500/5 shadow-sm'
          )}
        >
          <div
            className={cn(
              'p-3 rounded-2xl bg-white/5 shadow-2xl flex-shrink-0',
              topClientRate > 0 ? '' : 'text-slate-600'
            )}
            style={topClientRate > 0 ? { color: COLOR_MAP[theme]?.[400] || '#818cf8' } : undefined}
          >
            <Activity
              size={22}
              className={topClientRate > 0 ? 'animate-[pulse_1s_infinite]' : ''}
            />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-black text-slate-500 uppercase tracking-widest mb-1">
              {t('most_active_client')}
            </p>
            <h4
              className={cn(
                'text-base md:text-lg font-black truncate italic tracking-tight',
                isDark ? 'text-white' : 'text-slate-900'
              )}
            >
              {topClient.name || t('none')}
            </h4>
            <p
              className="text-xs font-mono font-bold mt-0.5"
              style={{ color: COLOR_MAP[theme]?.[400] || '#818cf8' }}
            >
              {formatBytes(topClientRate)}/s
            </p>
          </div>
        </GlassCard>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-6">
        <GlassCard
          className={cn(
            'p-6 flex items-center justify-between group transition-all',
            isDark
              ? 'bg-gradient-to-br from-emerald-500/10 to-teal-950/20 border-emerald-500/20'
              : 'bg-white/80 border-emerald-500/10 shadow-sm'
          )}
        >
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-2">
              <div
                className={cn(
                  'h-1.5 w-1.5 rounded-full animate-pulse flex-shrink-0',
                  sentinel?.status === 'healthy'
                    ? 'bg-emerald-500 shadow-[0_0_10px_#10b981]'
                    : 'bg-red-500'
                )}
              />
              <p className="text-[11px] font-black text-emerald-500/80 uppercase tracking-widest truncate">
                Sentinel Watchdog V2
              </p>
            </div>
            <h4
              className={cn(
                'text-lg md:text-xl font-black italic tracking-tight transition-colors',
                isDark ? 'text-white' : 'text-slate-900'
              )}
            >
              {sentinel?.status === 'healthy'
                ? 'Secured'
                : sentinel?.status === 'error'
                  ? 'Offline'
                  : 'Searching'}
            </h4>
            <p className="text-[11px] font-mono font-bold text-slate-500 mt-1 uppercase tracking-tight truncate">
              Pulse:{' '}
              {sentinel?.lastHeartbeat
                ? new Date(sentinel.lastHeartbeat).toLocaleTimeString()
                : 'Await Heartbeat'}
            </p>
          </div>
          <div className="p-3 md:p-4 rounded-2xl bg-emerald-500/10 text-emerald-500 shadow-2xl group-hover:scale-110 transition-transform flex-shrink-0 ml-4">
            <ShieldCheck size={24} />
          </div>
        </GlassCard>

        <GlassCard
          className={cn(
            'p-6 flex items-center justify-between group transition-all',
            isDark
              ? 'bg-gradient-to-br from-blue-500/10 to-indigo-950/20 border-blue-500/20'
              : 'bg-white/80 border-blue-500/10 shadow-sm'
          )}
        >
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-2">
              <div
                className={cn(
                  'h-1.5 w-1.5 rounded-full animate-pulse flex-shrink-0',
                  adguardStatus?.status === 'active'
                    ? 'bg-blue-500 shadow-[0_0_10px_#3b82f6]'
                    : 'bg-red-500'
                )}
              />
              <p className="text-[11px] font-black text-blue-500/80 uppercase tracking-widest truncate">
                DNS Safe Filter
              </p>
            </div>
            <h4
              className={cn(
                'text-lg md:text-xl font-black italic tracking-tight transition-colors',
                isDark ? 'text-white' : 'text-slate-900'
              )}
            >
              {adguardStatus?.status === 'active' ? 'Filtered' : 'Disabled'}
            </h4>
            <p className="text-[11px] font-mono font-bold text-slate-500 mt-1 uppercase tracking-tight truncate">
              Engine: AdGuard Home
            </p>
          </div>
          <div className="p-3 md:p-4 rounded-2xl bg-blue-500/10 text-blue-500 shadow-2xl group-hover:scale-110 transition-transform flex-shrink-0 ml-4">
            <Shield size={24} />
          </div>
        </GlassCard>
      </div>

      <GlassCard
        className="flex-1 p-6 md:p-8 flex flex-col justify-center gap-6 group"
        hover={true}
      >
        <div
          className={cn(
            'absolute top-0 left-0 p-8 opacity-[0.02] pointer-events-none',
            isDark ? 'text-white' : 'text-black'
          )}
        >
          <Activity size={100} />
        </div>
        <h3
          className={cn(
            'text-lg font-black flex items-center gap-3 italic tracking-tighter transition-colors',
            isDark ? 'text-white' : 'text-slate-900'
          )}
        >
          <Cpu style={{ color: COLOR_MAP[theme]?.[400] || '#818cf8' }} size={18} /> Core Resources
        </h3>
        <div className="flex justify-around items-center py-2">
          <CircularProgress label="CPU" value={cpu} color="text-indigo-500" icon={Cpu} />
          <CircularProgress label="RAM" value={ram} color="text-purple-500" icon={Zap} />
          <CircularProgress label="DISK" value={disk} color="text-emerald-500" icon={HardDrive} />
        </div>
      </GlassCard>

      <GlassCard
        className={cn(
          'p-5 md:p-6 flex items-center gap-4 group transition-all',
          isDark
            ? 'bg-gradient-to-br from-slate-900/60 to-indigo-900/20'
            : 'bg-white/80 border-indigo-500/5 shadow-sm'
        )}
      >
        <div
          className={cn(
            'p-3 rounded-2xl bg-white/5 shadow-2xl transition-all duration-500 group-hover:scale-110 group-hover:rotate-3 flex-shrink-0',
            topClientRate > 0 ? '' : 'text-slate-600'
          )}
          style={topClientRate > 0 ? { color: COLOR_MAP[theme]?.[400] || '#818cf8' } : undefined}
        >
          <Activity size={22} className={topClientRate > 0 ? 'animate-[pulse_1s_infinite]' : ''} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-black text-slate-500 uppercase tracking-widest mb-1">
            Top Active Client
          </p>
          <h4
            className={cn(
              'text-base md:text-lg font-black truncate italic tracking-tight transition-colors',
              isDark ? 'text-white' : 'text-slate-900'
            )}
          >
            {topClient.name || t('inactive_station')}
          </h4>
          <p
            className="text-xs font-mono font-bold mt-0.5"
            style={{ color: COLOR_MAP[theme]?.[400] || '#818cf8' }}
          >
            {formatBytes(topClientRate)}/s Burst
          </p>
        </div>
      </GlassCard>
    </div>
  );
};

export default StatusPanel;
