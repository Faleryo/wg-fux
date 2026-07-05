import React, { useState, useEffect } from 'react';
import { axiosInstance } from '../../lib/api';
import { useTheme } from '../../context/ThemeContext';
import { cn, COLOR_MAP } from '../../lib/utils';
import Modal from '../ui/Modal';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { Package, Users, UserPlus, Activity, Clock, Shield } from 'lucide-react';

const ROLE_LABELS = { admin: 'Root Access', manager: 'Manager', viewer: 'Operator' };

const PERIODS = [
  { days: 1, label: 'Jour', chartTitle: 'Créations — 24 dernières heures' },
  { days: 7, label: 'Semaine', chartTitle: 'Créations — 7 derniers jours' },
  { days: 30, label: 'Mois', chartTitle: 'Créations — 30 derniers jours' },
];

const ACTIVITY_LABELS = { 1: '24h', 7: '7 jours', 30: '30 jours' };
const PERIOD_STAT_LABELS = { 1: 'Ajoutés 24h', 7: 'Ajoutés 7j', 30: 'Ajoutés 30j' };

const UserReportModal = ({ isOpen, onClose, user }) => {
  const { theme, isDark } = useTheme();
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [days, setDays] = useState(7);

  useEffect(() => {
    if (!isOpen || !user) return;
    setReport(null);
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
      title={`Rapport — ${user.username}`}
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
              {p.label}
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
        <div className="space-y-8">
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
                    · expire {new Date(report.user.expiry).toLocaleDateString('fr-FR')}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Stats grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { icon: Package, label: 'Conteneurs', value: report.stats.totalContainers },
              { icon: Users, label: 'Clients total', value: report.stats.totalClients },
              { icon: Activity, label: 'Actifs', value: report.stats.activeClients },
              {
                icon: UserPlus,
                label: PERIOD_STAT_LABELS[days] || 'Ajoutés',
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
              {currentPeriod?.chartTitle}
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

          {/* Containers list */}
          {report.containers.length > 0 && (
            <div>
              <h4 className="text-[11px] font-black text-slate-500 uppercase tracking-widest mb-3">
                Conteneurs ({report.containers.length})
              </h4>
              <div className="flex flex-wrap gap-2">
                {report.containers.map((c) => (
                  <span
                    key={c}
                    className={cn(
                      'text-[11px] font-mono font-black px-3 py-1.5 rounded-xl border',
                      isDark
                        ? 'bg-white/5 text-slate-400 border-white/5'
                        : 'bg-black/5 text-slate-600 border-black/5'
                    )}
                  >
                    {c}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Recent audit activity */}
          {report.recentActivity.length > 0 && (
            <div>
              <h4 className="text-[11px] font-black text-slate-500 uppercase tracking-widest mb-3">
                Activité récente ({ACTIVITY_LABELS[days]})
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
                      {new Date(a.timestamp).toLocaleString('fr-FR', {
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
              Aucune activité enregistrée
            </p>
          )}
        </div>
      ) : (
        <div className="h-48 flex items-center justify-center">
          <p className="text-slate-500 text-[11px] font-black uppercase tracking-widest">
            Impossible de charger le rapport
          </p>
        </div>
      )}
    </Modal>
  );
};

export default UserReportModal;
