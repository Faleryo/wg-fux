import React, { useState, useEffect } from 'react';
import { 
  Activity, Gauge, Gamepad2, Film, RefreshCw, Clock, 
  Trash2, ShieldCheck, Zap, Cpu, BarChart3, TrendingUp
} from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';
import { useToast } from '../../context/ToastContext';
import { cn } from '../../lib/utils';
import { axiosInstance } from '../../lib/api';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { motion, AnimatePresence } from 'framer-motion';

const OptimizationSection = ({ systemStats }) => {
  const { theme } = useTheme();
  const { addToast } = useToast();
  const [loading, setLoading] = useState(false);
  const [currentProfile, setCurrentProfile] = useState('auto');
  const [cpuHistory, setCpuHistory] = useState([]);
  const [isEnabled, setIsEnabled] = useState(true);

  useEffect(() => {
    const now = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setCpuHistory(prev => [...prev.slice(-29), { time: now, value: systemStats?.cpu || 0 }]);
  }, [systemStats]);

  const handleOptimize = async (profile) => {
    setLoading(true);
    try {
      await axiosInstance.post('/system/optimize', { profile });
      setCurrentProfile(profile);
      addToast(`Profil ${profile} appliqué`, 'success');
    } catch (e) { addToast('Erreur d\'optimisation', 'error'); }
    finally { setLoading(false); }
  };

  const profiles = [
    { id: 'gaming', label: 'E-Sport / VoIP', desc: 'Priorité absolue aux petits paquets. Latence minimale garantie.', icon: Gamepad2, color: 'indigo' },
    { id: 'streaming', label: 'Ultra-HD Stream', desc: 'Optimisation du débit séquentiel pour flux 4K/8K.', icon: Film, color: 'rose' },
    { id: 'auto', label: 'Smart Engine', desc: 'Analyse heuristique et ajustement dynamique du MTU.', icon: Gauge, color: 'emerald' }
  ];

  return (
    <div className="space-y-10 animate-in fade-in slide-in-from-bottom-5 duration-700">
      <div className="flex flex-col lg:flex-row justify-between items-center bg-slate-900/40 backdrop-blur-3xl p-8 rounded-[3rem] border border-white/5 shadow-2xl gap-8">
        <div className="flex items-center gap-6">
           <div className={cn("p-5 rounded-[2rem] bg-white/5 shadow-2xl", `text-${theme}-400`)}>
              <Zap size={36} />
           </div>
           <div>
             <h2 className="text-4xl font-black text-white tracking-tighter italic uppercase">Neural Optimizer</h2>
             <p className="text-slate-500 text-[10px] font-black tracking-[0.4em] uppercase opacity-60">Deep Packet Inspection & Flux Tuning</p>
           </div>
        </div>
        <div className="flex items-center gap-4">
           <label className="flex items-center gap-4 bg-slate-950/60 p-4 rounded-2xl border border-white/5 cursor-pointer group">
              <span className="text-[10px] font-black text-slate-500 group-hover:text-white uppercase tracking-widest transition-colors">Auto-Sync</span>
              <div onClick={() => setIsEnabled(!isEnabled)} className={cn(
                "w-12 h-6 rounded-full transition-all relative border border-white/10 shadow-inner",
                isEnabled ? "bg-emerald-600" : "bg-slate-900"
              )}>
                 <div className={cn("absolute top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-white shadow-2xl transition-all", isEnabled ? "left-[calc(100%-1.25rem)]" : "left-1")} />
              </div>
           </label>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
         <div className="xl:col-span-2 space-y-8">
            <div className="bg-slate-900/40 backdrop-blur-3xl rounded-[3rem] border border-white/10 p-8 shadow-2xl h-80 relative overflow-hidden group">
               <div className="flex justify-between items-center mb-8">
                  <h3 className="text-lg font-black text-white uppercase tracking-tighter flex items-center gap-3">
                     <BarChart3 className={cn(`text-${theme}-400`)} /> CPU Load Variance
                  </h3>
                  <div className="flex items-center gap-2">
                     <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse border border-emerald-400" />
                     <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest uppercase tracking-widest">Real-time Spectrum</span>
                  </div>
               </div>
               <div className="h-48 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={cpuHistory}>
                      <defs>
                        <linearGradient id="colorCpu" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={theme === 'rose' ? '#f43f5e' : '#6366f1'} stopOpacity={0.3} />
                          <stop offset="95%" stopColor={theme === 'rose' ? '#f43f5e' : '#6366f1'} stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                      <XAxis dataKey="time" hide />
                      <YAxis hide domain={[0, 100]} />
                      <Tooltip 
                        contentStyle={{ backgroundColor: '#020617', border: '1px solid #1e293b', borderRadius: '1rem shadow-2xl' }}
                        itemStyle={{ color: '#fff', fontSize: '12px', fontFamily: 'monospace' }}
                      />
                      <Area type="monotone" dataKey="value" stroke={theme === 'rose' ? '#fb7185' : '#818cf8'} strokeWidth={4} fillOpacity={1} fill="url(#colorCpu)" isAnimationActive={false} />
                    </AreaChart>
                  </ResponsiveContainer>
               </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
               {profiles.map(profile => (
                 <div key={profile.id} className={cn(
                   "relative overflow-hidden bg-slate-900/40 backdrop-blur-3xl rounded-[2.5rem] border p-8 group transition-all duration-500",
                   currentProfile === profile.id ? `border-${profile.color}-500/50 shadow-2xl shadow-${profile.color}-500/10` : "border-white/5 hover:border-white/10"
                 )}>
                    <div className={cn(
                      "absolute -right-6 -top-6 p-4 opacity-[0.03] group-hover:opacity-10 transition-opacity duration-700 -rotate-12 pointer-events-none",
                      `text-${profile.color}-500`
                    )}>
                       <profile.icon size={120} />
                    </div>
                    <div className={cn("p-4 rounded-2xl bg-white/5 mb-6 w-fit transition-transform group-hover:scale-110", `text-${profile.color}-400`)}>
                       <profile.icon size={24} />
                    </div>
                    <h4 className="text-xl font-black text-white uppercase tracking-tight mb-2 italic">{profile.label}</h4>
                    <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest leading-loose mb-8 h-10">{profile.desc}</p>
                    <button 
                      onClick={() => handleOptimize(profile.id)}
                      disabled={loading}
                      className={cn(
                        "w-full py-4 rounded-2xl font-black uppercase text-[10px] tracking-widest transition-all shadow-2xl active:scale-95 disabled:opacity-30",
                        currentProfile === profile.id ? `bg-${profile.color}-600 text-white shadow-${profile.color}-600/30` : "bg-white/5 text-slate-400 hover:text-white border border-white/5"
                      )}
                    >
                       {currentProfile === profile.id ? 'Vecteur Actif' : 'Activer Profil'}
                    </button>
                 </div>
               ))}
            </div>
         </div>

         <div className="xl:col-span-1 space-y-8">
            <div className="bg-slate-950/40 backdrop-blur-3xl rounded-[3rem] border border-white/5 p-8 shadow-2xl relative overflow-hidden group">
                <div className="absolute top-0 right-0 p-8 opacity-10"><TrendingUp size={64} className={cn(`text-${theme}-600`)} /></div>
                <h3 className="text-lg font-black text-white uppercase mb-8 flex items-center gap-3"><ShieldCheck size={20} className="text-emerald-400" /> Metrics Tunnel</h3>
                <div className="space-y-6">
                   {[
                     { label: 'Jitter Buffer', val: '2.4ms', status: 'Optimal', icon: Activity },
                     { label: 'Bufferbloat', val: 'A+', status: 'Safe', icon: Zap },
                     { label: 'Tunneling MTU', val: '1420B', status: 'Stable', icon: Cpu }
                   ].map((m, i) => (
                     <div key={i} className="flex items-center justify-between p-4 bg-white/5 rounded-2xl border border-white/5 hover:border-white/10 transition-colors">
                        <div className="flex items-center gap-3">
                           <m.icon size={16} className="text-slate-500" />
                           <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{m.label}</div>
                        </div>
                        <div className="text-right">
                           <div className="text-xs font-mono font-black text-white">{m.val}</div>
                           <div className="text-[8px] font-black text-emerald-500 uppercase tracking-widest">{m.status}</div>
                        </div>
                     </div>
                   ))}
                </div>
            </div>

            <div className="bg-gradient-to-br from-indigo-900/20 to-slate-900/60 backdrop-blur-3xl border border-white/10 rounded-[3rem] p-10 shadow-2xl relative group overflow-hidden">
               <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(99,102,241,0.1),transparent_70%)] opacity-0 group-hover:opacity-100 transition-opacity duration-1000" />
               <div className="p-4 rounded-[1.5rem] bg-indigo-600 shadow-2xl shadow-indigo-600/30 text-white w-fit mb-6">
                  <RefreshCw size={24} className="hover:rotate-180 transition-transform duration-700" />
               </div>
               <h3 className="text-2xl font-black text-white tracking-widest italic uppercase mb-2">Sync Neural</h3>
               <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest leading-loose mb-8">Maintenance heuristique du noyau système active. Surveillance en temps réel des fuites mémoires.</p>
               <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
                  <div className="h-full w-full bg-gradient-to-r from-emerald-500 via-indigo-500 to-emerald-500 animate-[loading_4s_linear_infinite]" style={{ backgroundSize: '200% 100%' }} />
               </div>
            </div>
         </div>
      </div>
    </div>
  );
};

export default OptimizationSection;
