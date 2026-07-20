import React, { useState, useEffect } from 'react';
import {
  ShieldCheck,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  X,
  HardDrive,
  Shield,
  Activity,
  Lock,
  Cpu,
  Globe,
  Trash2,
} from 'lucide-react';
import { useTheme } from '../../../context/ThemeContext';
import { useToast } from '../../../context/ToastContext';
import { useLang } from '../../../context/LanguageContext';
import { cn, COLOR_MAP } from '../../../lib/utils';
import { axiosInstance as axios } from '../../../lib/api';
import { motion, AnimatePresence } from 'framer-motion';

const AuditSection = () => {
  const { theme, isDark } = useTheme();
  const { addToast } = useToast();
  const { t } = useLang();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchAudit = () => {
    setLoading(true);
    axios
      .get('/system/audit')
      .then((res) => {
        setData(res.data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  useEffect(() => {
    fetchAudit();
  }, []);

  const securityScore = data
    ? (data.firewall ? 33 : 0) + (data.ipForwarding ? 33 : 0) + (data.fail2ban ? 34 : 0)
    : 0;

  return (
    <div className="space-y-10 animate-in fade-in slide-in-from-bottom-5 duration-700">
      {/* Header */}
      <div
        className={cn(
          'flex flex-col lg:flex-row justify-between items-center p-6 md:p-8 rounded-[2rem] md:rounded-[2rem] border shadow-2xl gap-8 transition-all',
          isDark ? 'bg-slate-900/40 border-white/5 backdrop-blur-xl' : 'bg-white border-black/5'
        )}
      >
        <div className="flex items-center gap-6">
          <div
            className="p-5 rounded-[2rem] bg-white/5 shadow-2xl"
            style={{ color: COLOR_MAP[theme]?.[400] || '#818cf8' }}
          >
            <ShieldCheck size={36} />
          </div>
          <div>
            <h2
              className={cn(
                'text-4xl font-black tracking-tighter italic transition-colors',
                isDark ? 'text-white' : 'text-slate-900'
              )}
            >
              {t('audit_title')}
            </h2>
            <p className="text-slate-500 text-[11px] font-black tracking-[0.4em] uppercase opacity-60">
              System Security Analysis Protocol
            </p>
          </div>
        </div>

        <div className="flex gap-3">
          <button
            onClick={fetchAudit}
            className={cn(
              'p-5 border rounded-[2rem] transition-all group',
              isDark
                ? 'bg-white/5 border-white/5 text-slate-400 hover:text-white hover:bg-white/10'
                : 'bg-slate-50 border-black/5 text-slate-500 hover:text-slate-900 hover:bg-slate-100'
            )}
          >
            <RefreshCw
              size={24}
              className={
                loading
                  ? 'animate-spin'
                  : 'group-hover:rotate-180 transition-transform duration-700'
              }
            />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-8">
        {/* Main Score Board */}
        <div
          className={cn(
            'xl:col-span-1 rounded-[2rem] border p-10 shadow-2xl relative overflow-hidden flex flex-col items-center justify-center text-center transition-all',
            isDark
              ? 'bg-slate-900/40 border-white/10 backdrop-blur-xl'
              : 'bg-white border-black/5 shadow-sm'
          )}
        >
          <div className="relative w-48 h-48 mb-8 flex items-center justify-center">
            <svg className="w-full h-full transform -rotate-90">
              <circle
                cx="96"
                cy="96"
                r="80"
                stroke="currentColor"
                strokeWidth="12"
                fill="transparent"
                className="text-slate-800/50"
              />
              <motion.circle
                key={securityScore}
                cx="96"
                cy="96"
                r="80"
                stroke="currentColor"
                strokeWidth="12"
                fill="transparent"
                initial={{ strokeDashoffset: 502 }}
                animate={{ strokeDashoffset: 502 - (securityScore / 100) * 502 }}
                transition={{ duration: 2, ease: 'easeOut' }}
                className={cn(
                  'transition-all duration-500 shadow-2xl shadow-emerald-500/20',
                  securityScore > 80 ? 'text-emerald-500' : 'text-amber-500'
                )}
                strokeDasharray="502"
                strokeLinecap="round"
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span
                className={cn(
                  'text-6xl font-black italic transition-colors',
                  isDark ? 'text-white' : 'text-slate-900'
                )}
              >
                {securityScore}%
              </span>
              <span className="text-[11px] font-black text-slate-500 uppercase tracking-widest mt-2">
                {securityScore > 80 ? 'Safe' : 'Watch'}
              </span>
            </div>
          </div>
          <h3
            className={cn(
              'text-lg font-black tracking-tighter italic transition-colors',
              isDark ? 'text-white' : 'text-slate-900'
            )}
          >
            {t('integrity_index')}
          </h3>
          <p className="text-[11px] text-slate-500 font-bold uppercase tracking-widest mt-4 leading-loose">
            {t('integrity_desc')}
          </p>
        </div>

        {/* Detailed Checks */}
        <div className="xl:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-8">
          <div
            className={cn(
              'rounded-[2rem] border p-8 shadow-2xl relative group transition-all flex flex-col justify-between',
              isDark
                ? 'bg-slate-900/40 border-white/5 backdrop-blur-xl hover:border-white/10'
                : 'bg-white border-black/5 shadow-sm hover:border-indigo-500/20'
            )}
          >
            <div>
              <div className="flex items-center justify-between mb-6">
                <h3
                  className={cn(
                    'text-sm font-black uppercase tracking-widest flex items-center gap-3 italic transition-colors',
                    isDark ? 'text-white' : 'text-slate-900'
                  )}
                >
                  <Shield size={20} /> Firewall Status
                </h3>
                {loading ? (
                  <RefreshCw className="animate-spin text-slate-700" size={16} />
                ) : data?.firewall ? (
                  <div className="px-3 py-1 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[11px] font-black uppercase rounded-lg">
                    {t('status_active')}
                  </div>
                ) : (
                  <div className="px-3 py-1 bg-amber-500/10 border border-amber-500/20 text-amber-400 text-[11px] font-black uppercase rounded-lg">
                    {t('critical')}
                  </div>
                )}
              </div>
              <p className="text-[11px] text-slate-500 font-bold uppercase tracking-widest leading-relaxed mb-8">
                {t('audit_firewall_desc')}
              </p>
            </div>
            <div className="flex items-center gap-4">
              <div
                className={cn(
                  'p-3 rounded-2xl',
                  data?.firewall ? 'bg-emerald-500 text-white' : 'bg-slate-800 text-slate-600'
                )}
              >
                {data?.firewall ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
              </div>
              <span className="text-[11px] font-black text-slate-400 uppercase tracking-widest">
                {data?.firewall ? t('audit_fw_ok') : t('audit_fw_bad')}
              </span>
            </div>
          </div>

          <div
            className={cn(
              'rounded-[2rem] border p-8 shadow-2xl relative group transition-all flex flex-col justify-between',
              isDark
                ? 'bg-slate-900/40 border-white/5 backdrop-blur-xl hover:border-white/10'
                : 'bg-white border-black/5 shadow-sm hover:border-indigo-500/20'
            )}
          >
            <div>
              <div className="flex items-center justify-between mb-6">
                <h3
                  className={cn(
                    'text-sm font-black uppercase tracking-widest flex items-center gap-3 italic transition-colors',
                    isDark ? 'text-white' : 'text-slate-900'
                  )}
                >
                  <Globe size={20} /> IP Forwarding
                </h3>
                {loading ? (
                  <RefreshCw className="animate-spin text-slate-700" size={16} />
                ) : data?.ipForwarding ? (
                  <div className="px-3 py-1 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[11px] font-black uppercase rounded-lg">
                    OK
                  </div>
                ) : (
                  <div className="px-3 py-1 bg-red-500/10 border border-red-500/20 text-red-500 text-[11px] font-black uppercase rounded-lg">
                    FAILED
                  </div>
                )}
              </div>
              <p className="text-[11px] text-slate-500 font-bold uppercase tracking-widest leading-relaxed mb-8">
                {t('audit_ipfwd_desc')}
              </p>
            </div>
            <div className="flex items-center gap-4">
              <div
                className={cn(
                  'p-3 rounded-2xl',
                  data?.ipForwarding ? 'bg-emerald-500 text-white' : 'bg-slate-800 text-slate-600'
                )}
              >
                {data?.ipForwarding ? <CheckCircle2 size={18} /> : <X size={18} />}
              </div>
              <span className="text-[11px] font-black text-slate-400 uppercase tracking-widest">
                {data?.ipForwarding ? t('audit_ipfwd_ok') : t('audit_ipfwd_bad')}
              </span>
            </div>
          </div>

          <div
            className={cn(
              'rounded-[2rem] border p-8 shadow-2xl relative group transition-all flex flex-col justify-between',
              isDark
                ? 'bg-slate-900/40 border-white/5 backdrop-blur-xl hover:border-white/10'
                : 'bg-white border-black/5 shadow-sm hover:border-indigo-500/20'
            )}
          >
            <div>
              <div className="flex items-center justify-between mb-6">
                <h3
                  className={cn(
                    'text-sm font-black uppercase tracking-widest flex items-center gap-3 italic transition-colors',
                    isDark ? 'text-white' : 'text-slate-900'
                  )}
                >
                  <Lock size={18} /> Fail2Ban Monitor
                </h3>
                {loading ? (
                  <RefreshCw className="animate-spin text-slate-700" size={16} />
                ) : data?.fail2ban ? (
                  <div className="px-3 py-1 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[11px] font-black uppercase rounded-lg">
                    Online
                  </div>
                ) : (
                  <div className="px-3 py-1 bg-slate-800 border border-white/5 text-slate-500 text-[11px] font-black uppercase rounded-lg">
                    N/A
                  </div>
                )}
              </div>
              <p className="text-[11px] text-slate-500 font-bold uppercase tracking-widest leading-relaxed mb-8">
                {t('audit_f2b_desc')}
              </p>
            </div>
            <div className="flex items-center gap-4">
              <div
                className={cn(
                  'p-3 rounded-2xl',
                  data?.fail2ban ? 'bg-emerald-500 text-white' : 'bg-slate-800 text-slate-600'
                )}
              >
                {data?.fail2ban ? <ShieldCheck size={18} /> : <AlertTriangle size={18} />}
              </div>
              <span className="text-[11px] font-black text-slate-400 uppercase tracking-widest">
                {data?.fail2ban ? t('audit_f2b_ok') : t('audit_f2b_bad')}
              </span>
            </div>
          </div>

          <div
            className={cn(
              'rounded-[2rem] border p-8 shadow-2xl relative group transition-all flex flex-col justify-between',
              isDark
                ? 'bg-slate-900/40 border-white/5 backdrop-blur-xl hover:border-white/10'
                : 'bg-white border-black/5 shadow-sm hover:border-indigo-500/20'
            )}
          >
            <div>
              <div className="flex items-center justify-between mb-6">
                <h3
                  className={cn(
                    'text-sm font-black uppercase tracking-widest flex items-center gap-3 italic transition-colors',
                    isDark ? 'text-white' : 'text-slate-900'
                  )}
                >
                  <HardDrive size={18} /> Disk Storage
                </h3>
                <span
                  className={cn(
                    'text-xl font-mono font-black transition-colors',
                    isDark ? 'text-white' : 'text-slate-900'
                  )}
                >
                  {data?.disk || '0%'}
                </span>
              </div>
              <p className="text-[11px] text-slate-500 font-bold uppercase tracking-widest leading-relaxed mb-8">
                {t('audit_disk_desc')}
              </p>
            </div>
            <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: data?.disk || '0%' }}
                className={cn(
                  'h-full transition-all duration-1000',
                  parseInt(data?.disk || 0) > 80 ? 'bg-rose-500' : ''
                )}
                style={
                  parseInt(data?.disk || 0) <= 80
                    ? { backgroundColor: COLOR_MAP[theme]?.[600] || '#4f46e5' }
                    : undefined
                }
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AuditSection;
