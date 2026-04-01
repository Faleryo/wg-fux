import React, { useState, useEffect } from 'react';
import { 
  Activity, Database, ArrowDown, ArrowUp, Edit, Pause, Play, QrCode, Trash2, 
  ChevronRight, List, Info, RefreshCw
} from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { motion, AnimatePresence } from 'framer-motion';
import { useTheme } from '../../context/ThemeContext';
import { cn, formatBytes } from '../../lib/utils';
import { axiosInstance } from '../../lib/api';

const ClientDetail = ({ client, onBack, onToggle, onDelete, onQRCode, onEdit }) => {
  const { theme } = useTheme();
  const [history, setHistory] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [trafficHistory60, setTrafficHistory60] = useState([]);
  const [history72h, setHistory72h] = useState([]);
  const [viewMode, setViewMode] = useState('realtime');

  // Real-time traffic simulation/buffer
  useEffect(() => {
    if (trafficHistory60.length === 0) {
      const initial = Array.from({ length: 60 }, (_, i) => ({
        time: new Date(Date.now() - (60 - i) * 5000).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        download: 0, upload: 0
      }));
      setTrafficHistory60(initial);
    }
    const now = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setTrafficHistory60(prev => [...prev.slice(1), { 
        time: now, 
        download: client.downloadRate || 0, 
        upload: client.uploadRate || 0 
    }]);
  }, [client]);

  // Load connection history
  useEffect(() => {
    setLoadingHistory(true);
    axiosInstance.get(`/clients/${client.container}/${client.name}/history`)
      .then(res => setHistory(res.data))
      .catch(console.error)
      .finally(() => setLoadingHistory(false));
  }, [client.id]);

  // Load 72h history
  useEffect(() => {
    if (viewMode === 'history') {
      axiosInstance.get(`/clients/${client.container}/${client.name}/history-hours`)
        .then(res => {
          const data = res.data.map((h, i) => {
            const prev = res.data[i - 1] || h;
            const rxDiff = Math.max(0, h.rx - prev.rx);
            const txDiff = Math.max(0, h.tx - prev.tx);
            return {
              time: new Date(h.time).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit' }),
              download: rxDiff,
              upload: txDiff
            };
          });
          setHistory72h(data);
        })
        .catch(() => { });
    }
  }, [viewMode, client.id]);

  const lastActivity = client.lastHandshake 
    ? new Date(client.lastHandshake * 1000).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) 
    : 'Jamais';

  return (
    <motion.div 
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="space-y-8"
    >
      <button 
        onClick={onBack} 
        className="group flex items-center gap-3 text-slate-500 hover:text-white transition-all bg-white/5 px-6 py-2 rounded-2xl border border-white/5 hover:border-white/20"
      >
        <ChevronRight className="rotate-180 transform transition-transform group-hover:-translate-x-1" size={20} /> 
        <span className="font-black text-xs uppercase tracking-widest text-slate-400 group-hover:text-white">Retour Tactique</span>
      </button>

      {/* Hero Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Daily quota", value: formatBytes(client.usageDaily || 0), icon: Activity, color: "emerald" },
          { label: "Data Total", value: formatBytes(client.usageTotal || 0), icon: Database, color: "indigo" },
          { label: "Burst DL", value: formatBytes(client.downloadBytes), icon: ArrowDown, color: "cyan" },
          { label: "Burst UL", value: formatBytes(client.uploadBytes), icon: ArrowUp, color: "rose" }
        ].map((stat, i) => (
          <div key={i} className="bg-slate-950/40 backdrop-blur-3xl p-6 rounded-3xl border border-white/5 flex items-center gap-5 group hover:border-white/10 transition-all">
            <div className={cn(`p-4 rounded-2xl shadow-2xl`, `bg-${stat.color}-500/10 text-${stat.color}-400`)}>
              <stat.icon size={24} />
            </div>
            <div>
              <div className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">{stat.label}</div>
              <div className="text-xl font-mono font-black text-white tracking-tighter">{stat.value}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Main Identity Card */}
      <div className="relative overflow-hidden bg-slate-900/40 backdrop-blur-3xl rounded-[2.5rem] border border-white/10 p-8 group shadow-2xl">
        <div className="absolute top-0 right-0 p-12 opacity-[0.03] group-hover:opacity-10 transition-opacity duration-1000 rotate-12 scale-150">
          <Database size={200} />
        </div>
        
        <div className="relative z-10 flex flex-col md:flex-row justify-between items-start md:items-center gap-10">
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <div className={cn("p-4 rounded-[1.5rem] shadow-2xl", `bg-${theme}-600 text-white shadow-${theme}-600/30`)}>
                <Info size={32} />
              </div>
              <div>
                <h2 className="text-4xl font-black text-white tracking-widest uppercase mb-1">{client.name}</h2>
                <div className="flex items-center gap-3">
                   <span className={cn("text-sm font-mono font-bold", `text-${theme}-400`)}>{client.ip}</span>
                   <span className="w-1 h-1 bg-slate-700 rounded-full"></span>
                   <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{client.container}</span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 bg-white/5 py-1.5 px-4 rounded-xl border border-white/5 w-fit">
              <div className={cn("h-1.5 w-1.5 rounded-full animate-pulse", client.enabled ? "bg-emerald-500 shadow-[0_0_8px_#10b981]" : "bg-slate-600")}></div>
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Dernière activité: {lastActivity}</span>
            </div>
          </div>

          <div className="flex flex-wrap gap-4">
            {[
              { icon: Edit, label: "Modifier", color: "indigo", onClick: () => onEdit(client) },
              { icon: client.enabled ? Pause : Play, label: client.enabled ? "Désactiver" : "Activer", color: "amber", onClick: () => onToggle(client.container, client.name, !client.enabled) },
              { icon: QrCode, label: "QR Code", color: theme, onClick: () => onQRCode(client.name, client.config) },
              { icon: Trash2, label: "Supprimer", color: "rose", onClick: () => onDelete(client) }
            ].map((btn, i) => (
              <button 
                key={i}
                onClick={btn.onClick}
                className={cn(
                  "p-5 rounded-2xl transition-all duration-300 hover:scale-110 active:scale-95 shadow-xl border border-white/5",
                  `bg-${btn.color}-500/10 text-${btn.color}-400 hover:bg-${btn.color}-500/20 hover:border-${btn.color}-500/20 shadow-${btn.color}-500/5`
                )}
                title={btn.label}
              >
                <btn.icon size={24} />
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
        {/* Traffic Area */}
        <div className="xl:col-span-2 bg-slate-950/40 backdrop-blur-3xl border border-white/5 rounded-[2rem] p-8 shadow-2xl">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-6 mb-10">
            <h3 className="text-xl font-black text-white flex items-center gap-4 uppercase tracking-tighter">
              <Activity size={24} className={cn(`text-${theme}-400`)} /> Spectre Réseau
            </h3>
            <div className="flex bg-slate-900/60 p-2 rounded-2xl border border-white/5 shadow-inner">
               {[
                 { id: 'realtime', label: 'Temps réel' },
                 { id: 'history', label: '72 Heures' }
               ].map(opt => (
                 <button
                  key={opt.id}
                  onClick={() => setViewMode(opt.id)}
                  className={cn(
                    "px-6 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all duration-500",
                    viewMode === opt.id ? `bg-${theme}-600 text-white shadow-2xl` : "text-slate-500 hover:text-white"
                  )}
                 >
                   {opt.label}
                 </button>
               ))}
            </div>
          </div>
          <div className="h-80 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={viewMode === 'realtime' ? trafficHistory60 : history72h}>
                <defs>
                  <linearGradient id="colorRxDet" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="colorTxDet" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                <XAxis dataKey="time" stroke="#475569" fontSize={10} tickLine={false} axisLine={false} fontFamily="monospace" minTickGap={40} />
                <YAxis stroke="#475569" fontSize={10} tickLine={false} axisLine={false} fontFamily="monospace" tickFormatter={(val) => formatBytes(val)} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#020617', border: '1px solid #1e293b', borderRadius: '1.5rem', boxShadow: '0 20px 50px rgba(0,0,0,0.5)' }}
                  itemStyle={{ fontFamily: 'monospace', fontSize: '11px', fontWeight: 'bold' }}
                  labelStyle={{ marginBottom: '8px', opacity: 0.5 }}
                  formatter={(value) => [formatBytes(value) + (viewMode === 'realtime' ? '/s' : ''), '']}
                />
                <Area type="monotone" dataKey="download" name="Download" stroke="#10b981" strokeWidth={4} fillOpacity={1} fill="url(#colorRxDet)" isAnimationActive={false} />
                <Area type="monotone" dataKey="upload" name="Upload" stroke="#6366f1" strokeWidth={4} fillOpacity={1} fill="url(#colorTxDet)" isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Tactical History */}
        <div className="bg-slate-950/40 backdrop-blur-3xl border border-white/5 rounded-[2rem] p-8 shadow-2xl flex flex-col">
          <h3 className="text-xl font-black text-white mb-8 flex items-center gap-4 uppercase tracking-tighter">
            <List size={24} className={cn(`text-${theme}-400`)} /> Blackbox Log
          </h3>
          <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar space-y-4">
             {loadingHistory ? (
                <div className="flex flex-col items-center justify-center py-20 gap-4 opacity-40">
                   <RefreshCw className="animate-spin text-slate-500" size={32} />
                   <span className="text-[10px] font-black uppercase tracking-widest">Scanning logs...</span>
                </div>
             ) : history.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 gap-4 opacity-40">
                   <Info className="text-slate-500" size={32} />
                   <span className="text-[10px] font-black uppercase tracking-widest">No logs found</span>
                </div>
             ) : (
                history.map((entry, i) => (
                  <div key={i} className="bg-white/5 p-4 rounded-2xl border border-white/5 hover:border-white/10 hover:bg-white/10 transition-all group">
                     <div className="flex justify-between items-start mb-2">
                        <span className="text-[10px] font-mono font-bold text-slate-400 group-hover:text-white transition-colors">{new Date(entry.time).toLocaleString()}</span>
                        <span className={cn(
                          "px-2 py-0.5 rounded-lg text-[8px] font-black tracking-widest uppercase border",
                          entry.status === 'CONNECTED' ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" : "bg-slate-800 text-slate-500 border-white/10"
                        )}>
                          {entry.status}
                        </span>
                     </div>
                     <div className="grid grid-cols-2 gap-4 mt-4">
                        <div className="space-y-1">
                           <div className="text-[8px] font-black text-slate-500 uppercase">Traffic Daily</div>
                           <div className="text-xs font-mono font-bold text-emerald-500">{formatBytes(entry.usageDaily)}</div>
                        </div>
                        <div className="space-y-1">
                           <div className="text-[8px] font-black text-slate-500 uppercase">Traffic Total</div>
                           <div className="text-xs font-mono font-bold text-indigo-400">{formatBytes(entry.usageTotal)}</div>
                        </div>
                     </div>
                  </div>
                ))
             )}
          </div>
        </div>
      </div>
    </motion.div>
  );
};

export default ClientDetail;
