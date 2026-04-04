import React, { useState, useEffect } from 'react';
import { 
  Activity, Gauge, Gamepad2, Film, RefreshCw, Clock, 
  Trash2, ShieldCheck, Zap, Cpu, BarChart3, TrendingUp
} from 'lucide-react';
import { useTheme } from '../../../context/ThemeContext';
import { useToast } from '../../../context/ToastContext';
import { cn } from '../../../lib/utils';
import { axiosInstance } from '../../../lib/api';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { motion, AnimatePresence } from 'framer-motion';

const OptimizationSection = ({ systemStats }) => {
  const { theme, isDark } = useTheme();
  const { addToast } = useToast();
  const [loading, setLoading] = useState(false);
  const [currentProfile, setCurrentProfile] = useState('');
  const [cpuHistory, setCpuHistory] = useState([]);
  const [isEnabled, setIsEnabled] = useState(false);
  const [telemetry, setTelemetry] = useState({ jitter: '...', mtu: '...', bufferbloat: '...' });

  useEffect(() => {
    fetchActiveProfile();
    
    // Télémétrie — polling 5s (réduit de 1Hz pour éviter la surcharge VPS en production)
    const telInterval = setInterval(fetchTelemetry, 5000);
    fetchTelemetry(); // Premier fetch immédiat
    return () => clearInterval(telInterval);
  }, []);

  const fetchActiveProfile = async () => {
    try {
      const res = await axiosInstance.get('/system/optimize');
      const profile = res.data.profile;
      setCurrentProfile(profile);
      // SRE Logic: Only enable toggle if a real optimization is active
      setIsEnabled(profile !== 'default' && profile !== 'restore' && profile !== 'disable');
    } catch { /* Default to none */ }
  };

  const fetchTelemetry = async () => {
    try {
      const res = await axiosInstance.get('/system/telemetry');
      setTelemetry(res.data);
      // Synchronisation du graphe avec la télémétrie (fluidité accrue)
      const now = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      setCpuHistory(prev => [...prev.slice(-29), { time: now, value: parseFloat(res.data.cpu) || 0 }]);
    } catch { /* Fail silently */ }
  };

  const handleToggleSync = async () => {
    const nextState = !isEnabled;
    setIsEnabled(nextState);
    setLoading(true);
    try {
      const targetProfile = nextState ? (currentProfile || 'gaming') : 'restore';
      await axiosInstance.post('/system/optimize', { profile: targetProfile });
      if (!nextState) setCurrentProfile('restore');
      addToast(nextState ? `Optimisation réactivée (${targetProfile})` : 'Optimisations système désactivées (Tunnel préservé)', 'success');
    } catch { 
      setIsEnabled(!nextState);
      addToast('Échec du basculement SRE', 'error'); 
    } finally { setLoading(false); }
  };

  const handleOptimize = async (profile) => {
    if (!isEnabled) return;
    setLoading(true);
    try {
      await axiosInstance.post('/system/optimize', { profile });
      setCurrentProfile(profile);
      addToast(`Profil ${profile.toUpperCase()} activé avec succès`, 'success');
    } catch (e) { addToast('Échec de la synchronisation neurale', 'error'); }
    finally { setLoading(false); }
  };

  const profiles = [
    { id: 'gaming', label: 'E-Sport / Gaming', desc: 'Latency Zero. BBR v2 + CAKE + UDP Buffer Tuning.', icon: Gamepad2, color: 'indigo' },
    { id: 'streaming', label: 'Ultra-HD Stream', desc: 'Throughput maximal. Optimisation BBR & MTU 1280.', icon: Film, color: 'rose' },
    { id: 'auto', label: 'Smart Engine', desc: 'Analyse heuristique & ajustement dynamique du MTU.', icon: Gauge, color: 'emerald' }
  ];

  return (
    <div className="space-y-10 animate-in fade-in slide-in-from-bottom-5 duration-700">
      <div className={cn("flex flex-col lg:flex-row justify-between items-center p-8 rounded-[3rem] border shadow-2xl gap-8 transition-all", isDark ? "bg-slate-900/40 border-white/5 backdrop-blur-3xl" : "bg-white border-black/5")}>
        <div className="flex items-center gap-6">
           <div className={cn("p-5 rounded-[2rem] border shadow-2xl transition-all", isDark ? "bg-indigo-600/20 text-indigo-400 border-indigo-500/20" : "bg-indigo-50 text-indigo-600 border-indigo-100")}>
              <Zap size={36} className={cn(isEnabled && "animate-pulse")} />
           </div>
           <div>
             <h2 className={cn("text-4xl font-black tracking-tighter italic uppercase transition-colors", isDark ? "text-white" : "text-slate-900")}>Neural Optimizer</h2>
             <p className="text-slate-500 text-[10px] font-black tracking-[0.4em] uppercase opacity-60">Advanced Flow Shaping & Latency Control</p>
           </div>
        </div>
        <div className="flex items-center gap-4">
           <label className={cn("flex items-center gap-4 p-4 rounded-2xl border cursor-pointer group transition-all", isDark ? "bg-slate-950/60 border-white/5 backdrop-blur-3xl" : "bg-slate-50 border-black/5 shadow-sm")}>
              <span className={cn("text-[10px] font-black uppercase tracking-widest transition-colors", isDark ? "text-slate-500 group-hover:text-white" : "text-slate-400 group-hover:text-slate-900")}>Système Optimisé</span>
              <div onClick={handleToggleSync} className={cn(
                "w-12 h-6 rounded-full transition-all relative border shadow-inner",
                isEnabled ? "bg-emerald-600 border-emerald-500/20" : (isDark ? "bg-slate-900 border-white/10" : "bg-slate-100 border-slate-200")
              )}>
                 <div className={cn("absolute top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-white shadow-2xl transition-all", isEnabled ? "left-[calc(100%-1.25rem)]" : "left-1")} />
              </div>
           </label>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
         <div className="xl:col-span-2 space-y-8">
            <div className={cn("rounded-[3rem] border p-8 shadow-2xl h-80 relative overflow-hidden group transition-all", isDark ? "bg-slate-900/40 border-white/10 backdrop-blur-3xl" : "bg-white border-black/5", !isEnabled && "opacity-40 grayscale")}>
               <div className="flex justify-between items-center mb-8">
                  <h3 className={cn("text-lg font-black uppercase tracking-tighter flex items-center gap-3 transition-colors", isDark ? "text-white" : "text-slate-900")}>
                     <BarChart3 className={cn(`text-indigo-400`)} /> Kernel Load Variance
                  </h3>
                  <div className="flex items-center gap-2">
                     <div className={cn("w-1.5 h-1.5 rounded-full border", isEnabled ? "bg-emerald-500 animate-pulse border-emerald-400" : "bg-slate-500 border-slate-400")} />
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
                      <CartesianGrid strokeDasharray="3 3" stroke={isDark ? "#1e293b" : "#e2e8f0"} vertical={false} />
                      <XAxis dataKey="time" hide />
                      <YAxis hide domain={[0, 100]} />
                      <Tooltip 
                        contentStyle={isDark 
                          ? { backgroundColor: '#020617', border: '1px solid #1e293b', borderRadius: '1rem shadow-2xl' }
                          : { backgroundColor: '#fff', border: '1px solid #e2e8f0', borderRadius: '1rem', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }
                        }
                        itemStyle={{ color: isDark ? '#fff' : '#0f172a', fontSize: '12px', fontFamily: 'monospace' }}
                      />
                      <Area type="monotone" dataKey="value" stroke={theme === 'rose' ? '#fb7185' : '#818cf8'} strokeWidth={4} fillOpacity={1} fill="url(#colorCpu)" isAnimationActive={false} />
                    </AreaChart>
                  </ResponsiveContainer>
               </div>
            </div>

            <div className={cn("grid grid-cols-1 md:grid-cols-3 gap-6 transition-all", !isEnabled && "opacity-40 pointer-events-none")}>
               {profiles.map(profile => (
                 <div key={profile.id} className={cn(
                    "relative overflow-hidden rounded-[2.5rem] border p-8 group transition-all duration-500",
                    isDark ? "bg-slate-900/40 backdrop-blur-3xl" : "bg-white border-black/5 shadow-sm",
                    currentProfile === profile.id 
                      ? `border-${profile.color}-500/50 shadow-2xl shadow-${profile.color}-500/20 bg-${profile.color}-500/5` 
                      : (isDark ? "border-white/5 hover:border-white/10" : "border-black/5 hover:border-indigo-500/20")
                  )}>
                    {currentProfile === profile.id && (
                       <div className={cn("absolute top-6 right-6 px-3 py-1 rounded-full border text-[8px] font-black uppercase tracking-[0.2em] animate-pulse", `bg-${profile.color}-500/20 text-${profile.color}-400 border-${profile.color}-500/30`)}>
                          Vecteur Actif
                       </div>
                    )}
                    <div className={cn(
                      "absolute -right-6 -top-6 p-4 opacity-[0.03] group-hover:opacity-10 transition-opacity duration-700 -rotate-12 pointer-events-none",
                      `text-${profile.color}-500`
                    )}>
                       <profile.icon size={120} />
                    </div>
                    <div className={cn("p-4 rounded-2xl mb-6 w-fit transition-transform group-hover:scale-110", isDark ? "bg-white/5" : "bg-black/5", `text-${profile.color}-400`)}>
                       <profile.icon size={24} />
                    </div>
                    <h4 className={cn("text-xl font-black uppercase tracking-tight mb-2 italic transition-colors", isDark ? "text-white" : "text-slate-900")}>{profile.label}</h4>
                    <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest leading-loose mb-8 h-10">{profile.desc}</p>
                    <button 
                      onClick={() => handleOptimize(profile.id)}
                       disabled={loading}
                       className={cn(
                         "w-full py-4 rounded-2xl font-black uppercase text-[10px] tracking-widest transition-all shadow-2xl active:scale-95 disabled:opacity-30",
                         currentProfile === profile.id ? `bg-${profile.color}-600 text-white shadow-${profile.color}-600/30` : cn(isDark ? "bg-white/5 border-white/5 text-slate-400 hover:text-white" : "bg-slate-50 border-black/5 text-slate-500 hover:text-slate-900")
                       )}
                     >
                       {currentProfile === profile.id ? 'Optimisation Active' : 'Activer Profil'}
                    </button>
                 </div>
               ))}
            </div>
         </div>

          <div className={cn("xl:col-span-1 space-y-8")}>
             <div className={cn("rounded-[3rem] border p-8 shadow-2xl relative overflow-hidden group transition-all", isDark ? "bg-slate-950/40 border-white/5 backdrop-blur-3xl" : "bg-white border-black/5 shadow-sm")}>
                 <div className="absolute top-0 right-0 p-8 opacity-10"><TrendingUp size={64} className={cn(`text-indigo-600`)} /></div>
                 <h3 className={cn("text-lg font-black uppercase mb-8 flex items-center gap-3 transition-colors", isDark ? "text-white" : "text-slate-900")}><ShieldCheck size={20} className="text-emerald-400" /> Metrics Tunnel</h3>
                <div className="space-y-6">
                    {[
                      { label: 'Jitter Buffer', val: `${telemetry.jitter}ms`, status: isEnabled ? 'Optimal' : 'Standard', icon: Activity },
                      { label: 'Bufferbloat', val: telemetry.bufferbloat || 'A+', status: isEnabled ? 'Ultra-Stable' : 'Unmanaged', icon: Zap },
                      { label: 'Tunneling MTU', val: `${telemetry.mtu}B`, status: 'Fixed', icon: Cpu }
                     ].map((m, i) => (
                       <div key={i} className={cn("flex items-center justify-between p-4 rounded-2xl border transition-colors", isDark ? "bg-white/5 border-white/5 hover:border-white/10" : "bg-slate-50 border-black/5 hover:border-indigo-500/20")}>
                          <div className="flex items-center gap-3">
                             <m.icon size={16} className="text-slate-500" />
                             <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{m.label}</div>
                          </div>
                          <div className="text-right">
                             <div className={cn("text-xs font-mono font-black transition-colors", isDark ? "text-white" : "text-slate-900")}>{m.val}</div>
                             <div className={cn("text-[8px] font-black uppercase tracking-widest", (m.status === 'Optimal' || m.status === 'Ultra-Stable' || m.status === 'Fixed') ? 'text-emerald-500' : 'text-slate-500')}>{m.status}</div>
                          </div>
                       </div>
                     ))}
                </div>
            </div>

             <div className={cn("border rounded-[3rem] p-10 shadow-2xl relative group overflow-hidden transition-all", isDark ? "bg-gradient-to-br from-indigo-900/20 to-slate-900/60 border-white/10 backdrop-blur-3xl" : "bg-white border-black/5 shadow-sm")}>
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(99,102,241,0.1),transparent_70%)] opacity-0 group-hover:opacity-100 transition-opacity duration-1000" />
                <div className="p-4 rounded-[1.5rem] bg-indigo-600 shadow-2xl shadow-indigo-600/30 text-white w-fit mb-6">
                   <RefreshCw size={24} className="hover:rotate-180 transition-transform duration-700" />
                </div>
                <h3 className={cn("text-2xl font-black tracking-widest italic uppercase mb-2 transition-colors", isDark ? "text-white" : "text-slate-900")}>Sync Neural</h3>
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
