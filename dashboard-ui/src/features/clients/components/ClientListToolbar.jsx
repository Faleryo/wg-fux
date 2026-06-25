import { motion, AnimatePresence } from 'framer-motion';
import { ChevronLeft, Package, Search, Download, Plus } from 'lucide-react';
import { cn, formatBytes, COLOR_MAP } from '../../../lib/utils';
import GlassCard from '../../../components/ui/Card';
import VibeButton from '../../../components/ui/Button';
import { isOnlineClient } from './ClientListHelpers';

const ClientListToolbar = ({
  activeContainer,
  setActiveContainer,
  selectedColor,
  search,
  setSearch,
  containerEntriesLength,
  containerGroups,
  onCreateClient,
  onCreateContainer,
  clients,
  containerClients,
}) => {
  const handleExportCSV = () => {
    const list = activeContainer ? containerClients : clients;
    const hdrs = ['Nom', 'Container', 'IP', 'Statut', 'DL', 'UL', 'Quota (GB)', 'Expiration'];
    const rows = list.map((c) => [
      c.name,
      c.container,
      c.ip,
      isOnlineClient(c) ? 'En ligne' : 'Hors ligne',
      formatBytes(c.downloadBytes || 0),
      formatBytes(c.uploadBytes || 0),
      c.quota > 0 ? `${c.quota}` : 'Illimité',
      c.expiry ? new Date(c.expiry).toLocaleDateString('fr-FR') : 'Illimité',
    ]);
    const csv = [hdrs, ...rows].map((r) => r.map((v) => `"${v}"`).join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), {
      href: url,
      download: `wg-fux-peers-${new Date().toISOString().split('T')[0]}.csv`,
    });
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <GlassCard className="flex flex-col sm:flex-row gap-4 items-center justify-between p-5">
      <div className="flex items-center gap-3 w-full sm:w-auto">
        <AnimatePresence>
          {activeContainer && (
            <motion.button
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -12 }}
              onClick={() => {
                setActiveContainer(null);
                setSearch('');
              }}
              className={
                'flex items-center gap-2 px-3 py-2.5 rounded-2xl border font-black text-[10px] uppercase tracking-widest transition-all flex-shrink-0'
              }
              style={{
                backgroundColor: `${COLOR_MAP[selectedColor]?.[500] || '#6366f1'}1A`,
                color: COLOR_MAP[selectedColor]?.[400] || '#818cf8',
                borderColor: `${COLOR_MAP[selectedColor]?.[500] || '#6366f1'}33`,
              }}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = `${COLOR_MAP[selectedColor]?.[500] || '#6366f1'}33`; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = `${COLOR_MAP[selectedColor]?.[500] || '#6366f1'}1A`; }}
            >
              <ChevronLeft size={15} />
              <span className="hidden sm:inline">Conteneurs</span>
            </motion.button>
          )}
        </AnimatePresence>

        <div className="min-w-0">
          {activeContainer ? (
            <div className="flex items-center gap-2">
              <Package size={16} style={{ color: COLOR_MAP[selectedColor]?.[400] || '#818cf8' }} />
              <span className="text-white font-black text-sm uppercase tracking-tight truncate">
                {activeContainer}
              </span>
              <span
                className={'text-[9px] px-2 py-0.5 rounded-full border font-black uppercase'}
              style={{
                backgroundColor: `${COLOR_MAP[selectedColor]?.[500] || '#6366f1'}1A`,
                color: COLOR_MAP[selectedColor]?.[400] || '#818cf8',
                borderColor: `${COLOR_MAP[selectedColor]?.[500] || '#6366f1'}33`,
              }}
              >
                {(containerGroups[activeContainer] || []).length} peers
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-slate-400">
              <Package size={16} />
              <span className="font-black text-sm uppercase tracking-tight">
                {containerEntriesLength} Conteneur{containerEntriesLength > 1 ? 's' : ''}
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3 w-full sm:w-auto">
        <AnimatePresence>
          {activeContainer && (
            <motion.div
              initial={{ opacity: 0, width: 0 }}
              animate={{ opacity: 1, width: 'auto' }}
              exit={{ opacity: 0, width: 0 }}
              className="relative group overflow-hidden"
            >
              <Search
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-white transition-colors"
                size={15}
              />
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
        <div className="flex items-center gap-3">
          <button
            onClick={handleExportCSV}
            className="hidden sm:flex items-center gap-2 p-3 rounded-2xl bg-white/5 border border-white/5 hover:bg-white/10 hover:border-white/10 text-slate-400 hover:text-white transition-all group"
            title="Exporter CSV"
          >
            <Download size={16} className="group-hover:-translate-y-0.5 transition-transform" />
          </button>
          <VibeButton
            variant="primary"
            icon={Plus}
            onClick={() => {
              if (activeContainer) {
                onCreateClient(activeContainer);
              } else {
                onCreateContainer();
              }
            }}
            className="flex-shrink-0"
          >
            <span className="hidden sm:inline">
              {activeContainer ? 'Nouveau Peer' : 'Nouveau Conteneur'}
            </span>
            <span className="sm:hidden">Créer</span>
          </VibeButton>
        </div>
      </div>
    </GlassCard>
  );
};

export default ClientListToolbar;
