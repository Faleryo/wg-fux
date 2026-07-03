import React, { useState } from 'react';
import { ShieldCheck, X, ChevronRight, ChevronLeft } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTheme } from '../../context/ThemeContext';
import { useLang } from '../../context/LanguageContext';
import { cn, COLOR_MAP } from '../../lib/utils';
import NavItems from './NavItems';
import StatusWidget from './StatusWidget';

const Sidebar = ({
  activeSection,
  setActiveSection,
  isOpen,
  onClose,
  onLogout,
  uptime,
  userRole,
  instanceLicensed,
}) => {
  const { theme, setTheme, mode, setMode } = useTheme();
  const isDark = mode === 'dark';
  const { lang, setLang, t } = useLang();
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem('sidebar-collapsed') === 'true'
  );

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      localStorage.setItem('sidebar-collapsed', String(!prev));
      return !prev;
    });
  };

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

      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex flex-col h-screen glass-panel border-r border-white/5 transition-all duration-300 ease-in-out',
          // Desktop: Toggle between collapsed and expanded
          collapsed ? 'md:w-20' : 'md:w-64 lg:w-72',
          // Mobile: Hidden by default, translate when open
          'w-64 -translate-x-full md:translate-x-0 md:relative md:z-auto',
          isOpen && 'translate-x-0 shadow-2xl'
        )}
      >
        {/* ── Branding ──────────────────────────────────────────────────── */}
        <div
          className={cn(
            'flex justify-between items-center transition-all duration-500',
            collapsed ? 'p-4 py-6' : 'p-8 pb-10'
          )}
        >
          <div className={cn('flex items-center gap-4 overflow-hidden', collapsed && 'md:hidden')}>
            <div className="relative group flex-shrink-0">
              <div
                className={cn(
                  'relative p-3 rounded-2xl shadow-2xl border transition-all duration-500',
                  isDark ? 'border-white/10' : 'border-white/20'
                )}
                style={{
                  backgroundColor: COLOR_MAP[theme]?.[600] || '#4f46e5',
                  boxShadow: `0 10px 30px -10px ${COLOR_MAP[theme]?.[600] || '#4f46e5'}66`,
                }}
              >
                <ShieldCheck className="text-white" size={collapsed ? 20 : 28} strokeWidth={2.5} />
              </div>
            </div>
            <div>
              <h1
                className={cn(
                  'text-2xl font-black italic tracking-tighter transition-colors duration-500',
                  isDark ? 'text-white' : 'text-slate-900'
                )}
              >
                {window.APP_TITLE || 'WG-FUX'}
              </h1>
              <div className="flex items-center gap-1.5">
                <p
                  className={'text-[8px] font-extrabold tracking-[0.2em] uppercase opacity-70'}
                  style={{ color: COLOR_MAP[theme]?.[500] || '#6366f1' }}
                >
                  PLATINUM CORE
                </p>
                <div className="h-1 w-1 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_8px_#10b981]" />
              </div>
            </div>
          </div>

          {/* Collapsed icon only */}
          {collapsed && (
            <div className={cn('hidden md:flex items-center justify-center w-full')}>
              <div
                className={cn(
                  'p-2.5 rounded-2xl shadow-xl border',
                  isDark ? 'border-white/10' : 'border-white/20'
                )}
                style={{ backgroundColor: COLOR_MAP[theme]?.[600] || '#4f46e5' }}
              >
                <ShieldCheck className="text-white" size={20} strokeWidth={2.5} />
              </div>
            </div>
          )}

          {/* Close button on mobile */}
          <button
            onClick={onClose}
            className="md:hidden p-3 rounded-2xl transition-all border text-slate-500 hover:text-white hover:bg-white/10 border-white/5"
          >
            <X size={24} />
          </button>
        </div>

        {/* ── Collapse Toggle (desktop only) ────────────────────────────── */}
        <button
          onClick={toggleCollapsed}
          className={cn(
            'hidden md:flex absolute -right-3.5 top-12 w-7 h-7 items-center justify-center border rounded-full transition-all shadow-xl z-10',
            isDark
              ? 'bg-slate-800 border-white/10 text-slate-400 hover:text-white'
              : 'bg-white border-slate-200 text-slate-400 hover:text-slate-900'
          )}
          title={collapsed ? 'Développer' : 'Réduire'}
        >
          {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
        </button>

        <NavItems
          activeSection={activeSection}
          setActiveSection={setActiveSection}
          onClose={onClose}
          collapsed={collapsed}
          isDark={isDark}
          theme={theme}
          onLogout={onLogout}
          t={t}
          userRole={userRole}
          instanceLicensed={instanceLicensed}
        />

        <StatusWidget
          collapsed={collapsed}
          isDark={isDark}
          theme={theme}
          mode={mode}
          setMode={setMode}
          setTheme={setTheme}
          lang={lang}
          setLang={setLang}
          uptime={uptime}
          t={t}
        />
      </aside>
    </>
  );
};

export default Sidebar;
