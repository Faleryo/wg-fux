import React from 'react';
import { Search, X, RefreshCw } from 'lucide-react';
import { cn } from '../../../lib/utils';

const LogSearchBar = ({ searchTerm, onSearchChange, isDark, loading, onRefresh }) => (
  <div className="flex items-center gap-3 w-full sm:w-auto">
    <div className="relative group flex-1 sm:flex-none">
      <Search
        className={cn(
          'absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 transition-colors',
          isDark ? 'group-focus-within:text-white' : 'group-focus-within:text-slate-900'
        )}
        size={16}
      />
      <input
        type="text"
        placeholder="Filtrer..."
        aria-label="Filtrer les logs"
        value={searchTerm}
        onChange={(e) => onSearchChange(e.target.value)}
        className={cn(
          'pl-10 pr-4 py-3 border rounded-xl focus:outline-none focus:border-indigo-500/50 font-mono transition-all text-sm w-full sm:w-56',
          isDark
            ? 'bg-white/5 border-white/5 text-white placeholder:text-slate-700'
            : 'bg-white border-black/5 text-slate-900 placeholder:text-slate-400'
        )}
      />
      {searchTerm && (
        <button
          onClick={() => onSearchChange('')}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white"
        >
          <X size={14} />
        </button>
      )}
    </div>
    <button
      onClick={onRefresh}
      className={cn(
        'p-3 border rounded-xl transition-all flex-shrink-0',
        isDark
          ? 'bg-white/5 border-white/5 text-slate-400 hover:text-white hover:bg-white/10'
          : 'bg-white border-black/5 text-slate-500 hover:text-slate-900 hover:bg-black/5'
      )}
      title="Rafraîchir"
    >
      <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
    </button>
  </div>
);

export default LogSearchBar;
