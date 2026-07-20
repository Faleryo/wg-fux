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
  PowerOff,
  Activity,
  PencilLine,
  Download,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTheme } from '../../../context/ThemeContext';
import { useToast } from '../../../context/ToastContext';
import { useLang } from '../../../context/LanguageContext';
import { cn, COLOR_MAP } from '../../../lib/utils';
import { axiosInstance } from '../../../lib/api';
import GlassCard from '../../../components/ui/Card';
import VibeButton from '../../../components/ui/Button';
import ConfirmModal from '../../../components/modals/ConfirmModal';
import AddServerModal from '../../../components/modals/AddServerModal';
import EditServerModal from './EditServerModal';
import ServerDetailModal from './ServerDetailModal';

// Délai de polling tant qu'au moins un serveur est en attente.
const POLL_INTERVAL = 3000;
const PENDING_STATES = new Set(['pending', 'provisioning']);

const STATUS_CONFIG = {
  pending: {
    labelKey: 'srv_status_pending',
    cls: 'bg-slate-500/10 border-slate-500/20 text-slate-400',
    dot: 'bg-slate-400',
    pulse: false,
  },
  provisioning: {
    labelKey: 'srv_status_provisioning',
    cls: 'bg-sky-500/10 border-sky-500/20 text-sky-400',
    dot: 'bg-sky-400',
    pulse: true,
  },
  online: {
    labelKey: 'status_online',
    cls: 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400',
    dot: 'bg-emerald-400 shadow-[0_0_8px_#10b981]',
    pulse: false,
  },
  error: {
    labelKey: 'srv_status_error',
    cls: 'bg-red-500/10 border-red-500/20 text-red-400',
    dot: 'bg-red-500 shadow-[0_0_8px_#ef4444]',
    pulse: false,
  },
  offline: {
    labelKey: 'status_offline',
    cls: 'bg-slate-700/30 border-slate-600/30 text-slate-500',
    dot: 'bg-slate-600',
    pulse: false,
  },
};

// Temps relatif compact (fr) — pas de dépendance externe.
const relativeTime = (iso, t) => {
  if (!iso) return '—';
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return '—';
  const wrap = (value) => [t('ago_prefix'), value, t('ago_suffix')].filter(Boolean).join(' ');
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 5) return t('just_now');
  if (diff < 60) return wrap(`${diff}s`);
  const min = Math.floor(diff / 60);
  if (min < 60) return wrap(`${min} ${t('unit_min')}`);
  const h = Math.floor(min / 60);
  if (h < 24) return wrap(`${h} ${t('unit_hour')}`);
  const d = Math.floor(h / 24);
  return wrap(`${d} ${t('unit_day')}`);
};

const StatusBadge = ({ status }) => {
  const { t } = useLang();
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.pending;
  return (
    <div
      className={cn(
        'inline-flex items-center gap-2 text-[11px] font-black uppercase tracking-widest px-4 py-1.5 rounded-xl border w-fit',
        cfg.cls
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', cfg.dot, cfg.pulse && 'animate-pulse')} />
      {t(cfg.labelKey)}
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
  const { t } = useLang();
  if (!version) return <span className="text-[11px] font-mono text-slate-600">—</span>;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 text-[11px] font-mono font-bold',
        updateAvailable ? 'text-amber-400' : 'text-emerald-400/90'
      )}
      title={updateAvailable ? t('update_available_cron') : t('up_to_date')}
    >
      {updateAvailable ? <ArrowUpCircle size={12} /> : <Check size={12} />}v{version}
    </span>
  );
};

