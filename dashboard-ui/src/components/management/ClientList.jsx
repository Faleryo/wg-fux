import React from 'react';
import { 
  Users, Activity, Database, ArrowDown, ArrowUp, QrCode, Edit, Trash2, 
  Pause, Play, ChevronRight, Search, Plus, List, LayoutGrid, Package, Clock
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
      <div>
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
               <span className="text-[9px] font-mono text-slate-500 font-bold">{client.ip}</span>
             </div>
          </div>
          <VibeButton 
            variant="ghost"
            size="sm"
            icon={ChevronRight}
            onClick={(e) => { e.stopPropagation(); onSelect(client); }}
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
                onClick={(e) => { e.stopPropagation(); onToggle(client.container, client.name, !client.enabled); }} 
                 className="p-2" 
              />
              <VibeButton variant="danger" size="sm" icon={Trash2} onClick={(e) => { e.stopPropagation(); onDelete(client); }} className="p-2" />
           </div>
        </div>
      </div>
    </GlassCard>
  );
};

// ─── Container Group View ─────────────────────────────────────────────────────
const CONTAINER_COLORS = ['emerald', 'indigo', 'rose', 'amber', 'cyan', 'purple'];

const getContainerColor = (name) => {
  const hashCode = (s) => s.split('').reduce((a, b) => { a = ((a << 5) - a) + b.charCodeAt(0); return a & a; }, 0);
  return CONTAINER_COLORS[Math.abs(hashCode(name || '')) % CONTAINER_COLORS.length];
};

