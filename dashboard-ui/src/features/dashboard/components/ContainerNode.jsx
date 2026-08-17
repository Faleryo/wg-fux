import React from 'react';
import { motion } from 'framer-motion';
import { Package } from 'lucide-react';
import { cn, COLOR_MAP } from '../../../lib/utils';

// Nœud « conteneur » du premier niveau de la carte. Cliquer dessus descend d'un
// cran et n'affiche plus que SES peers : afficher toute la flotte d'un coup
// devient illisible dès quelques dizaines de peers.
const ContainerNode = ({ group, position, index = 0, isDark, isMobile, onSelect, color }) => {
  const x = position?.x ?? 0;
  const y = position?.y ?? 0;
  const hex = COLOR_MAP[color?.name]?.[500] || '#6366f1';
  const hasOnline = group.online > 0;

  return (
    <motion.div
      initial={{ scale: 0, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ delay: index * 0.05, type: 'spring' }}
      className="absolute z-20 group/cont cursor-pointer"
      style={{ left: x, top: y, transform: 'translate(-50%, -50%)' }}
      onClick={() => onSelect(group.name)}
      title={group.name}
    >
      <div
        className={cn(
          'backdrop-blur-md border-[3px] rounded-2xl flex flex-col items-center justify-center transition-all duration-500 group-hover/cont:scale-125 shadow-2xl',
          isMobile ? 'w-14 h-14' : 'w-20 h-20',
          isDark ? 'bg-slate-900/80' : 'bg-white/80'
        )}
        style={{ borderColor: hex + '80', backgroundColor: hex + '1a' }}
      >
        <Package size={isMobile ? 18 : 26} style={{ color: hex }} />
        <span className="text-[10px] font-black font-mono mt-0.5" style={{ color: hex }}>
          {group.total}
        </span>
        {hasOnline && (
          <span
            className={cn(
              'absolute -top-1.5 -right-1.5 rounded-full border-4 bg-emerald-500 shadow-[0_0_15px_#10b981]',
              isMobile ? 'w-3.5 h-3.5 border-[3px]' : 'w-4 h-4',
              isDark ? 'border-slate-950' : 'border-white'
            )}
          ></span>
        )}
      </div>

      <div
        className={cn(
          'absolute top-full left-1/2 -translate-x-1/2 mt-3 px-3 py-1.5 rounded-xl border whitespace-nowrap text-[10px] font-black uppercase tracking-widest transition-opacity duration-300',
          isDark ? 'bg-slate-950/90 border-white/10 text-white' : 'bg-white border-black/10 text-slate-900'
        )}
      >
        {group.name}
        <span className="ml-2 text-emerald-400">{group.online}</span>
        <span className="text-slate-500">/{group.total}</span>
      </div>
    </motion.div>
  );
};

export default ContainerNode;
