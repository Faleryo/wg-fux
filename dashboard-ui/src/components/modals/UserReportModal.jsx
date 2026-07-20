import React, { useState, useEffect } from 'react';
import { axiosInstance } from '../../lib/api';
import { useTheme } from '../../context/ThemeContext';
import { cn, COLOR_MAP } from '../../lib/utils';
import Modal from '../ui/Modal';
import { useLang } from '../../context/LanguageContext';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { Package, Users, UserPlus, Activity, Clock, Shield } from 'lucide-react';

const ROLE_LABELS = { admin: 'Root Access', manager: 'Manager', viewer: 'Operator' };

const PERIODS = [
  { days: 1, labelKey: 'period_day', chartTitleKey: 'chart_creations_24h' },
  { days: 7, labelKey: 'period_week', chartTitleKey: 'chart_creations_7d' },
  { days: 30, labelKey: 'period_month', chartTitleKey: 'chart_creations_30d' },
];

const ACTIVITY_KEYS = { 1: 'activity_24h', 7: 'activity_7d', 30: 'activity_30d' };
const PERIOD_STAT_KEYS = { 1: 'added_24h', 7: 'added_7d', 30: 'added_30d' };

const UserReportModal = ({ isOpen, onClose, user }) => {
  const { theme, isDark } = useTheme();
  const { t, lang } = useLang();
  const locale = lang === 'fr' ? 'fr-FR' : 'en-GB';
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [days, setDays] = useState(7);
  // Conteneur déplié pour consulter ses peers (lecture seule).
  const [openContainer, setOpenContainer] = useState(null);

  useEffect(() => {
    if (!isOpen || !user) return;
    setReport(null);
    setOpenContainer(null);
    setLoading(true);
    axiosInstance
      .get(`/users/${user.username}/report?days=${days}`)
      .then((res) => setReport(res.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [isOpen, user, days]);

  // Reset period on close
  useEffect(() => {
    if (!isOpen) setDays(7);
  }, [isOpen]);

  if (!user) return null;

  const accent = COLOR_MAP[theme]?.[500] || '#6366f1';
  const accentBg = COLOR_MAP[theme]?.[600] || '#4f46e5';
  const currentPeriod = PERIODS.find((p) => p.days === days);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`${t('report_title')} — ${user.username}`}
      maxWidth="max-w-3xl"
    >
      {/* Period filter */}
      <div className="flex items-center gap-2 mb-6">
        {PERIODS.map((p) => {
          const active = p.days === days;
          return (
            <button
              key={p.days}
              onClick={() => setDays(p.days)}
              className={cn(
                'px-4 py-2 rounded-2xl text-[11px] font-black uppercase tracking-widest transition-all border',
                active
                  ? 'text-white border-transparent'
                  : isDark
                    ? 'bg-white/5 border-white/5 text-slate-500 hover:text-white hover:bg-white/10'
                    : 'bg-black/5 border-black/5 text-slate-500 hover:text-slate-900 hover:bg-black/10'
              )}
              style={active ? { backgroundColor: accentBg, borderColor: accent + '55' } : undefined}
            >
              {t(p.labelKey)}
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="h-48 flex items-center justify-center">
          <div
            className="animate-spin rounded-full h-12 w-12 border-b-2"
            style={{ borderColor: accent }}
          />
        </div>
      ) : report ? (
        <div className="space-y-6">
          {/* User role badge */}
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-2xl flex items-center justify-center font-black text-white text-base shadow-xl"
              style={{ backgroundColor: accentBg }}
            >
              {user.username.charAt(0).toUpperCase()}
            </div>
            <div>
              <div className="text-sm font-black text-white uppercase tracking-tight flex items-center gap-2">
                {user.username}
                <Shield size={13} style={{ color: accent + 'cc' }} />
              </div>
              <div className="text-[11px] font-bold text-slate-500 uppercase tracking-widest">
                {ROLE_LABELS[report.user.role] || report.user.role}
                {report.user.expiry && (
                  <span className="ml-2">
                    · {t('expires_word')}{' '}
                    {new Date(report.user.expiry).toLocaleDateString(locale)}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Stats grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { icon: Package, label: t('containers'), value: report.stats.totalContainers },
              { icon: Users, label: t('clients_total'), value: report.stats.totalClients },
              { icon: Activity, label: t('actives'), value: report.stats.activeClients },
              {
                icon: UserPlus,
                label: PERIOD_STAT_KEYS[days] ? t(PERIOD_STAT_KEYS[days]) : t('added_generic'),
                value: report.stats.newClientsInPeriod,
              },
            ].map(({ icon: Icon, label, value }) => (
              <div
                key={label}
                className={cn(
                  'rounded-2xl p-4 flex flex-col items-center gap-2 border',
                  isDark ? 'bg-white/5 border-white/5' : 'bg-black/5 border-black/5'
                )}
              >
                <Icon size={18} style={{ color: accent }} />
                <span
                  className={cn('text-2xl font-black', isDark ? 'text-white' : 'text-slate-900')}
                >
                  {value}
                </span>
                <span className="text-[11px] font-black uppercase tracking-widest text-slate-500 text-center">
                  {label}
                </span>
              </div>
            ))}
          </div>

          {/* Chart */}
          <div>
            <h4 className="text-[11px] font-black text-slate-500 uppercase tracking-widest mb-4">
              {currentPeriod ? t(currentPeriod.chartTitleKey) : ''}
            </h4>
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={report.breakdown} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                <XAxis
                  dataKey="label"
                  tick={{ fill: '#475569', fontSize: 9, fontWeight: 700 }}
                  axisLine={false}
                  tickLine={false}
                  interval={days === 30 ? 4 : 0}
                />
                <YAxis
                  tick={{ fill: '#475569', fontSize: 9 }}
                  axisLine={false}
                  tickLine={false}
                  allowDecimals={false}
                />
                <Tooltip
                  contentStyle={{
                    background: isDark ? '#0f172a' : '#fff',
                    border: `1px solid ${accent}33`,
                    borderRadius: 12,
                    fontSize: 11,
                  }}
                  labelStyle={{ color: '#94a3b8', fontSize: 9 }}
                  itemStyle={{ color: accent }}
                  cursor={{ fill: accent + '18' }}
                />
                <Bar dataKey="count" name="Clients" radius={[4, 4, 0, 0]}>
                  {report.breakdown.map((entry, idx) => (
                    <Cell
                      key={idx}
                      fill={entry.count > 0 ? accent : isDark ? '#1e293b' : '#e2e8f0'}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Containers list — cliquer un conteneur déplie ses peers (lecture) */}
          {report.containers.length > 0 && (
            <div>
              <h4 className="text-[11px] font-black text-slate-500 uppercase tracking-widest mb-3">
                {t('containers')} ({report.containers.length})
              </h4>
              <div className="flex flex-wrap gap-2">
                {report.containers.map((c) => {
                  const count = (report.clientsByContainer?.[c] || []).length;
                  const active = openContainer === c;
                  return (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setOpenContainer(active ? null : c)}
                      className={cn(
                        'text-[11px] font-mono font-black px-3 py-1.5 rounded-xl border transition-colors',
                        active
                          ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40'
                          : isDark
                            ? 'bg-white/5 text-slate-400 border-white/5 hover:bg-white/10'
                            : 'bg-black/5 text-slate-600 border-black/5 hover:bg-black/10'
                      )}
                    >
                      {c}
                      <span className="ml-1.5 opacity-60">({count})</span>
                    </button>
                  );
                })}
              </div>

              {/* Peers du conteneur déplié (lecture seule) */}
              {openContainer && (
                <div
                  className={cn(
                    'mt-3 rounded-2xl border overflow-hidden',
                    isDark ? 'border-white/10 bg-white/[0.03]' : 'border-black/10 bg-black/[0.02]'
                  )}
                >
                  <div className="px-4 py-2 flex items-center gap-2 text-[11px] font-black uppercase tracking-widest text-slate-500 border-b border-white/5">
                    <Package size={13} /> {openContainer} —{' '}
                    {(report.clientsByContainer?.[openContainer] || []).length} peer(s)
                  </div>
                  {(report.clientsByContainer?.[openContainer] || []).length === 0 ? (
                    <div className="px-4 py-4 text-[11px] text-slate-500">{t('no_peer_dot')}</div>
                  ) : (
                    <div className="max-h-56 overflow-y-auto custom-scrollbar divide-y divide-white/5">
                      {(report.clientsByContainer?.[openContainer] || []).map((p) => (
                        <div
                          key={p.id}
                          className="px-4 py-2.5 flex items-center justify-between gap-3"
                        >
                          <div className="min-w-0">
                            <div className="text-xs font-bold truncate">{p.name}</div>
                            <div className="text-[10px] font-mono text-slate-500 truncate">
                              {p.ip || '—'}
                              {p.expiry
                                ? ` · exp. ${new Date(p.expiry).toLocaleDateString(locale)}`
                                : ''}
                            </div>
                          </div>
                          <span
                            className={cn(
                              'shrink-0 text-[8px] font-black tracking-widest uppercase px-2 py-0.5 rounded-lg border',
                              p.enabled
                                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                                : 'bg-slate-800 text-slate-500 border-white/10'
                            )}
                          >
                            {p.enabled ? t('status_active') : t('inactive')}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Recent audit activity */}
          {report.recentActivity.length > 0 && (
            <div>
              <h4 className="text-[11px] font-black text-slate-500 uppercase tracking-widest mb-3">
                {t('recent_activity')} ({t(ACTIVITY_KEYS[days])})
              </h4>
              <div className="space-y-1.5 max-h-44 overflow-y-auto custom-scrollbar pr-1">
                {report.recentActivity.map((a, idx) => (
                  <div
                    key={idx}
                    className={cn(
                      'flex items-center gap-3 px-4 py-2.5 rounded-xl border',
                      isDark ? 'bg-white/[0.03] border-white/5' : 'bg-black/[0.02] border-black/5'
                    )}
                  >
                    <Clock size={11} className="text-slate-600 flex-shrink-0" />
                    <span className="text-[11px] text-slate-500 font-mono w-20 flex-shrink-0">
                      {new Date(a.timestamp).toLocaleString(locale, {
                        day: '2-digit',
                        month: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                    <span
                      className="text-[11px] font-black uppercase tracking-wider flex-1"
                      style={{ color: accent }}
                    >
                      {a.action}
                    </span>
                    {a.targetName && (
                      <span
                        className={cn(
                          'text-[11px] font-mono truncate max-w-[8rem]',
                          isDark ? 'text-slate-400' : 'text-slate-500'
                        )}
                      >
                        {a.targetName}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {report.recentActivity.length === 0 && report.stats.totalClients === 0 && (
            <p className="text-center text-[11px] text-slate-600 font-black uppercase tracking-widest py-4">
              {t('no_activity_recorded')}
            </p>
          )}
        </div>
      ) : (
        <div className="h-48 flex items-center justify-center">
          <p className="text-slate-500 text-[11px] font-black uppercase tracking-widest">
            {t('report_load_err')}
          </p>
        </div>
      )}
    </Modal>
  );
};

export default UserReportModal;
