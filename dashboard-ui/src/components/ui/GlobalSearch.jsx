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
import { cn } from '../../lib/utils';
import { useTheme } from '../../context/ThemeContext';

const NAV_ITEMS = [
  { id: 'dashboard', label: 'Tableau de Bord', icon: Activity, desc: 'Statistiques temps réel' },
  { id: 'containers', label: 'Conteneurs', icon: Package, desc: 'Gestion des peers WireGuard' },
  { id: 'users', label: 'Utilisateurs', icon: Users, desc: 'Accès opérateurs' },
  { id: 'logs', label: 'Logs Système', icon: FileText, desc: "Journaux d'accès et sécurité" },
  { id: 'audit', label: 'Audit', icon: ShieldCheck, desc: 'Contrôle de sécurité' },
  { id: 'optimization', label: 'Optimisation', icon: Gauge, desc: 'Profils réseau' },
  { id: 'settings', label: 'Paramètres', icon: Settings, desc: 'Configuration système' },
];

const GlobalSearch = ({ isOpen, onClose, clients = [], onNavigate }) => {
  const { theme, isDark } = useTheme();
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
    const q = query.toLowerCase();
    NAV_ITEMS.filter(
      (n) => n.label.toLowerCase().includes(q) || n.desc.toLowerCase().includes(q)
    ).forEach((n) => results.push({ ...n, category: 'Navigation', type: 'section' }));

    clients
      .filter(
        (c) =>
          c.name?.toLowerCase().includes(q) ||
          (c.ip || '').includes(q) ||
          (c.container || '').toLowerCase().includes(q)
      )
      .slice(0, 6)
      .forEach((c) =>
        results.push({
          id: c.id,
          label: c.name,
          desc: `${c.container} · ${c.ip}`,
          icon: Package,
          type: 'client',
          category: 'Peers',
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
    onNavigate(item.type === 'client' ? 'containers' : item.id);
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
                className={cn(
                  'flex-shrink-0 transition-colors',
                  query ? `text-${theme}-400` : 'text-slate-500'
                )}
              />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Rechercher peers, sections, IP..."
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
                    'hidden sm:block px-2 py-1 border rounded-lg text-[10px] font-black uppercase tracking-widest',
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
                    className={cn(
                      'inline-flex p-4 rounded-2xl mb-4',
                      `bg-${theme}-600/10 text-${theme}-400`
                    )}
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
                  <p className="text-[10px] text-slate-600 mt-1">Peers · Sections · Adresses IP</p>
                  <div className="flex justify-center gap-4 mt-5">
                    {NAV_ITEMS.slice(0, 4).map((n) => (
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
                              : 'bg-black/5 group-hover:bg-black/10',
                            `text-${theme}-400`
                          )}
                        >
                          <n.icon size={16} />
                        </div>
                        <span
                          className={cn(
                            'text-[9px] font-black uppercase tracking-widest transition-colors',
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
                  <p className="text-[10px] text-slate-700 mt-1">pour « {query} »</p>
                </div>
              ) : (
                categories.map((cat) => (
                  <div key={cat} className="mb-2">
                    <div className="text-[9px] font-black text-slate-600 uppercase tracking-widest px-3 py-2">
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
                                ? `bg-${theme}-600/10 border border-${theme}-500/20`
                                : 'hover:bg-white/5 border border-transparent'
                            )}
                          >
                            <div
                              className={cn(
                                'p-2.5 rounded-xl transition-all flex-shrink-0',
                                selectedIdx === idx
                                  ? `bg-${theme}-600 text-white`
                                  : cn(
                                      isDark
                                        ? 'bg-white/5 group-hover:bg-white/10'
                                        : 'bg-black/5 group-hover:bg-black/10',
                                      `text-${theme}-400`
                                    )
                              )}
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
                              <div className="text-[10px] text-slate-500 font-mono truncate">
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
            <div className="px-6 py-3 border-t border-white/5 flex items-center gap-6 text-[9px] font-black text-slate-600 uppercase tracking-widest">
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
