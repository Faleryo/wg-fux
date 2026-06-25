import React from 'react';
import { Shield, RefreshCw } from 'lucide-react';
import { cn } from '../../../lib/utils';

const DnsRecordsTable = ({ filtering, handleRemoveFilter, handleAddFilter, newFilterName, newFilterUrl, setNewFilterName, setNewFilterUrl }) => {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4">
        {filtering?.filters?.map((filter) => (
          <div
            key={filter.url}
            className="flex items-center justify-between p-4 rounded-2xl bg-white/5 border border-white/5 group hover:border-white/10 transition-all"
          >
            <div className="flex items-center gap-4">
              <div className="p-2 rounded-xl bg-indigo-500/10 text-indigo-400">
                <Shield size={16} />
              </div>
              <div>
                <div className="text-xs font-bold text-white">{filter.name}</div>
                <div className="text-[10px] text-slate-500 font-mono truncate max-w-[300px]">
                  {filter.url}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="text-right mr-4">
                <div className="text-[10px] font-black text-indigo-500 uppercase tracking-widest">
                  {filter.rules_count} RÈGLES
                </div>
                <div
                  className={cn(
                    'text-[10px] font-bold uppercase',
                    filter.enabled ? 'text-emerald-500' : 'text-amber-500'
                  )}
                >
                  {filter.enabled ? 'ACTIF' : 'INACTIF'}
                </div>
              </div>
              <button
                onClick={() => handleRemoveFilter(filter.url)}
                className="p-2 rounded-lg bg-rose-500/10 text-rose-500 opacity-0 group-hover:opacity-100 transition-all"
              >
                <RefreshCw size={14} className="rotate-45" />
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="pt-6 border-t border-white/5">
        <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] mb-4">
          Ajouter une Blocklist
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
            placeholder="URL (ex: https://...)"
            value={newFilterUrl}
            onChange={(e) => setNewFilterUrl(e.target.value)}
            className="flex-[2] glass-input text-xs p-3"
          />
          <button
            onClick={() => {
              if (newFilterName && newFilterUrl) {
                handleAddFilter(newFilterName, newFilterUrl);
                setNewFilterName('');
                setNewFilterUrl('');
              }
            }}
            className="px-6 py-3 bg-white/10 hover:bg-white/20 text-white rounded-xl font-bold text-[10px] uppercase tracking-widest transition-all whitespace-nowrap"
          >
            Ajouter
          </button>
        </div>
      </div>
    </div>
  );
};

export default DnsRecordsTable;
