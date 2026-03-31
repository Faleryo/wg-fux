import React, { useState, useEffect } from 'react';
import { 
  FileText, Search, RefreshCw, AlertCircle, Info, CheckCircle2, 
  Terminal, Shield, Globe, Clock, Download 
} from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';
import { cn } from '../../lib/utils';
import { axiosInstance as axios, getWsUri } from '../../lib/api';
import { useWebSocket } from '../../lib/useWebSocket';

const LogsSection = () => {
  const { theme } = useTheme();
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeTab, setActiveTab] = useState('access');

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const endpoint = activeTab === 'access' ? '/api/logs' : '/api/system/security-logs';
      const res = await axios.get(endpoint, {
        headers: { 'X-Api-Token': localStorage.getItem('wg-api-token') || sessionStorage.getItem('wg-api-token') }
      });
      setLogs(res.data);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    fetchLogs();
  }, [activeTab]);

  // WebSocket for Live Streaming
  const wsUrl = activeTab === 'access' ? getWsUri('logs-api') : getWsUri('logs-wg');
  useWebSocket(wsUrl, {
    onMessage: (msg) => {
        if (typeof msg !== 'string') return;
        const newLog = { 
            time: new Date().toISOString(), 
            message: msg, 
            status: 'LIVE' 
        };
        setLogs(prev => [newLog, ...prev.slice(0, 100)]);
    }
  });

  const filteredLogs = logs.filter(log => 
    JSON.stringify(log).toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-5 duration-700">
      <div className="flex flex-col md:flex-row justify-between items-center bg-slate-900/40 backdrop-blur-3xl p-8 rounded-[2.5rem] border border-white/5 shadow-2xl gap-6">
        <div className="flex items-center gap-6">
           <div className={cn("p-4 rounded-2xl bg-white/5 shadow-2xl", `text-${theme}-400`)}>
              <Terminal size={32} />
           </div>
           <div>
             <h2 className="text-3xl font-black text-white tracking-tighter italic uppercase">Blackbox Protocol</h2>
             <p className="text-slate-500 text-[10px] font-black tracking-[0.4em] uppercase opacity-60">System Event History</p>
           </div>
        </div>
        <div className="flex items-center gap-4">
           <div className="relative group">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-white transition-colors" size={18} />
              <input
                type="text"
                placeholder="Filtrer les événements..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-12 pr-6 py-3.5 bg-white/5 border border-white/5 rounded-2xl focus:outline-none focus:border-white/10 focus:bg-white/10 text-white font-mono placeholder:text-slate-700 transition-all text-sm w-64 md:w-80"
              />
           </div>
           <button onClick={fetchLogs} className="p-3.5 bg-white/5 border border-white/5 rounded-2xl hover:bg-white/10 transition-all text-slate-400 hover:text-white">
              <RefreshCw size={20} className={loading ? 'animate-spin' : ''} />
           </button>
        </div>
      </div>

      <div className="flex gap-2">
         {[
           { id: 'access', label: 'Accès Peers', icon: Globe },
           { id: 'security', label: 'Sécurité Système', icon: Shield }
         ].map(tab => (
           <button 
             key={tab.id}
             onClick={() => setActiveTab(tab.id)}
             className={cn(
               "flex items-center gap-3 px-8 py-3 rounded-2xl font-black uppercase text-[10px] tracking-widest transition-all",
               activeTab === tab.id ? `bg-${theme}-600 text-white shadow-2xl shadow-${theme}-600/20` : "text-slate-500 hover:text-white hover:bg-white/5"
             )}
           >
             <tab.icon size={16} /> {tab.label}
           </button>
         ))}
      </div>

      <div className="bg-slate-900/40 backdrop-blur-3xl rounded-[2.5rem] border border-white/5 overflow-hidden shadow-2xl shadow-black/50">
         <div className="overflow-y-auto max-h-[calc(100vh-450px)] custom-scrollbar">
            <table className="w-full text-left">
               <thead>
                  <tr className="text-[10px] font-black text-slate-500 uppercase tracking-widest border-b border-white/5 bg-slate-950/20">
                     <th className="px-8 py-6">Timestamp</th>
                     <th className="px-8 py-6">Événement</th>
                     <th className="px-8 py-6">Statut</th>
                  </tr>
               </thead>
               <tbody className="divide-y divide-white/5 font-mono">
                  {loading && logs.length === 0 ? (
                    <tr><td colSpan="3" className="text-center py-20 text-slate-500 italic opacity-40">Scanning archives...</td></tr>
                  ) : filteredLogs.length === 0 ? (
                    <tr><td colSpan="3" className="text-center py-20 text-slate-500 italic opacity-40">Aucun enregistrement détecté</td></tr>
                  ) : (
                    filteredLogs.map((log, i) => (
                      <tr key={i} className="group hover:bg-white/5 transition-colors">
                        <td className="px-8 py-4">
                           <div className="flex items-center gap-3">
                              <Clock size={14} className="text-slate-600" />
                              <span className="text-[11px] text-slate-400 group-hover:text-white transition-colors">{new Date(log.time || log.date).toLocaleString()}</span>
                           </div>
                        </td>
                        <td className="px-8 py-4">
                           <div className="flex flex-col gap-1 max-w-xl">
                              <div className="text-sm font-bold text-white tracking-tight uppercase">{log.message || `${log.username} a tenté une connexion`}</div>
                              <div className="text-[9px] text-slate-500 truncate">{log.ip || 'Terminal interne'}</div>
                           </div>
                        </td>
                        <td className="px-8 py-4">
                           <div className={cn(
                             "inline-flex items-center gap-2 px-3 py-1 rounded-lg border text-[9px] font-black uppercase tracking-widest leading-loose",
                             (log.status === 'SUCCESS' || log.status === 'CONNECTED') ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" : "bg-red-500/10 text-red-500 border-red-500/20"
                           )}>
                              {log.status || 'LOGGED'}
                           </div>
                        </td>
                      </tr>
                    ))
                  )}
               </tbody>
            </table>
         </div>
         {/* Footer Statistics */}
         <div className="p-8 border-t border-white/5 bg-slate-950/20 flex justify-between items-center">
            <div className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Registre Blackbox v2.1</div>
            <button className="flex items-center gap-2 text-[10px] font-black text-slate-400 hover:text-white uppercase tracking-widest transition-all">
               <Download size={14} /> Télécharger Archives .log
            </button>
         </div>
      </div>
    </div>
  );
};

export default LogsSection;
