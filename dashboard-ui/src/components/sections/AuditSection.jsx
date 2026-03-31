import React, { useState, useEffect } from 'react';
import { 
  ShieldCheck, RefreshCw, CheckCircle2, AlertTriangle, 
  X, HardDrive, Shield, Activity, Lock, Cpu, Globe 
} from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';
import { cn } from '../../lib/utils';
import axios from 'axios';
import { motion, AnimatePresence } from 'framer-motion';

const AuditSection = () => {
  const { theme } = useTheme();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchAudit = () => {
    setLoading(true);
    axios.get('/api/system/audit', {
      headers: { 'X-Api-Token': localStorage.getItem('wg-api-token') || sessionStorage.getItem('wg-api-token') }
    }).then(res => {
      setData(res.data);
      setLoading(false);
    }).catch(() => setLoading(false));
  };

  useEffect(() => {
    fetchAudit();
  }, []);

  const securityScore = data ? (
    (data.firewall ? 33 : 0) + 
    (data.ipForwarding ? 33 : 0) + 
    (data.fail2ban ? 34 : 0)
  ) : 0;

  return (
    <div className="space-y-10 animate-in fade-in slide-in-from-bottom-5 duration-700">
      {/* Header */}
      <div className="flex flex-col lg:flex-row justify-between items-center bg-slate-900/40 backdrop-blur-3xl p-8 rounded-[3rem] border border-white/5 shadow-2xl gap-8">
        <div className="flex items-center gap-6">
           <div className={cn("p-5 rounded-[2rem] bg-white/5 shadow-2xl", `text-${theme}-400`)}>
              <ShieldCheck size={36} />
           </div>
           <div>
             <h2 className="text-4xl font-black text-white tracking-tighter italic uppercase">Audit de Sécurité</h2>
             <p className="text-slate-500 text-[10px] font-black tracking-[0.4em] uppercase opacity-60">System Security Analysis Protocol</p>
           </div>
        </div>
        <button 
          onClick={fetchAudit} 
          className="p-5 bg-white/5 border border-white/5 rounded-[2rem] hover:bg-white/10 transition-all text-slate-400 hover:text-white group"
        >
          <RefreshCw size={24} className={loading ? 'animate-spin' : 'group-hover:rotate-180 transition-transform duration-700'} />
        </button>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
         {/* Main Score Board */}
         <div className="xl:col-span-1 bg-slate-900/40 backdrop-blur-3xl rounded-[3rem] border border-white/10 p-10 shadow-2xl relative overflow-hidden flex flex-col items-center justify-center text-center">
            <div className="relative w-48 h-48 mb-8 flex items-center justify-center">
              <svg className="w-full h-full transform -rotate-90">
                <circle cx="96" cy="96" r="80" stroke="currentColor" strokeWidth="12" fill="transparent" className="text-slate-800/50" />
                <motion.circle 
                  cx="96" cy="96" r="80" stroke="currentColor" strokeWidth="12" fill="transparent"
                  initial={{ strokeDashoffset: 502 }}
                  animate={{ strokeDashoffset: 502 - (securityScore / 100) * 502 }}
                  transition={{ duration: 2, ease: "easeOut" }}
                  className={cn("transition-all duration-500 shadow-2xl shadow-emerald-500/20", securityScore > 80 ? "text-emerald-500" : "text-amber-500")}
                  strokeDasharray="502"
                  strokeLinecap="round"
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                 <span className="text-6xl font-black text-white italic">{securityScore}%</span>
                 <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest mt-2">{securityScore > 80 ? 'Safe' : 'Watch'}</span>
              </div>
            </div>
            <h3 className="text-lg font-black text-white uppercase tracking-tighter italic">Indice d'Intégrité</h3>
            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mt-4 leading-loose">Calcul basé sur l'état du noyau, du firewall et des protections logicielles.</p>
         </div>

         {/* Detailed Checks */}
         <div className="xl:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="bg-slate-900/40 backdrop-blur-3xl rounded-[3rem] border border-white/5 p-8 shadow-2xl relative group hover:border-white/10 transition-all flex flex-col justify-between">
               <div>
                  <div className="flex items-center justify-between mb-6">
                     <h3 className="text-sm font-black text-white uppercase tracking-widest flex items-center gap-3 italic"><Shield size={20} /> Firewall Status</h3>
                     {loading ? <RefreshCw className="animate-spin text-slate-700" size={16} /> : (
                       data?.firewall 
                         ? <div className="px-3 py-1 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[9px] font-black uppercase rounded-lg">Actif</div>
                         : <div className="px-3 py-1 bg-amber-500/10 border border-amber-500/20 text-amber-400 text-[9px] font-black uppercase rounded-lg">Critique</div>
                     )}
                  </div>
                  <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest leading-relaxed mb-8">Vérification de l'interface UFW et des règles de filtrage pré-configurées.</p>
               </div>
               <div className="flex items-center gap-4">
                  <div className={cn("p-3 rounded-2xl", data?.firewall ? "bg-emerald-500 text-white" : "bg-slate-800 text-slate-600")}>
                    {data?.firewall ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
                  </div>
                  <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">{data?.firewall ? 'Protection Périphérique OK' : 'Vulnérabilité Réseau Possible'}</span>
               </div>
            </div>

            <div className="bg-slate-900/40 backdrop-blur-3xl rounded-[2.5rem] border border-white/5 p-8 shadow-2xl relative group hover:border-white/10 transition-all flex flex-col justify-between">
               <div>
                  <div className="flex items-center justify-between mb-6">
                     <h3 className="text-sm font-black text-white uppercase tracking-widest flex items-center gap-3 italic"><Globe size={20} /> IP Forwarding</h3>
                     {loading ? <RefreshCw className="animate-spin text-slate-700" size={16} /> : (
                       data?.ipForwarding 
                         ? <div className="px-3 py-1 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[9px] font-black uppercase rounded-lg">OK</div>
                         : <div className="px-3 py-1 bg-red-500/10 border border-red-500/20 text-red-500 text-[9px] font-black uppercase rounded-lg">FAILED</div>
                     )}
                  </div>
                  <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest leading-relaxed mb-8">État de l'option sysctl net.ipv4.ip_forward nécessaire au transit vpn.</p>
               </div>
               <div className="flex items-center gap-4">
                  <div className={cn("p-3 rounded-2xl", data?.ipForwarding ? "bg-emerald-500 text-white" : "bg-slate-800 text-slate-600")}>
                    {data?.ipForwarding ? <CheckCircle2 size={18} /> : <X size={18} />}
                  </div>
                  <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">{data?.ipForwarding ? 'Transit de Données Actif' : 'Interruption Flux Tunnel'}</span>
               </div>
            </div>

            <div className="bg-slate-900/40 backdrop-blur-3xl rounded-[2.5rem] border border-white/5 p-8 shadow-2xl relative group hover:border-white/10 transition-all flex flex-col justify-between">
               <div>
                  <div className="flex items-center justify-between mb-6">
                     <h3 className="text-sm font-black text-white uppercase tracking-widest flex items-center gap-3 italic"><Lock size={18} /> Fail2Ban Monitor</h3>
                     {loading ? <RefreshCw className="animate-spin text-slate-700" size={16} /> : (
                       data?.fail2ban 
                         ? <div className="px-3 py-1 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[9px] font-black uppercase rounded-lg">Online</div>
                         : <div className="px-3 py-1 bg-slate-800 border border-white/5 text-slate-500 text-[9px] font-black uppercase rounded-lg">N/A</div>
                     )}
                  </div>
                  <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest leading-relaxed mb-8">Surveillance des tentatives de brute-force SSH et des bannissements IP.</p>
               </div>
               <div className="flex items-center gap-4">
                  <div className={cn("p-3 rounded-2xl", data?.fail2ban ? "bg-emerald-500 text-white" : "bg-slate-800 text-slate-600")}>
                    {data?.fail2ban ? <ShieldCheck size={18} /> : <AlertTriangle size={18} />}
                  </div>
                  <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">{data?.fail2ban ? 'Defense Brute-Force OK' : 'Vulnérabilité SSH Détectée'}</span>
               </div>
            </div>

            <div className="bg-slate-900/40 backdrop-blur-3xl rounded-[2.5rem] border border-white/5 p-8 shadow-2xl relative group hover:border-white/10 transition-all flex flex-col justify-between">
               <div>
                  <div className="flex items-center justify-between mb-6">
                     <h3 className="text-sm font-black text-white uppercase tracking-widest flex items-center gap-3 italic"><HardDrive size={18} /> Disk Storage</h3>
                     <span className="text-xl font-mono font-black text-white">{data?.disk || '0%'}</span>
                  </div>
                  <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest leading-relaxed mb-8">Utilisation de la partition racine (SSD/NVMe) pour le cache système.</p>
               </div>
               <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
                  <motion.div 
                    initial={{ width: 0 }}
                    animate={{ width: data?.disk || '0%' }}
                    className={cn("h-full transition-all duration-1000", parseInt(data?.disk || 0) > 80 ? "bg-rose-500" : `bg-${theme}-600`)} 
                  />
               </div>
            </div>
         </div>
      </div>
    </div>
  );
};

export default AuditSection;
