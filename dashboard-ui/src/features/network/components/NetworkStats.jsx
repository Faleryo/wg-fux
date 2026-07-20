import React, { useState, useEffect } from 'react';
import { TrendingUp, BarChart3 } from 'lucide-react';
import GlassCard from '../../../components/ui/Card';
import { axiosInstance } from '../../../lib/api';
import { useLang } from '../../../context/LanguageContext';

const euros = (cents) => (cents / 100).toFixed(0) + ' €';
const shortMonth = (ym, locale) => {
  const [y, m] = ym.split('-');
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString(locale, { month: 'short' });
};

// Courbes business (12 mois) : crédits acquis / revendus / consommés + marge.
const NetworkStats = () => {
  const { t, lang } = useLang();
  const locale = lang === 'fr' ? 'fr-FR' : 'en-GB';
  const [series, setSeries] = useState(null);

  useEffect(() => {
    let on = true;
    axiosInstance
      .get('/wallet/stats')
      .then((r) => on && setSeries(r.data?.series || []))
      .catch(() => on && setSeries([]));
    return () => {
      on = false;
    };
  }, []);

  if (!series) return null;

  const maxCredits = Math.max(1, ...series.map((m) => Math.max(m.acquired, m.resold, m.consumed)));
  const totalMargin = series.reduce((a, m) => a + m.marginCents, 0);
  const totalResold = series.reduce((a, m) => a + m.resold, 0);

  return (
    <GlassCard hover={false}>
      <div className="flex items-center justify-between mb-5">
        <h3 className="text-lg font-black text-white tracking-tight flex items-center gap-2">
          <BarChart3 size={18} /> {t('activity_12m')}
        </h3>
        <div className="flex items-center gap-6 text-right">
          <div>
            <div className="text-[10px] font-black text-slate-500 tracking-widest">
              {t('cumulative_margin')}
            </div>
            <div className="text-lg font-black text-emerald-400 inline-flex items-center gap-1">
              <TrendingUp size={14} /> {euros(totalMargin)}
            </div>
          </div>
          <div>
            <div className="text-[10px] font-black text-slate-500 tracking-widest">
              {t('credits_resold')}
            </div>
            <div className="text-lg font-black text-white">{totalResold}</div>
          </div>
        </div>
      </div>

      {/* Histogramme mensuel (acquis vs revendus vs consommés) */}
      <div className="flex items-end justify-between gap-1.5 h-40">
        {series.map((m) => (
          <div key={m.month} className="flex-1 flex flex-col items-center gap-1.5 group">
            <div className="w-full flex items-end justify-center gap-0.5 h-32">
              {[
                ['acquired', 'bg-sky-500/70', t('acquired')],
                ['resold', 'bg-emerald-500/70', t('resold')],
                ['consumed', 'bg-amber-500/70', t('consumed')],
              ].map(([k, color, lab]) => (
                <div
                  key={k}
                  title={`${lab} : ${m[k]}`}
                  className={`w-1/3 rounded-t ${color} transition-all group-hover:opacity-100 opacity-80`}
                  style={{ height: `${Math.max(2, (m[k] / maxCredits) * 100)}%` }}
                />
              ))}
            </div>
            <span className="text-[9px] font-mono text-slate-600">
              {shortMonth(m.month, locale)}
            </span>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-4 mt-4 text-[10px] font-bold text-slate-500">
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm bg-sky-500/70" /> {t('acquired')}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500/70" /> {t('resold')}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm bg-amber-500/70" /> {t('consumed')}
        </span>
      </div>
    </GlassCard>
  );
};

export default NetworkStats;
