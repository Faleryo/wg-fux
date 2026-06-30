import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Server, Plus, Trash2, RefreshCw, AlertCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTheme } from '../../../context/ThemeContext';
import { useToast } from '../../../context/ToastContext';
import { cn, COLOR_MAP } from '../../../lib/utils';
import { axiosInstance } from '../../../lib/api';
import GlassCard from '../../../components/ui/Card';
import VibeButton from '../../../components/ui/Button';
import ConfirmModal from '../../../components/modals/ConfirmModal';
import AddServerModal from '../../../components/modals/AddServerModal';

// Délai de polling tant qu'au moins un serveur est en attente.
const POLL_INTERVAL = 3000;
const PENDING_STATES = new Set(['pending', 'provisioning']);

const STATUS_CONFIG = {
  pending: {
    label: 'En attente',
    cls: 'bg-slate-500/10 border-slate-500/20 text-slate-400',
    dot: 'bg-slate-400',
    pulse: false,
  },
  provisioning: {
    label: 'Provisioning',
    cls: 'bg-sky-500/10 border-sky-500/20 text-sky-400',
    dot: 'bg-sky-400',
    pulse: true,
  },
  online: {
    label: 'En ligne',
    cls: 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400',
    dot: 'bg-emerald-400 shadow-[0_0_8px_#10b981]',
    pulse: false,
  },
  error: {
    label: 'Erreur',
    cls: 'bg-red-500/10 border-red-500/20 text-red-400',
    dot: 'bg-red-500 shadow-[0_0_8px_#ef4444]',
    pulse: false,
  },
  offline: {
    label: 'Hors-ligne',
    cls: 'bg-slate-700/30 border-slate-600/30 text-slate-500',
    dot: 'bg-slate-600',
    pulse: false,
  },
};

