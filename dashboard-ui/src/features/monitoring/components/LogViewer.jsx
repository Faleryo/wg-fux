import React from 'react';
import { Clock } from 'lucide-react';
import { cn } from '../../../lib/utils';

const getStatusStyle = (status, isDark) => {
  const s = (status || '').toUpperCase();
  if (s === 'SUCCESS' || s === 'CONNECTED' || s === 'INFO')
    return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
  if (s === 'LIVE' || s === 'DEBUG')
    return 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20 animate-pulse';
  if (s === 'FAILED' || s === 'ERROR' || s === 'AUDIT')
    return 'bg-red-500/10 text-red-400 border-red-500/20';
  if (s === 'WARN' || s === 'WARNING') return 'bg-amber-500/10 text-amber-400 border-amber-500/20';
  return isDark
    ? 'bg-white/5 text-slate-400 border-white/5'
    : 'bg-slate-100/50 text-slate-500 border-black/5';
};

const LogViewer = ({ logs, filteredLogs, loading, isDark }) => (
  <div className="overflow-x-auto overflow-y-auto max-h-[calc(100vh-420px)] custom-scrollbar">
    <table className="w-full text-left min-w-[600px]">
      <thead
        className={cn(
          'sticky top-0 z-10 backdrop-blur-xl transition-colors',
          isDark ? 'bg-slate-950/80' : 'bg-slate-50/80'
        )}
      >
        <tr
          className={cn(
            'text-[10px] font-black uppercase tracking-widest border-b transition-colors',
            isDark ? 'text-slate-500 border-white/5' : 'text-slate-400 border-black/5'
          )}
        >
          <th className="px-6 py-5">Timestamp</th>
          <th className="px-6 py-5">Événement</th>
          <th className="px-6 py-5 hidden sm:table-cell">Source</th>
          <th className="px-6 py-5">Statut</th>
        </tr>
      </thead>
      <tbody
        className={cn(
          'divide-y font-mono transition-colors',
          isDark ? 'divide-white/5' : 'divide-black/5'
        )}
      >
        {loading && logs.length === 0 ? (
          <tr>
            <td colSpan="4" className="text-center py-20 text-slate-500 italic opacity-40">
              Scanning archives...
            </td>
          </tr>
        ) : filteredLogs.length === 0 ? (
          <tr>
            <td colSpan="4" className="text-center py-20 text-slate-500 italic opacity-40">
              Aucun enregistrement détecté
            </td>
          </tr>
        ) : (
          filteredLogs.map((log) => (
            <tr
              key={log.id}
              className={cn(
                'group transition-colors',
                isDark ? 'hover:bg-white/5' : 'hover:bg-slate-50'
              )}
            >
              <td className="px-6 py-4 whitespace-nowrap">
                <div className="flex items-center gap-2">
                  <Clock size={12} className="text-slate-600 shrink-0" />
                  <span
                    className={cn(
                      'text-[10px] transition-colors',
                      isDark
                        ? 'text-slate-400 group-hover:text-white'
                        : 'text-slate-500 group-hover:text-slate-900'
                    )}
                  >
                    {new Date(log.time).toLocaleString('fr-FR', {
                      day: '2-digit',
                      month: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                    })}
                  </span>
                </div>
              </td>
              <td className="px-6 py-4 max-w-xs">
                <div
                  className={cn(
                    'text-xs font-bold tracking-tight truncate transition-colors',
                    isDark ? 'text-white' : 'text-slate-900'
                  )}
                >
                  {log.message}
                </div>
              </td>
              <td className="px-6 py-4 hidden sm:table-cell">
                <span className="text-[10px] text-slate-500 font-mono">{log.ip}</span>
              </td>
              <td className="px-6 py-4">
                <div
                  className={cn(
                    'inline-flex items-center px-2.5 py-1 rounded-lg border text-[9px] font-black uppercase tracking-widest',
                    getStatusStyle(log.status, isDark)
                  )}
                >
                  {log.status}
                </div>
              </td>
            </tr>
          ))
        )}
      </tbody>
    </table>
  </div>
);

export default LogViewer;
