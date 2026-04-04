import React, { useState, useEffect } from 'react';
import { 
  Settings, Globe, Shield, Wrench, Server, Zap, RefreshCw, 
  Save, Download, AlertTriangle, Info, Cpu, HardDrive, 
  ChevronRight, ArrowRight, ShieldCheck, Activity
} from 'lucide-react';
import { useTheme } from '../../../context/ThemeContext';
import { useToast } from '../../../context/ToastContext';
import { cn } from '../../../lib/utils';
import { axiosInstance } from '../../../lib/api';
import { motion, AnimatePresence } from 'framer-motion';

const GlassInput = ({ label, value, onChange, badge, tooltip }) => {
  const { theme, isDark } = useTheme();
  return (
    <div className="group space-y-3">
      <div className="flex items-center justify-between px-1">
        <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest leading-none">{label}</label>
        {tooltip && (
          <div className="group/tip relative">
            <Info size={12} className={cn("cursor-help transition-colors", isDark ? "text-slate-600 hover:text-white" : "text-slate-400 hover:text-slate-900")} />
            <div className={cn("absolute bottom-full right-0 mb-4 w-64 p-4 border rounded-2xl text-[10px] font-bold uppercase tracking-widest opacity-0 group-hover/tip:opacity-100 transition-all pointer-events-none z-50 shadow-2xl", isDark ? "bg-slate-950/95 backdrop-blur-3xl border-white/10 text-slate-400" : "bg-white border-black/10 text-slate-500")}>
              {tooltip}
            </div>
          </div>
        )}
      </div>
      <div className="relative group/field">
        <div className={cn("absolute -inset-0.5 rounded-2xl blur opacity-0 group-focus-within/field:opacity-40 transition-opacity", `bg-${theme}-500/20`)} />
        <input
          type="text"
          value={value}
          onChange={onChange}
          className={cn("relative w-full border rounded-2xl px-6 py-4 font-mono text-sm focus:outline-none transition-all", isDark ? "bg-white/5 border-white/5 text-white focus:border-white/10 focus:bg-white/10" : "bg-slate-50 border-black/5 text-slate-900 focus:border-indigo-500/20 focus:bg-white")}
        />
        {badge && (
          <div className={cn("absolute right-4 top-1/2 -translate-y-1/2 px-3 py-1 border rounded-xl text-[9px] font-black font-mono uppercase tracking-widest transition-colors", isDark ? "bg-slate-900 border-white/5 text-slate-500" : "bg-white border-black/5 text-slate-400")}>
            {badge}
          </div>
        )}
      </div>
    </div>
  );
};

