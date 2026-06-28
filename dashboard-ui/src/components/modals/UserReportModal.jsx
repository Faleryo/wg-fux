import React, { useState, useEffect } from 'react';
import { axiosInstance } from '../../lib/api';
import { useTheme } from '../../context/ThemeContext';
import { cn, COLOR_MAP } from '../../lib/utils';
import Modal from '../ui/Modal';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { Package, Users, UserPlus, Activity, Clock, Shield } from 'lucide-react';

const ROLE_LABELS = { admin: 'Root Access', manager: 'Manager', viewer: 'Operator' };

const UserReportModal = ({ isOpen, onClose, user }) => {
  const { theme, isDark } = useTheme();
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isOpen || !user) return;
    setReport(null);
    setLoading(true);
    axiosInstance
      .get(`/users/${user.username}/report`)
      .then((res) => setReport(res.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [isOpen, user]);

  if (!user) return null;

  const accent = COLOR_MAP[theme]?.[500] || '#6366f1';
  const accentBg = COLOR_MAP[theme]?.[600] || '#4f46e5';

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Rapport — ${user.username}`}
      maxWidth="max-w-3xl"
    >
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
              <div className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">
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
              { icon: UserPlus, label: 'Ajoutés 24h', value: report.stats.newClientsToday },
            ].map(({ icon: Icon, label, value }) => (
              <div
                key={label}
                className={cn(
                  'rounded-2xl p-4 flex flex-col items-center gap-2 border',
                  isDark ? 'bg-white/5 border-white/5' : 'bg-black/5 border-black/5'
                )}
              >
                <Icon size={18} style={{ color: accent }} />
                <span className={cn('text-2xl font-black', isDark ? 'text-white' : 'text-slate-900')}>
                  {value}
                </span>
                <span className="text-[9px] font-black uppercase tracking-widest text-slate-500 text-center">
                  {label}
                </span>
              </div>
            ))}
          </div>

          {/* 7-day chart */}
          <div>
            <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-4">
              Clients créés — 7 derniers jours
            </h4>
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={report.dailyBreakdown} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                <XAxis
                  dataKey="date"
                  tick={{ fill: '#475569', fontSize: 9, fontWeight: 700 }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => v.slice(5)}
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
                  {report.dailyBreakdown.map((entry, idx) => (
                    <Cell
                      key={idx}
                      fill={entry.count > 0 ? accent : (isDark ? '#1e293b' : '#e2e8f0')}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Containers list */}
          {report.containers.length > 0 && (
            <div>
              <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-3">
                Conteneurs ({report.containers.length})
              </h4>
              <div className="flex flex-wrap gap-2">
                {report.containers.map((c) => (
                  <span
                    key={c}
                    className={cn(
                      'text-[10px] font-mono font-black px-3 py-1.5 rounded-xl border',
                      isDark ? 'bg-white/5 text-slate-400 border-white/5' : 'bg-black/5 text-slate-600 border-black/5'
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
              <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-3">
                Activité récente (24h)
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
                    <span className="text-[9px] text-slate-500 font-mono w-10 flex-shrink-0">
                      {new Date(a.timestamp).toLocaleTimeString('fr-FR', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                    <span
                      className="text-[9px] font-black uppercase tracking-wider flex-1"
                      style={{ color: accent }}
                    >
                      {a.action}
                    </span>
                    {a.targetName && (
                      <span
                        className={cn(
                          'text-[9px] font-mono truncate max-w-[8rem]',
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
            <p className="text-center text-[10px] text-slate-600 font-black uppercase tracking-widest py-4">
              Aucune activité enregistrée
            </p>
          )}
        </div>
      ) : (
        <div className="h-48 flex items-center justify-center">
          <p className="text-slate-500 text-[10px] font-black uppercase tracking-widest">
            Impossible de charger le rapport
          </p>
        </div>
      )}
    </Modal>
  );
};

export default UserReportModal;
