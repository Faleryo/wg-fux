import React from 'react';
import { 
  Home, Package, Users, FileText, Activity, Gauge, ShieldCheck, Settings, 
  LogOut, X, ChevronRight, Cpu, RefreshCw, Sun, Moon 
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTheme } from '../../context/ThemeContext';
import { useLang } from '../../context/LanguageContext';
import { useToast } from '../../context/ToastContext';
import axios from 'axios';
import { cn } from '../../lib/utils';

const Sidebar = ({ activeSection, setActiveSection, isOpen, onClose, onLogout, uptime }) => {
  const { theme, setTheme, mode, setMode } = useTheme();
  const { lang, setLang, t } = useLang();
  const { addToast } = useToast();

  const navItems = [
    { id: 'dashboard', icon: <Home size={20} />, label: t('dashboard') },
    { id: 'containers', icon: <Package size={20} />, label: t('containers') },
    { id: 'users', icon: <Users size={20} />, label: t('users_manage'), hidden: localStorage.getItem('wg-user-role') !== 'admin' },
    { id: 'logs', icon: <FileText size={20} />, label: t('logs') },
    { id: 'topology', icon: <Activity size={20} />, label: t('topology') },
    { id: 'optimization', icon: <Gauge size={20} />, label: t('optimization') },
    { id: 'audit', icon: <ShieldCheck size={20} />, label: 'Audit' },
    { id: 'settings', icon: <Settings size={20} />, label: t('settings'), hidden: localStorage.getItem('wg-user-role') !== 'admin' },
  ];

  const handleRestartServer = async () => {
    if (window.confirm('Êtes-vous sûr de vouloir redémarrer le service WireGuard ?')) {
      try {
        await axios.post('/api/system/restart/wireguard', {}, {
          headers: { 'Authorization': `Bearer ${localStorage.getItem('wg-api-token') || sessionStorage.getItem('wg-api-token')}` }
        });
        addToast('Service WireGuard redémarré.', 'success');
      } catch (error) {
        console.error('Erreur:', error);
        addToast('Erreur lors du redémarrage.', 'error');
      }
    }
  };

  const themes = [
    { id: 'indigo', color: 'bg-indigo-500' },
    { id: 'cyan', color: 'bg-cyan-500' },
    { id: 'rose', color: 'bg-rose-500' },
  ];

  return (
    <>
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
        "fixed inset-y-0 left-0 z-50 w-72 glass-panel flex flex-col h-screen transition-all duration-500 ease-in-out md:translate-x-0 md:relative",
        isOpen ? "translate-x-0" : "-translate-x-full"
      )}>
        {/* Branding */}
        <div className="p-8 pb-10 flex justify-between items-start">
          <div className="flex items-center gap-4">
            <div className="relative group">
              <div className={cn("absolute inset-0 bg-gradient-to-br from-white/20 to-transparent blur-xl opacity-0 group-hover:opacity-100 transition-opacity duration-500", `bg-${theme}-600`)}></div>
              <div className={cn("relative p-3 rounded-2xl shadow-2xl border border-white/10", `bg-${theme}-600 shadow-${theme}-600/20`)}>
                <ShieldCheck className="text-white" size={28} strokeWidth={2.5} />
              </div>
            </div>
            <div>
              <h1 className="text-2xl font-black text-white italic tracking-tighter bg-gradient-to-br from-white via-slate-100 to-slate-500 bg-clip-text text-transparent">
                {window.APP_TITLE || 'WG-FUX'}
              </h1>
              <div className="flex items-center gap-1.5">
                 <p className={cn("text-[8px] font-extrabold tracking-[0.2em] uppercase opacity-70", `text-${theme}-500`)}>PLATINUM CORE</p>
                 <div className="h-1 w-1 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_8px_#10b981]" title="Sentinel Active"></div>
              </div>
            </div>
          </div>
          <button onClick={onClose} className="md:hidden text-slate-500 hover:text-white p-2 hover:bg-white/5 rounded-xl transition-all"><X size={24} /></button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-4 space-y-2 overflow-y-auto custom-scrollbar">
          {navItems.filter(i => !i.hidden).map((item) => {
            const isActive = activeSection === item.id;
            return (
              <button
                key={item.id}
                onClick={() => { setActiveSection(item.id); onClose(); }}
                className={cn(
                  "group relative w-full flex items-center gap-3 px-4 py-3 rounded-2xl transition-all duration-300",
                  isActive 
                    ? `bg-${theme}-600 text-white shadow-lg shadow-${theme}-600/20` 
                    : "text-slate-500 hover:bg-white/5 hover:text-slate-200"
                )}
              >
                {isActive && (
                  <motion.div layoutId="activeNav" className="absolute left-0 top-1/2 -translate-y-1/2 h-8 w-1 bg-white rounded-r-full shadow-[0_0_15px_white]" />
                )}
                <div className={cn("transition-transform duration-300", !isActive && "group-hover:scale-110 group-hover:rotate-3")}>
                  {React.cloneElement(item.icon, { 
                    size: 18,
                    className: isActive ? "text-white" : "group-hover:text-white transition-colors"
                  })}
                </div>
                <span className="font-bold text-xs tracking-wide uppercase">{item.label}</span>
                {isActive && <motion.div initial={{ opacity: 0, x: -5 }} animate={{ opacity: 1, x: 0 }} className="ml-auto"><ChevronRight size={14} /></motion.div>}
              </button>
            );
          })}

          <button
            onClick={() => { onLogout(); onClose(); }}
            className="group w-full flex items-center gap-3 px-4 py-3 rounded-2xl transition-all duration-300 text-slate-500 hover:bg-red-500/10 hover:text-red-400 mt-6"
          >
            <LogOut size={20} className="group-hover:scale-110 group-hover:rotate-3 transition-transform" />
            <span className="font-bold text-xs tracking-wide uppercase">{t('logout')}</span>
          </button>
        </nav>

        {/* Status Widget */}
        <div className="p-6">
          <div className="relative overflow-hidden glass-card p-6 group">
            <Cpu className="absolute -right-6 -bottom-6 text-white opacity-[0.03] w-32 h-32 rotate-12 group-hover:rotate-45 transition-transform duration-700" />
            
            <div className="relative z-10">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-2">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                  </span>
                  <span className="text-[10px] font-black text-emerald-500 uppercase tracking-widest">SENTINEL ACTIVE</span>
                </div>
                <span className="text-[9px] font-mono text-slate-500 px-2 py-0.5 bg-white/5 rounded-md border border-white/5">{window.WG_INTERFACE || 'wg0'}</span>
              </div>

              <div className="space-y-2 mb-6">
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
                className="w-full py-3 bg-white/5 hover:bg-red-500/10 text-slate-400 hover:text-red-400 text-[10px] font-black uppercase tracking-widest rounded-xl border border-white/5 hover:border-red-500/20 transition-all flex items-center justify-center gap-2 group/btn"
              >
                <RefreshCw size={12} className="group-hover/btn:rotate-180 transition-transform duration-700" />
                {t('reboot_system')}
              </button>

              <div className="flex items-center justify-between gap-2 mt-6 pt-6 border-t border-white/5">
                <div className="flex gap-2">
                  <button onClick={() => setMode(mode === 'dark' ? 'light' : 'dark')} className="p-2 rounded-xl bg-white/5 text-slate-400 hover:text-white transition-all">
                    {mode === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
                  </button>
                  <button onClick={() => setLang(lang === 'fr' ? 'en' : 'fr')} className="p-2 rounded-xl bg-white/5 text-slate-400 hover:text-white text-[10px] font-black w-10">
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
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
};

export default Sidebar;
