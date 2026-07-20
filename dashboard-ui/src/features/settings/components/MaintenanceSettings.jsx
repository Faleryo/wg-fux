import React from 'react';
import { Download, AlertTriangle } from 'lucide-react';
import { motion } from 'framer-motion';
import { cn } from '../../../lib/utils';
import { useLang } from '../../../context/LanguageContext';

const MaintenanceSettings = ({ handleBackup, isDark, theme }) => {
  const { t } = useLang();
  return (
    <motion.div
      key="maint"
      initial={{ opacity: 0, x: 10 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -10 }}
      className="grid grid-cols-1 md:grid-cols-2 gap-10"
    >
      <div className="space-y-6">
        <h3
          className={cn(
            'text-xl font-black flex items-center gap-3 italic transition-colors',
            isDark ? 'text-white' : 'text-slate-900'
          )}
        >
          <Download size={20} className="text-emerald-400" /> Archives
        </h3>
        <p className="text-[11px] text-slate-500 font-bold uppercase tracking-widest leading-loose">
          {t('maint_archives_desc')}
        </p>
        <button
          onClick={handleBackup}
          className="w-full flex items-center justify-center gap-3 px-8 py-4 bg-slate-950 border border-white/5 rounded-2xl text-slate-400 hover:text-white hover:bg-slate-900 transition-all group"
        >
          <Download size={18} className="group-hover:-translate-y-1 transition-transform" />
          <span className="text-[11px] font-black uppercase tracking-widest">
            {t('maint_generate_backup')}
          </span>
        </button>
      </div>
      <div className="space-y-6">
        <h3
          className={cn(
            'text-xl font-black flex items-center gap-3 italic uppercase transition-colors',
            isDark ? 'text-white' : 'text-slate-900'
          )}
        >
          <AlertTriangle size={20} className="text-rose-600" /> Danger Zone
        </h3>
        <div className="p-8 bg-rose-950/20 border border-rose-500/20 rounded-[2rem] space-y-6">
          <div>
            <h4 className="text-sm font-black text-rose-400 uppercase tracking-widest mb-2">
              Nuclear Reset
            </h4>
            <p className="text-[11px] text-rose-500/60 font-bold uppercase tracking-widest leading-relaxed">
              {t('maint_reset_desc')}
            </p>
          </div>
          <button
            className="w-full py-4 bg-rose-600/10 hover:bg-rose-600 text-rose-500 hover:text-white border border-rose-600/20 rounded-2xl text-[11px] font-black uppercase tracking-widest transition-all disabled:opacity-30 disabled:cursor-not-allowed"
            disabled
          >
            {t('maint_factory_reset')}
          </button>
        </div>
      </div>
    </motion.div>
  );
};

export default MaintenanceSettings;
