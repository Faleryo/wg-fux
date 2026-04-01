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

const isOnlineClient = (client) => (Date.now() / 1000 - (client.lastHandshake || 0)) < 180;
const isExpired      = (expiry) => expiry && new Date(expiry) < new Date();
const isExpiringSoon = (expiry) => {
  if (!expiry || isExpired(expiry)) return false;
  return (new Date(expiry) - new Date()) / (1000 * 60 * 60 * 24) <= 7;
};

// ─── Level 1 — Container Card ─────────────────────────────────────────────────
const ContainerCard = ({ name, clients, color, onClick, idx }) => {
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
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: idx * 0.07, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
    >
      <GlassCard onClick={onClick} className="p-0 overflow-hidden cursor-pointer group">
        {/* Color header strip */}
        <div className={cn(
          "relative h-2 w-full transition-all duration-500 group-hover:h-3",
          `bg-${color}-500`
        )} />

        <div className="p-6 space-y-5">
          {/* Title row */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={cn(
                "p-3 rounded-2xl border transition-all duration-300 group-hover:scale-110 group-hover:rotate-3",
                `bg-${color}-500/10 text-${color}-400 border-${color}-500/20`
              )}>
                <Package size={22} />
              </div>
              <div>
                <h3 className="text-xl font-black text-white uppercase tracking-tight">{name}</h3>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className={cn(
                    "text-[9px] font-black px-2 py-0.5 rounded-full border uppercase tracking-widest",
                    activeCount > 0
                      ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                      : "bg-slate-800 text-slate-500 border-white/10"
                  )}>
                    {activeCount}/{clients.length} actifs
                  </span>
                  {quotaCritical > 0 && (
                    <span className="text-[9px] font-black px-2 py-0.5 rounded-full border bg-rose-500/10 text-rose-400 border-rose-500/20 flex items-center gap-1">
                      <AlertTriangle size={8} />
                      {quotaCritical} critique{quotaCritical > 1 ? 's' : ''}
                    </span>
                  )}
                </div>
              </div>
            </div>
            <div className={cn(
              "p-2 rounded-xl border transition-all duration-300 group-hover:translate-x-1",
              `text-${color}-400 bg-${color}-500/5 border-${color}-500/10`
            )}>
              <ChevronRight size={18} />
            </div>
          </div>

          {/* Peer activity bar — ratio of active peers */}
          <div className="space-y-1.5">
            <div className="flex justify-between text-[9px] font-black text-slate-500 uppercase tracking-widest">
              <span>Activité Peers</span>
              <span>{clients.length > 0 ? Math.round((activeCount / clients.length) * 100) : 0}%</span>
            </div>
            <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${clients.length > 0 ? (activeCount / clients.length) * 100 : 0}%` }}
                transition={{ duration: 1, delay: idx * 0.1 + 0.3 }}
                className={cn("h-full rounded-full", `bg-${color}-500`)}
              />
            </div>
          </div>

          {/* Traffic stats */}
          <div className="grid grid-cols-2 gap-3">
            <div className={cn("p-3 rounded-2xl border", `bg-${color}-500/5 border-${color}-500/10`)}>
              <div className="flex items-center gap-1.5 mb-1">
                <ArrowDown size={11} className="text-emerald-400" />
                <span className="text-[9px] font-black text-slate-500 uppercase tracking-wider">DL Live</span>
              </div>
              <div className="text-sm font-mono font-black text-white">{formatBytes(totalDl)}/s</div>
              <div className="text-[9px] text-slate-600 mt-0.5 font-mono">{formatBytes(totalDlBytes)} total</div>
            </div>
            <div className={cn("p-3 rounded-2xl border", `bg-${color}-500/5 border-${color}-500/10`)}>
              <div className="flex items-center gap-1.5 mb-1">
                <ArrowUp size={11} className="text-indigo-400" />
                <span className="text-[9px] font-black text-slate-500 uppercase tracking-wider">UL Live</span>
              </div>
              <div className="text-sm font-mono font-black text-white">{formatBytes(totalUl)}/s</div>
              <div className="text-[9px] text-slate-600 mt-0.5 font-mono">{formatBytes(totalUlBytes)} total</div>
            </div>
          </div>

          {/* Peer count footer */}
          <div className="flex items-center justify-between pt-3 border-t border-white/5">
            <div className="flex items-center gap-1.5 text-slate-500">
              <Wifi size={13} />
              <span className="text-[10px] font-black uppercase tracking-widest">
                {clients.length} peer{clients.length !== 1 ? 's' : ''}
              </span>
            </div>
            <div className="flex -space-x-2">
              {clients.slice(0, 5).map((c, i) => (
                <div
                  key={c.id || i}
                  className={cn(
                    "w-6 h-6 rounded-full flex items-center justify-center text-[8px] font-black text-white border-2 border-slate-900",
                    isOnlineClient(c) ? `bg-${color}-500` : "bg-slate-700"
                  )}
                  title={c.name}
                >
                  {c.name.charAt(0).toUpperCase()}
                </div>
              ))}
              {clients.length > 5 && (
                <div className="w-6 h-6 rounded-full flex items-center justify-center text-[8px] font-black text-slate-400 border-2 border-slate-900 bg-slate-800">
                  +{clients.length - 5}
                </div>
              )}
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
    <GlassCard onClick={() => onSelect(client)} className="p-5 group cursor-pointer">
      {/* Header */}
      <div className="flex items-start justify-between mb-4 gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className={cn(
            "w-11 h-11 rounded-2xl flex items-center justify-center text-base font-black text-white shadow-lg flex-shrink-0 transition-all duration-300 group-hover:scale-110 group-hover:rotate-3",
            online ? `bg-${color}-500 shadow-${color}-500/30` : "bg-slate-800 text-slate-500"
          )}>
            {client.name.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <h4 className="text-sm font-black text-white uppercase tracking-tight truncate">{client.name}</h4>
            <span className="text-[9px] font-mono text-slate-500">{client.ip}</span>
          </div>
        </div>

        {/* Status badges */}
        <div className="flex flex-col items-end gap-1 flex-shrink-0">
          <div className={cn(
            "flex items-center gap-1 text-[9px] font-black px-2 py-0.5 rounded-full border uppercase tracking-widest",
            online
              ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
              : "bg-slate-800 text-slate-500 border-white/5"
          )}>
            <span className={cn("w-1 h-1 rounded-full", online ? "bg-emerald-400 animate-pulse" : "bg-slate-600")} />
            {online ? "On" : "Off"}
          </div>
          {(expired || expiring) && (
            <span className={cn(
              "text-[9px] font-black px-2 py-0.5 rounded-full border uppercase tracking-widest flex items-center gap-1",
              expired ? "bg-red-500/20 text-red-400 border-red-500/30" : "bg-amber-500/20 text-amber-400 border-amber-500/30"
            )}>
              <Timer size={8} />
              {expired ? 'Expiré' : 'Soon'}
            </span>
          )}
        </div>
      </div>

      {/* Traffic */}
      <div className="grid grid-cols-2 gap-2 mb-4">
        <div className="bg-white/5 p-2.5 rounded-xl border border-white/5 group-hover:border-white/10 transition-colors">
          <div className="flex items-center gap-1.5 mb-1 text-emerald-400/70">
            <ArrowDown size={10} />
            <span className="text-[8px] font-black uppercase">DL</span>
          </div>
          <div className="text-[11px] font-mono font-black text-white">{formatBytes(client.downloadRate)}/s</div>
        </div>
        <div className="bg-white/5 p-2.5 rounded-xl border border-white/5 group-hover:border-white/10 transition-colors">
          <div className="flex items-center gap-1.5 mb-1 text-indigo-400/70">
            <ArrowUp size={10} />
            <span className="text-[8px] font-black uppercase">UL</span>
          </div>
          <div className="text-[11px] font-mono font-black text-white">{formatBytes(client.uploadRate)}/s</div>
        </div>
      </div>

      {/* Quota bar */}
      {client.quota > 0 && (
        <div className="mb-4 space-y-1.5">
          <div className="flex justify-between text-[9px] font-black uppercase tracking-widest text-slate-500">
            <span>Quota</span>
            <span className={quotaPct > 80 ? "text-rose-400" : "text-white"}>{quotaPct.toFixed(0)}%</span>
          </div>
          <div className="h-1 w-full bg-white/5 rounded-full overflow-hidden">
            <div
              className={cn("h-full rounded-full transition-all duration-700", quotaPct > 80 ? "bg-rose-500" : `bg-${color}-500`)}
              style={{ width: `${quotaPct}%` }}
            />
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center justify-between pt-3 border-t border-white/5">
        <ChevronRight size={14} className={cn("transition-all duration-300 group-hover:translate-x-1", `text-${color}-500/50 group-hover:text-${color}-400`)} />
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
          <button
            onClick={(e) => { e.stopPropagation(); onEdit(client); }}
            className="p-1.5 rounded-xl hover:bg-white/10 text-slate-500 hover:text-white transition-all"
            title="Éditer"
          >
            <Edit size={13} />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onToggle(client.container, client.name, !client.enabled); }}
            className="p-1.5 rounded-xl hover:bg-white/10 text-slate-500 hover:text-amber-400 transition-all"
            title={client.enabled ? 'Désactiver' : 'Activer'}
          >
            {client.enabled ? <Pause size={13} /> : <Play size={13} />}
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(client); }}
            className="p-1.5 rounded-xl hover:bg-red-500/10 text-slate-500 hover:text-red-400 transition-all"
            title="Supprimer"
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>
    </GlassCard>
  );
};

// ─── Main ClientList — 2-level navigation ─────────────────────────────────────
export const ClientList = ({ clients = [], onSelect, onToggle, onEdit, onQRCode, onDelete, onCreateClient }) => {
  const { theme } = useTheme();
  const [selectedContainer, setSelectedContainer] = useState(null); // null = show container grid
  const [search, setSearch] = useState('');

  // Build container groups
  const containerGroups = clients.reduce((acc, client) => {
    const key = client.container || 'default';
    if (!acc[key]) acc[key] = [];
    acc[key].push(client);
    return acc;
  }, {});

  const containerEntries = Object.entries(containerGroups);

  // Clients for selected container (with search filter)
  const containerClients = selectedContainer
    ? (containerGroups[selectedContainer] || []).filter(c =>
        !search ||
        c.name.toLowerCase().includes(search.toLowerCase()) ||
        (c.ip || '').includes(search)
      )
    : [];

  const selectedColor = selectedContainer ? getContainerColor(selectedContainer) : theme;

  const handleExportCSV = () => {
    const list = selectedContainer ? containerClients : clients;
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
            {selectedContainer && (
              <motion.button
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -12 }}
                onClick={() => { setSelectedContainer(null); setSearch(''); }}
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
            {selectedContainer ? (
              <div className="flex items-center gap-2">
                <Package size={16} className={cn(`text-${selectedColor}-400`)} />
                <span className="text-white font-black text-sm uppercase tracking-tight truncate">{selectedContainer}</span>
                <span className={cn("text-[9px] px-2 py-0.5 rounded-full border font-black uppercase", `bg-${selectedColor}-500/10 text-${selectedColor}-400 border-${selectedColor}-500/20`)}>
                  {(containerGroups[selectedContainer] || []).length} peers
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
            {selectedContainer && (
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

          <button
            onClick={handleExportCSV}
            title="Exporter CSV"
            className="p-2.5 rounded-xl bg-white/5 border border-white/5 text-slate-400 hover:text-emerald-400 hover:bg-emerald-500/10 hover:border-emerald-500/20 transition-all flex-shrink-0"
          >
            <Download size={16} />
          </button>
          <VibeButton variant="primary" icon={Plus} onClick={onCreateClient} className="flex-shrink-0">
            Nouveau Peer
          </VibeButton>
        </div>
      </GlassCard>

      {/* ── LEVEL 1 — Container Grid ──────────────────────────────────────── */}
      <AnimatePresence mode="wait">
        {!selectedContainer ? (
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
                <h3 className="text-2xl font-black text-white tracking-widest uppercase mb-2">Aucun Conteneur</h3>
                <p className="text-slate-500 font-bold uppercase text-[10px] tracking-widest">Créez un peer pour initialiser un conteneur</p>
                <VibeButton variant="primary" icon={Plus} onClick={onCreateClient} className="mt-8">
                  Initialiser Peer
                </VibeButton>
              </GlassCard>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-5">
                {containerEntries.map(([name, cClients], idx) => (
                  <ContainerCard
                    key={name}
                    name={name}
                    clients={cClients}
                    color={getContainerColor(name)}
                    idx={idx}
                    onClick={() => setSelectedContainer(name)}
                  />
                ))}
              </div>
            )}
          </motion.div>
        ) : (
          /* ── LEVEL 2 — Clients of selected container ────────────────────── */
          <motion.div
            key={`container-${selectedContainer}`}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            className="space-y-4"
          >
            {/* Container summary strip */}
            {(() => {
              const cc = containerGroups[selectedContainer] || [];
              const active = cc.filter(isOnlineClient).length;
              return (
                <div className={cn(
                  "flex items-center gap-4 p-4 rounded-2xl border",
                  `bg-${selectedColor}-500/5 border-${selectedColor}-500/15`
                )}>
                  <div className={cn("p-2.5 rounded-xl", `bg-${selectedColor}-500/10 text-${selectedColor}-400`)}>
                    <Package size={18} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 flex-wrap">
                      <span className="text-sm font-black text-white uppercase tracking-tight">{selectedContainer}</span>
                      <span className={cn("text-[9px] font-black px-2 py-0.5 rounded-full border uppercase tracking-widest",
                        active > 0
                          ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                          : "bg-slate-800 text-slate-500 border-white/5"
                      )}>
                        {active}/{cc.length} actifs
                      </span>
                    </div>
                    <div className="flex items-center gap-4 mt-1">
                      <span className="text-[9px] font-mono text-emerald-400 flex items-center gap-1">
                        <ArrowDown size={9} />{formatBytes(cc.reduce((a, c) => a + (c.downloadRate || 0), 0))}/s
                      </span>
                      <span className="text-[9px] font-mono text-indigo-400 flex items-center gap-1">
                        <ArrowUp size={9} />{formatBytes(cc.reduce((a, c) => a + (c.uploadRate || 0), 0))}/s
                      </span>
                    </div>
                  </div>
                </div>
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