// Modale de déploiement gouverné : l'admin choisit quelles instances reçoivent
// la version courante de la plateforme (ou toute la flotte). Une instance non
// approuvée ne voit JAMAIS la mise à jour (heartbeat muet + bundle 204).
const PushUpdateModal = ({ servers, onClose, onApply, busy }) => {
  const { t } = useLang();
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
              {t('deploy_version_title')} v{platformVersion}
            </h3>
            <p className="text-[11px] font-mono text-slate-500">
              {t('deploy_approved_hint')}
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
            {allSelected ? t('deselect_all') : t('select_all')}
          </button>
          <span className="text-[11px] font-mono text-slate-500">
            {selected.size} / {eligible.length} {t('instances_word')}
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
                      <span className="text-[11px] font-mono text-slate-500"> · {s.owner}</span>
                    ) : null}
                  </span>
                  <span className="block text-[11px] font-mono text-slate-500 truncate">
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
                    className="text-[11px] font-black uppercase tracking-widest text-amber-400"
                    title={t('deploy_already_scheduled')}
                  >
                    {t('scheduled_badge')}
                  </span>
                )}
              </label>
            );
          })}
          {eligible.length === 0 && (
            <div className="px-4 py-8 text-center text-slate-500 text-xs uppercase tracking-widest">
              {t('no_instance_enrolled')}
            </div>
          )}
        </div>

        {/* Mode de déploiement */}
        <div className="space-y-2">
          <span className="text-[11px] font-black text-slate-500 uppercase tracking-widest">
            {t('deploy_mode')}
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
                {t('deploy_scheduled_title')}
              </span>
              <span className="block text-[11px] text-slate-400 mt-1">
                {t('deploy_scheduled_desc')}
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
                {t('deploy_instant_title')}
              </span>
              <span className="block text-[11px] text-slate-400 mt-1">
                {t('deploy_instant_desc')}
              </span>
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between pt-2 border-t border-white/5">
          <button
            disabled={busy || selected.size === 0}
            onClick={() => onApply({ serverIds: [...selected], clear: true })}
            className="text-[11px] font-black uppercase tracking-widest text-red-400/80 hover:text-red-400 transition-colors disabled:opacity-40"
            title={t('cancel_deployment_title')}
          >
            {t('cancel_deployment')}
          </button>
          <div className="flex items-center gap-4">
            <button
              disabled={busy}
              onClick={onClose}
              className="text-[11px] font-black tracking-widest text-slate-400 hover:text-white transition-colors disabled:opacity-50"
            >
              {t('close')}
            </button>
            <button
              disabled={busy || selected.size === 0}
              onClick={() => onApply({ serverIds: [...selected], mode })}
              className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-[11px] font-black tracking-widest text-white transition-colors disabled:opacity-40"
            >
              {t('push_update')} ({selected.size})
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// Modale one-liner : commande de (ré)installation à coller sur le VPS.
const OneLinerModal = ({ data, onClose }) => {
  const { t } = useLang();
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
            <h3 className="text-lg font-black text-white tracking-tight">
              {t('install_command')}
            </h3>
            <p className="text-[11px] font-mono text-slate-500">
              {data.label} · {t('oneliner_validity')}
            </p>
          </div>
        </div>
        <p className="text-xs text-slate-400">
          {t('oneliner_desc')}
        </p>
        <pre className="bg-black/40 border border-white/10 rounded-xl p-4 text-[11px] font-mono text-sky-200 whitespace-pre-wrap break-all max-h-48 overflow-y-auto select-all">
          <code>{data.oneLiner}</code>
        </pre>
        <div className="flex items-center justify-between">
          <button
            onClick={copy}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-white/10 bg-white/5 hover:bg-sky-500/20 text-[11px] font-black tracking-widest text-white transition-colors"
          >
            {copied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
            {copied ? t('copied') : t('copy')}
          </button>
          <button
            onClick={onClose}
            className="text-[11px] font-black uppercase tracking-widest text-slate-400 hover:text-white transition-colors"
          >
            {t('close')}
          </button>
        </div>
      </div>
    </div>
  );
};

const LicenseBadge = ({ expiry }) => {
  const { t } = useLang();
  const days = daysUntil(expiry);
  if (days === null) {
    return <span className="text-[11px] font-mono text-slate-600">—</span>;
  }
  const expired = days <= 0;
  const soon = days > 0 && days <= 7;
  const cls = expired ? 'text-red-400' : soon ? 'text-amber-400' : 'text-emerald-400/90';
  const label = expired
    ? `${t('lic_expired')} (${Math.abs(days)} ${t('unit_day')})`
    : days === 0
      ? t('expires_today')
      : `${days} ${t('days_left')}`;
  return <span className={cn('text-[11px] font-mono font-bold', cls)}>{label}</span>;
};

