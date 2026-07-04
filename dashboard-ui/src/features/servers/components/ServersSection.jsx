import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  Server,
  Plus,
  Trash2,
  RefreshCw,
  AlertCircle,
  KeyRound,
  Users,
  Search,
  Terminal,
  Copy,
  Check,
  ArrowUpCircle,
  Timer,
  Wifi,
} from 'lucide-react';
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

// Nombre de jours restants avant expiration de la licence (négatif = expirée).
const daysUntil = (iso) => {
  if (!iso) return null;
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return null;
  return Math.ceil((ts - Date.now()) / 86400000);
};

// Version de l'instance vs version plateforme (remontée au heartbeat licence).
const VersionBadge = ({ version, updateAvailable }) => {
  if (!version) return <span className="text-[11px] font-mono text-slate-600">—</span>;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 text-[11px] font-mono font-bold',
        updateAvailable ? 'text-amber-400' : 'text-emerald-400/90'
      )}
      title={
        updateAvailable ? 'Mise à jour disponible (appliquée par le cron quotidien)' : 'À jour'
      }
    >
      {updateAvailable ? <ArrowUpCircle size={12} /> : <Check size={12} />}v{version}
    </span>
  );
};

// Modale de déploiement gouverné : l'admin choisit quelles instances reçoivent
// la version courante de la plateforme (ou toute la flotte). Une instance non
// approuvée ne voit JAMAIS la mise à jour (heartbeat muet + bundle 204).
const PushUpdateModal = ({ servers, onClose, onApply, busy }) => {
  const [selected, setSelected] = useState(() => new Set());
  const [mode, setMode] = useState('auto');
  const platformVersion = servers[0]?.platformVersion || '?';
  // Une instance pas encore installée (pending/provisioning) n'a rien à mettre à jour.
  const eligible = servers.filter((s) => !PENDING_STATES.has(s.status));

  const toggle = (id) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allSelected = eligible.length > 0 && eligible.every((s) => selected.has(s.id));

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="glass-panel border rounded-2xl shadow-2xl w-full max-w-2xl p-8 space-y-5">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-amber-500/15 border border-amber-500/20 flex items-center justify-center text-amber-400">
            <ArrowUpCircle size={20} />
          </div>
          <div>
            <h3 className="text-lg font-black text-white uppercase tracking-tight">
              Déployer la version v{platformVersion}
            </h3>
            <p className="text-[11px] font-mono text-slate-500">
              Seules les instances approuvées ici recevront la mise à jour (≤ 30 min).
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between">
          <button
            onClick={() =>
              setSelected(allSelected ? new Set() : new Set(eligible.map((s) => s.id)))
            }
            className="text-[11px] font-black uppercase tracking-widest text-indigo-400 hover:text-indigo-300"
          >
            {allSelected ? 'Tout désélectionner' : 'Tout sélectionner'}
          </button>
          <span className="text-[11px] font-mono text-slate-500">
            {selected.size} / {eligible.length} instance{eligible.length > 1 ? 's' : ''}
          </span>
        </div>

        <div className="max-h-72 overflow-y-auto divide-y divide-white/5 border border-white/5 rounded-xl">
          {eligible.map((s) => {
            const upToDate = s.version && s.version === s.platformVersion;
            return (
              <label
                key={s.id}
                className={cn(
                  'flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-white/5 transition-colors',
                  upToDate && 'opacity-50'
                )}
              >
                <input
                  type="checkbox"
                  checked={selected.has(s.id)}
                  onChange={() => toggle(s.id)}
                  className="accent-indigo-500"
                />
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-bold text-white truncate">
                    {s.label}
                    {s.owner ? (
                      <span className="text-[10px] font-mono text-slate-500"> · {s.owner}</span>
                    ) : null}
                  </span>
                  <span className="block text-[10px] font-mono text-slate-500 truncate">
                    {s.host} · {s.status}
                  </span>
                </span>
                <span className="text-[11px] font-mono whitespace-nowrap">
                  <span className={upToDate ? 'text-emerald-400' : 'text-slate-400'}>
                    v{s.version || '?'}
                  </span>
                  {!upToDate && <span className="text-slate-600"> → v{s.platformVersion}</span>}
                </span>
                {s.updateApproved && (
                  <span
                    className="text-[9px] font-black uppercase tracking-widest text-amber-400"
                    title="Déploiement déjà programmé"
                  >
                    programmée
                  </span>
                )}
              </label>
            );
          })}
          {eligible.length === 0 && (
            <div className="px-4 py-8 text-center text-slate-500 text-xs uppercase tracking-widest">
              Aucune instance enrôlée
            </div>
          )}
        </div>

        {/* Mode de déploiement */}
        <div className="space-y-2">
          <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
            Mode de déploiement
          </span>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <button
              onClick={() => setMode('auto')}
              className={cn(
                'text-left px-4 py-3 rounded-xl border transition-colors',
                mode === 'auto'
                  ? 'border-indigo-500/50 bg-indigo-500/15'
                  : 'border-white/10 bg-white/5 hover:bg-white/10'
              )}
            >
              <span className="block text-xs font-black uppercase tracking-widest text-white">
                Programmé (défaut)
              </span>
              <span className="block text-[10px] text-slate-400 mt-1">
                Appliquée automatiquement sous ~6 h, sans intervention.
              </span>
            </button>
            <button
              onClick={() => setMode('instant')}
              className={cn(
                'text-left px-4 py-3 rounded-xl border transition-colors',
                mode === 'instant'
                  ? 'border-amber-500/50 bg-amber-500/15'
                  : 'border-white/10 bg-white/5 hover:bg-white/10'
              )}
            >
              <span className="block text-xs font-black uppercase tracking-widest text-white">
                Instantané
              </span>
              <span className="block text-[10px] text-slate-400 mt-1">
                L’instance la reçoit tout de suite — son opérateur confirme l’installation.
              </span>
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between pt-2 border-t border-white/5">
          <button
            disabled={busy || selected.size === 0}
            onClick={() => onApply({ serverIds: [...selected], clear: true })}
            className="text-[11px] font-black uppercase tracking-widest text-red-400/80 hover:text-red-400 transition-colors disabled:opacity-40"
            title="Retire l'approbation : ces instances ne recevront plus la mise à jour"
          >
            Annuler le déploiement
          </button>
          <div className="flex items-center gap-4">
            <button
              disabled={busy}
              onClick={onClose}
              className="text-[11px] font-black uppercase tracking-widest text-slate-400 hover:text-white transition-colors disabled:opacity-50"
            >
              Fermer
            </button>
            <button
              disabled={busy || selected.size === 0}
              onClick={() => onApply({ serverIds: [...selected], mode })}
              className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-[11px] font-black uppercase tracking-widest text-white transition-colors disabled:opacity-40"
            >
              Pousser la mise à jour ({selected.size})
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// Modale one-liner : commande de (ré)installation à coller sur le VPS.
const OneLinerModal = ({ data, onClose }) => {
  const [copied, setCopied] = useState(false);
  if (!data) return null;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(data.oneLiner);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard indisponible (http) */
    }
  };
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="glass-panel border rounded-2xl shadow-2xl w-full max-w-2xl p-8 space-y-5">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-sky-500/15 border border-sky-500/20 flex items-center justify-center text-sky-400">
            <Terminal size={20} />
          </div>
          <div>
            <h3 className="text-lg font-black text-white uppercase tracking-tight">
              Commande d’installation
            </h3>
            <p className="text-[11px] font-mono text-slate-500">
              {data.label} · valable 10 minutes, usage unique
            </p>
          </div>
        </div>
        <p className="text-xs text-slate-400">
          À coller en root sur le VPS. Réinstalle ou installe l’instance ; la licence du serveur est
          conservée.
        </p>
        <pre className="bg-black/40 border border-white/10 rounded-xl p-4 text-[11px] font-mono text-sky-200 whitespace-pre-wrap break-all max-h-48 overflow-y-auto select-all">
          <code>{data.oneLiner}</code>
        </pre>
        <div className="flex items-center justify-between">
          <button
            onClick={copy}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-white/10 bg-white/5 hover:bg-sky-500/20 text-[11px] font-black uppercase tracking-widest text-white transition-colors"
          >
            {copied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
            {copied ? 'Copié' : 'Copier'}
          </button>
          <button
            onClick={onClose}
            className="text-[11px] font-black uppercase tracking-widest text-slate-400 hover:text-white transition-colors"
          >
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
};

