import React from 'react';
import { 
  Users, Activity, Database, ArrowDown, ArrowUp, QrCode, Edit, Trash2, 
  Pause, Play, ChevronRight, Search, Plus, List, LayoutGrid, Clock
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTheme } from '../../context/ThemeContext';
import { cn, formatBytes } from '../../lib/utils';
import GlassCard from '../ui/Card';
import VibeButton from '../ui/Button';

export const ClientCard = ({ client, onSelect, onToggle, onEdit, onQRCode, onDelete }) => {
  const { theme } = useTheme();
  const isOnline = (Date.now() / 1000 - client.lastHandshake) < 180;
  const progress = client.quota > 0 ? Math.min(100, (client.usageTotal / (client.quota * 1024 * 1024 * 1024)) * 100) : 0;

  const getContainerColor = (container) => {
    const colors = ['emerald', 'indigo', 'rose', 'amber', 'cyan', 'purple'];
    const hashCode = (s) => s.split('').reduce((a, b) => { a = ((a << 5) - a) + b.charCodeAt(0); return a & a; }, 0);
    const idx = Math.abs(hashCode(container || '')) % colors.length;
    return colors[idx];
  };

  const color = getContainerColor(client.container);

  return (
    <GlassCard 
      onClick={() => onSelect(client)}
      className="p-6 group"
    >
      <div className="relative z-10">
        <div className="flex justify-between items-start mb-6">
          <div className="flex items-center gap-4">
             <div className={cn(
               "w-12 h-12 rounded-2xl flex items-center justify-center text-lg font-black shadow-2xl transition-all duration-500 group-hover:scale-110 group-hover:rotate-6",
               isOnline ? `bg-${color}-500 text-white shadow-${color}-500/30` : "bg-slate-800 text-slate-500"
             )}>
               {client.name.charAt(0).toUpperCase()}
             </div>
             <div>
               <h3 className="text-lg font-black text-white tracking-tight uppercase truncate max-w-[120px]">{client.name}</h3>
               <span className={cn("text-[9px] font-black uppercase tracking-[0.2em] opacity-60", `text-${color}-400`)}>{client.container}</span>
             </div>
          </div>
          <VibeButton 
            variant="ghost"
            size="sm"
            icon={ChevronRight}
            onClick={() => onSelect(client)}
          />
        </div>

        <div className="grid grid-cols-2 gap-3 mb-6">
           <div className="bg-white/5 p-3 rounded-2xl border border-white/5 group-hover:border-white/10 transition-colors">
              <div className="flex items-center gap-2 mb-1 opacity-60">
                 <ArrowDown size={12} className="text-emerald-400" />
                 <span className="text-[8px] font-black uppercase">Burst DL</span>
              </div>
              <div className="text-xs font-mono font-bold text-white">{formatBytes(client.downloadRate)}/s</div>
           </div>
           <div className="bg-white/5 p-3 rounded-2xl border border-white/5 group-hover:border-white/10 transition-colors">
              <div className="flex items-center gap-2 mb-1 opacity-60">
                 <ArrowUp size={12} className="text-indigo-400" />
                 <span className="text-[8px] font-black uppercase">Burst UL</span>
              </div>
              <div className="text-xs font-mono font-bold text-white">{formatBytes(client.uploadRate)}/s</div>
           </div>
        </div>

        {client.quota > 0 && (
          <div className="space-y-2 mb-6">
            <div className="flex justify-between text-[9px] font-black uppercase tracking-widest text-slate-500">
               <span>Quota Usage</span>
               <span className={cn(progress > 80 ? "text-rose-400" : "text-white")}>{progress.toFixed(1)}%</span>
            </div>
            <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
               <motion.div 
                 initial={{ width: 0 }}
                 animate={{ width: `${progress}%` }}
                 className={cn(
                   "h-full rounded-full transition-all duration-1000 shadow-[0_0_10px_currentColor]",
                   progress > 80 ? "bg-rose-500" : `bg-${color}-500`
                 )}
               />
            </div>
          </div>
        )}

        <div className="flex items-center justify-between pt-4 border-t border-white/5">
           <div className="flex items-center gap-2">
              <div className={cn("h-1.5 w-1.5 rounded-full animate-pulse", isOnline ? "bg-emerald-500 shadow-[0_0_8px_#10b981]" : "bg-slate-600")}></div>
              <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest font-mono">
                {isOnline ? "Online" : "Offline"}
              </span>
           </div>
           
           <div className="flex items-center gap-1">
              <VibeButton variant="ghost" size="sm" icon={Edit} onClick={(e) => { e.stopPropagation(); onEdit(client); }} className="p-2" />
              <VibeButton 
                variant="secondary" 
                size="sm" 
                icon={client.enabled ? Pause : Play} 
                onClick={(e) => { e.stopPropagation(); onToggle(client.name, !client.enabled); }} 
                 className="p-2" 
              />
              <VibeButton variant="danger" size="sm" icon={Trash2} onClick={(e) => { e.stopPropagation(); onDelete(client); }} className="p-2" />
           </div>
        </div>
      </div>
    </GlassCard>
  );
};

