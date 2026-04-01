import React, { useState } from 'react';
import { 
  Home, Package, Users, FileText, Activity, Gauge, ShieldCheck, Settings, 
  LogOut, X, ChevronRight, ChevronLeft, Cpu, RefreshCw, Sun, Moon, PanelLeftClose, PanelLeftOpen
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTheme } from '../../context/ThemeContext';
import { useLang } from '../../context/LanguageContext';
import { useToast } from '../../context/ToastContext';
import { axiosInstance } from '../../lib/api';
import { cn } from '../../lib/utils';

const Sidebar = ({ activeSection, setActiveSection, isOpen, onClose, onLogout, uptime }) => {
  const { theme, setTheme, mode, setMode } = useTheme();
  const { lang, setLang, t } = useLang();
  const { addToast } = useToast();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('sidebar-collapsed') === 'true');

  const toggleCollapsed = () => {
    setCollapsed(prev => {
      localStorage.setItem('sidebar-collapsed', String(!prev));
      return !prev;
    });
  };

  const navItems = [
    { id: 'dashboard',    icon: <Home size={20} />,       label: t('dashboard') },
    { id: 'containers',   icon: <Package size={20} />,    label: t('containers') },
    { id: 'users',        icon: <Users size={20} />,      label: t('users_manage'), hidden: localStorage.getItem('wg-user-role') !== 'admin' },
    { id: 'logs',         icon: <FileText size={20} />,   label: t('logs') },
    { id: 'topology',     icon: <Activity size={20} />,   label: t('topology') },
    { id: 'optimization', icon: <Gauge size={20} />,      label: t('optimization') },
    { id: 'audit',        icon: <ShieldCheck size={20} />,label: 'Audit' },
    { id: 'settings',     icon: <Settings size={20} />,   label: t('settings'), hidden: localStorage.getItem('wg-user-role') !== 'admin' },
  ];

  const handleRestartServer = async () => {
    if (window.confirm('Êtes-vous sûr de vouloir redémarrer le service WireGuard ?')) {
      try {
        await axiosInstance.post('/system/restart/wireguard');
        addToast('Service WireGuard redémarré.', 'success');
      } catch {
        addToast('Erreur lors du redémarrage.', 'error');
      }
    }
  };

  const themes = [
    { id: 'indigo', color: 'bg-indigo-500' },
    { id: 'cyan',   color: 'bg-cyan-500' },
    { id: 'rose',   color: 'bg-rose-500' },
  ];

  return (
    <>
      {/* Mobile backdrop */}
      <AnimatePresence>
        {isOpen && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 md:hidden" 
            onClick={onClose} 
          />
        )}
      </AnimatePresence>

      <aside className={cn(
        "fixed inset-y-0 left-0 z-50 shrink-0 glass-panel flex flex-col h-screen transition-all duration-500 ease-in-out md:translate-x-0 md:relative md:z-auto",
        // Width: collapsed mode or full mode (desktop only)
        collapsed ? "md:w-[4.5rem]" : "md:w-72",
        // Width is always 72 on mobile (overlay)
        "w-72",
        isOpen ? "translate-x-0 shadow-2xl" : "-translate-x-full md:translate-x-0"
      )}>
        {/* ── Branding ──────────────────────────────────────────────────── */}
        <div className={cn("flex justify-between items-center transition-all duration-500", collapsed ? "p-4 py-6" : "p-8 pb-10")}>
          <div className={cn("flex items-center gap-4 overflow-hidden", collapsed && "md:hidden")}>
            <div className="relative group flex-shrink-0">
              <div className={cn("relative p-3 rounded-2xl shadow-2xl border border-white/10", `bg-${theme}-600 shadow-${theme}-600/20`)}>
                <ShieldCheck className="text-white" size={collapsed ? 20 : 28} strokeWidth={2.5} />
              </div>
            </div>
            <div>
              <h1 className="text-2xl font-black text-white italic tracking-tighter bg-gradient-to-br from-white via-slate-100 to-slate-500 bg-clip-text text-transparent">
                {window.APP_TITLE || 'WG-FUX'}
              </h1>
              <div className="flex items-center gap-1.5">
                <p className={cn("text-[8px] font-extrabold tracking-[0.2em] uppercase opacity-70", `text-${theme}-500`)}>PLATINUM CORE</p>
                <div className="h-1 w-1 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_8px_#10b981]" />
              </div>
            </div>
          </div>

          {/* Collapsed icon only */}
          {collapsed && (
            <div className={cn("hidden md:flex items-center justify-center w-full")}>
              <div className={cn("p-2.5 rounded-2xl shadow-xl border border-white/10", `bg-${theme}-600`)}>
                <ShieldCheck className="text-white" size={20} strokeWidth={2.5} />
              </div>
            </div>
          )}

          {/* Close button on mobile */}
          <button onClick={onClose} className="md:hidden text-slate-500 hover:text-white p-3 hover:bg-white/10 rounded-2xl transition-all border border-white/5">
            <X size={24} />
          </button>
        </div>

        {/* ── Collapse Toggle (desktop only) ────────────────────────────── */}
        <button
          onClick={toggleCollapsed}
          className="hidden md:flex absolute -right-3.5 top-12 w-7 h-7 items-center justify-center bg-slate-800 hover:bg-slate-700 border border-white/10 rounded-full text-slate-400 hover:text-white transition-all shadow-xl z-10"
          title={collapsed ? 'Développer' : 'Réduire'}
        >
          {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
        </button>

        {/* ── Navigation ────────────────────────────────────────────────── */}
        <nav className="flex-1 px-3 space-y-1.5 overflow-y-auto custom-scrollbar">
          {navItems.filter(i => !i.hidden).map((item) => {
            const isActive = activeSection === item.id;
            return (
              <button
                key={item.id}
                onClick={() => { setActiveSection(item.id); onClose(); }}
                title={collapsed ? item.label : undefined}
                className={cn(
                  "group relative w-full flex items-center gap-3 px-3 py-3 rounded-2xl transition-all duration-300",
                  collapsed ? "md:justify-center md:px-0" : "",
                  isActive 
                    ? `bg-${theme}-600 text-white shadow-lg shadow-${theme}-600/20` 
                    : "text-slate-500 hover:bg-white/5 hover:text-slate-200"
                )}
              >
                {isActive && (
                  <motion.div layoutId="activeNav" className="absolute left-0 top-1/2 -translate-y-1/2 h-8 w-1 bg-white rounded-r-full shadow-[0_0_15px_white]" />
                )}
                <div className={cn("transition-transform duration-300 flex-shrink-0", !isActive && "group-hover:scale-110 group-hover:rotate-3")}>
                  {React.cloneElement(item.icon, { 
                    size: 18,
                    className: isActive ? "text-white" : "group-hover:text-white transition-colors"
                  })}
                </div>
                <span className={cn("font-bold text-xs tracking-wide uppercase whitespace-nowrap transition-all duration-300 overflow-hidden", collapsed ? "md:w-0 md:opacity-0" : "w-auto opacity-100")}>
                  {item.label}
                </span>
                {!collapsed && isActive && (
                  <motion.div initial={{ opacity: 0, x: -5 }} animate={{ opacity: 1, x: 0 }} className="ml-auto">
                    <ChevronRight size={14} />
                  </motion.div>
                )}
              </button>
            );
          })}

          <button
            onClick={() => { onLogout(); onClose(); }}
            className={cn(
              "group w-full flex items-center gap-3 px-3 py-3 rounded-2xl transition-all duration-300 text-slate-500 hover:bg-red-500/10 hover:text-red-400 mt-6",
              collapsed && "md:justify-center md:px-0"
            )}
            title={collapsed ? 'Déconnexion' : undefined}
          >
            <LogOut size={18} className="group-hover:scale-110 group-hover:rotate-3 transition-transform flex-shrink-0" />
            <span className={cn("font-bold text-xs tracking-wide uppercase transition-all duration-300 overflow-hidden", collapsed ? "md:w-0 md:opacity-0" : "w-auto opacity-100")}>
              {t('logout')}
            </span>
          </button>
        </nav>

        {/* ── Status Widget ─────────────────────────────────────────────── */}
        <div className={cn("p-4 mt-auto transition-all duration-500", collapsed && "md:hidden")}>
          <div className="relative overflow-hidden glass-card p-4 md:p-6 group border border-white/5 shadow-2xl">
            <Cpu className="absolute -right-6 -bottom-6 text-white opacity-[0.02] w-32 h-32 rotate-12 group-hover:rotate-45 transition-transform duration-700 pointer-events-none" />
            
            <div className="relative z-10">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
                  </span>
                  <span className="text-[9px] font-black text-emerald-500 uppercase tracking-widest">SENTINEL ACTIVE</span>
                </div>
                <span className="text-[9px] font-mono text-slate-500 px-2 py-0.5 bg-white/5 rounded-md border border-white/5">{window.WG_INTERFACE || 'wg0'}</span>
              </div>

              <div className="space-y-2 mb-5">
                <div className="flex justify-between items-center text-[10px] font-bold text-slate-500 uppercase tracking-tight">
                  <span>Version</span>
                  <span className="text-white font-mono bg-white/5 px-2 py-0.5 rounded-md">v3.1.0-Plat</span>
                </div>
                <div className="flex justify-between items-center text-[10px] font-bold text-slate-500 uppercase tracking-tight">
                  <span>{t('uptime')}</span>
                  <span className={cn("font-mono", `text-${theme}-400`)}>{uptime || '...'}</span>
                </div>
              </div>

              <button
                onClick={handleRestartServer}
                className="w-full py-2.5 bg-white/5 hover:bg-red-500/10 text-slate-400 hover:text-red-400 text-[10px] font-black uppercase tracking-widest rounded-xl border border-white/5 hover:border-red-500/20 transition-all flex items-center justify-center gap-2 group/btn"
              >
                <RefreshCw size={12} className="group-hover/btn:rotate-180 transition-transform duration-700" />
                {t('reboot_system')}
              </button>

              <div className="flex items-center justify-between gap-2 mt-5 pt-5 border-t border-white/5">
                <div className="flex gap-2">
                  <button onClick={() => setMode(mode === 'dark' ? 'light' : 'dark')} className="p-2 rounded-xl bg-white/5 text-slate-400 hover:text-white transition-all" title="Changer de mode">
                    {mode === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
                  </button>
                  <button onClick={() => setLang(lang === 'fr' ? 'en' : 'fr')} className="p-2 rounded-xl bg-white/5 text-slate-400 hover:text-white text-[10px] font-black w-10" title="Changer de langue">
                    {lang.toUpperCase()}
                  </button>
                </div>
                <div className="flex gap-2 p-1 bg-white/5 rounded-full">
                  {themes.map((th) => (
                    <button
                      key={th.id}
                      onClick={() => setTheme(th.id)}
                      className={cn(
                        "w-3.5 h-3.5 rounded-full transition-all duration-300",
                        th.color,
                        theme === th.id ? "ring-2 ring-white scale-110" : "opacity-30 hover:opacity-100"
                      )}
                      title={th.id}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Collapsed: just icon buttons for theme + mode */}
        {collapsed && (
          <div className="hidden md:flex flex-col items-center gap-3 p-4 mt-auto border-t border-white/5">
            <button onClick={() => setMode(mode === 'dark' ? 'light' : 'dark')} className="p-2.5 rounded-xl bg-white/5 text-slate-400 hover:text-white transition-all" title="Thème">
              {mode === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
            </button>
            <button onClick={handleRestartServer} className="p-2.5 rounded-xl bg-white/5 text-slate-400 hover:text-red-400 transition-all" title="Redémarrer WireGuard">
              <RefreshCw size={16} />
            </button>
          </div>
        )}
      </aside>
    </>
  );
};

export default Sidebar;
