import React, { useState } from 'react';
import { 
  Users, Activity, ArrowDown, ArrowUp, Edit, Trash2, 
  Pause, Play, ChevronRight, ChevronLeft, Search, Plus, 
  Download, Timer, Package, Wifi, LayoutGrid, List, AlertTriangle
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTheme } from '../../context/ThemeContext';
import { cn, formatBytes } from '../../lib/utils';
import GlassCard from '../ui/Card';
import VibeButton from '../ui/Button';

// ─── Helpers ──────────────────────────────────────────────────────────────────
const CONTAINER_COLORS = ['indigo', 'emerald', 'rose', 'amber', 'cyan', 'purple'];

const getContainerColor = (name) => {
  const hash = (s) => s.split('').reduce((a, b) => { a = ((a << 5) - a) + b.charCodeAt(0); return a & a; }, 0);
  return CONTAINER_COLORS[Math.abs(hash(name || '')) % CONTAINER_COLORS.length];
};

const isOnlineClient = (client) => client.isOnline === true;
const isExpired      = (expiry) => expiry && new Date(expiry) < new Date();
const isExpiringSoon = (expiry) => {
  if (!expiry || isExpired(expiry)) return false;
  return (new Date(expiry) - new Date()) / (1000 * 60 * 60 * 24) <= 7;
};

