import { memo, useMemo, useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Package, Users, Activity, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn, formatBytes, COLOR_MAP } from '../../../lib/utils';
import GlassCard from '../../../components/ui/Card';
import ClientCard from './ClientCard';
import { isOnlineClient } from './ClientListHelpers';

const PAGE_SIZE = 20;

const ClientGridView = ({
  activeContainer,
  containerGroups,
  selectedColor,
  containerClients,
  onlinePeers = [],
  search,
  selectedIds = new Set(),
  onToggleSelect,
  onSelect,
  onToggle,
  onEdit,
  onQRCode,
  onDelete,
}) => {
  const onlinePeersSet = useMemo(() => new Set(onlinePeers), [onlinePeers]);
  const [page, setPage] = useState(0);
  useEffect(() => {
    setPage(0);
  }, [activeContainer, search]);

  const cc = containerGroups[activeContainer] || [];
  const active = cc.filter((c) => isOnlineClient(c) || onlinePeersSet.has(c.publicKey)).length;

  const totalPages = Math.ceil(containerClients.length / PAGE_SIZE);
  const safePage = Math.min(page, Math.max(0, totalPages - 1));
  const pageClients = containerClients.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  return (
    <motion.div
      key={`container-${activeContainer}`}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
      className="space-y-4"
    >
      <motion.div
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        className="flex flex-col md:flex-row items-start md:items-center gap-6 p-6 rounded-[2rem] border relative overflow-hidden group"
        style={{
          backgroundColor: `${COLOR_MAP[selectedColor]?.[500] || '#6366f1'}1a`,
          borderColor: `${COLOR_MAP[selectedColor]?.[500] || '#6366f1'}33`,
        }}
      >
        <div
          className={cn(
            'absolute inset-0 bg-gradient-to-r from-transparent to-white/[0.02] pointer-events-none'
          )}
        />
        <div
          className="p-4 rounded-2xl shadow-2xl"
          style={{
            backgroundColor: `${COLOR_MAP[selectedColor]?.[500] || '#6366f1'}1a`,
            color: COLOR_MAP[selectedColor]?.[400] || '#818cf8',
          }}
        >
          <Package size={24} />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-xl font-black text-white italic tracking-tighter mb-1">
            {activeContainer}
          </h2>
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1.5 text-[11px] font-black text-slate-400 uppercase tracking-widest">
              <Users size={12} /> {cc.length} Peers Total
            </span>
            <div className="h-1 w-1 rounded-full bg-slate-700" />
            <span className="flex items-center gap-1.5 text-[11px] font-black text-emerald-400 uppercase tracking-widest">
              <Activity size={12} /> {active} Actifs
            </span>
          </div>
        </div>
        <div className="hidden md:flex gap-8 px-8 border-l border-white/10 font-mono">
          <div className="text-right">
            <span className="block text-[11px] font-black text-slate-500 uppercase mb-1">
              Download
            </span>
            <span className="text-xl font-black text-white">
              {formatBytes(cc.reduce((a, c) => a + (c.downloadRate || 0), 0))}/s
            </span>
          </div>
          <div className="text-right">
            <span className="block text-[11px] font-black text-slate-500 uppercase mb-1">
              Upload
            </span>
            <span className="text-xl font-black text-white">
              {formatBytes(cc.reduce((a, c) => a + (c.uploadRate || 0), 0))}/s
            </span>
          </div>
        </div>
      </motion.div>

      {containerClients.length === 0 ? (
        <GlassCard
          className="flex flex-col items-center justify-center py-20 border-dashed"
          hover={false}
        >
          <div className="p-6 bg-white/5 rounded-full mb-4">
            <Users size={40} className="text-slate-600" />
          </div>
          <h3 className="text-lg font-black text-white mb-1">
            {search ? 'Aucun résultat' : 'Conteneur Vide'}
          </h3>
          <p className="text-slate-500 text-[11px] font-black uppercase tracking-widest">
            {search ? `Aucun peer ne correspond à "${search}"` : 'Aucun peer dans ce conteneur'}
          </p>
        </GlassCard>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-5">
            <AnimatePresence mode="popLayout">
              {pageClients.map((client, idx) => (
                <motion.div
                  key={client.id}
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ delay: Math.min(idx * 0.03, 0.3), duration: 0.25 }}
                >
                  <ClientCard
                    client={client}
                    color={selectedColor}
                    isOnlineOverride={onlinePeersSet.has(client.publicKey)}
                    isSelected={selectedIds.has(client.id)}
                    onToggleSelect={onToggleSelect}
                    onSelect={onSelect}
                    onToggle={onToggle}
                    onEdit={onEdit}
                    onQRCode={onQRCode}
                    onDelete={onDelete}
                  />
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-4 pt-2">
              <button
                onClick={() => setPage(Math.max(0, safePage - 1))}
                disabled={safePage === 0}
                className="p-2 rounded-xl bg-white/5 border border-white/5 hover:bg-white/10 text-slate-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-all"
              >
                <ChevronLeft size={16} />
              </button>
              <span className="text-[11px] font-black text-slate-500 uppercase tracking-widest">
                Page {safePage + 1} / {totalPages}
                <span className="ml-2 text-slate-600">({containerClients.length} peers)</span>
              </span>
              <button
                onClick={() => setPage(Math.min(totalPages - 1, safePage + 1))}
                disabled={safePage >= totalPages - 1}
                className="p-2 rounded-xl bg-white/5 border border-white/5 hover:bg-white/10 text-slate-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-all"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          )}
        </>
      )}
    </motion.div>
  );
};

export default memo(ClientGridView);
