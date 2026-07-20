import React from 'react';
import { Shield, ShieldCheck, Activity, ArrowRight, Zap } from 'lucide-react';
import { motion } from 'framer-motion';
import { cn } from '../../../lib/utils';
import { axiosInstance } from '../../../lib/api';
import { useLang } from '../../../context/LanguageContext';

const SecuritySettings = ({ addToast, isDark, theme }) => {
  const { t } = useLang();
  return (
    <motion.div
      key="sec"
      initial={{ opacity: 0, x: 10 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -10 }}
      className="space-y-6"
    >
      <div className="flex items-center justify-between">
        <h3
          className={cn(
            'text-xl font-black flex items-center gap-3 italic transition-colors',
            isDark ? 'text-white' : 'text-slate-900'
          )}
        >
          <Shield size={20} className="text-rose-400" /> Hardening Profile
        </h3>
        <div
          className={cn(
            'px-4 py-1.5 rounded-full border text-[11px] font-black uppercase tracking-[0.2em]',
            isDark
              ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
              : 'bg-emerald-50 border-emerald-200 text-emerald-600'
          )}
        >
          SENTINEL ACTIVE
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <div
          className={cn(
            'p-8 rounded-[2rem] border relative group hover:border-white/10 transition-all',
            isDark
              ? 'bg-white/5 border-white/5'
              : 'bg-slate-50 border-black/5 shadow-sm hover:border-indigo-500/20'
          )}
        >
          <div className="absolute top-4 right-4 animate-pulse">
            <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_10px_#10b981]" />
          </div>
          <h4
            className={cn(
              'text-sm font-black uppercase tracking-widest mb-4 flex items-center gap-3 transition-colors',
              isDark ? 'text-white' : 'text-slate-900'
            )}
          >
            <ShieldCheck size={18} /> Encryption Module
          </h4>
          <p className="text-[11px] text-slate-500 font-bold uppercase tracking-widest leading-relaxed mb-6">
            {t('sec_encryption_desc')}
          </p>
          <button className="text-[11px] font-black text-indigo-400 hover:text-white uppercase tracking-[0.2em] flex items-center gap-2 transition-all">
            {t('sec_analyze_integrity')} <ArrowRight size={14} />
          </button>
        </div>
        <div
          className={cn(
            'p-8 rounded-[2rem] border relative group transition-all',
            isDark
              ? 'bg-white/5 border-white/5 hover:border-white/10'
              : 'bg-slate-50 border-black/5 shadow-sm hover:border-indigo-500/20'
          )}
        >
          <h4
            className={cn(
              'text-sm font-black uppercase tracking-widest mb-4 flex items-center gap-3 transition-colors',
              isDark ? 'text-white' : 'text-slate-900'
            )}
          >
            <Activity size={18} /> Packet Filtering
          </h4>
          <p className="text-[11px] text-slate-500 font-bold uppercase tracking-widest leading-relaxed mb-6">
            {t('sec_packet_desc')}
          </p>
          <button className="text-[11px] font-black text-indigo-400 hover:text-white uppercase tracking-[0.2em] flex items-center gap-2 transition-all">
            {t('sec_firewall_logs')} <ArrowRight size={14} />
          </button>
        </div>
      </div>

      <div className={cn('grid grid-cols-1 gap-8 mt-4')}>
        <div
          className={cn(
            'p-8 rounded-[2rem] border relative group transition-all',
            isDark
              ? 'bg-white/5 border-white/5 hover:border-white/10'
              : 'bg-slate-50 border-black/5 shadow-sm hover:border-indigo-500/20'
          )}
        >
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="space-y-4">
              <h4
                className={cn(
                  'text-sm font-black uppercase tracking-widest flex items-center gap-3 transition-colors',
                  isDark ? 'text-white' : 'text-slate-900'
                )}
              >
                <Zap size={18} className="text-amber-400" /> Telegram Sentinel
              </h4>
              <p className="text-[11px] text-slate-500 font-bold uppercase tracking-widest leading-relaxed max-w-xl">
                {t('sec_telegram_desc')}
              </p>
            </div>
            <button
              onClick={async () => {
                try {
                  await axiosInstance.post('/system/test-telegram', {});
                  addToast(t('telegram_test_ok'), 'success');
                } catch (e) {
                  addToast(t('telegram_test_err'), 'error');
                }
              }}
              className={cn(
                'whitespace-nowrap px-8 py-4 rounded-2xl text-[11px] font-black uppercase tracking-[0.2em] transition-all active:scale-95',
                isDark
                  ? 'bg-white/5 hover:bg-white/10 text-white'
                  : 'bg-indigo-600 text-white shadow-lg hover:bg-indigo-500 shadow-indigo-600/20'
              )}
            >
              {t('test_connection')}
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  );
};

export default SecuritySettings;