// ─── Level 1 — Container Card ─────────────────────────────────────────────────
const ContainerCard = ({ name, clients, color, onClick, onDeleteContainer, idx }) => {
  const activeCount  = clients.filter(isOnlineClient).length;
  const totalDl      = clients.reduce((a, c) => a + (c.downloadRate  || 0), 0);
  const totalUl      = clients.reduce((a, c) => a + (c.uploadRate    || 0), 0);
  const totalDlBytes = clients.reduce((a, c) => a + (c.downloadBytes || 0), 0);
  const totalUlBytes = clients.reduce((a, c) => a + (c.uploadBytes   || 0), 0);
  const quotaCritical = clients.filter(c => {
    if (!c.quota || c.quota <= 0) return false;
    return (c.usageTotal / (c.quota * 1024 * 1024 * 1024)) * 100 > 80;
  }).length;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      whileHover={{ y: -5 }}
      transition={{ delay: idx * 0.05, duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
    >
      <GlassCard 
        onClick={onClick} 
        className="p-0 overflow-hidden cursor-pointer group relative border-white/5 hover:border-white/10"
      >
        {/* Animated accent gradient */}
        <div className={cn(
          "absolute inset-0 opacity-0 group-hover:opacity-10 transition-opacity duration-700 bg-gradient-to-br",
          `from-${color}-500 to-transparent`
        )} />

        <div className={cn(
          "h-1.5 w-full transition-all duration-700 group-hover:h-2 opacity-80",
          `bg-${color}-500 shadow-[0_0_10px_${color}-500]`
        )} />

        <div className="p-6 space-y-6 relative z-10">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className={cn(
                "p-3 rounded-2xl border transition-all duration-500 group-hover:scale-110 group-hover:rotate-6",
                `bg-${color}-500/10 text-${color}-400 border-${color}-500/20`
              )}>
                <Package size={24} />
              </div>
              <div className="min-w-0">
                <h3 className="text-xl font-black text-white uppercase tracking-tight truncate">{name}</h3>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className={cn(
                    "text-[8px] font-black px-2 py-0.5 rounded-full border uppercase tracking-widest",
                    activeCount > 0 ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" : "bg-slate-800 text-slate-500"
                  )}>
                    {activeCount}/{clients.length} EN LIGNE
                  </span>
                </div>
              </div>
            </div>
            <div className="flex gap-2 items-center">
              {clients.length === 0 && onDeleteContainer && (
                 <button 
                   onClick={(e) => { e.stopPropagation(); onDeleteContainer(name); }} 
                   className={cn(
                     "w-8 h-8 rounded-full border flex items-center justify-center transition-all duration-500 hover:bg-red-500/10 hover:text-red-400 hover:border-red-500/20 text-slate-500 border-white/5"
                   )}
                 >
                   <Trash2 size={14} />
                 </button>
              )}
              <div className={cn(
                "w-8 h-8 rounded-full border flex items-center justify-center transition-all duration-500 group-hover:bg-white/10",
                `text-${color}-400 border-${color}-500/10`
              )}>
                <ChevronRight size={16} className="group-hover:translate-x-0.5 transition-transform" />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
             <div className="space-y-1">
               <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest block">Flux Sortant</span>
               <div className="flex items-end gap-1.5">
                 <span className="text-lg font-mono font-black text-white italic">{formatBytes(totalDl)}</span>
                 <span className="text-[9px] text-slate-600 mb-1">/S</span>
               </div>
             </div>
             <div className="space-y-1">
               <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest block">Flux Entrant</span>
               <div className="flex items-end gap-1.5">
                 <span className="text-lg font-mono font-black text-white italic">{formatBytes(totalUl)}</span>
                 <span className="text-[9px] text-slate-600 mb-1">/S</span>
               </div>
             </div>
          </div>

          <div className="pt-4 border-t border-white/5 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="flex -space-x-2">
                {clients.slice(0, 3).map((c, i) => (
                  <div key={i} className={cn(
                    "w-6 h-6 rounded-lg border-2 border-slate-950 flex items-center justify-center text-[8px] font-black text-white",
                    isOnlineClient(c) ? `bg-${color}-500 shadow-lg shadow-${color}-500/20` : "bg-slate-800"
                  )}>
                    {c.name.charAt(0)}
                  </div>
                ))}
              </div>
              {clients.length > 3 && <span className="text-[9px] font-black text-slate-600">+{clients.length - 3}</span>}
            </div>
            <div className="flex flex-col items-end">
               <span className="text-[9px] font-mono text-slate-500 uppercase">Volume Total</span>
               <span className="text-[10px] font-mono font-black text-white">{formatBytes(totalDlBytes + totalUlBytes)}</span>
            </div>
          </div>
        </div>
      </GlassCard>
    </motion.div>
  );
};

// ─── Level 2 — Client Card (inside a container) ───────────────────────────────
const ClientCard = ({ client, color, onSelect, onToggle, onEdit, onDelete }) => {
  const online   = isOnlineClient(client);
  const expired  = isExpired(client.expiry);
  const expiring = isExpiringSoon(client.expiry);
  const quotaPct = client.quota > 0
    ? Math.min(100, (client.usageTotal / (client.quota * 1024 * 1024 * 1024)) * 100)
    : 0;

  return (
    <GlassCard onClick={() => onSelect(client)} className="p-5 group cursor-pointer border-white/5 hover:border-white/20 transition-all duration-300">
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-4">
          <div className={cn(
             "w-12 h-12 rounded-2xl flex items-center justify-center text-lg font-black text-white shadow-2xl transition-all duration-500 group-hover:scale-110 group-hover:rotate-6",
             online ? `bg-${color}-500 shadow-${color}-500/30` : "bg-slate-800 text-slate-500"
          )}>
            {client.name.charAt(0).toUpperCase()}
          </div>
          <div>
            <h4 className="text-sm font-black text-white uppercase tracking-tight truncate">{client.name}</h4>
            <div className="flex items-center gap-2 mt-0.5">
               <span className={cn("w-1.5 h-1.5 rounded-full", online ? "bg-emerald-500 animate-pulse" : "bg-slate-600")} />
               <span className="text-[9px] font-mono text-slate-500 font-bold uppercase tracking-widest">{online ? 'Actif' : 'Offline'}</span>
            </div>
          </div>
        </div>
        <div className="text-right">
           <span className="block text-[10px] font-mono font-bold text-white/40 mb-0.5">{client.ip}</span>
           {(expired || expiring) && (
             <span className={cn(
               "text-[8px] font-extrabold px-2 py-0.5 rounded-lg border uppercase tracking-tighter",
               expired ? "bg-red-500/10 text-red-400 border-red-500/20" : "bg-amber-500/10 text-amber-400 border-amber-500/20"
             )}>
               {expired ? 'Expiré' : 'Bientôt'}
             </span>
           )}
        </div>
      </div>

      <div className="space-y-4 mb-5">
        <div className="flex justify-between items-center bg-white/5 p-3 rounded-2xl border border-white/5">
           <div className="space-y-0.5">
             <span className="text-[8px] font-black text-slate-500 uppercase tracking-widest block">Download</span>
             <span className="text-xs font-mono font-black text-emerald-400">{formatBytes(client.downloadRate)}/s</span>
           </div>
           <div className="h-6 w-px bg-white/10" />
           <div className="space-y-0.5 text-right">
             <span className="text-[8px] font-black text-slate-500 uppercase tracking-widest block">Upload</span>
             <span className="text-xs font-mono font-black text-indigo-400">{formatBytes(client.uploadRate)}/s</span>
           </div>
        </div>

        {client.quota > 0 && (
          <div className="space-y-2">
            <div className="flex justify-between text-[9px] font-black uppercase text-slate-500">
              <span>Quota Usage</span>
              <span className={quotaPct > 80 ? "text-rose-400" : "text-white"}>{quotaPct.toFixed(1)}%</span>
            </div>
            <div className="h-1 w-full bg-white/5 rounded-full overflow-hidden">
               <div className={cn("h-full rounded-full", quotaPct > 80 ? "bg-rose-500" : `bg-${color}-500`)} style={{ width: `${quotaPct}%` }} />
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between pt-4 border-t border-white/5">
         <div className="flex gap-1.5 opacity-40 group-hover:opacity-100 transition-opacity">
            <button onClick={(e) => { e.stopPropagation(); onEdit(client); }} className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white transition-all"><Edit size={14} /></button>
            <button onClick={(e) => { e.stopPropagation(); onToggle(client.container, client.name, !client.enabled); }} className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-400 hover:text-amber-400 transition-all">{client.enabled ? <Pause size={14} /> : <Play size={14} />}</button>
            <button onClick={(e) => { e.stopPropagation(); onDelete(client); }} className="p-2 rounded-xl bg-white/5 hover:bg-red-500/10 text-slate-400 hover:text-red-400 transition-all"><Trash2 size={14} /></button>
         </div>
         <div className={cn("p-1.5 rounded-lg opacity-0 group-hover:opacity-100 transition-all duration-300", `bg-${color}-500/10 text-${color}-400`)}>
            <ChevronRight size={14} className="group-hover:translate-x-0.5 transition-transform" />
         </div>
      </div>
    </GlassCard>
  );
};

// ─── Main ClientList — 2-level navigation ─────────────────────────────────────
export const ClientList = ({ clients = [], allContainers = [], activeContainer = null, setActiveContainer, onSelect, onToggle, onEdit, onQRCode, onDelete, onDeleteContainer, onCreateClient, onCreateContainer }) => {
  const { theme } = useTheme();
  const [search, setSearch] = useState('');

  // Build container groups
  const containerGroups = clients.reduce((acc, client) => {
    const key = client.container || 'default';
    if (!acc[key]) acc[key] = [];
    acc[key].push(client);
    return acc;
  }, {});
  
  // Inject empty containers
  if (Array.isArray(allContainers)) {
      allContainers.forEach(c => {
          if (!containerGroups[c]) containerGroups[c] = [];
      });
  }

  const containerEntries = Object.entries(containerGroups);

  // Clients for selected container (with search filter)
  const containerClients = activeContainer
    ? (containerGroups[activeContainer] || []).filter(c =>
        !search ||
        c.name.toLowerCase().includes(search.toLowerCase()) ||
        (c.ip || '').includes(search)
      )
    : [];

  const selectedColor = activeContainer ? getContainerColor(activeContainer) : theme;

  const handleExportCSV = () => {
    const list = activeContainer ? containerClients : clients;
    const hdrs = ['Nom', 'Container', 'IP', 'Statut', 'DL', 'UL', 'Quota (GB)', 'Expiration'];
    const rows = list.map(c => [
      c.name, c.container, c.ip,
      isOnlineClient(c) ? 'En ligne' : 'Hors ligne',
      formatBytes(c.downloadBytes || 0),
      formatBytes(c.uploadBytes   || 0),
      c.quota > 0 ? `${c.quota}` : 'Illimité',
      c.expiry ? new Date(c.expiry).toLocaleDateString('fr-FR') : 'Illimité',
    ]);
    const csv  = [hdrs, ...rows].map(r => r.map(v => `"${v}"`).join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement('a'), { href: url, download: `wg-fux-peers-${new Date().toISOString().split('T')[0]}.csv` });
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-5 duration-700">

      {/* ── Toolbar ──────────────────────────────────────────────────────── */}
      <GlassCard className="flex flex-col sm:flex-row gap-4 items-center justify-between p-5">
        <div className="flex items-center gap-3 w-full sm:w-auto">
          {/* Back button when inside a container */}
          <AnimatePresence>
            {activeContainer && (
              <motion.button
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -12 }}
                onClick={() => { setActiveContainer(null); setSearch(''); }}
                className={cn(
                  "flex items-center gap-2 px-3 py-2.5 rounded-2xl border font-black text-[10px] uppercase tracking-widest transition-all flex-shrink-0",
                  `bg-${selectedColor}-500/10 text-${selectedColor}-400 border-${selectedColor}-500/20 hover:bg-${selectedColor}-500/20`
                )}
              >
                <ChevronLeft size={15} />
                <span className="hidden sm:inline">Conteneurs</span>
              </motion.button>
            )}
          </AnimatePresence>

          {/* Current breadcrumb */}
          <div className="min-w-0">
            {activeContainer ? (
              <div className="flex items-center gap-2">
                <Package size={16} className={cn(`text-${selectedColor}-400`)} />
                <span className="text-white font-black text-sm uppercase tracking-tight truncate">{activeContainer}</span>
                <span className={cn("text-[9px] px-2 py-0.5 rounded-full border font-black uppercase", `bg-${selectedColor}-500/10 text-${selectedColor}-400 border-${selectedColor}-500/20`)}>
                  {(containerGroups[activeContainer] || []).length} peers
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-slate-400">
                <Package size={16} />
                <span className="font-black text-sm uppercase tracking-tight">{containerEntries.length} Conteneur{containerEntries.length > 1 ? 's' : ''}</span>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3 w-full sm:w-auto">
          {/* Search (only inside a container) */}
          <AnimatePresence>
            {activeContainer && (
              <motion.div
                initial={{ opacity: 0, width: 0 }}
                animate={{ opacity: 1, width: 'auto' }}
                exit={{ opacity: 0, width: 0 }}
                className="relative group overflow-hidden"
              >
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-white transition-colors" size={15} />
                <input
                  type="text"
                  placeholder="Rechercher..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9 pr-4 py-2.5 bg-white/5 border border-white/5 rounded-2xl focus:outline-none focus:border-white/20 text-sm text-white w-48 font-mono"
                />
              </motion.div>
            )}
          </AnimatePresence>
          {/* Global Actions */}
          <div className="flex items-center gap-3">
             <button
                onClick={handleExportCSV}
                className="hidden sm:flex items-center gap-2 p-3 rounded-2xl bg-white/5 border border-white/5 hover:bg-white/10 hover:border-white/10 text-slate-400 hover:text-white transition-all group"
                title="Exporter CSV"
             >
                <Download size={16} className="group-hover:-translate-y-0.5 transition-transform" />
             </button>
             <VibeButton variant="primary" icon={Plus} onClick={() => {
                if (activeContainer) {
                   onCreateClient(activeContainer);
                } else {
                   onCreateContainer();
                }
             }} className="flex-shrink-0">
               <span className="hidden sm:inline">{activeContainer ? "Nouveau Peer" : "Nouveau Conteneur"}</span>
               <span className="sm:hidden">Créer</span>
             </VibeButton>
          </div>
        </div>
      </GlassCard>

      {/* ── LEVEL 1 — Container Grid ──────────────────────────────────────── */}
      <AnimatePresence mode="wait">
        {!activeContainer ? (
          <motion.div
            key="container-grid"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
          >
            {containerEntries.length === 0 ? (
              <GlassCard className="flex flex-col items-center justify-center py-32 border-dashed" hover={false}>
                <div className="p-8 bg-white/5 rounded-full mb-6">
                  <Package size={64} className="text-slate-600" />
                </div>
                <h3 className="text-2xl font-black text-white tracking-widest uppercase mb-2">Initialisation Requise</h3>
                <p className="text-slate-500 font-bold uppercase text-[10px] tracking-widest">Créez votre premier conteneur depuis le bouton "+" ci-dessus</p>
              </GlassCard>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
                {containerEntries.map(([name, cClients], idx) => (
                  <ContainerCard
                    key={name}
                    name={name}
                    clients={cClients}
                    color={getContainerColor(name)}
                    onDeleteContainer={onDeleteContainer}
                    idx={idx}
                    onClick={() => setActiveContainer(name)}
                  />
                ))}
              </div>
            )}
          </motion.div>
        ) : (
          /* ── LEVEL 2 — Clients of selected container ────────────────────── */
          <motion.div
            key={`container-${activeContainer}`}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            className="space-y-4"
          >
            {/* Container summary strip */}
            {(() => {
              const cc = containerGroups[activeContainer] || [];
              const active = cc.filter(isOnlineClient).length;
              return (
                <motion.div 
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  className={cn(
                    "flex flex-col md:flex-row items-start md:items-center gap-6 p-6 rounded-[2rem] border relative overflow-hidden group",
                    `bg-${selectedColor}-500/5 border-${selectedColor}-500/15`
                  )}
                >
                   <div className={cn("absolute inset-0 bg-gradient-to-r from-transparent to-white/[0.02] pointer-events-none")} />
                   <div className={cn("p-4 rounded-2xl shadow-2xl", `bg-${selectedColor}-500/10 text-${selectedColor}-400`)}>
                     <Package size={24} />
                   </div>
                   <div className="flex-1 min-w-0">
                      <h2 className="text-xl font-black text-white italic uppercase tracking-tighter mb-1">{activeContainer}</h2>
                      <div className="flex items-center gap-4">
                        <span className="flex items-center gap-1.5 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                           <Users size={12} /> {cc.length} Peers Total
                        </span>
                        <div className="h-1 w-1 rounded-full bg-slate-700" />
                        <span className="flex items-center gap-1.5 text-[10px] font-black text-emerald-400 uppercase tracking-widest">
                           <Activity size={12} /> {active} Actifs
                        </span>
                      </div>
                   </div>
                   <div className="hidden md:flex gap-8 px-8 border-l border-white/10 font-mono">
                      <div className="text-right">
                         <span className="block text-[10px] font-black text-slate-500 uppercase mb-1">Download</span>
                         <span className="text-xl font-black text-white">{formatBytes(cc.reduce((a, c) => a + (c.downloadRate || 0), 0))}/s</span>
                      </div>
                      <div className="text-right">
                         <span className="block text-[10px] font-black text-slate-500 uppercase mb-1">Upload</span>
                         <span className="text-xl font-black text-white">{formatBytes(cc.reduce((a, c) => a + (c.uploadRate || 0), 0))}/s</span>
                      </div>
                   </div>
                </motion.div>
              );
            })()}

            {/* Clients grid */}
            {containerClients.length === 0 ? (
              <GlassCard className="flex flex-col items-center justify-center py-20 border-dashed" hover={false}>
                <div className="p-6 bg-white/5 rounded-full mb-4">
                  <Users size={40} className="text-slate-600" />
                </div>
                <h3 className="text-lg font-black text-white uppercase mb-1">
                  {search ? 'Aucun résultat' : 'Conteneur Vide'}
                </h3>
                <p className="text-slate-500 text-[10px] font-black uppercase tracking-widest">
                  {search ? `Aucun peer ne correspond à "${search}"` : 'Aucun peer dans ce conteneur'}
                </p>
              </GlassCard>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-5">
                <AnimatePresence mode="popLayout">
                  {containerClients.map((client, idx) => (
                    <motion.div
                      key={client.id}
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      transition={{ delay: idx * 0.04, duration: 0.3 }}
                    >
                      <ClientCard
                        client={client}
                        color={selectedColor}
                        onSelect={onSelect}
                        onToggle={onToggle}
                        onEdit={onEdit}
                        onDelete={onDelete}
                      />
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default ClientList;
