import React, { useState } from 'react';
import { Cpu, RefreshCw, Sun, Moon, Ghost } from 'lucide-react';
import { cn, COLOR_MAP } from '../../lib/utils';
import { axiosInstance } from '../../lib/api';
import { useToast } from '../../context/ToastContext';

const StatusWidget = ({
  collapsed,
  isDark,
  theme,
  mode,
  setMode,
  setTheme,
  lang,
  setLang,
  uptime,
  t,
}) => {
  const { addToast } = useToast();
  const [confirmRestart, setConfirmRestart] = useState(false);
  const [restarting, setRestarting] = useState(false);

  const handleRestartServer = async () => {
    setRestarting(true);
    try {
      await axiosInstance.post('/system/restart/wireguard');
      addToast('Service WireGuard redémarré.', 'success');
    } catch {
      addToast('Erreur lors du redémarrage.', 'error');
    } finally {
      setRestarting(false);
      setConfirmRestart(false);
    }
  };

  const themes = [
    { id: 'indigo', color: 'bg-indigo-500' },
    { id: 'cyan', color: 'bg-cyan-500' },
    { id: 'rose', color: 'bg-rose-500' },
  ];

  return (
    <>
      <div className={cn('p-4 mt-auto transition-all duration-500', collapsed && 'md:hidden')}>
        <div
          className={cn(
            'relative overflow-hidden glass-card p-4 md:p-6 group border shadow-2xl',
            isDark ? 'border-white/5' : 'border-slate-100'
          )}
        >
          <Cpu
            className={cn(
              'absolute -right-6 -bottom-6 opacity-[0.03] w-32 h-32 rotate-12 group-hover:rotate-45 transition-transform duration-700 pointer-events-none',
              isDark ? 'text-white' : 'text-slate-900'
            )}
          />

          <div className="relative z-10">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
                </span>
                <span className="text-[11px] font-black text-emerald-500 uppercase tracking-widest">
                  SENTINEL ACTIVE
                </span>
              </div>
              <span
                className={cn(
                  'text-[11px] font-mono px-2 py-0.5 rounded-md border',
                  isDark
                    ? 'text-slate-500 bg-white/5 border-white/5'
                    : 'text-slate-400 bg-black/5 border-slate-200'
                )}
              >
                {window.WG_INTERFACE || 'wg0'}
              </span>
            </div>

            <div className="space-y-2 mb-5">
              <div className="flex justify-between items-center text-[11px] font-bold text-slate-500 uppercase tracking-tight">
                <span>Version</span>
                <span
                  className={cn(
                    'font-mono px-2 py-0.5 rounded-md',
                    isDark ? 'text-white bg-white/5' : 'text-slate-900 bg-black/5'
                  )}
                >
                  v3.1.0-Plat
                </span>
              </div>
              <div className="flex justify-between items-center text-[11px] font-bold text-slate-500 uppercase tracking-tight">
                <span>{t('uptime')}</span>
                <span
                  className={'font-mono'}
                  style={{ color: COLOR_MAP[theme]?.[500] || '#6366f1' }}
                >
                  {uptime || '...'}
                </span>
              </div>
            </div>

            {confirmRestart ? (
              <div className="flex gap-2 w-full">
                <button
                  onClick={handleRestartServer}
                  className="flex-1 py-2.5 text-[11px] font-black uppercase tracking-widest rounded-xl bg-red-500/20 text-red-400 border border-red-500/30 transition-all"
                >
                  {restarting ? 'Redémarrage...' : 'Confirmer'}
                </button>
                <button
                  onClick={() => setConfirmRestart(false)}
                  className="flex-1 py-2.5 text-[11px] font-black uppercase tracking-widest rounded-xl bg-white/5 text-slate-400 border border-white/5 hover:bg-white/10 transition-all"
                >
                  Annuler
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmRestart(true)}
                disabled={restarting}
                className={cn(
                  'w-full py-2.5 text-[11px] font-black uppercase tracking-widest rounded-xl border transition-all flex items-center justify-center gap-2 group/btn',
                  isDark
                    ? 'bg-white/5 hover:bg-red-500/10 text-slate-400 hover:text-red-400 border-white/5 hover:border-red-500/20'
                    : 'bg-black/5 hover:bg-red-50 text-slate-500 hover:text-red-600 border-slate-200 hover:border-red-200'
                )}
              >
                <RefreshCw
                  size={12}
                  className="group-hover/btn:rotate-180 transition-transform duration-700"
                />
                {t('reboot_system')}
              </button>
            )}

            <div
              className={cn(
                'flex items-center justify-between gap-2 mt-5 pt-5 border-t',
                isDark ? 'border-white/5' : 'border-slate-100'
              )}
            >
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    if (mode === 'light') setMode('dark');
                    else if (mode === 'dark') setMode('spectre');
                    else setMode('light');
                  }}
                  className={cn(
                    'p-2 rounded-xl transition-all duration-500',
                    mode === 'spectre'
                      ? 'bg-indigo-500/20 text-indigo-400'
                      : 'bg-white/5 text-slate-400 hover:text-white'
                  )}
                  title={`Mode: ${mode.toUpperCase()}`}
                >
                  {mode === 'dark' ? (
                    <Moon size={14} />
                  ) : mode === 'spectre' ? (
                    <Ghost size={14} />
                  ) : (
                    <Sun size={14} />
                  )}
                </button>
                <button
                  onClick={() => setLang(lang === 'fr' ? 'en' : 'fr')}
                  className="p-2 rounded-xl transition-all text-[11px] font-black w-10 bg-white/5 text-slate-400 hover:text-white"
                  title="Changer de langue"
                >
                  {lang.toUpperCase()}
                </button>
              </div>
              <div
                className={cn('flex gap-2 p-1 rounded-full', isDark ? 'bg-white/5' : 'bg-black/5')}
              >
                {themes.map((th) => (
                  <button
                    key={th.id}
                    onClick={() => setTheme(th.id)}
                    className={cn(
                      'w-3.5 h-3.5 rounded-full transition-all duration-300 border border-transparent',
                      th.color,
                      theme === th.id
                        ? isDark
                          ? 'ring-2 ring-white scale-110'
                          : 'ring-2 ring-indigo-500 scale-110'
                        : 'opacity-30 hover:opacity-100'
                    )}
                    title={th.id}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {collapsed && (
        <div
          className={cn(
            'hidden md:flex flex-col items-center gap-3 p-4 mt-auto border-t relative',
            isDark ? 'border-white/5' : 'border-slate-100'
          )}
        >
          <button
            onClick={() => {
              if (mode === 'light') setMode('dark');
              else if (mode === 'dark') setMode('spectre');
              else setMode('light');
            }}
            className={cn(
              'p-2.5 rounded-xl transition-all duration-500',
              mode === 'spectre'
                ? 'bg-indigo-500/20 text-indigo-400'
                : isDark
                  ? 'bg-white/5 text-slate-400 hover:text-white'
                  : 'bg-black/5 text-slate-500 hover:text-slate-900'
            )}
            title={`Mode: ${mode.toUpperCase()}`}
          >
            {mode === 'dark' ? (
              <Moon size={16} />
            ) : mode === 'spectre' ? (
              <Ghost size={16} />
            ) : (
              <Sun size={16} />
            )}
          </button>
          <button
            onClick={() => setConfirmRestart(true)}
            className={cn(
              'p-2.5 rounded-xl transition-all',
              isDark
                ? 'bg-white/5 text-slate-400 hover:text-red-400'
                : 'bg-black/5 text-slate-500 hover:text-red-600'
            )}
            title="Redémarrer WireGuard"
          >
            <RefreshCw size={16} />
          </button>
          {confirmRestart && (
            <div className="absolute bottom-20 left-1/2 -translate-x-1/2 bg-slate-900 border border-white/10 rounded-2xl p-4 shadow-2xl z-50 w-56 text-center space-y-3">
              <p className="text-[11px] font-bold text-slate-300">Redémarrer WireGuard ?</p>
              <div className="flex gap-2">
                <button
                  onClick={handleRestartServer}
                  className="flex-1 py-2 text-[11px] font-black bg-red-500/20 text-red-400 rounded-xl border border-red-500/30"
                >
                  Oui
                </button>
                <button
                  onClick={() => setConfirmRestart(false)}
                  className="flex-1 py-2 text-[11px] font-black bg-white/5 text-slate-400 rounded-xl border border-white/5"
                >
                  Non
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
};

export default StatusWidget;
