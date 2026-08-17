import React, { useState, useEffect, useCallback } from 'react';
import { UserCircle, Clock, AlertTriangle, Infinity as InfinityIcon, RefreshCw } from 'lucide-react';
import GlassCard from '../../../components/ui/Card';
import { axiosInstance } from '../../../lib/api';
import { useLang } from '../../../context/LanguageContext';
import { cn } from '../../../lib/utils';

// Couleur d'urgence commune au compte et aux peers : rouge une fois dépassé,
// ambre à l'approche, neutre sinon. `days` null = illimité.
const tone = (days, soon) => {
  if (days === null) return 'text-slate-400';
  if (days < 0) return 'text-red-400';
  if (days <= soon) return 'text-amber-400';
  return 'text-emerald-400';
};

const AccountSection = () => {
  const { t } = useLang();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axiosInstance.get('/me');
      setData(res.data);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading && !data) {
    return (
      <GlassCard hover={false} className="flex items-center gap-3 text-slate-400">
        <RefreshCw className="animate-spin" size={16} /> {t('loading')}
      </GlassCard>
    );
  }
  if (!data) {
    return (
      <GlassCard hover={false}>
        <p className="text-[11px] text-slate-500 italic">{t('account_load_err')}</p>
      </GlassCard>
    );
  }

  const { account, peers, totals, soonDays } = data;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-5 duration-500">
      {/* Bandeau d'échéance — n'apparaît que s'il y a réellement une échéance
          proche ou dépassée (un compte illimité ne doit rien afficher). */}
      {(account.expiringSoon || account.expired) && (
        <div
          className={cn(
            'flex items-start gap-4 px-5 py-4 rounded-2xl border',
            account.expired
              ? 'bg-red-500/10 border-red-500/20 text-red-300'
              : 'bg-amber-500/10 border-amber-500/20 text-amber-300'
          )}
        >
          <AlertTriangle size={20} className="flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-black text-sm">
              {account.expired ? t('account_expired_title') : t('account_expiring_title')}
            </p>
            <p className="text-[12px] opacity-90 mt-0.5">
              {account.expired
                ? t('account_expired_desc')
                : `${t('account_expiring_desc')} ${account.daysLeft} ${t('days_left')}.`}
            </p>
          </div>
        </div>
      )}

      <GlassCard hover={false}>
        <div className="flex flex-col md:flex-row md:items-center gap-6">
          <div className="p-4 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 w-fit">
            <UserCircle size={28} className="text-indigo-400" />
          </div>
          <div className="flex-1">
            <h2 className="text-2xl font-black text-white tracking-tight">{account.username}</h2>
            <p className="text-[11px] font-black uppercase tracking-widest text-slate-500 mt-1">
              {account.role}
              {account.email ? ` · ${account.email}` : ''}
            </p>
          </div>
          <div className="md:text-right">
            <div className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">
              {t('my_subscription')}
            </div>
            {account.expiry === null ? (
              <div className="flex items-center gap-2 text-slate-300 md:justify-end">
                <InfinityIcon size={20} />
                <span className="text-xl font-black">{t('unlimited')}</span>
              </div>
            ) : (
              <>
                <div className={cn('text-3xl font-black', tone(account.daysLeft, soonDays))}>
                  {account.daysLeft < 0
                    ? `${t('expired_since')} ${Math.abs(account.daysLeft)} j`
                    : `${account.daysLeft} ${t('days_left')}`}
                </div>
                <div className="text-[11px] font-mono text-slate-500 mt-1">
                  {new Date(account.expiry).toLocaleDateString('fr-FR')}
                </div>
              </>
            )}
          </div>
        </div>
      </GlassCard>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: t('peers_total'), value: totals.total, accent: 'text-white' },
          { label: t('peers_active'), value: totals.active, accent: 'text-emerald-400' },
          { label: t('peers_expiring'), value: totals.expiringSoon, accent: 'text-amber-400' },
          { label: t('peers_expired'), value: totals.expired, accent: 'text-red-400' },
        ].map((c) => (
          <GlassCard key={c.label} hover={false}>
            <div className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">
              {c.label}
            </div>
            <div className={cn('text-3xl font-black', c.accent)}>{c.value}</div>
          </GlassCard>
        ))}
      </div>

      <GlassCard hover={false} className="p-0 overflow-hidden">
        <div className="p-6 border-b border-white/5 flex items-center gap-2">
          <Clock size={18} className="text-slate-400" />
          <h3 className="text-lg font-black text-white tracking-tight">{t('my_peers_expiry')}</h3>
        </div>
        {peers.length === 0 ? (
          <p className="p-6 text-[11px] text-slate-500 italic">{t('no_peers_yet')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left min-w-[520px]">
              <thead>
                <tr className="text-[10px] font-black uppercase tracking-widest text-slate-500 border-b border-white/5">
                  <th className="px-6 py-3">{t('col_identity')}</th>
                  <th className="px-6 py-3">{t('container_word')}</th>
                  <th className="px-6 py-3">{t('col_expiry')}</th>
                  <th className="px-6 py-3 text-right">{t('col_status')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {peers.map((p) => (
                  <tr key={p.id}>
                    <td className="px-6 py-3 font-bold text-white">{p.name}</td>
                    <td className="px-6 py-3 text-[12px] font-mono text-slate-400">{p.container}</td>
                    <td className="px-6 py-3">
                      {p.daysLeft === null ? (
                        <span className="text-[11px] text-slate-500 italic">{t('unlimited')}</span>
                      ) : (
                        <div className="leading-tight">
                          <div className={cn('text-[13px] font-black', tone(p.daysLeft, soonDays))}>
                            {p.daysLeft < 0
                              ? `${t('expired_since')} ${Math.abs(p.daysLeft)} j`
                              : `${p.daysLeft} ${t('days_left')}`}
                          </div>
                          <div className="text-[10px] font-mono text-slate-600">
                            {new Date(p.expiry).toLocaleDateString('fr-FR')}
                          </div>
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-3 text-right">
                      <span
                        className={cn(
                          'text-[10px] font-black uppercase tracking-widest px-3 py-1 rounded-lg border',
                          p.enabled
                            ? 'text-emerald-400 bg-emerald-500/5 border-emerald-500/10'
                            : 'text-slate-500 bg-white/5 border-white/5'
                        )}
                      >
                        {p.enabled ? t('status_active') : t('status_suspended')}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </GlassCard>
    </div>
  );
};

export default AccountSection;
