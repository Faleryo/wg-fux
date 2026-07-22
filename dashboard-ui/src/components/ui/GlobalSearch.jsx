import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search,
  X,
  Package,
  FileText,
  Settings,
  Activity,
  Users,
  ShieldCheck,
  Gauge,
  Command,
  ArrowRight,
} from 'lucide-react';
import { cn, COLOR_MAP } from '../../lib/utils';
import { useTheme } from '../../context/ThemeContext';
import { useLang } from '../../context/LanguageContext';

// Libellés résolus via t() DANS le composant (voir navItems) : ils servent à la
// fois à l'affichage ET au filtrage, donc la recherche matche la langue affichée.
const NAV_ITEMS = [
  { id: 'dashboard', labelKey: 'dashboard', icon: Activity, descKey: 'gs_dashboard_desc' },
  { id: 'containers', labelKey: 'containers', icon: Package, descKey: 'gs_containers_desc' },
  { id: 'users', labelKey: 'users_manage', icon: Users, descKey: 'gs_users_desc' },
  { id: 'logs', labelKey: 'gs_logs_label', icon: FileText, descKey: 'gs_logs_desc' },
  { id: 'audit', labelKey: 'audit', icon: ShieldCheck, descKey: 'gs_audit_desc' },
  { id: 'optimization', labelKey: 'optimization', icon: Gauge, descKey: 'gs_optimization_desc' },
  { id: 'settings', labelKey: 'settings', icon: Settings, descKey: 'gs_settings_desc' },
];