export const ClientList = ({ clients, onSelect, onToggle, onEdit, onQRCode, onDelete, onCreateClient }) => {
  const [search, setSearch] = React.useState('');
  const [containerFilter, setContainerFilter] = React.useState('all');
  const [viewMode, setViewMode] = React.useState('grid'); // grid or list
  const { theme } = useTheme();

  const containers = ['all', ...new Set(clients.map(c => c.container))].sort();

  const filteredClients = clients.filter(c => {
    const matchesSearch = c.name.toLowerCase().includes(search.toLowerCase()) || c.ip.includes(search);
    const matchesContainer = containerFilter === 'all' || c.container === containerFilter;
    return matchesSearch && matchesContainer;
  });

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-5 duration-700">
      <GlassCard className="flex flex-col lg:flex-row gap-6 items-center justify-between p-6">
         <div className="flex flex-col md:flex-row gap-4 w-full lg:w-auto">
            <div className="relative group">
               <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-white transition-colors" size={20} />
               <input 
                 type="text" 
                 placeholder="Rechercher un client ou une IP..."
                 value={search}
                 onChange={(e) => setSearch(e.target.value)}
                 className="pl-12 pr-6 py-3 bg-white/5 border border-white/5 rounded-2xl focus:outline-none focus:border-white/20 focus:bg-white/10 text-sm text-white w-full md:w-80 transition-all font-mono"
               />
            </div>
            <select 
              value={containerFilter}
              onChange={(e) => setContainerFilter(e.target.value)}
              className="px-6 py-3 bg-white/5 border border-white/5 rounded-2xl focus:outline-none focus:border-white/20 focus:bg-white/10 text-sm text-slate-400 font-bold uppercase tracking-widest transition-all appearance-none cursor-pointer pr-10"
              style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='white' stroke-width='2'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' d='M19.5 8.25l-7.5 7.5-7.5-7.5' /%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 1rem center', backgroundSize: '1rem' }}
            >
              {containers.map(c => <option key={c} value={c}>{c === 'all' ? 'Tous les groupes' : c}</option>)}
            </select>
         </div>

         <div className="flex items-center gap-4 w-full md:w-auto">
            <div className="flex bg-slate-950 p-1 rounded-2xl border border-white/5 shadow-inner">
               <VibeButton 
                 variant={viewMode === "grid" ? "primary" : "ghost"} 
                 size="sm" 
                 icon={LayoutGrid} 
                 onClick={() => setViewMode("grid")} 
                 className="p-2.5" 
               />
               <VibeButton 
                 variant={viewMode === "list" ? "primary" : "ghost"} 
                 size="sm" 
                 icon={List} 
                 onClick={() => setViewMode("list")} 
                 className="p-2.5" 
               />
            </div>
            <VibeButton 
              variant="primary" 
              icon={Plus} 
              onClick={onCreateClient} 
              className="flex-1 md:flex-none"
            >
              Nouveau Peer
            </VibeButton>
          </div>
      </GlassCard>

      <AnimatePresence mode="wait">
        {viewMode === 'grid' ? (
          <motion.div 
            key="grid"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.3 }}
            className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-6"
          >
            <AnimatePresence mode="popLayout">
              {filteredClients.map(client => (
                <ClientCard 
                  key={client.id}
                  client={client}
                  onSelect={onSelect}
                  onToggle={onToggle}
                  onEdit={onEdit}
                  onQRCode={onQRCode}
                  onDelete={onDelete}
                />
              ))}
            </AnimatePresence>
          </motion.div>
        ) : (
          <GlassCard className="p-0 overflow-hidden" hover={false}>
             <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                   <thead>
                      <tr className="text-[10px] font-black text-slate-500 uppercase tracking-[0.25em] border-b border-white/5">
                         <th className="px-8 py-6">Identity</th>
                         <th className="px-6 py-6">End-IP</th>
                         <th className="px-6 py-6">Tact Traffic</th>
                         <th className="px-6 py-6">Quota Burst</th>
                         <th className="px-6 py-6">Status</th>
                         <th className="px-8 py-6 text-right">Intervention</th>
                      </tr>
                   </thead>
                   <tbody className="divide-y divide-white/5">
                      {filteredClients.map(client => {
                         const isOnline = (Date.now() / 1000 - client.lastHandshake) < 180;
                         return (
                            <motion.tr key={client.id} layout className="group hover:bg-white/5 transition-colors cursor-pointer" onClick={() => onSelect(client)}>
                               <td className="px-8 py-5">
                                  <div className="flex items-center gap-4">
                                     <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center font-black text-sm", isOnline ? `bg-emerald-500 text-white shadow-xl shadow-emerald-500/20` : "bg-slate-800 text-slate-500")}>
                                        {client.name.charAt(0).toUpperCase()}
                                     </div>
                                     <div>
                                        <div className="text-sm font-black text-white uppercase tracking-tight">{client.name}</div>
                                        <div className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">{client.container}</div>
                                     </div>
                                  </div>
                               </td>
                               <td className="px-6 py-5">
                                  <span className="text-xs font-mono font-bold text-slate-400 group-hover:text-white transition-colors">{client.ip}</span>
                               </td>
                               <td className="px-6 py-5">
                                  <div className="flex flex-col gap-1">
                                     <div className="flex items-center gap-2 text-[10px] font-mono text-emerald-400">
                                        <ArrowDown size={10} /> {formatBytes(client.downloadRate)}/s
                                     </div>
                                     <div className="flex items-center gap-2 text-[10px] font-mono text-indigo-400">
                                        <ArrowUp size={10} /> {formatBytes(client.uploadRate)}/s
                                     </div>
                                  </div>
                               </td>
                               <td className="px-6 py-5">
                                  <div className="flex flex-col gap-1">
                                     <div className="text-[10px] font-mono text-slate-300">{formatBytes(client.usageTotal)}</div>
                                     {client.quota > 0 && <div className="text-[8px] font-black text-slate-500 uppercase tracking-widest">Total Lim. {client.quota}GB</div>}
                                  </div>
                               </td>
                               <td className="px-6 py-5">
                                  <div className={cn(
                                     "inline-flex items-center gap-2 px-3 py-1 rounded-lg border text-[9px] font-black uppercase tracking-widest",
                                     isOnline ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20 shadow-[0_0_15px_rgba(16,185,129,0.1)]" : "bg-slate-800 text-slate-500 border-white/10"
                                  )}>
                                     {isOnline ? "Connected" : "Offline"}
                                  </div>
                               </td>
                               <td className="px-8 py-5 text-right">
                                  <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                     <VibeButton variant="ghost" size="sm" icon={Edit} onClick={(e) => { e.stopPropagation(); onEdit(client); }} className="p-2" />
                                     <VibeButton variant="secondary" size="sm" icon={client.enabled ? Pause : Play} onClick={(e) => { e.stopPropagation(); onToggle(client.name, !client.enabled); }} className="p-2" />
                                     <VibeButton variant="danger" size="sm" icon={Trash2} onClick={(e) => { e.stopPropagation(); onDelete(client); }} className="p-2" />
                                  </div>
                               </td>
                            </motion.tr>
                         );
                      })}
                   </tbody>
                </table>
             </div>
          </GlassCard>
        )}
      </AnimatePresence>

      {/* Empty State */}
      {filteredClients.length === 0 && (
        <GlassCard className="flex flex-col items-center justify-center py-32 border-dashed" hover={false}>
           <div className="p-8 bg-white/5 rounded-full mb-6">
              <Users size={64} className="text-slate-600" />
           </div>
           <h3 className="text-2xl font-black text-white tracking-widest uppercase mb-2">No Peers Detected</h3>
           <p className="text-slate-500 font-bold uppercase text-[10px] tracking-[0.2em]">Deploy a new peer to begin monitoring</p>
           <VibeButton variant="primary" icon={Plus} onClick={onCreateClient} className="mt-10">
              Initialiser Peer
           </VibeButton>
        </GlassCard>
      )}
    </div>
  );
};
export default ClientList;