// Modale de renouvellement : prolonge/coupe la licence d'une instance (admin).
const RENEW_OPTIONS = [
  { days: 30, labelKey: 'renew_1_month' },
  { days: 90, labelKey: 'renew_3_months' },
  { days: 365, labelKey: 'renew_1_year' },
];
const UPDATE_CHANNELS = [
  { value: 'stable', labelKey: 'channel_stable' },
  { value: 'canary', labelKey: 'channel_canary' },
  { value: 'hold', labelKey: 'channel_hold' },
];
const RenewModal = ({ server, onClose, onApply, busy }) => {
  const { t } = useLang();
  const [maxClients, setMaxClients] = useState('');
  const [customDays, setCustomDays] = useState('');
  useEffect(() => {
    setMaxClients(server?.maxClients != null ? String(server.maxClients) : '');
    setCustomDays('');
  }, [server]);
  if (!server) return null;

  const customDaysInt = Number(customDays);
  const customDaysValid =
    customDays.trim() !== '' &&
    Number.isInteger(customDaysInt) &&
    customDaysInt > 0 &&
    customDaysInt <= 3650;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="glass-panel border rounded-2xl shadow-2xl w-full max-w-md p-8 space-y-6">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-indigo-500/15 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
            <KeyRound size={20} />
          </div>
          <div>
            <h3 className="text-lg font-black text-white uppercase tracking-tight">{t('license')}</h3>
            <p className="text-[11px] font-mono text-slate-500">
              {server.label} · {server.host}
            </p>
          </div>
        </div>

        <div className="text-xs text-slate-400">
          {t('current_status')} <LicenseBadge expiry={server.licenseExpiry} />
        </div>

        <div className="grid grid-cols-3 gap-3">
          {RENEW_OPTIONS.map((opt) => (
            <button
              key={opt.days}
              disabled={busy}
              onClick={() => onApply({ extendDays: opt.days })}
              className="py-3 rounded-xl border border-white/10 bg-white/5 hover:bg-indigo-500/20 hover:border-indigo-500/40 text-sm font-black text-white transition-colors disabled:opacity-50"
            >
              {t(opt.labelKey)}
            </button>
          ))}
        </div>

        {/* Délai personnalisé : durée libre en jours (au-delà des 3 préréglages) */}
        <div className="flex gap-3">
          <input
            value={customDays}
            onChange={(e) => setCustomDays(e.target.value)}
            inputMode="numeric"
            placeholder={t('ph_custom_days')}
            className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white font-mono focus:outline-none focus:border-white/20"
          />
          <button
            disabled={busy || !customDaysValid}
            onClick={() => onApply({ extendDays: customDaysInt })}
            className="px-4 rounded-xl border border-white/10 bg-white/5 hover:bg-indigo-500/20 hover:border-indigo-500/40 text-[11px] font-black uppercase tracking-widest text-white transition-colors disabled:opacity-50"
          >
            {t('apply')}
          </button>
        </div>

        {/* Palier : plafond de clients (appliqué par l'instance au heartbeat suivant) */}
        <div className="space-y-2 pt-2 border-t border-white/5">
          <label className="text-[11px] font-black text-slate-500 uppercase tracking-widest">
            {t('client_cap_label')}
          </label>
          <div className="flex gap-3">
            <input
              value={maxClients}
              onChange={(e) => setMaxClients(e.target.value)}
              placeholder={t('ph_unlimited')}
              className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white font-mono focus:outline-none focus:border-white/20"
            />
            <button
              disabled={busy}
              onClick={() =>
                onApply({ maxClients: maxClients.trim() === '' ? null : Number(maxClients) })
              }
              className="px-4 rounded-xl border border-white/10 bg-white/5 hover:bg-indigo-500/20 text-[11px] font-black uppercase tracking-widest text-white transition-colors disabled:opacity-50"
            >
              {t('apply')}
            </button>
          </div>
        </div>

        {/* Canal de mise à jour */}
        <div className="space-y-2">
          <label className="text-[11px] font-black text-slate-500 uppercase tracking-widest">
            {t('update_channel_label')}
          </label>
          <div className="grid grid-cols-3 gap-2">
            {UPDATE_CHANNELS.map((ch) => (
              <button
                key={ch.value}
                disabled={busy}
                onClick={() => onApply({ updateChannel: ch.value })}
                className={cn(
                  'py-2 rounded-xl border text-[11px] font-black uppercase tracking-widest transition-colors disabled:opacity-50',
                  (server.updateChannel || 'stable') === ch.value
                    ? 'border-indigo-500/50 bg-indigo-500/20 text-indigo-300'
                    : 'border-white/10 bg-white/5 text-slate-400 hover:text-white'
                )}
              >
                {t(ch.labelKey)}
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
            {t('cut_unpaid')}
          </button>
          <button
            disabled={busy}
            onClick={onClose}
            className="text-[11px] font-black uppercase tracking-widest text-slate-400 hover:text-white transition-colors disabled:opacity-50"
          >
            {t('close')}
          </button>
        </div>
      </div>
    </div>
  );
};

// Modale de désinstallation à distance : action destructive et irréversible sur
// le VPS lui-même (pas seulement l'enregistrement) — on exige de retaper le
// label du serveur avant d'activer le bouton, comme pour un `terraform destroy`.
const UninstallModal = ({ server, onClose, onConfirm, busy }) => {
  const { t } = useLang();
  const [typed, setTyped] = useState('');
  useEffect(() => {
    setTyped('');
  }, [server]);
  if (!server) return null;
  const matches = typed === server.label;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="glass-panel border rounded-2xl shadow-2xl w-full max-w-md p-8 space-y-6">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-red-500/15 border border-red-500/20 flex items-center justify-center text-red-400">
            <PowerOff size={20} />
          </div>
          <div>
            <h3 className="text-lg font-black text-white uppercase tracking-tight">
              {t('uninstall_wgfux')}
            </h3>
            <p className="text-[11px] font-mono text-slate-500">
              {server.label} · {server.host}
            </p>
          </div>
        </div>

        <div className="flex items-start gap-3 p-4 rounded-2xl bg-red-500/10 border border-red-500/15">
          <AlertCircle size={16} className="text-red-400 flex-shrink-0 mt-0.5" />
          <p className="text-[11px] text-red-400 font-bold leading-relaxed">
            {t('uninstall_warning')}
          </p>
        </div>

        <div className="space-y-2">
          <label className="text-[11px] font-black text-slate-500 uppercase tracking-widest">
            {t('type_to_confirm_prefix')} « {server.label} » {t('type_to_confirm_suffix')}
          </label>
          <input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white font-mono focus:outline-none focus:border-red-500/40"
            autoFocus
          />
        </div>

        <div className="flex gap-3">
          <button
            onClick={onClose}
            disabled={busy}
            className="flex-1 py-3 rounded-2xl text-xs font-black uppercase tracking-widest bg-slate-800 hover:bg-slate-700 text-slate-300 border border-white/5 transition-all disabled:opacity-50"
          >
            {t('cancel')}
          </button>
          <button
            onClick={onConfirm}
            disabled={busy || !matches}
            className="flex-1 py-3 rounded-2xl text-white text-xs font-black uppercase tracking-widest bg-red-600 hover:bg-red-500 shadow-lg shadow-red-600/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {busy ? t('uninstalling') : t('uninstall_permanently')}
          </button>
        </div>
      </div>
    </div>
  );
};

const ServersSection = ({ userRole = '' }) => {
  const { theme } = useTheme();
  const { addToast } = useToast();
  const { t, lang } = useLang();
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
  const [uninstallTarget, setUninstallTarget] = useState(null);
  const [uninstalling, setUninstalling] = useState(false);
  const [query, setQuery] = useState('');
  const [showPushModal, setShowPushModal] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [editing, setEditing] = useState(false);
  const [detailId, setDetailId] = useState(null);
  const [checkingId, setCheckingId] = useState(null);
  const [selected, setSelected] = useState(() => new Set());
  const [bulkRenewDays, setBulkRenewDays] = useState('30');

  const pollRef = useRef(null);

  const fetchServers = useCallback(async () => {
    try {
      const res = await axiosInstance.get('/servers');
      setServers(Array.isArray(res.data) ? res.data : []);
    } catch (e) {
      addToast(e?.response?.data?.error || t('srv_load_err'), 'error');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      addToast(t('server_deleted'), 'success');
      setConfirmTarget(null);
      fetchServers();
    } catch (e) {
      addToast(e?.response?.data?.error || t('delete_error'), 'error');
    } finally {
      setDeleting(false);
    }
  };

  const handleUninstall = async () => {
    if (!uninstallTarget || uninstalling) return;
    setUninstalling(true);
    try {
      await axiosInstance.post(`/servers/${uninstallTarget.id}/uninstall`);
      addToast(t('wgfux_uninstalled'), 'success');
      setUninstallTarget(null);
      fetchServers();
    } catch (e) {
      addToast(e?.response?.data?.error || t('uninstall_error'), 'error');
    } finally {
      setUninstalling(false);
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
          ? `${t('deploy_cancelled_for')} ${data.count} ${t('instances_word')}`
          : `v${data.version} ${t('approved_for')} ${data.count} ${t('instances_word')}`,
        'success'
      );
      setShowPushModal(false);
      fetchServers();
    } catch (e) {
      addToast(e?.response?.data?.error || t('deploy_error'), 'error');
    } finally {
      setPushing(false);
    }
  };

  // Édite un serveur (label/host/port/métadonnées/alertes).
  const handleEdit = async (payload) => {
    if (!editTarget || editing) return;
    setEditing(true);
    try {
      await axiosInstance.patch(`/servers/${editTarget.id}`, payload);
      addToast(t('server_updated'), 'success');
      setEditTarget(null);
      fetchServers();
    } catch (e) {
      addToast(e?.response?.data?.error || t('update_error'), 'error');
    } finally {
      setEditing(false);
    }
  };

  // Sonde SSH à la demande (rafraîchit statut/erreur sans attendre le heartbeat).
  const handleHealthcheck = async (srv) => {
    if (checkingId) return;
    setCheckingId(srv.id);
    try {
      const { data } = await axiosInstance.post(`/servers/${srv.id}/healthcheck`);
      addToast(
        data.success
          ? `${srv.label} : ${t('srv_online_suffix')}`
          : `${srv.label} : ${t('srv_unreachable_suffix')}`,
        data.success ? 'success' : 'error'
      );
      fetchServers();
    } catch (e) {
      addToast(e?.response?.data?.error || t('probe_failed'), 'error');
    } finally {
      setCheckingId(null);
    }
  };

  // Sélection groupée.
  const toggleSelect = (id) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  const clearSelection = () => setSelected(new Set());

  const handleBulk = async (action) => {
    const ids = [...selected];
    if (ids.length === 0) return;
    try {
      const payload = { ids, action };
      if (action === 'renew') payload.extendDays = Number(bulkRenewDays) || 30;
      const { data } = await axiosInstance.post('/servers/bulk', payload);
      addToast(
        action === 'delete'
          ? `${data.affected} ${t('servers_deleted_suffix')}`
          : `${data.affected} ${t('licenses_extended_suffix')}`,
        'success'
      );
      clearSelection();
      fetchServers();
    } catch (e) {
      addToast(e?.response?.data?.error || t('bulk_action_failed'), 'error');
    }
  };

  // Export CSV de la flotte (client-side, sur la vue filtrée).
  const handleExportCsv = () => {
    const cols = [
      'id',
      'label',
      'host',
      'port',
      'status',
      'version',
      'clientCount',
      'cpuPct',
      'memPct',
      'diskPct',
      'region',
      'provider',
      'licenseExpiry',
      'lastHeartbeat',
    ];
    const esc = (v) => {
      const s = v == null ? '' : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [cols.join(',')];
    for (const s of visibleServers) lines.push(cols.map((c) => esc(s[c])).join(','));
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `wg-fux-serveurs-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 100);
  };

  // Régénère le one-liner d'installation (token neuf, licence conservée).
  const handleOneLiner = async (srv) => {
    try {
      const { data } = await axiosInstance.post(`/servers/${srv.id}/one-liner`);
      setOneLiner({ label: srv.label, oneLiner: data.oneLiner });
    } catch (e) {
      addToast(e?.response?.data?.error || t('oneliner_gen_error'), 'error');
    }
  };

  const handleRenew = async (payload) => {
    if (!renewTarget || renewing) return;
    setRenewing(true);
    try {
      const { data } = await axiosInstance.patch(`/servers/${renewTarget.id}/license`, payload);
      let msg;
      if (payload.revoke) msg = t('license_cut');
      else if (payload.updateChannel)
        msg = `${t('update_channel_prefix')} ${payload.updateChannel}`;
      else if (payload.maxClients !== undefined)
        msg =
          payload.maxClients == null
            ? t('client_cap_removed')
            : `${t('cap_prefix')} ${payload.maxClients} ${t('clients_word')}`;
      else
        msg = `${t('license_extended_until')} ${new Date(data.licenseExpiry).toLocaleDateString(
          lang === 'fr' ? 'fr-FR' : 'en-GB'
        )}`;
      addToast(msg, 'success');
      setRenewTarget(null);
      fetchServers();
    } catch (e) {
      addToast(e?.response?.data?.error || t('renew_error'), 'error');
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
    { icon: Server, label: t('servers'), value: summary.total, cls: 'text-slate-300' },
    { icon: Wifi, label: t('status_online'), value: summary.online, cls: 'text-emerald-400' },
    {
      icon: Timer,
      label: t('licenses_7d'),
      value: summary.expiring,
      cls: summary.expiring > 0 ? 'text-amber-400' : 'text-slate-300',
    },
    { icon: Users, label: t('clients_fleet'), value: summary.clients, cls: 'text-sky-400' },
    {
      icon: ArrowUpCircle,
      label: t('pending_updates'),
      value: summary.outdated,
      cls: summary.outdated > 0 ? 'text-amber-400' : 'text-slate-300',
    },
  ];

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-5 duration-700">
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
              {t('servers')}
            </h2>
            <p className="text-slate-500 text-[11px] font-black tracking-[0.3em] uppercase opacity-60">
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
              placeholder={t('srv_filter_ph')}
              className="w-full bg-white/5 border border-white/10 rounded-xl pl-9 pr-4 py-2.5 text-xs text-white font-mono focus:outline-none focus:border-white/20"
            />
          </div>
          <VibeButton
            variant="secondary"
            icon={RefreshCw}
            className="w-full md:w-auto"
            onClick={fetchServers}
          >
            {t('refresh')}
          </VibeButton>
          <VibeButton
            variant="secondary"
            icon={Download}
            className="w-full md:w-auto"
            onClick={handleExportCsv}
            disabled={visibleServers.length === 0}
          >
            {t('export_csv')}
          </VibeButton>
          {isAdmin && (
            <VibeButton
              variant="secondary"
              icon={ArrowUpCircle}
              className="w-full md:w-auto"
              onClick={() => setShowPushModal(true)}
            >
              {t('deploy_btn')}
              {summary.outdated > 0 ? ` (${summary.outdated})` : ''}
            </VibeButton>
          )}
          <VibeButton
            variant="primary"
            icon={Plus}
            className="w-full md:w-auto"
            onClick={() => setShowAddModal(true)}
          >
            {t('add_vps')}
          </VibeButton>
        </div>
      </GlassCard>

      {/* Synthèse de flotte */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {summaryCards.map((c) => (
          <GlassCard key={c.label} hover={false} className="py-5">
            <div className="flex items-center gap-2 text-slate-500 mb-2">
              <c.icon size={14} />
              <span className="text-[11px] font-black uppercase tracking-widest">{c.label}</span>
            </div>
            <div className={cn('text-3xl font-black', c.cls)}>{c.value}</div>
          </GlassCard>
        ))}
      </div>

      {/* Barre d'actions groupées */}
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-3 px-5 py-3 rounded-2xl bg-indigo-500/10 border border-indigo-500/20">
          <span className="text-[11px] font-black tracking-widest text-indigo-300">
            {selected.size} {t('selected')}
          </span>
          <div className="flex-1" />
          {isAdmin && (
            <div className="flex items-center gap-2">
              <input
                value={bulkRenewDays}
                onChange={(e) => setBulkRenewDays(e.target.value)}
                className="w-16 bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-white/20"
                title={t('days_to_add')}
              />
              <button
                onClick={() => handleBulk('renew')}
                className="px-3 py-1.5 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-[11px] font-black tracking-widest text-emerald-300 hover:bg-emerald-500/25 transition-colors"
              >
                {t('extend_licenses')}
              </button>
            </div>
          )}
          <button
            onClick={() => handleBulk('delete')}
            className="px-3 py-1.5 rounded-lg bg-red-500/15 border border-red-500/30 text-[11px] font-black tracking-widest text-red-300 hover:bg-red-500/25 transition-colors"
          >
            {t('delete')}
          </button>
          <button
            onClick={clearSelection}
            className="px-3 py-1.5 text-[11px] font-black tracking-widest text-slate-400 hover:text-white transition-colors"
          >
            {t('cancel')}
          </button>
        </div>
      )}

      {/* Table */}
      <GlassCard className="p-0 overflow-hidden" hover={false}>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="text-[11px] font-black text-slate-500 uppercase tracking-[0.25em] border-b border-white/5">
                <th className="pl-8 py-8 w-10">
                  <input
                    type="checkbox"
                    className="accent-indigo-500 cursor-pointer"
                    checked={visibleServers.length > 0 && selected.size === visibleServers.length}
                    onChange={(e) =>
                      setSelected(
                        e.target.checked ? new Set(visibleServers.map((s) => s.id)) : new Set()
                      )
                    }
                    title={t('select_all')}
                  />
                </th>
                <th className="px-6 py-8">{t('col_server')}</th>
                <th className="px-6 py-4">{t('col_address')}</th>
                <th className="px-6 py-4">{t('col_status')}</th>
                <th className="px-6 py-4">{t('col_load')}</th>
                <th className="px-6 py-4">{t('col_version')}</th>
                <th className="px-6 py-4">{t('col_license')}</th>
                <th className="px-6 py-4">{t('col_last_contact')}</th>
                <th className="px-6 py-4 text-right">{t('col_action')}</th>
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
                    className={cn(
                      'group hover:bg-white/5 transition-colors',
                      selected.has(srv.id) && 'bg-indigo-500/5'
                    )}
                  >
                    <td className="pl-8 py-6">
                      <input
                        type="checkbox"
                        className="accent-indigo-500 cursor-pointer"
                        checked={selected.has(srv.id)}
                        onChange={() => toggleSelect(srv.id)}
                      />
                    </td>
                    <td className="px-6 py-4">
                      <button
                        type="button"
                        onClick={() => setDetailId(srv.id)}
                        className="flex items-center gap-5 text-left"
                        title={t('view_detail')}
                      >
                        <div className="w-12 h-12 rounded-2xl bg-slate-800 flex items-center justify-center text-slate-400 transition-all group-hover:scale-110 group-hover:bg-slate-700 shadow-xl border border-white/5">
                          <Server size={20} />
                        </div>
                        <div>
                          <div className="text-sm font-black text-white tracking-tight hover:text-indigo-300 transition-colors">
                            {srv.label || t('unnamed')}
                          </div>
                          {srv.owner && (
                            <div className="text-[11px] font-mono text-slate-500">{srv.owner}</div>
                          )}
                          {Array.isArray(srv.tags) && srv.tags.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1">
                              {srv.tags.slice(0, 3).map((t) => (
                                <span
                                  key={t}
                                  className="px-1.5 py-0.5 rounded bg-indigo-500/10 text-[9px] font-bold text-indigo-300"
                                >
                                  {t}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </button>
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-xs font-mono text-slate-400">
                        {srv.host}
                        <span className="text-slate-600">:{srv.port ?? 22}</span>
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-col gap-1.5">
                        <StatusBadge status={srv.status} />
                        {srv.status === 'error' && srv.lastError && (
                          <span
                            title={srv.lastError}
                            className="flex items-center gap-1.5 text-[11px] text-red-400/80 font-mono max-w-[260px] truncate"
                          >
                            <AlertCircle size={12} className="flex-shrink-0" />
                            {srv.lastError}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      {srv.cpuPct == null && srv.memPct == null && srv.diskPct == null ? (
                        <span className="text-[11px] font-mono text-slate-600">—</span>
                      ) : (
                        <div className="flex flex-col gap-1 min-w-[120px]">
                          {[
                            ['CPU', srv.cpuPct],
                            ['RAM', srv.memPct],
                            ['DSK', srv.diskPct],
                          ].map(([lab, v]) => (
                            <div key={lab} className="flex items-center gap-2">
                              <span className="text-[9px] font-black text-slate-600 w-6">
                                {lab}
                              </span>
                              <div className="flex-1 h-1 rounded-full bg-white/5 overflow-hidden">
                                <div
                                  className={cn(
                                    'h-full rounded-full',
                                    v == null
                                      ? 'bg-slate-600'
                                      : v >= 90
                                        ? 'bg-red-500'
                                        : v >= 70
                                          ? 'bg-amber-500'
                                          : 'bg-emerald-500'
                                  )}
                                  style={{ width: `${v == null ? 0 : Math.min(100, v)}%` }}
                                />
                              </div>
                              <span className="text-[9px] font-mono text-slate-500 w-7 text-right">
                                {v == null ? '—' : `${Math.round(v)}`}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-col gap-1">
                        <VersionBadge version={srv.version} updateAvailable={srv.updateAvailable} />
                        {srv.updateApproved && srv.updateAvailable && (
                          <span className="text-[11px] font-black uppercase tracking-widest text-amber-400/90">
                            → v{srv.platformVersion} {t('scheduled_badge')}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-col gap-1">
                        <LicenseBadge expiry={srv.licenseExpiry} />
                        {typeof srv.clientCount === 'number' && (
                          <span className="flex items-center gap-1 text-[11px] font-mono text-slate-600">
                            <Users size={11} /> {srv.clientCount}
                            {srv.maxClients != null ? ` / ${srv.maxClients}` : ''}{' '}
                            {t('clients_word')}
                          </span>
                        )}
                        {(srv.updateChannel || 'stable') !== 'stable' && (
                          <span className="text-[11px] font-black uppercase tracking-widest text-sky-400/80">
                            {t('channel_word')} {srv.updateChannel}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-[11px] font-mono text-slate-500">
                        {relativeTime(srv.lastHeartbeat || srv.lastChecked, t)}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex justify-end gap-2 lg:opacity-0 lg:group-hover:opacity-100 transition-all transform lg:translate-x-2 lg:group-hover:translate-x-0">
                        <VibeButton
                          variant="secondary"
                          size="sm"
                          icon={Activity}
                          className="p-2.5"
                          title={t('probe_now')}
                          loading={checkingId === srv.id}
                          onClick={() => handleHealthcheck(srv)}
                        />
                        <VibeButton
                          variant="secondary"
                          size="sm"
                          icon={PencilLine}
                          className="p-2.5"
                          title={t('edit_meta_alerts')}
                          onClick={() => setEditTarget(srv)}
                        />
                        <VibeButton
                          variant="secondary"
                          size="sm"
                          icon={Terminal}
                          className="p-2.5"
                          title={t('install_command_oneliner')}
                          onClick={() => handleOneLiner(srv)}
                        />
                        {isAdmin && (
                          <VibeButton
                            variant="secondary"
                            size="sm"
                            icon={KeyRound}
                            className="p-2.5"
                            title={t('manage_license')}
                            onClick={() => setRenewTarget(srv)}
                          />
                        )}
                        <VibeButton
                          variant="danger"
                          size="sm"
                          icon={PowerOff}
                          className="p-2.5"
                          title={t('uninstall_from_vps')}
                          onClick={() => setUninstallTarget(srv)}
                        />
                        <VibeButton
                          variant="danger"
                          size="sm"
                          icon={Trash2}
                          className="p-2.5"
                          title={t('delete_server')}
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
            {t('no_server_matches_filter')}
          </div>
        )}

        {servers.length === 0 && !loading && (
          <div className="flex flex-col items-center justify-center py-24">
            <div className="p-6 bg-white/5 rounded-full mb-4">
              <Server size={48} className="text-slate-600" />
            </div>
            <p className="text-slate-500 font-black uppercase text-xs tracking-widest">
              {t('no_server_registered')}
            </p>
            <button
              onClick={() => setShowAddModal(true)}
              className="mt-4 text-indigo-400 hover:text-indigo-300 text-[11px] font-black uppercase tracking-widest transition-colors"
            >
              {t('add_first_vps')}
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

      <UninstallModal
        server={uninstallTarget}
        busy={uninstalling}
        onConfirm={handleUninstall}
        onClose={() => setUninstallTarget(null)}
      />

      <EditServerModal
        server={editTarget}
        busy={editing}
        onApply={handleEdit}
        onClose={() => setEditTarget(null)}
      />

      {detailId && (
        <ServerDetailModal
          serverId={detailId}
          checking={checkingId === detailId}
          onHealthcheck={() => {
            const srv = servers.find((s) => s.id === detailId);
            if (srv) handleHealthcheck(srv);
          }}
          onClose={() => setDetailId(null)}
        />
      )}

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
        title={t('delete_server')}
        message={
          confirmTarget ? (
            <span>
              {t('delete_server')}{' '}
              <strong className="font-mono text-white">{confirmTarget.label}</strong> (
              <span className="font-mono">{confirmTarget.host}</span>) ?
            </span>
          ) : (
            t('action_irreversible')
          )
        }
        confirmLabel={t('delete_permanently')}
        intent="danger"
        onConfirm={handleDelete}
        onCancel={() => setConfirmTarget(null)}
      />
    </div>
  );
};

export default ServersSection;