const GlobalSearch = ({ isOpen, onClose, clients = [], onNavigate }) => {
  const { theme, isDark } = useTheme();
  const { t } = useLang();
  // Libellés traduits, résolus ici (t n'existe qu'à l'intérieur du composant).
  const navItems = NAV_ITEMS.map((n) => ({ ...n, label: t(n.labelKey), desc: t(n.descKey) }));
  const [query, setQuery] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef(null);

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIdx(0);
      setTimeout(() => inputRef.current?.focus(), 60);
    }
  }, [isOpen]);

  // Compute results
  const results = [];
  if (query.length >= 1) {
    const q = String(query || '').toLowerCase();
    navItems
      .filter((n) => {
        const label = String(n?.label || '').toLowerCase();
        const desc = String(n?.desc || '').toLowerCase();
        return label.includes(q) || desc.includes(q);
      })
      .forEach((n) => results.push({ ...n, category: t('gs_navigation'), type: 'section' }));

    (clients || [])
      .filter((c) => {
        const name = String(c?.name || '').toLowerCase();
        const container = String(c?.container || '').toLowerCase();
        const ip = String(c?.ip || '').toLowerCase();
        const pubkey = String(c?.publicKey || '').toLowerCase();
        return name.includes(q) || container.includes(q) || ip.includes(q) || pubkey.includes(q);
      })
      .slice(0, 6)
      .forEach((c) =>
        results.push({
          id: c.id,
          label: c.name,
          desc: `${c.container} · ${c.ip}`,
          icon: Package,
          type: 'client',
          category: t('gs_peers_section'),
          container: c.container,
          clientObj: c,
        })
      );
  }

  // Keyboard navigation
  useEffect(() => {
    const handleKey = (e) => {
      if (!isOpen) return;
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIdx((i) => Math.min(i + 1, results.length - 1));
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIdx((i) => Math.max(i - 1, 0));
      }
      if (e.key === 'Enter' && results[selectedIdx]) {
        handleSelect(results[selectedIdx]);
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [isOpen, results, selectedIdx]);

  useEffect(() => {
    setSelectedIdx(0);
  }, [query]);

  const handleSelect = (item) => {
    if (item.type === 'client') {
      onNavigate('containers', { container: item.container, client: item.clientObj });
    } else {
      onNavigate(item.id);
    }
    onClose();
  };

  const categories = [...new Set(results.map((r) => r.category))];
  let globalIdx = 0;

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[200] flex items-start justify-center pt-16 sm:pt-24 px-4">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className={cn(
              'absolute inset-0 backdrop-blur-sm transition-colors duration-700',
              isDark ? 'bg-slate-950/60' : 'bg-slate-200/40'
            )}
            onClick={onClose}
          />

          {/* Search Box */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -20 }}
            transition={{ type: 'spring', damping: 28, stiffness: 350 }}
            className="relative w-full max-w-xl glass-panel border border-white/10 rounded-[2rem] shadow-2xl overflow-hidden"
          >
            {/* Glow decoration */}
            <div
              className="absolute -top-20 left-1/2 -translate-x-1/2 w-64 h-32 blur-[80px] opacity-30 pointer-events-none"
              style={{ background: `var(--theme-color, #4f46e5)` }}
            />

            {/* Input Row */}
            <div className="flex items-center gap-4 px-6 py-5 border-b border-white/5 relative z-10">
              <Search
                size={20}
                style={{ color: query ? COLOR_MAP[theme]?.[400] || '#818cf8' : undefined }}
                className={cn('flex-shrink-0 transition-colors', !query && 'text-slate-500')}
              />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('gs_search_placeholder')}
                className={cn(
                  'flex-1 bg-transparent font-mono text-sm outline-none transition-colors',
                  isDark
                    ? 'text-white placeholder:text-slate-600'
                    : 'text-slate-900 placeholder:text-slate-400'
                )}
              />
              <div className="flex items-center gap-2 flex-shrink-0">
                <kbd
                  className={cn(
                    'hidden sm:block px-2 py-1 border rounded-lg text-[11px] font-black uppercase tracking-widest',
                    isDark
                      ? 'bg-white/5 border-white/10 text-slate-500'
                      : 'bg-black/5 border-slate-200 text-slate-400'
                  )}
                >
                  ESC
                </kbd>
                <button
                  onClick={onClose}
                  className={cn(
                    'p-1.5 rounded-xl transition-all',
                    isDark
                      ? 'hover:bg-white/10 text-slate-500 hover:text-white'
                      : 'hover:bg-black/5 text-slate-400 hover:text-slate-900'
                  )}
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            {/* Results */}
            <div className="max-h-[360px] overflow-y-auto custom-scrollbar p-2">
              {query.length === 0 ? (
                <div className="py-10 text-center">
                  <div
                    className={'inline-flex p-4 rounded-2xl mb-4'}
                    style={{
                      backgroundColor: `${COLOR_MAP[theme]?.[600] || '#4f46e5'}1A`,
                      color: COLOR_MAP[theme]?.[400] || '#818cf8',
                    }}
                  >
                    <Command size={28} />
                  </div>
                  <p
                    className={cn(
                      'text-[11px] font-black uppercase tracking-widest',
                      isDark ? 'text-white' : 'text-slate-900'
                    )}
                  >
                    Recherche Globale
                  </p>
                  <p className="text-[11px] text-slate-600 mt-1">{t('gs_hint')}</p>
                  <div className="flex justify-center gap-4 mt-5">
                    {navItems.slice(0, 4).map((n) => (
                      <button
                        key={n.id}
                        onClick={() => handleSelect(n)}
                        className={cn(
                          'flex flex-col items-center gap-2 p-3 rounded-2xl transition-all group',
                          isDark ? 'hover:bg-white/5' : 'hover:bg-black/5'
                        )}
                      >
                        <div
                          className={cn(
                            'p-2.5 rounded-xl transition-all',
                            isDark
                              ? 'bg-white/5 group-hover:bg-white/10'
                              : 'bg-black/5 group-hover:bg-black/10'
                          )}
                          style={{ color: COLOR_MAP[theme]?.[400] || '#818cf8' }}
                        >
                          <n.icon size={16} />
                        </div>
                        <span
                          className={cn(
                            'text-[11px] font-black uppercase tracking-widest transition-colors',
                            isDark
                              ? 'text-slate-500 group-hover:text-white'
                              : 'text-slate-400 group-hover:text-slate-900'
                          )}
                        >
                          {n.label}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : results.length === 0 ? (
                <div className="py-10 text-center">
                  <p className="text-[11px] font-black text-slate-500 uppercase tracking-widest">
                    Aucun résultat
                  </p>
                  <p className="text-[11px] text-slate-700 mt-1">pour « {query} »</p>
                </div>
              ) : (
                categories.map((cat) => (
                  <div key={cat} className="mb-2">
                    <div className="text-[11px] font-black text-slate-600 uppercase tracking-widest px-3 py-2">
                      {cat}
                    </div>
                    {results
                      .filter((r) => r.category === cat)
                      .map((item) => {
                        const idx = globalIdx++;
                        return (
                          <button
                            key={`${item.id}-${idx}`}
                            onClick={() => handleSelect(item)}
                            className={cn(
                              'w-full flex items-center gap-4 px-3 py-3 rounded-2xl transition-all group text-left',
                              selectedIdx === idx
                                ? 'border'
                                : 'hover:bg-white/5 border border-transparent'
                            )}
                            style={
                              selectedIdx === idx
                                ? {
                                    backgroundColor: `${COLOR_MAP[theme]?.[600] || '#4f46e5'}1A`,
                                    borderColor: `${COLOR_MAP[theme]?.[500] || '#6366f1'}33`,
                                  }
                                : undefined
                            }
                          >
                            <div
                              className={cn(
                                'p-2.5 rounded-xl transition-all flex-shrink-0',
                                selectedIdx === idx
                                  ? 'text-white'
                                  : isDark
                                    ? 'bg-white/5 group-hover:bg-white/10'
                                    : 'bg-black/5 group-hover:bg-black/10'
                              )}
                              style={{
                                backgroundColor:
                                  selectedIdx === idx
                                    ? COLOR_MAP[theme]?.[600] || '#4f46e5'
                                    : undefined,
                                color:
                                  selectedIdx !== idx
                                    ? COLOR_MAP[theme]?.[400] || '#818cf8'
                                    : undefined,
                              }}
                            >
                              <item.icon size={16} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div
                                className={cn(
                                  'text-sm font-black uppercase tracking-tight truncate',
                                  isDark ? 'text-white' : 'text-slate-900'
                                )}
                              >
                                {item.label}
                              </div>
                              <div className="text-[11px] text-slate-500 font-mono truncate">
                                {item.desc}
                              </div>
                            </div>
                            <ArrowRight
                              size={14}
                              className={cn(
                                'transition-colors',
                                isDark
                                  ? 'text-slate-600 group-hover:text-slate-400'
                                  : 'text-slate-400 group-hover:text-slate-600'
                              )}
                            />
                          </button>
                        );
                      })}
                  </div>
                ))
              )}
            </div>

            {/* Footer hints */}
            <div className="px-6 py-3 border-t border-white/5 flex items-center gap-6 text-[11px] font-black text-slate-600 uppercase tracking-widest">
              <span className="flex items-center gap-1.5">
                <kbd className="px-1.5 py-0.5 bg-white/5 rounded border border-white/10">↑↓</kbd>{' '}
                Naviguer
              </span>
              <span className="flex items-center gap-1.5">
                <kbd className="px-1.5 py-0.5 bg-white/5 rounded border border-white/10">↵</kbd>{' '}
                Sélectionner
              </span>
              <span className="flex items-center gap-1.5">
                <kbd className="px-1.5 py-0.5 bg-white/5 rounded border border-white/10">ESC</kbd>{' '}
                Fermer
              </span>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};

export default GlobalSearch;
