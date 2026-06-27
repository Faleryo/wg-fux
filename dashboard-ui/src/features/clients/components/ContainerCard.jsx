import { motion } from 'framer-motion';
import { Package, Trash2, ChevronRight } from 'lucide-react';
import { cn, formatBytes, COLOR_MAP } from '../../../lib/utils';
import GlassCard from '../../../components/ui/Card';
import { isOnlineClient } from './ClientListHelpers';

const BASE_COLOR = '#6366f1';
const getHex = (c, shade) => COLOR_MAP[c]?.[shade] || BASE_COLOR;

const ContainerCard = ({ name, clients, color, onClick, onDeleteContainer, idx }) => {
  const activeCount = clients.filter(isOnlineClient).length;
  const totalDl = clients.reduce((a, c) => a + (c.downloadRate || 0), 0);
  const totalUl = clients.reduce((a, c) => a + (c.uploadRate || 0), 0);
  const totalDlBytes = clients.reduce((a, c) => a + (c.downloadBytes || 0), 0);
  const totalUlBytes = clients.reduce((a, c) => a + (c.uploadBytes || 0), 0);
  const quotaCritical = clients.filter((c) => {
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
        <div
          className="absolute inset-0 opacity-0 group-hover:opacity-10 transition-opacity duration-700"
          style={{
            background: `linear-gradient(to bottom right, ${getHex(color, 500)}, transparent)`,
          }}
        />

        <div
          className="h-1.5 w-full transition-all duration-700 group-hover:h-2 opacity-80"
          style={{
            backgroundColor: getHex(color, 500),
            boxShadow: `0 4px 12px ${getHex(color, 500)}80`,
          }}
        />

        <div className="p-6 space-y-6 relative z-10">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div
                className="p-3 rounded-2xl border transition-all duration-500 group-hover:scale-110 group-hover:rotate-6"
                style={{
                  backgroundColor: `${getHex(color, 500)}1a`,
                  color: getHex(color, 400),
                  borderColor: `${getHex(color, 500)}33`,
                }}
              >
                <Package size={24} />
              </div>
              <div className="min-w-0">
                <h3 className="text-xl font-black text-white uppercase tracking-tight truncate">
                  {name}
                </h3>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span
                    className={cn(
                      'text-[8px] font-black px-2 py-0.5 rounded-full border uppercase tracking-widest',
                      activeCount > 0
                        ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                        : 'bg-slate-800 text-slate-500'
                    )}
                  >
                    {activeCount}/{clients.length} EN LIGNE
                  </span>
                </div>
              </div>
            </div>
            <div className="flex gap-2 items-center">
              {clients.length === 0 && onDeleteContainer && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteContainer(name);
                  }}
                  className={cn(
                    'w-8 h-8 rounded-full border flex items-center justify-center transition-all duration-500 hover:bg-red-500/10 hover:text-red-400 hover:border-red-500/20 text-slate-500 border-white/5'
                  )}
                >
                  <Trash2 size={14} />
                </button>
              )}
              <div
                className="w-8 h-8 rounded-full border flex items-center justify-center transition-all duration-500 group-hover:bg-white/10"
                style={{
                  color: getHex(color, 400),
                  borderColor: `${getHex(color, 500)}1a`,
                }}
              >
                <ChevronRight
                  size={16}
                  className="group-hover:translate-x-0.5 transition-transform"
                />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest block">
                Flux Sortant
              </span>
              <div className="flex items-end gap-1.5">
                <span className="text-lg font-mono font-black text-white italic">
                  {formatBytes(totalDl)}
                </span>
                <span className="text-[9px] text-slate-600 mb-1">/S</span>
              </div>
            </div>
            <div className="space-y-1">
              <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest block">
                Flux Entrant
              </span>
              <div className="flex items-end gap-1.5">
                <span className="text-lg font-mono font-black text-white italic">
                  {formatBytes(totalUl)}
                </span>
                <span className="text-[9px] text-slate-600 mb-1">/S</span>
              </div>
            </div>
          </div>

          <div className="pt-4 border-t border-white/5 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="flex -space-x-2">
                {clients.slice(0, 3).map((c, i) => (
                  <div
                    key={i}
                    className={cn(
                      'w-6 h-6 rounded-lg border-2 border-slate-950 flex items-center justify-center text-[8px] font-black text-white',
                      isOnlineClient(c) ? '' : 'bg-slate-800'
                    )}
                    style={isOnlineClient(c) ? {
                      backgroundColor: getHex(color, 500),
                      boxShadow: `0 4px 12px ${getHex(color, 500)}33`,
                    } : undefined}
                  >
                    {(c.name || '?').charAt(0)}
                  </div>
                ))}
              </div>
              {clients.length > 3 && (
                <span className="text-[9px] font-black text-slate-600">+{clients.length - 3}</span>
              )}
            </div>
            <div className="flex flex-col items-end">
              <span className="text-[9px] font-mono text-slate-500 uppercase">Volume Total</span>
              <span className="text-[10px] font-mono font-black text-white">
                {formatBytes(totalDlBytes + totalUlBytes)}
              </span>
            </div>
          </div>
        </div>
      </GlassCard>
    </motion.div>
  );
};

export default ContainerCard;