const LicenseBadge = ({ expiry }) => {
  const days = daysUntil(expiry);
  if (days === null) {
    return <span className="text-[11px] font-mono text-slate-600">—</span>;
  }
  const expired = days <= 0;
  const soon = days > 0 && days <= 7;
  const cls = expired ? 'text-red-400' : soon ? 'text-amber-400' : 'text-emerald-400/90';
  const label = expired
    ? `Expirée (${Math.abs(days)} j)`
    : days === 0
      ? "Expire aujourd'hui"
      : `${days} j restants`;
  return <span className={cn('text-[11px] font-mono font-bold', cls)}>{label}</span>;
};

// Modale de renouvellement : prolonge/coupe la licence d'une instance (admin).
const RENEW_OPTIONS = [
  { days: 30, label: '+ 1 mois' },
  { days: 90, label: '+ 3 mois' },
  { days: 365, label: '+ 1 an' },
];
const UPDATE_CHANNELS = [
  { value: 'stable', label: 'Stable' },
  { value: 'canary', label: 'Canary (pilote)' },
  { value: 'hold', label: 'Gelé (aucune maj)' },
];
const RenewModal = ({ server, onClose, onApply, busy }) => {
  const [maxClients, setMaxClients] = useState('');
  useEffect(() => {
    setMaxClients(server?.maxClients != null ? String(server.maxClients) : '');
  }, [server]);
  if (!server) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="glass-panel border rounded-2xl shadow-2xl w-full max-w-md p-8 space-y-6">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-indigo-500/15 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
            <KeyRound size={20} />
          </div>
          <div>
            <h3 className="text-lg font-black text-white uppercase tracking-tight">Licence</h3>
            <p className="text-[11px] font-mono text-slate-500">
              {server.label} · {server.host}
            </p>
          </div>
        </div>

        <div className="text-xs text-slate-400">
          Statut actuel : <LicenseBadge expiry={server.licenseExpiry} />
        </div>

        <div className="grid grid-cols-3 gap-3">
          {RENEW_OPTIONS.map((opt) => (
            <button
              key={opt.days}
              disabled={busy}
              onClick={() => onApply({ extendDays: opt.days })}
              className="py-3 rounded-xl border border-white/10 bg-white/5 hover:bg-indigo-500/20 hover:border-indigo-500/40 text-sm font-black text-white transition-colors disabled:opacity-50"
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* Palier : plafond de clients (appliqué par l'instance au heartbeat suivant) */}
        <div className="space-y-2 pt-2 border-t border-white/5">
          <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
            Plafond de clients (vide = illimité)
          </label>
          <div className="flex gap-3">
            <input
              value={maxClients}
              onChange={(e) => setMaxClients(e.target.value)}
              placeholder="illimité"
              className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white font-mono focus:outline-none focus:border-white/20"
            />
            <button
              disabled={busy}
              onClick={() =>
                onApply({ maxClients: maxClients.trim() === '' ? null : Number(maxClients) })
              }
              className="px-4 rounded-xl border border-white/10 bg-white/5 hover:bg-indigo-500/20 text-[11px] font-black uppercase tracking-widest text-white transition-colors disabled:opacity-50"
            >
              Appliquer
            </button>
          </div>
        </div>

        {/* Canal de mise à jour */}
        <div className="space-y-2">
          <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
            Canal de mise à jour
          </label>
          <div className="grid grid-cols-3 gap-2">
            {UPDATE_CHANNELS.map((ch) => (
              <button
                key={ch.value}
                disabled={busy}
                onClick={() => onApply({ updateChannel: ch.value })}
                className={cn(
                  'py-2 rounded-xl border text-[10px] font-black uppercase tracking-widest transition-colors disabled:opacity-50',
                  (server.updateChannel || 'stable') === ch.value
                    ? 'border-indigo-500/50 bg-indigo-500/20 text-indigo-300'
                    : 'border-white/10 bg-white/5 text-slate-400 hover:text-white'
                )}
              >
                {ch.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between pt-2 border-t border-white/5">
          <button
            disabled={busy}
            onClick={() => onApply({ revoke: true })}
            className="text-[11px] font-black uppercase tracking-widest text-red-400/80 hover:text-red-400 transition-colors disabled:opacity-50"
          >
            Couper (impayé)
          </button>
          <button
            disabled={busy}
            onClick={onClose}
            className="text-[11px] font-black uppercase tracking-widest text-slate-400 hover:text-white transition-colors disabled:opacity-50"
          >
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
};

const ServersSection = ({ userRole = '' }) => {
  const { theme } = useTheme();
  const { addToast } = useToast();
  // La gestion de licence (prolonger/couper/palier/canal) est l'acte de
  // facturation → admin uniquement. Le reste (ajout, one-liner, suppression)
  // est ouvert au revendeur sur SES serveurs (l'API scope par propriétaire).
  const isAdmin = userRole === 'admin';

  const [servers, setServers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [confirmTarget, setConfirmTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [renewTarget, setRenewTarget] = useState(null);
  const [renewing, setRenewing] = useState(false);
  const [oneLiner, setOneLiner] = useState(null); // { label, oneLiner }
  const [query, setQuery] = useState('');
  const [showPushModal, setShowPushModal] = useState(false);
  const [pushing, setPushing] = useState(false);

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

  // Approuve (ou annule) le déploiement de la version plateforme sur une
  // sélection d'instances. Elles l'appliquent en ≤ 30 min (cron gouverné).
  const handlePushUpdate = async (payload) => {
    if (pushing) return;
    setPushing(true);
    try {
      const { data } = await axiosInstance.post('/servers/push-update', payload);
      addToast(
        payload.clear
          ? `Déploiement annulé pour ${data.count} instance${data.count > 1 ? 's' : ''}`
          : `v${data.version} approuvée pour ${data.count} instance${data.count > 1 ? 's' : ''}`,
        'success'
      );
      setShowPushModal(false);
      fetchServers();
    } catch (e) {
      addToast(e?.response?.data?.error || 'Erreur de déploiement', 'error');
    } finally {
      setPushing(false);
    }
  };

  // Régénère le one-liner d'installation (token neuf, licence conservée).
  const handleOneLiner = async (srv) => {
    try {
      const { data } = await axiosInstance.post(`/servers/${srv.id}/one-liner`);
      setOneLiner({ label: srv.label, oneLiner: data.oneLiner });
    } catch (e) {
      addToast(e?.response?.data?.error || 'Erreur de génération du one-liner', 'error');
    }
  };

  const handleRenew = async (payload) => {
    if (!renewTarget || renewing) return;
    setRenewing(true);
    try {
      const { data } = await axiosInstance.patch(`/servers/${renewTarget.id}/license`, payload);
      let msg;
      if (payload.revoke) msg = 'Licence coupée';
      else if (payload.updateChannel) msg = `Canal de mise à jour : ${payload.updateChannel}`;
      else if (payload.maxClients !== undefined)
        msg =
          payload.maxClients == null
            ? 'Plafond de clients retiré'
            : `Plafond : ${payload.maxClients} clients`;
      else
        msg = `Licence prolongée jusqu'au ${new Date(data.licenseExpiry).toLocaleDateString('fr-FR')}`;
      addToast(msg, 'success');
      setRenewTarget(null);
      fetchServers();
    } catch (e) {
      addToast(e?.response?.data?.error || 'Erreur lors du renouvellement', 'error');
    } finally {
      setRenewing(false);
    }
  };

  // Synthèse de flotte + filtre de recherche.
  const summary = useMemo(() => {
    const online = servers.filter((s) => s.status === 'online').length;
    const expiring = servers.filter((s) => {
      const d = daysUntil(s.licenseExpiry);
      return d !== null && d <= 7;
    }).length;
    const clients = servers.reduce((a, s) => a + (s.clientCount || 0), 0);
    const outdated = servers.filter((s) => s.updateAvailable).length;
    return { total: servers.length, online, expiring, clients, outdated };
  }, [servers]);

  const visibleServers = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return servers;
    return servers.filter((s) =>
      [s.label, s.host, s.owner, s.status].some((v) => (v || '').toLowerCase().includes(q))
    );
  }, [servers, query]);

  const summaryCards = [
    { icon: Server, label: 'Serveurs', value: summary.total, cls: 'text-slate-300' },
    { icon: Wifi, label: 'En ligne', value: summary.online, cls: 'text-emerald-400' },
    {
      icon: Timer,
      label: 'Licences ≤ 7 j',
      value: summary.expiring,
      cls: summary.expiring > 0 ? 'text-amber-400' : 'text-slate-300',
    },
    { icon: Users, label: 'Clients (flotte)', value: summary.clients, cls: 'text-sky-400' },
    {
      icon: ArrowUpCircle,
      label: 'Maj en attente',
      value: summary.outdated,
      cls: summary.outdated > 0 ? 'text-amber-400' : 'text-slate-300',
    },
  ];

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
          <div className="relative w-full md:w-56">
            <Search
              size={14}
              className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500"
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filtrer (nom, hôte, statut…)"
              className="w-full bg-white/5 border border-white/10 rounded-xl pl-9 pr-4 py-2.5 text-xs text-white font-mono focus:outline-none focus:border-white/20"
            />
          </div>
          <VibeButton
            variant="secondary"
            icon={RefreshCw}
            className="w-full md:w-auto"
            onClick={fetchServers}
          >
            Actualiser
          </VibeButton>
          {isAdmin && (
            <VibeButton
              variant="secondary"
              icon={ArrowUpCircle}
              className="w-full md:w-auto"
              onClick={() => setShowPushModal(true)}
            >
              Déployer{summary.outdated > 0 ? ` (${summary.outdated})` : ''}
            </VibeButton>
          )}
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

      {/* Synthèse de flotte */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {summaryCards.map((c) => (
          <GlassCard key={c.label} hover={false} className="py-5">
            <div className="flex items-center gap-2 text-slate-500 mb-2">
              <c.icon size={14} />
              <span className="text-[10px] font-black uppercase tracking-widest">{c.label}</span>
            </div>
            <div className={cn('text-3xl font-black', c.cls)}>{c.value}</div>
          </GlassCard>
        ))}
      </div>

      {/* Table */}
      <GlassCard className="p-0 overflow-hidden" hover={false}>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="text-[10px] font-black text-slate-500 uppercase tracking-[0.25em] border-b border-white/5">
                <th className="px-10 py-8">Serveur</th>
                <th className="px-8 py-8">Adresse</th>
                <th className="px-8 py-8">Statut</th>
                <th className="px-8 py-8">Version</th>
                <th className="px-8 py-8">Licence</th>
                <th className="px-8 py-8">Dernier contact</th>
                <th className="px-10 py-8 text-right">Intervention</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              <AnimatePresence mode="popLayout">
                {visibleServers.map((srv, idx) => (
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
                        <div>
                          <div className="text-sm font-black text-white uppercase tracking-tight">
                            {srv.label || 'Sans nom'}
                          </div>
                          {srv.owner && (
                            <div className="text-[10px] font-mono text-slate-500">{srv.owner}</div>
                          )}
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
                      <div className="flex flex-col gap-1">
                        <VersionBadge version={srv.version} updateAvailable={srv.updateAvailable} />
                        {srv.updateApproved && srv.updateAvailable && (
                          <span className="text-[9px] font-black uppercase tracking-widest text-amber-400/90">
                            → v{srv.platformVersion} programmée
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-8 py-6">
                      <div className="flex flex-col gap-1">
                        <LicenseBadge expiry={srv.licenseExpiry} />
                        {typeof srv.clientCount === 'number' && (
                          <span className="flex items-center gap-1 text-[10px] font-mono text-slate-600">
                            <Users size={11} /> {srv.clientCount}
                            {srv.maxClients != null ? ` / ${srv.maxClients}` : ''} client
                            {srv.clientCount > 1 ? 's' : ''}
                          </span>
                        )}
                        {(srv.updateChannel || 'stable') !== 'stable' && (
                          <span className="text-[9px] font-black uppercase tracking-widest text-sky-400/80">
                            canal {srv.updateChannel}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-8 py-6">
                      <span className="text-[11px] font-mono text-slate-500">
                        {relativeTime(srv.lastHeartbeat || srv.lastChecked)}
                      </span>
                    </td>
                    <td className="px-6 py-6 text-right">
                      <div className="flex justify-end gap-2 lg:opacity-0 lg:group-hover:opacity-100 transition-all transform lg:translate-x-2 lg:group-hover:translate-x-0">
                        <VibeButton
                          variant="secondary"
                          size="sm"
                          icon={Terminal}
                          className="p-2.5"
                          title="Commande d’installation (one-liner)"
                          onClick={() => handleOneLiner(srv)}
                        />
                        {isAdmin && (
                          <VibeButton
                            variant="secondary"
                            size="sm"
                            icon={KeyRound}
                            className="p-2.5"
                            title="Gérer la licence"
                            onClick={() => setRenewTarget(srv)}
                          />
                        )}
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

        {servers.length > 0 && visibleServers.length === 0 && (
          <div className="flex items-center justify-center py-16 text-slate-500 text-xs font-black uppercase tracking-widest">
            Aucun serveur ne correspond au filtre
          </div>
        )}

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

      <RenewModal
        server={renewTarget}
        busy={renewing}
        onApply={handleRenew}
        onClose={() => setRenewTarget(null)}
      />

      <OneLinerModal data={oneLiner} onClose={() => setOneLiner(null)} />

      {showPushModal && (
        <PushUpdateModal
          servers={servers}
          busy={pushing}
          onApply={handlePushUpdate}
          onClose={() => setShowPushModal(false)}
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
