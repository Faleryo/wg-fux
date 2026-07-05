import React, { useState, useMemo } from 'react';
import { Shield, Trash2, Search, Plus, Check } from 'lucide-react';
import { cn } from '../../../lib/utils';

// Blocklists populaires proposées en 1 clic (ajout via handleAddFilter).
const PRESETS = [
  {
    name: 'AdGuard DNS filter',
    url: 'https://adguardteam.github.io/HostlistsRegistry/assets/filter_1.txt',
  },
  { name: 'OISD Big', url: 'https://big.oisd.nl' },
  {
    name: 'StevenBlack Hosts',
    url: 'https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts',
  },
  { name: 'AdAway', url: 'https://adaway.org/hosts.txt' },
];

const isValidUrl = (u) => /^https?:\/\/\S+\.\S+/.test((u || '').trim());

const DnsRecordsTable = ({
  filtering,
  handleRemoveFilter,
  handleAddFilter,
  newFilterName,
  newFilterUrl,
  setNewFilterName,
  setNewFilterUrl,
}) => {
  const [query, setQuery] = useState('');
  const filters = useMemo(() => filtering?.filters || [], [filtering]);

  const existingUrls = useMemo(() => new Set(filters.map((f) => f.url)), [filters]);
  const totalRules = useMemo(
    () => filters.reduce((a, f) => a + (f.rules_count || 0), 0),
    [filters]
  );
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return filters;
    return filters.filter(
      (f) => (f.name || '').toLowerCase().includes(q) || (f.url || '').toLowerCase().includes(q)
    );
  }, [filters, query]);

  const canAdd =
    newFilterName.trim() && isValidUrl(newFilterUrl) && !existingUrls.has(newFilterUrl.trim());

  return (
    <div className="space-y-6">
      {/* En-tête : compteur + recherche */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3 text-[11px] font-black tracking-widest text-slate-500">
          <span className="text-white text-lg font-black">{filters.length}</span> blocklists
          <span className="w-1 h-1 rounded-full bg-white/20" />
          <span className="text-white text-lg font-black">
            {totalRules.toLocaleString('fr-FR')}
          </span>{' '}
          règles
        </div>
        <div className="relative w-full sm:w-64">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filtrer les blocklists…"
            className="w-full glass-input text-xs pl-9 pr-3 py-2.5"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3">
        {visible.map((filter) => (
          <div
            key={filter.url}
            className="flex items-center justify-between p-4 rounded-2xl bg-white/5 border border-white/5 group hover:border-white/10 transition-all"
          >
            <div className="flex items-center gap-4 min-w-0">
              <div className="p-2 rounded-xl bg-indigo-500/10 text-indigo-400 flex-shrink-0">
                <Shield size={16} />
              </div>
              <div className="min-w-0">
                <div className="text-xs font-bold text-white truncate">{filter.name}</div>
                <div className="text-[11px] text-slate-500 font-mono truncate max-w-[320px]">
                  {filter.url}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-4 flex-shrink-0">
              <div className="text-right">
                <div className="text-[11px] font-black text-indigo-400 tracking-widest">
                  {(filter.rules_count || 0).toLocaleString('fr-FR')} règles
                </div>
                <div
                  className={cn(
                    'text-[11px] font-bold',
                    filter.enabled ? 'text-emerald-500' : 'text-amber-500'
                  )}
                >
                  {filter.enabled ? 'Actif' : 'Inactif'}
                </div>
              </div>
              <button
                onClick={() => handleRemoveFilter(filter.url)}
                title="Supprimer cette blocklist"
                className="p-2 rounded-lg bg-rose-500/10 text-rose-500 opacity-0 group-hover:opacity-100 transition-all hover:bg-rose-500/20"
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        ))}
        {visible.length === 0 && (
          <div className="text-center py-8 text-slate-500 text-xs tracking-widest">
            {query ? 'Aucune blocklist ne correspond' : 'Aucune blocklist configurée'}
          </div>
        )}
      </div>

      {/* Presets populaires */}
      <div className="pt-6 border-t border-white/5">
        <h4 className="text-[11px] font-black text-slate-500 tracking-[0.2em] mb-3">
          Ajout rapide
        </h4>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => {
            const added = existingUrls.has(p.url);
            return (
              <button
                key={p.url}
                disabled={added}
                onClick={() => handleAddFilter(p.name, p.url)}
                className={cn(
                  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-[11px] font-bold transition-all',
                  added
                    ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400 cursor-default'
                    : 'bg-white/5 border-white/10 text-slate-300 hover:bg-indigo-500/15 hover:border-indigo-500/30 hover:text-white'
                )}
              >
                {added ? <Check size={12} /> : <Plus size={12} />}
                {p.name}
              </button>
            );
          })}
        </div>
      </div>

      {/* Ajout manuel */}
      <div className="pt-6 border-t border-white/5">
        <h4 className="text-[11px] font-black text-slate-500 tracking-[0.2em] mb-4">
          Ajouter une blocklist personnalisée
        </h4>
        <div className="flex flex-col sm:flex-row gap-4">
          <input
            type="text"
            placeholder="Nom (ex: Steven Black)"
            value={newFilterName}
            onChange={(e) => setNewFilterName(e.target.value)}
            className="flex-1 glass-input text-xs p-3"
          />
          <input
            type="text"
            placeholder="URL (https://…)"
            value={newFilterUrl}
            onChange={(e) => setNewFilterUrl(e.target.value)}
            className={cn(
              'flex-[2] glass-input text-xs p-3',
              newFilterUrl && !isValidUrl(newFilterUrl) && 'border-rose-500/40'
            )}
          />
          <button
            disabled={!canAdd}
            onClick={() => {
              handleAddFilter(newFilterName.trim(), newFilterUrl.trim());
              setNewFilterName('');
              setNewFilterUrl('');
            }}
            className="px-6 py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-bold text-[11px] tracking-widest transition-all whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Ajouter
          </button>
        </div>
        {newFilterUrl && !isValidUrl(newFilterUrl) && (
          <p className="text-[11px] text-rose-400 mt-2">URL invalide (attendu : https://…)</p>
        )}
        {isValidUrl(newFilterUrl) && existingUrls.has(newFilterUrl.trim()) && (
          <p className="text-[11px] text-amber-400 mt-2">Cette blocklist est déjà ajoutée.</p>
        )}
      </div>
    </div>
  );
};

export default DnsRecordsTable;