const ContainerGroupView = ({ groups, onSelect, onToggle, onEdit, onQRCode, onDelete, onCreateClient }) => {
  const { theme } = useTheme();
  const entries = Object.entries(groups);

  if (entries.length === 0) {
    return (
      <GlassCard className="flex flex-col items-center justify-center py-32 border-dashed" hover={false}>
         <div className="p-8 bg-white/5 rounded-full mb-6">
            <Package size={64} className="text-slate-600" />
         </div>
         <h3 className="text-2xl font-black text-white tracking-widest uppercase mb-2">Aucun Conteneur</h3>
         <p className="text-slate-500 font-bold uppercase text-[10px] tracking-[0.2em]">Déployez un peer pour initialiser un conteneur</p>
         <VibeButton variant="primary" icon={Plus} onClick={onCreateClient} className="mt-10">
            Initialiser Peer
         </VibeButton>
      </GlassCard>
    );
  }

  return (
    <div className="space-y-10">
      {entries.map(([containerName, clients], idx) => {
        const color = getContainerColor(containerName);
        const activeCount = clients.filter(c => (Date.now() / 1000 - c.lastHandshake) < 180).length;
        const totalDl = clients.reduce((acc, c) => acc + (c.downloadRate || 0), 0);
        const totalUl = clients.reduce((acc, c) => acc + (c.uploadRate || 0), 0);

        return (
          <motion.div
            key={containerName}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.08, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
            className="space-y-4"
          >
            {/* Container Header Bar */}
            <div className={cn(
              "flex items-center gap-4 p-4 rounded-2xl border bg-white/[0.02]",
              `border-${color}-500/20`
            )}>
              <div className={cn("p-2.5 rounded-xl border", `bg-${color}-500/10 text-${color}-400 border-${color}-500/20`)}>
                <Package size={20} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3">
                  <h3 className="text-base font-black text-white uppercase tracking-tight">{containerName}</h3>
                  <span className={cn("text-[9px] font-black px-2 py-0.5 rounded-full border uppercase tracking-widest",
                    `bg-${color}-500/10 text-${color}-400 border-${color}-500/20`
                  )}>
                    {activeCount}/{clients.length} actifs
                  </span>
                </div>
                <div className="flex items-center gap-4 mt-0.5">
                  <span className="text-[9px] font-mono text-emerald-400 flex items-center gap-1">
                    <ArrowDown size={9} />{formatBytes(totalDl)}/s
                  </span>
                  <span className="text-[9px] font-mono text-indigo-400 flex items-center gap-1">
                    <ArrowUp size={9} />{formatBytes(totalUl)}/s
                  </span>
                </div>
              </div>
              <div className={cn("text-[10px] font-mono font-black px-3 py-1.5 rounded-xl border",
                `bg-${color}-500/5 text-${color}-500 border-${color}-500/10`
              )}>
                {clients.length} peer{clients.length > 1 ? 's' : ''}
              </div>
            </div>

            {/* Clients Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4 pl-4 border-l-2 border-white/5">
              <AnimatePresence mode="popLayout">
                {clients.map(client => (
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
            </div>
          </motion.div>
        );
      })}
    </div>
  );
};

// ─── Main Client List ─────────────────────────────────────────────────────────
export const ClientList = ({ clients, onSelect, onToggle, onEdit, onQRCode, onDelete, onCreateClient }) => {
  const [search, setSearch] = React.useState('');
  const [viewMode, setViewMode] = React.useState('containers'); // 'containers', 'grid', 'list'
  const { theme } = useTheme();

  const filteredClients = clients.filter(c => {
    const matchesSearch = c.name.toLowerCase().includes(search.toLowerCase()) || (c.ip || '').includes(search);
    return matchesSearch;
  });

  // Group by container
  const containerGroups = filteredClients.reduce((acc, client) => {
    const key = client.container || 'default';
    if (!acc[key]) acc[key] = [];
    acc[key].push(client);
    return acc;
  }, {});

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-5 duration-700">
      {/* Header / Toolbar */}
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
         </div>

         <div className="flex items-center gap-4 w-full md:w-auto">
            {/* View Mode Controls */}
            <div className="flex bg-slate-950 p-1 rounded-2xl border border-white/5 shadow-inner">
               <button
                 onClick={() => setViewMode('containers')}
                 title="Vue Conteneurs"
                 className={cn(
                   "p-2.5 rounded-xl transition-all flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest",
                   viewMode === 'containers'
                     ? `bg-${theme}-600 text-white shadow-lg`
                     : "text-slate-500 hover:text-white hover:bg-white/5"
                 )}
               >
                 <Package size={16} />
                 <span className="hidden sm:inline">Conteneurs</span>
               </button>
               <button
                 onClick={() => setViewMode('grid')}
                 title="Vue Grille"
                 className={cn(
                   "p-2.5 rounded-xl transition-all",
                   viewMode === 'grid'
                     ? `bg-${theme}-600 text-white shadow-lg`
                     : "text-slate-500 hover:text-white hover:bg-white/5"
                 )}
               >
                 <LayoutGrid size={16} />
               </button>
               <button
                 onClick={() => setViewMode('list')}
                 title="Vue Liste"
                 className={cn(
                   "p-2.5 rounded-xl transition-all",
                   viewMode === 'list'
                     ? `bg-${theme}-600 text-white shadow-lg`
                     : "text-slate-500 hover:text-white hover:bg-white/5"
                 )}
               >
                 <List size={16} />
               </button>
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

      {/* Stats summary bar */}
      {clients.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: 'Total Peers', value: clients.length, color: 'indigo' },
            { label: 'Actifs', value: clients.filter(c => (Date.now()/1000 - c.lastHandshake) < 180).length, color: 'emerald' },
            { label: 'Conteneurs', value: Object.keys(containerGroups).length, color: 'amber' },
            { label: 'Download ↓', value: formatBytes(clients.reduce((a, c) => a + (c.downloadRate || 0), 0)) + '/s', color: 'cyan' },
          ].map((s, i) => (
            <div key={i} className={cn("bg-white/5 border rounded-2xl p-4 text-center", `border-${s.color}-500/10`)}>
              <div className={cn("text-lg font-black font-mono", `text-${s.color}-400`)}>{s.value}</div>
              <div className="text-[9px] font-black text-slate-500 uppercase tracking-widest mt-0.5">{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Content */}
      <AnimatePresence mode="wait">
        {viewMode === 'containers' ? (
          <motion.div key="containers" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} transition={{ duration: 0.3 }}>
            <ContainerGroupView
              groups={containerGroups}
              onSelect={onSelect}
              onToggle={onToggle}
              onEdit={onEdit}
              onQRCode={onQRCode}
              onDelete={onDelete}
              onCreateClient={onCreateClient}
            />
          </motion.div>
        ) : viewMode === 'grid' ? (
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
                         <th className="px-6 py-6">Container</th>
                         <th className="px-6 py-6">End-IP</th>
                         <th className="px-6 py-6">Tact Traffic</th>
                         <th className="px-6 py-6">Status</th>
                         <th className="px-8 py-6 text-right">Intervention</th>
                      </tr>
                   </thead>
                   <tbody className="divide-y divide-white/5">
                      {filteredClients.map(client => {
                         const isOnline = (Date.now() / 1000 - client.lastHandshake) < 180;
                         const color = getContainerColor(client.container);
                         return (
                            <motion.tr key={client.id} layout className="group hover:bg-white/5 transition-colors cursor-pointer" onClick={() => onSelect(client)}>
                               <td className="px-8 py-5">
                                  <div className="flex items-center gap-4">
                                     <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center font-black text-sm", isOnline ? `bg-emerald-500 text-white shadow-xl shadow-emerald-500/20` : "bg-slate-800 text-slate-500")}>
                                        {client.name.charAt(0).toUpperCase()}
                                     </div>
                                     <div className="text-sm font-black text-white uppercase tracking-tight">{client.name}</div>
                                  </div>
                               </td>
                               <td className="px-6 py-5">
                                  <span className={cn("text-[10px] font-black px-2 py-1 rounded-lg border uppercase tracking-widest", `bg-${color}-500/10 text-${color}-400 border-${color}-500/20`)}>{client.container}</span>
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
                                  <div className={cn(
                                     "inline-flex items-center gap-2 px-3 py-1 rounded-lg border text-[9px] font-black uppercase tracking-widest",
                                     isOnline ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" : "bg-slate-800 text-slate-500 border-white/10"
                                  )}>
                                     {isOnline ? "Connected" : "Offline"}
                                  </div>
                               </td>
                               <td className="px-8 py-5 text-right">
                                  <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                     <VibeButton variant="ghost" size="sm" icon={Edit} onClick={(e) => { e.stopPropagation(); onEdit(client); }} className="p-2" />
                                     <VibeButton variant="secondary" size="sm" icon={client.enabled ? Pause : Play} onClick={(e) => { e.stopPropagation(); onToggle(client.container, client.name, !client.enabled); }} className="p-2" />
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
      {filteredClients.length === 0 && viewMode !== 'containers' && (
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
