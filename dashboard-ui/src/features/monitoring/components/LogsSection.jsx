import React, { useState, useEffect, useRef } from 'react';
import { 
  FileText, Search, RefreshCw, 
  Terminal, Shield, Globe, Clock, Download, X, Cpu, Server
} from 'lucide-react';
import { useTheme } from '../../../context/ThemeContext';
import { cn } from '../../../lib/utils';
import { axiosInstance as axios, getWsUri } from '../../../lib/api';

const LogsSection = () => {
  const { theme, isDark } = useTheme();
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeTab, setActiveTab] = useState('access');
  const wsRef = useRef(null);
  const bottomRef = useRef(null);

  const fetchLogs = async () => {
    setLoading(true);
    try {
      let endpoint;
      if (activeTab === 'access') endpoint = '/system/logs';
      else if (activeTab === 'security') endpoint = '/system/security-logs';
      else if (activeTab === 'system') endpoint = '/system/container-logs';

      const res = await axios.get(endpoint);
      const rawData = res.data || [];

      // Normalise les différents formats que l'API peut retourner
      const normalized = rawData.map((item, i) => ({
        id: i,
        time: item.time || item.date || item.timestamp || new Date().toISOString(),
        message: item.message || item.MESSAGE || (item.username ? `${item.username} – ${item.virtualIp || ''}` : 'Événement système'),
        ip: item.ip || item.realIp || item.unit || item._SYSTEMD_UNIT || 'Système',
        status: item.status || item.type || 'LOGGED',
      }));
      setLogs(normalized);
    } catch (e) { 
      console.error('[LOGS]', e); 
      setLogs([]);
    } finally { 
      setLoading(false); 
    }
  };

  // Gestion WebSocket pour l'onglet "security" (journalctl live)
  useEffect(() => {
    // Fermer la connexion WS précédente si elle existe
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    fetchLogs();

    if (activeTab === 'security') {
      const wsUrl = getWsUri('logs-wg');
      if (!wsUrl) return;
      
      try {
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onmessage = (evt) => {
          const line = typeof evt.data === 'string' ? evt.data.trim() : '';
          if (!line) return;
          const newLog = {
            id: Date.now(),
            time: new Date().toISOString(),
            message: line,
            ip: 'journald',
            status: 'LIVE',
          };
          setLogs(prev => [newLog, ...prev.slice(0, 199)]);
        };

        ws.onerror = (err) => console.warn('[WS-LOGS] error:', err);
      } catch (e) {
        console.warn('[WS-LOGS] Could not connect:', e);
      }
    }

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [activeTab]);

  const filteredLogs = logs.filter(log =>
    JSON.stringify(log).toLowerCase().includes(searchTerm.toLowerCase())
  );

  const getStatusStyle = (status) => {
    const s = (status || '').toUpperCase();
    if (s === 'SUCCESS' || s === 'CONNECTED' || s === 'INFO') return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
    if (s === 'LIVE') return 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20 animate-pulse';
    if (s === 'FAILED' || s === 'ERROR') return 'bg-red-500/10 text-red-400 border-red-500/20';
    if (s === 'WARN' || s === 'WARNING') return 'bg-amber-500/10 text-amber-400 border-amber-500/20';
    return isDark ? 'bg-slate-800/50 text-slate-400 border-white/5' : 'bg-slate-100/50 text-slate-500 border-black/5';
  };

  const handleDownload = () => {
    const content = filteredLogs.map(l => `[${l.time}] [${l.status}] ${l.message} — ${l.ip}`).join('\n');
    const blob = new Blob([content], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `wg-fux-logs-${activeTab}-${new Date().toISOString().split('T')[0]}.log`;
    a.click();
  };

  const tabs = [
    { id: 'access',   label: 'Accès Peers',    icon: Globe },
    { id: 'security', label: 'Sécurité',        icon: Shield },
    { id: 'system',   label: 'Journal Système', icon: Server },
  ];

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-5 duration-700">
      {/* Header */}
      <div className={cn("flex flex-col lg:flex-row justify-between items-start lg:items-center backdrop-blur-3xl p-6 md:p-8 rounded-[2rem] border shadow-2xl gap-6 transition-all", isDark ? "bg-slate-900/40 border-white/5" : "bg-white/80 border-black/5")}>
        <div className="flex items-center gap-4 md:gap-6">
          <div className={cn("p-3 md:p-4 rounded-2xl shadow-2xl flex-shrink-0 transition-colors", isDark ? "bg-white/5" : "bg-black/5", `text-${theme}-400`)}>
            <Terminal size={28} />
          </div>
          <div>
            <h2 className={cn("text-2xl md:text-3xl font-black tracking-tighter italic uppercase transition-colors", isDark ? "text-white" : "text-slate-900")}>Blackbox Protocol</h2>
            <p className="text-slate-500 text-[10px] font-black tracking-[0.3em] uppercase opacity-60">System Event History</p>
          </div>
        </div>
        <div className="flex items-center gap-3 w-full sm:w-auto">
          <div className="relative group flex-1 sm:flex-none">
            <Search className={cn("absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 transition-colors", isDark ? "group-focus-within:text-white" : "group-focus-within:text-slate-900")} size={16} />
            <input
              type="text"
              placeholder="Filtrer..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className={cn("pl-10 pr-4 py-3 border rounded-xl focus:outline-none focus:border-indigo-500/50 font-mono transition-all text-sm w-full sm:w-56", isDark ? "bg-white/5 border-white/5 text-white placeholder:text-slate-700" : "bg-white border-black/5 text-slate-900 placeholder:text-slate-400")}
            />
            {searchTerm && (
              <button onClick={() => setSearchTerm('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white">
                <X size={14} />
              </button>
            )}
          </div>
          <button onClick={fetchLogs} className={cn("p-3 border rounded-xl transition-all flex-shrink-0", isDark ? "bg-white/5 border-white/5 text-slate-400 hover:text-white hover:bg-white/10" : "bg-white border-black/5 text-slate-500 hover:text-slate-900 hover:bg-black/5")} title="Rafraîchir">
            <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 flex-wrap">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              'flex items-center gap-2 px-5 py-2.5 rounded-2xl font-black uppercase text-[10px] tracking-widest transition-all',
              activeTab === tab.id
                ? `bg-${theme}-600 text-white shadow-lg shadow-${theme}-600/20`
                : cn("transition-all border", isDark ? "text-slate-500 hover:text-white hover:bg-white/5 border-white/5" : "text-slate-500 hover:text-slate-900 hover:bg-white border-black/5 shadow-sm")
            )}
          >
            <tab.icon size={14} /> {tab.label}
            {activeTab === tab.id && tab.id === 'security' && wsRef.current?.readyState === 1 && (
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            )}
          </button>
        ))}
      </div>

      {/* System tab notice */}
      {activeTab === 'system' && (
        <div className="flex items-center gap-3 p-4 bg-amber-500/5 border border-amber-500/10 rounded-2xl">
          <Cpu size={16} className="text-amber-400 flex-shrink-0" />
          <p className="text-[10px] font-bold text-amber-400/80 uppercase tracking-widest">
            Logs des conteneurs Docker — wg-fux-api · wg-fux-dashboard · wg-sentinel-proxy
          </p>
        </div>
      )}

      {/* Table */}
      <div className={cn("backdrop-blur-3xl rounded-[2rem] border overflow-hidden shadow-2xl transition-all", isDark ? "bg-slate-900/40 border-white/5" : "bg-white border-black/5")}>
        <div className="overflow-x-auto overflow-y-auto max-h-[calc(100vh-420px)] custom-scrollbar">
          <table className="w-full text-left min-w-[600px]">
            <thead className={cn("sticky top-0 z-10 backdrop-blur-xl transition-colors", isDark ? "bg-slate-950/80" : "bg-slate-50/80")}>
              <tr className={cn("text-[10px] font-black uppercase tracking-widest border-b transition-colors", isDark ? "text-slate-500 border-white/5" : "text-slate-400 border-black/5")}>
                <th className="px-6 py-5">Timestamp</th>
                <th className="px-6 py-5">Événement</th>
                <th className="px-6 py-5 hidden sm:table-cell">Source</th>
                <th className="px-6 py-5">Statut</th>
              </tr>
            </thead>
            <tbody className={cn("divide-y font-mono transition-colors", isDark ? "divide-white/5" : "divide-black/5")}>
              {loading && logs.length === 0 ? (
                <tr><td colSpan="4" className="text-center py-20 text-slate-500 italic opacity-40">Scanning archives...</td></tr>
              ) : filteredLogs.length === 0 ? (
                <tr><td colSpan="4" className="text-center py-20 text-slate-500 italic opacity-40">Aucun enregistrement détecté</td></tr>
              ) : (
                filteredLogs.map((log) => (
                  <tr key={log.id} className={cn("group transition-colors", isDark ? "hover:bg-white/5" : "hover:bg-slate-50")}>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <Clock size={12} className="text-slate-600 shrink-0" />
                        <span className={cn("text-[10px] transition-colors", isDark ? "text-slate-400 group-hover:text-white" : "text-slate-500 group-hover:text-slate-900")}>
                          {new Date(log.time).toLocaleString('fr-FR', { 
                            day: '2-digit', month: '2-digit', 
                            hour: '2-digit', minute: '2-digit', second: '2-digit' 
                          })}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4 max-w-xs">
                      <div className={cn("text-xs font-bold tracking-tight truncate transition-colors", isDark ? "text-white" : "text-slate-900")}>{log.message}</div>
                    </td>
                    <td className="px-6 py-4 hidden sm:table-cell">
                      <span className="text-[10px] text-slate-500 font-mono">{log.ip}</span>
                    </td>
                    <td className="px-6 py-4">
                      <div className={cn(
                        "inline-flex items-center px-2.5 py-1 rounded-lg border text-[9px] font-black uppercase tracking-widest",
                        getStatusStyle(log.status)
                      )}>
                        {log.status}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          <div ref={bottomRef} />
        </div>

        {/* Footer */}
        <div className={cn("px-6 py-4 border-t transition-colors flex flex-wrap justify-between items-center gap-3", isDark ? "border-white/5 bg-slate-950/20" : "border-black/5 bg-slate-50")}>
          <div className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
            {filteredLogs.length} entrées · Blackbox v2.1
          </div>
          <button 
            onClick={handleDownload}
            className="flex items-center gap-2 text-[10px] font-black text-slate-400 hover:text-white uppercase tracking-widest transition-all"
          >
            <Download size={13} /> Export .log
          </button>
        </div>
      </div>
    </div>
  );
};

export default LogsSection;