// Temps relatif compact (fr) — pas de dépendance externe.
const relativeTime = (iso) => {
  if (!iso) return '—';
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return '—';
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 5) return "à l'instant";
  if (diff < 60) return `il y a ${diff}s`;
  const min = Math.floor(diff / 60);
  if (min < 60) return `il y a ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `il y a ${h} h`;
  const d = Math.floor(h / 24);
  return `il y a ${d} j`;
};

const StatusBadge = ({ status }) => {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.pending;
  return (
    <div
      className={cn(
        'inline-flex items-center gap-2 text-[10px] font-black uppercase tracking-widest px-4 py-1.5 rounded-xl border w-fit',
        cfg.cls
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', cfg.dot, cfg.pulse && 'animate-pulse')} />
      {cfg.label}
    </div>
  );
};

const ServersSection = () => {
  const { theme } = useTheme();
  const { addToast } = useToast();

  const [servers, setServers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [confirmTarget, setConfirmTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const pollRef = useRef(null);

  const fetchServers = useCallback(async () => {
    try {
      const res = await axiosInstance.get('/servers');
      setServers(Array.isArray(res.data) ? res.data : []);
    } catch (e) {
      addToast(e?.response?.data?.error || 'Erreur de chargement des serveurs', 'error');
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  // Chargement initial
  useEffect(() => {
    fetchServers();
  }, [fetchServers]);

  // Polling : actif tant qu'au moins un serveur est en pending/provisioning.
  const hasPending = servers.some((s) => PENDING_STATES.has(s.status));
  useEffect(() => {
    if (!hasPending) {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      return;
    }
    if (pollRef.current) return; // déjà en cours
    pollRef.current = setInterval(fetchServers, POLL_INTERVAL);
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [hasPending, fetchServers]);

  // Nettoyage final au démontage
  useEffect(
    () => () => {
      if (pollRef.current) clearInterval(pollRef.current);
    },
    []
  );

  const handleDelete = async () => {
    if (!confirmTarget || deleting) return;
    setDeleting(true);
    try {
      await axiosInstance.delete(`/servers/${confirmTarget.id}`);
      addToast('Serveur supprimé', 'success');
      setConfirmTarget(null);
      fetchServers();
    } catch (e) {
      addToast(e?.response?.data?.error || 'Erreur lors de la suppression', 'error');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-5 duration-700">
      {/* Header */}
      <GlassCard className="flex flex-col lg:flex-row justify-between items-center gap-8">
        <div className="flex items-center gap-6">
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center shadow-2xl border"
            style={{
              backgroundColor: COLOR_MAP[theme]?.[600] ? COLOR_MAP[theme][600] + '33' : '#4f46e533',
              color: COLOR_MAP[theme]?.[400] || '#818cf8',
              borderColor: COLOR_MAP[theme]?.[500] ? COLOR_MAP[theme][500] + '33' : '#6366f133',
            }}
          >
            <Server size={32} />
          </div>
          <div>
            <h2 className="text-3xl font-black text-white tracking-tighter italic uppercase">
              Serveurs
            </h2>
            <p className="text-slate-500 text-[10px] font-black tracking-[0.3em] uppercase opacity-60">
              Reseller Fleet Management
            </p>
          </div>
        </div>

        <div className="flex flex-col md:flex-row gap-4 w-full lg:w-auto items-center">
          <VibeButton
            variant="secondary"
            icon={RefreshCw}
            className="w-full md:w-auto"
            onClick={fetchServers}
          >
            Actualiser
          </VibeButton>
          <VibeButton
            variant="primary"
            icon={Plus}
            className="w-full md:w-auto"
            onClick={() => setShowAddModal(true)}
          >
            Ajouter un VPS
          </VibeButton>
        </div>
      </GlassCard>

      {/* Table */}
      <GlassCard className="p-0 overflow-hidden" hover={false}>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="text-[10px] font-black text-slate-500 uppercase tracking-[0.25em] border-b border-white/5">
                <th className="px-10 py-8">Serveur</th>
                <th className="px-8 py-8">Adresse</th>
                <th className="px-8 py-8">Statut</th>
                <th className="px-8 py-8">Dernier contrôle</th>
                <th className="px-10 py-8 text-right">Intervention</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              <AnimatePresence mode="popLayout">
                {servers.map((srv, idx) => (
                  <motion.tr
                    key={srv.id || idx}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    transition={{ delay: idx * 0.05 }}
                    className="group hover:bg-white/5 transition-colors"
                  >
                    <td className="px-10 py-6">
                      <div className="flex items-center gap-5">
                        <div className="w-12 h-12 rounded-2xl bg-slate-800 flex items-center justify-center text-slate-400 transition-all group-hover:scale-110 group-hover:bg-slate-700 shadow-xl border border-white/5">
                          <Server size={20} />
                        </div>
                        <div className="text-sm font-black text-white uppercase tracking-tight">
                          {srv.label || 'Sans nom'}
                        </div>
                      </div>
                    </td>
                    <td className="px-8 py-6">
                      <span className="text-xs font-mono text-slate-400">
                        {srv.host}
                        <span className="text-slate-600">:{srv.port ?? 22}</span>
                      </span>
                    </td>
                    <td className="px-8 py-6">
                      <div className="flex flex-col gap-1.5">
                        <StatusBadge status={srv.status} />
                        {srv.status === 'error' && srv.lastError && (
                          <span
                            title={srv.lastError}
                            className="flex items-center gap-1.5 text-[10px] text-red-400/80 font-mono max-w-[260px] truncate"
                          >
                            <AlertCircle size={12} className="flex-shrink-0" />
                            {srv.lastError}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-8 py-6">
                      <span className="text-[11px] font-mono text-slate-500">
                        {relativeTime(srv.lastChecked)}
                      </span>
                    </td>
                    <td className="px-6 py-6 text-right">
                      <div className="flex justify-end gap-2 lg:opacity-0 lg:group-hover:opacity-100 transition-all transform lg:translate-x-2 lg:group-hover:translate-x-0">
                        <VibeButton
                          variant="danger"
                          size="sm"
                          icon={Trash2}
                          className="p-2.5"
                          title="Supprimer le serveur"
                          onClick={() => setConfirmTarget(srv)}
                        />
                      </div>
                    </td>
                  </motion.tr>
                ))}
              </AnimatePresence>
            </tbody>
          </table>
        </div>

        {servers.length === 0 && !loading && (
          <div className="flex flex-col items-center justify-center py-24">
            <div className="p-6 bg-white/5 rounded-full mb-4">
              <Server size={48} className="text-slate-600" />
            </div>
            <p className="text-slate-500 font-black uppercase text-xs tracking-widest">
              Aucun serveur enregistré
            </p>
            <button
              onClick={() => setShowAddModal(true)}
              className="mt-4 text-indigo-400 hover:text-indigo-300 text-[11px] font-black uppercase tracking-widest transition-colors"
            >
              + Ajouter votre premier VPS
            </button>
          </div>
        )}

        {loading && servers.length === 0 && (
          <div className="flex items-center justify-center py-24 text-slate-600">
            <RefreshCw size={20} className="animate-spin" />
          </div>
        )}
      </GlassCard>

      {/* Modals */}
      {showAddModal && (
        <AddServerModal
          isOpen={showAddModal}
          onClose={() => setShowAddModal(false)}
          onCreated={fetchServers}
          servers={servers}
        />
      )}

      <ConfirmModal
        isOpen={!!confirmTarget}
        title="Supprimer le serveur"
        message={
          confirmTarget ? (
            <span>
              Supprimer le serveur{' '}
              <strong className="font-mono text-white">{confirmTarget.label}</strong> (
              <span className="font-mono">{confirmTarget.host}</span>) ?
            </span>
          ) : (
            'Cette action est irréversible.'
          )
        }
        confirmLabel="Supprimer définitivement"
        intent="danger"
        onConfirm={handleDelete}
        onCancel={() => setConfirmTarget(null)}
      />
    </div>
  );
};

export default ServersSection;