const SettingsSection = () => {
  const { theme, isDark } = useTheme();
  const { addToast } = useToast();
  const [activeTab, setActiveTab] = useState('general');
  const [loading, setLoading] = useState(false);
  const [config, setConfig] = useState({
    port: '51820',
    mtu: '1420',
    dns: '1.1.1.1, 8.8.8.8',
    subnet: '10.0.0.0/24',
    keepalive: '25'
  });

  useEffect(() => {
    axiosInstance.get('/system/config')
      .then(res => setConfig(prev => ({ ...prev, ...res.data })))
      .catch(console.error);
  }, []);

  const handleSave = async () => {
    setLoading(true);
    try {
      await axiosInstance.post('/system/config', config);
      addToast('Configuration appliquée avec succès', 'success');
    } catch (error) {
      addToast('Erreur lors de l\'application', 'error');
    } finally { setLoading(false); }
  };

  const handleBackup = async () => {
    try {
      const response = await axiosInstance.post('/system/backup', {});
      addToast('Sauvegarde créée avec succès', 'success');
    } catch (error) {
      addToast('Erreur lors du backup', 'error');
    }
  };

  const tabs = [
    { id: 'general', label: 'Noyau', icon: Server },
    { id: 'network', label: 'Réseau', icon: Globe },
    { id: 'security', label: 'Sûreté', icon: Shield },
    { id: 'maintenance', label: 'Terminal', icon: Wrench },
  ];

  return (
    <div className="space-y-10 animate-in fade-in slide-in-from-bottom-5 duration-700">
      {/* Header */}
      <div className={cn("flex flex-col lg:flex-row justify-between items-center p-8 rounded-[3rem] border shadow-2xl gap-8 transition-all", isDark ? "bg-slate-900/40 border-white/5 backdrop-blur-3xl" : "bg-white border-black/5")}>
        <div className="flex items-center gap-6">
           <div className={cn("p-5 rounded-[2rem] bg-white/5 shadow-2xl", `text-${theme}-400`)}>
              <Settings size={36} />
           </div>
           <div>
             <h2 className={cn("text-4xl font-black tracking-tighter italic uppercase transition-colors", isDark ? "text-white" : "text-slate-900")}>Paramètres Noyau</h2>
             <p className="text-slate-500 text-[10px] font-black tracking-[0.4em] uppercase opacity-60">Deep Core Control Panel</p>
           </div>
        </div>
        
        <div className="flex gap-4 w-full lg:w-auto">
           <button 
             onClick={handleSave} 
             disabled={loading}
             className={cn(
               "flex-1 lg:flex-none flex items-center justify-center gap-3 px-10 py-5 text-white rounded-[1.5rem] font-black uppercase text-xs tracking-widest shadow-2xl transition-all active:scale-95 disabled:opacity-30",
               `bg-${theme}-600 hover:bg-${theme}-500 shadow-${theme}-600/30`
             )}
           >
             {loading ? <RefreshCw className="animate-spin" size={20} /> : <Save size={20} />} Appliquer Mission
           </button>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-8">
         {/* Tabs Navigation */}
         <div className="xl:col-span-1 space-y-3">
             {tabs.map(tab => (
               <button
                 key={tab.id}
                 onClick={() => setActiveTab(tab.id)}
                 className={cn(
                   "w-full flex items-center gap-4 px-6 py-5 rounded-[1.5rem] font-black uppercase text-[10px] tracking-widest transition-all duration-300",
                   activeTab === tab.id ? `bg-${theme}-600 text-white shadow-2xl shadow-${theme}-600/20` : cn("text-slate-500", isDark ? "hover:text-white hover:bg-white/5" : "hover:text-slate-900 hover:bg-slate-100")
                 )}
               >
                 <tab.icon size={18} /> {tab.label}
                 {activeTab === tab.id && <ChevronRight className="ml-auto" size={14} />}
               </button>
             ))}
         </div>

         {/* Content Area */}
         <div className={cn("xl:col-span-3 rounded-[3rem] border p-10 shadow-2xl relative overflow-hidden h-fit transition-all", isDark ? "bg-slate-900/40 border-white/10 backdrop-blur-3xl" : "bg-white border-black/5 shadow-sm")}>
            {/* Background Icon Watermark */}
            <div className={cn("absolute -top-12 -right-12 p-12 opacity-[0.02] rotate-12 pointer-events-none transition-colors", isDark ? "text-white" : "text-black")}>
               <Settings size={300} />
            </div>

            <AnimatePresence mode="wait">
               {activeTab === 'general' && (
                 <motion.div key="gen" initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }} className="grid grid-cols-1 md:grid-cols-2 gap-10">
                    <div className="space-y-8">
                       <h3 className={cn("text-xl font-black flex items-center gap-3 italic uppercase transition-colors", isDark ? "text-white" : "text-slate-900")}><Server size={20} className={cn(`text-${theme}-400`)} /> Main-Core</h3>
                       <GlassInput label="Distant UDP Port" value={config.port} onChange={e => setConfig({ ...config, port: e.target.value })} badge="UDP" tooltip="Port d'écoute standard WireGuard" />
                       <GlassInput label="Protocol MTU" value={config.mtu} onChange={e => setConfig({ ...config, mtu: e.target.value })} badge="BYTES" tooltip="Maximum Transmission Unit" />
                    </div>
                    <div className="space-y-8">
                       <h3 className={cn("text-xl font-black flex items-center gap-3 italic uppercase transition-colors", isDark ? "text-white" : "text-slate-900")}><Zap size={20} className="text-emerald-400" /> Pulse-Mode</h3>
                       <GlassInput 
                         label="Persistent Keepalive" 
                         value={config.keepalive} 
                         onChange={e => setConfig({ ...config, keepalive: e.target.value })} 
                         badge="SECONDS" 
                         tooltip="Maintient les sessions actives à travers les pare-feu NAT rigides via stimulation UDP (0 = désactivé)." 
                       />
                       <p className="px-1 text-[9px] text-slate-500 font-bold uppercase tracking-widest leading-relaxed opacity-60">
                         Recommandé : 25s (Standard), 5s (Gaming Mobile Ultra-Stable).
                       </p>
                    </div>
                 </motion.div>
               )}

               {activeTab === 'network' && (
                 <motion.div key="net" initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }} className="space-y-10">
                    <h3 className={cn("text-xl font-black flex items-center gap-3 italic uppercase transition-colors", isDark ? "text-white" : "text-slate-900")}><Globe size={20} className="text-cyan-400" /> Infrastructure</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
                       <GlassInput label="Primary DNS Cluster" value={config.dns} onChange={e => setConfig({ ...config, dns: e.target.value })} badge="IP-LIST" tooltip="Serveurs DNS transmis aux clients" />
                       <GlassInput label="VPN Base-Subnet" value={config.subnet} onChange={e => setConfig({ ...config, subnet: e.target.value })} badge="CIDR" tooltip="Plage d'IP interne du tunnel vpn" />
                    </div>
                 </motion.div>
               )}

               {activeTab === 'security' && (
                 <motion.div key="sec" initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }} className="space-y-8">
                    <h3 className={cn("text-xl font-black flex items-center gap-3 italic uppercase transition-colors", isDark ? "text-white" : "text-slate-900")}><Shield size={20} className="text-rose-400" /> Hardening Profile</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                       <div className={cn("p-8 rounded-[2.5rem] border relative group hover:border-white/10 transition-all", isDark ? "bg-white/5 border-white/5" : "bg-slate-50 border-black/5 shadow-sm hover:border-indigo-500/20")}>
                          <div className="absolute top-4 right-4 animate-pulse"><div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_10px_#10b981]" /></div>
                          <h4 className={cn("text-sm font-black uppercase tracking-widest mb-4 flex items-center gap-3 transition-colors", isDark ? "text-white" : "text-slate-900")}><ShieldCheck size={18} /> Encryption Module</h4>
                          <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest leading-relaxed mb-6">Protocole ChaCha20-Poly1305 actif. Rotation automatique des clés de session Curve25519.</p>
                          <button className="text-[9px] font-black text-indigo-400 hover:text-white uppercase tracking-[0.25em] flex items-center gap-2 transition-all">Analyser Intégrité <ArrowRight size={14} /></button>
                       </div>
                       <div className={cn("p-8 rounded-[2.5rem] border relative group transition-all", isDark ? "bg-white/5 border-white/5 hover:border-white/10" : "bg-slate-50 border-black/5 shadow-sm hover:border-indigo-500/20")}>
                          <h4 className={cn("text-sm font-black uppercase tracking-widest mb-4 flex items-center gap-3 transition-colors", isDark ? "text-white" : "text-slate-900")}><Activity size={18} /> Packet Filtering</h4>
                          <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest leading-relaxed mb-6">Pare-feu UFW activé. Rejet immédiat des paquets ICMP non autorisés et scans SYN furtifs.</p>
                          <button className="text-[9px] font-black text-indigo-400 hover:text-white uppercase tracking-[0.25em] flex items-center gap-2 transition-all">Logs Firewall <ArrowRight size={14} /></button>
                       </div>
                    </div>
                 </motion.div>
               )}

               {activeTab === 'maintenance' && (
                 <motion.div key="maint" initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }} className="grid grid-cols-1 md:grid-cols-2 gap-10">
                    <div className="space-y-8">
                       <h3 className={cn("text-xl font-black flex items-center gap-3 italic uppercase transition-colors", isDark ? "text-white" : "text-slate-900")}><Download size={20} className="text-emerald-400" /> Archives</h3>
                       <p className="text-[11px] text-slate-500 font-bold uppercase tracking-widest leading-loose">Exportation complète du cluster : certificats, configurations d'interfaces et database SQL cryptée.</p>
                       <button onClick={handleBackup} className="w-full flex items-center justify-center gap-3 px-8 py-4 bg-slate-950 border border-white/5 rounded-2xl text-slate-400 hover:text-white hover:bg-slate-900 transition-all group">
                          <Download size={18} className="group-hover:-translate-y-1 transition-transform" /> 
                          <span className="text-[10px] font-black uppercase tracking-widest">Générer Backup .tar.gz</span>
                       </button>
                    </div>
                    <div className="space-y-8">
                       <h3 className={cn("text-xl font-black flex items-center gap-3 italic uppercase transition-colors", isDark ? "text-white" : "text-slate-900")}><AlertTriangle size={20} className="text-rose-600" /> Danger Zone</h3>
                       <div className="p-8 bg-rose-950/20 border border-rose-500/20 rounded-[2.5rem] space-y-6">
                          <div>
                            <h4 className="text-sm font-black text-rose-400 uppercase tracking-widest mb-2">Nuclear Reset</h4>
                            <p className="text-[10px] text-rose-500/60 font-bold uppercase tracking-widest leading-relaxed">Réinitialisation complète de l'architecture. Perte irrémédiable de toutes les routes vpn.</p>
                          </div>
                          <button className="w-full py-4 bg-rose-600/10 hover:bg-rose-600 text-rose-500 hover:text-white border border-rose-600/20 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all">Restaurer Valeurs Usine</button>
                       </div>
                    </div>
                 </motion.div>
               )}
            </AnimatePresence>
         </div>
      </div>
    </div>
  );
};

export default SettingsSection;
