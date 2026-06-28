import React, { useState } from 'react';
import { Users, Plus, Shield, Search, Trash2, UserCheck, RefreshCw } from 'lucide-react';
import { useTheme } from '../../../context/ThemeContext';
import { cn, COLOR_MAP } from '../../../lib/utils';
import { motion, AnimatePresence } from 'framer-motion';
import GlassCard from '../../../components/ui/Card';
import VibeButton from '../../../components/ui/Button';

const ROLE_CONFIG = {
  admin:   { label: 'Root Access',     badge: 'Admin',   variant: 'theme' },
  manager: { label: 'Manager Access',  badge: 'Manager', variant: 'indigo' },
  viewer:  { label: 'Operator Access', badge: 'Viewer',  variant: 'slate' },
};

const UsersSection = ({ users = [], loading = false, onCreateUser, onEdit, onDelete, onRefresh, onViewReport }) => {
  const { theme } = useTheme();
  const [searchTerm, setSearchTerm] = useState('');

  const filteredUsers = (users || []).filter((user) => {
    const searchLower = String(searchTerm || '').toLowerCase();
    return (
      String(user?.username || '')
        .toLowerCase()
        .includes(searchLower) ||
      String(user?.role || '')
        .toLowerCase()
        .includes(searchLower)
    );
  });

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-5 duration-700">
      {/* Header Liquid Glass */}
      <GlassCard className="flex flex-col lg:flex-row justify-between items-center gap-8">
        <div className="flex items-center gap-6">
          <div
            className={cn(
              'w-16 h-16 rounded-2xl flex items-center justify-center shadow-2xl border'
            )}
            style={{
              backgroundColor: COLOR_MAP[theme]?.[600] ? COLOR_MAP[theme][600] + '33' : '#4f46e533',
              color: COLOR_MAP[theme]?.[400] || '#818cf8',
              borderColor: COLOR_MAP[theme]?.[500] ? COLOR_MAP[theme][500] + '33' : '#6366f133'
            }}
          >
            <Users size={32} />
          </div>
          <div>
            <h2 className="text-3xl font-black text-white tracking-tighter italic uppercase">
              Gestion des Opérateurs
            </h2>
            <p className="text-slate-500 text-[10px] font-black tracking-[0.3em] uppercase opacity-60">
              System Access Control
            </p>
          </div>
        </div>

        <div className="flex flex-col md:flex-row gap-4 w-full lg:w-auto items-center">
          <div className="relative group w-full md:w-auto">
            <Search
              className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-white transition-colors"
              size={20}
            />
            <input
              type="text"
              placeholder="Rechercher un opérateur..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-12 pr-6 py-4 bg-white/5 border border-white/5 rounded-2xl focus:outline-none focus:border-white/20 focus:bg-white/10 text-sm text-white w-full md:w-80 transition-all font-mono"
            />
          </div>
          {onRefresh && (
            <VibeButton
              variant="secondary"
              icon={RefreshCw}
              className="w-full md:w-auto"
              onClick={onRefresh}
            >
              Actualiser
            </VibeButton>
          )}
          <VibeButton
            variant="primary"
            icon={Plus}
            className="w-full md:w-auto"
            onClick={onCreateUser}
          >
            Créer un Accès
          </VibeButton>
        </div>
      </GlassCard>

      {/* Users Table Liquid Glass */}
      <GlassCard className="p-0 overflow-hidden" hover={false}>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="text-[10px] font-black text-slate-500 uppercase tracking-[0.25em] border-b border-white/5">
                <th className="px-10 py-8">Identité Opérateur</th>
                <th className="px-8 py-8">Rôle Système</th>
                <th className="px-8 py-8">Statut</th>
                <th className="px-10 py-8 text-right">Intervention</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              <AnimatePresence mode="popLayout">
                {filteredUsers.map((user, idx) => (
                  <motion.tr
                    key={user.id || idx}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    transition={{ delay: idx * 0.05 }}
                    className="group hover:bg-white/5 transition-colors cursor-pointer focus:outline-none focus:bg-white/5"
                    tabIndex={0}
                    onClick={() => onViewReport && onViewReport(user)}
                    onKeyDown={(e) => {
                      if ((e.key === 'Enter' || e.key === ' ') && onViewReport) {
                        e.preventDefault();
                        onViewReport(user);
                      }
                    }}
                  >
                    <td className="px-10 py-6">
                      {(() => {
                        const rc = ROLE_CONFIG[user.role] || ROLE_CONFIG.viewer;
                        const isElevated = user.role === 'admin' || user.role === 'manager';
                        const accentColor = user.role === 'admin'
                          ? COLOR_MAP[theme]?.[500] || '#6366f1'
                          : user.role === 'manager'
                          ? '#6366f1'
                          : null;
                        return (
                          <div className="flex items-center gap-5">
                            <div
                              className={cn(
                                'w-12 h-12 rounded-2xl bg-slate-800 flex items-center justify-center font-black text-white text-lg transition-all group-hover:scale-110 group-hover:bg-slate-700 shadow-xl border',
                              )}
                              style={isElevated && accentColor ? { borderColor: accentColor + '4d' } : { borderColor: 'rgba(255,255,255,0.05)' }}
                            >
                              {String(user?.username || '?').charAt(0).toUpperCase()}
                            </div>
                            <div>
                              <div className="text-sm font-black text-white uppercase tracking-tight flex items-center gap-2">
                                {user.username || 'Inconnu'}
                                {isElevated && (
                                  <Shield size={14} style={{ color: accentColor + 'cc' }} />
                                )}
                              </div>
                              <div className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">
                                {rc.label}
                              </div>
                            </div>
                          </div>
                        );
                      })()}
                    </td>
                    <td className="px-8 py-6">
                      {(() => {
                        const rc = ROLE_CONFIG[user.role] || ROLE_CONFIG.viewer;
                        const accentColor = user.role === 'admin'
                          ? COLOR_MAP[theme]?.[500] || '#6366f1'
                          : user.role === 'manager'
                          ? '#6366f1'
                          : null;
                        return (
                          <span
                            className="text-[10px] font-black px-4 py-1.5 rounded-xl border uppercase tracking-widest inline-block"
                            style={accentColor ? {
                              backgroundColor: accentColor + '1a',
                              color: accentColor,
                              borderColor: accentColor + '33',
                            } : { background: 'rgba(255,255,255,0.05)', color: '#94a3b8', borderColor: 'rgba(255,255,255,0.05)' }}
                          >
                            {rc.badge}
                          </span>
                        );
                      })()}
                    </td>
                    <td className="px-8 py-6">
                      {(() => {
                        const isExpired = user.expiry && new Date(user.expiry) < new Date();
                        return (
                          <div className={cn(
                            'flex items-center gap-2 text-[10px] font-black uppercase tracking-widest px-4 py-1.5 rounded-xl border w-fit',
                            isExpired
                              ? 'text-red-400 bg-red-500/5 border-red-500/10'
                              : 'text-emerald-400 bg-emerald-500/5 border-emerald-500/10'
                          )}>
                            <div className={cn(
                              'h-1.5 w-1.5 rounded-full',
                              isExpired
                                ? 'bg-red-500 shadow-[0_0_8px_#ef4444]'
                                : 'bg-emerald-500 animate-pulse shadow-[0_0_8px_#10b981]'
                            )} />
                            {isExpired ? 'Expiré' : 'Actif'}
                          </div>
                        );
                      })()}
                    </td>
                    <td className="px-6 py-6 text-right">
                      <div className="flex justify-end gap-2 lg:opacity-0 lg:group-hover:opacity-100 transition-all transform lg:translate-x-2 lg:group-hover:translate-x-0">
                        <VibeButton
                          variant="secondary"
                          size="sm"
                          icon={RefreshCw}
                          className="p-2.5"
                          title="Éditer Opérateur"
                          onClick={(e) => {
                            e.stopPropagation();
                            onEdit(user);
                          }}
                        />
                        <VibeButton
                          variant="danger"
                          size="sm"
                          icon={Trash2}
                          className="p-2.5"
                          title="Supprimer Opérateur"
                          onClick={(e) => {
                            e.stopPropagation();
                            onDelete(user);
                          }}
                        />
                      </div>
                    </td>
                  </motion.tr>
                ))}
              </AnimatePresence>
            </tbody>
          </table>
        </div>

        {filteredUsers.length === 0 && !loading && (
          <div className="flex flex-col items-center justify-center py-24">
            <div className="p-6 bg-white/5 rounded-full mb-4">
              <UserCheck size={48} className="text-slate-600" />
            </div>
            <p className="text-slate-500 font-black uppercase text-xs tracking-widest">
              Aucun opérateur trouvé
            </p>
          </div>
        )}
      </GlassCard>
    </div>
  );
};

export default UsersSection;
