import React from 'react';
import { Download, AlertTriangle } from 'lucide-react';
import { motion } from 'framer-motion';
import { cn } from '../../../lib/utils';

const MaintenanceSettings = ({ handleBackup, isDark, theme }) => {
  return (
    <motion.div
      key="maint"
      initial={{ opacity: 0, x: 10 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -10 }}
      className="grid grid-cols-1 md:grid-cols-2 gap-10"
    >
      <div className="space-y-8">
        <h3
          className={cn(
            'text-xl font-black flex items-center gap-3 italic uppercase transition-colors',
            isDark ? 'text-white' : 'text-slate-900'
          )}
        >
          <Download size={20} className="text-emerald-400" /> Archives
        </h3>
        <p className="text-[11px] text-slate-500 font-bold uppercase tracking-widest leading-loose">
          Exportation complète du cluster : certificats, configurations d'interfaces et
          database SQL cryptée.
        </p>
        <button
          onClick={handleBackup}
          className="w-full flex items-center justify-center gap-3 px-8 py-4 bg-slate-950 border border-white/5 rounded-2xl text-slate-400 hover:text-white hover:bg-slate-900 transition-all group"
        >
          <Download
            size={18}
            className="group-hover:-translate-y-1 transition-transform"
          />
          <span className="text-[10px] font-black uppercase tracking-widest">
            Générer Backup .tar.gz
          </span>
        </button>
      </div>
      <div className="space-y-8">
        <h3
          className={cn(
            'text-xl font-black flex items-center gap-3 italic uppercase transition-colors',
            isDark ? 'text-white' : 'text-slate-900'
          )}
        >
          <AlertTriangle size={20} className="text-rose-600" /> Danger Zone
        </h3>
        <div className="p-8 bg-rose-950/20 border border-rose-500/20 rounded-[2.5rem] space-y-6">
          <div>
            <h4 className="text-sm font-black text-rose-400 uppercase tracking-widest mb-2">
              Nuclear Reset
            </h4>
            <p className="text-[10px] text-rose-500/60 font-bold uppercase tracking-widest leading-relaxed">
              Réinitialisation complète de l'architecture. Perte irrémédiable de toutes
              les routes vpn.
            </p>
          </div>
          <button className="w-full py-4 bg-rose-600/10 hover:bg-rose-600 text-rose-500 hover:text-white border border-rose-600/20 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all">
            Restaurer Valeurs Usine
          </button>
        </div>
      </div>
    </motion.div>
  );
};

export default MaintenanceSettings;
