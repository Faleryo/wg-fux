import React from 'react';
import { Trash2, Download } from 'lucide-react';
import { cn } from '../../../lib/utils';

const LogToolbar = ({ totalCount, isDark, onClear, clearing, onDownload }) => (
  <div
    className={cn(
      'px-6 py-4 border-t transition-colors flex flex-wrap justify-between items-center gap-3',
      isDark ? 'border-white/5 bg-slate-950/20' : 'border-black/5 bg-slate-50'
    )}
  >
    <div className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
      {totalCount} entrées · Blackbox v2.1
    </div>
    <div className="flex items-center gap-6">
      <button
        onClick={onClear}
        disabled={clearing}
        className={cn(
          'flex items-center gap-2 text-[10px] font-black uppercase tracking-widest transition-all',
          isDark
            ? 'text-rose-500/50 hover:text-rose-400'
            : 'text-rose-400 hover:text-rose-600'
        )}
      >
        <Trash2 size={13} className={clearing ? 'animate-pulse' : ''} /> EFFACER
      </button>
      <button
        onClick={onDownload}
        className="flex items-center gap-2 text-[10px] font-black text-slate-400 hover:text-white uppercase tracking-widest transition-all"
      >
        <Download size={13} /> Export .log
      </button>
    </div>
  </div>
);

export default LogToolbar;
