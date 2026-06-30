import React, { useState, useRef, useEffect } from 'react';
import {
  Globe,
  Plug,
  Tag,
  RefreshCw,
  Plus,
  Copy,
  Check,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Terminal,
} from 'lucide-react';
import Modal from '../ui/Modal';
import { useTheme } from '../../context/ThemeContext';
import { useToast } from '../../context/ToastContext';
import { cn, COLOR_MAP } from '../../lib/utils';
import { axiosInstance } from '../../lib/api';

/**
 * AddServerModal — Enrôlement d'un VPS pour le mode revendeur.
 *
 * Étape 1 : formulaire (label, host, port) → POST /api/servers
 * Étape 2 : affichage du one-liner de provisioning + suivi du statut en live.
 *
 * Le suivi du statut s'appuie sur le polling de la liste (prop `servers`) :
 * le parent rafraîchit GET /api/servers, on lit le statut du serveur créé ici.
 */
const AddServerModal = ({ isOpen, onClose, onCreated, servers = [] }) => {
  const { theme } = useTheme();
  const { addToast } = useToast();

  const [label, setLabel] = useState('');
  const [host, setHost] = useState('');
  const [port, setPort] = useState('22');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const submittingRef = useRef(false);

  // Étape 2
  const [step, setStep] = useState(1);
  const [provision, setProvision] = useState(null); // { serverId, oneLiner, scriptSha256, expiresAt }
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(Date.now());

  const accent = COLOR_MAP[theme]?.[600] || '#4f46e5';

  // Reset à l'ouverture
  useEffect(() => {
    if (!isOpen) return;
    submittingRef.current = false;
    setLabel('');
    setHost('');
    setPort('22');
    setError('');
    setLoading(false);
    setStep(1);
    setProvision(null);
    setCopied(false);
  }, [isOpen]);

  // Tick pour évaluer l'expiration (étape 2 uniquement)
  useEffect(() => {
    if (step !== 2) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [step]);

  // Statut courant du serveur enrôlé (lu depuis la liste pollée par le parent)
  const created = provision ? servers.find((s) => s.id === provision.serverId) : null;
  const status = created?.status;
  const isOnline = status === 'online';
  const isError = status === 'error';
  const expired =
    provision?.expiresAt && new Date(provision.expiresAt).getTime() < now && !isOnline && !isError;

  // Auto-succès quand le serveur passe online
  useEffect(() => {
    if (step === 2 && isOnline) {
      addToast('Serveur en ligne', 'success');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnline, step]);

  const submit = async () => {
    if (submittingRef.current) return;
    setError('');

    const cleanLabel = label.trim();
    const cleanHost = host.trim();
    const portNum = Number(port);

    if (!cleanLabel) {
      setError('Label requis');
      return;
    }
    if (!cleanHost) {
      setError('Host / IP requis');
      return;
    }
    if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
      setError('Port invalide (1-65535)');
      return;
    }

    submittingRef.current = true;
    setLoading(true);
    try {
      const res = await axiosInstance.post('/servers', {
        label: cleanLabel,
        host: cleanHost,
        port: portNum,
      });
      setProvision(res.data);
      setStep(2);
      onCreated?.(); // déclenche un refresh + démarre le polling côté parent
    } catch (err) {
      setError(
        err?.response?.data?.error ||
          err?.response?.data?.message ||
          "Erreur lors de l'enregistrement"
      );
    } finally {
      setLoading(false);
      submittingRef.current = false;
    }
  };

  // Régénère la commande (re-POST) après expiration
  const regenerate = async () => {
    setProvision(null);
    setCopied(false);
    await submit();
  };

  const handleCopy = async () => {
    if (!provision?.oneLiner) return;
    try {
      await navigator.clipboard.writeText(provision.oneLiner);
      setCopied(true);
      addToast('Copié', 'success');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      addToast('Copie impossible', 'error');
    }
  };

  const handleSubmitForm = (e) => {
    e.preventDefault();
    submit();
  };

  // ── Étape 1 : formulaire ───────────────────────────────────────────────────
  const renderForm = () => (
    <form onSubmit={handleSubmitForm} className="space-y-6">
      {/* Label */}
      <div>
        <label className="block text-[10px] font-black text-slate-500 mb-2 uppercase tracking-widest">
          Label
        </label>
        <div className="relative group">
          <Tag
            className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-slate-900 dark:group-focus-within:text-white transition-colors"
            size={18}
          />
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className="w-full pl-12 pr-6 py-4 glass-input rounded-2xl font-mono"
            placeholder="ex: vps-paris-01"
            autoFocus
          />
        </div>
      </div>

      {/* Host */}
      <div>
        <label className="block text-[10px] font-black text-slate-500 mb-2 uppercase tracking-widest">
          Host / IP
        </label>
        <div className="relative group">
          <Globe
            className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-slate-900 dark:group-focus-within:text-white transition-colors"
            size={18}
          />
          <input
            type="text"
            value={host}
            onChange={(e) => setHost(e.target.value)}
            className="w-full pl-12 pr-6 py-4 glass-input rounded-2xl font-mono"
            placeholder="ex: 203.0.113.10"
          />
        </div>
      </div>

      {/* Port */}
      <div>
        <label className="block text-[10px] font-black text-slate-500 mb-2 uppercase tracking-widest">
          Port SSH
        </label>
        <div className="relative group">
          <Plug
            className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-slate-900 dark:group-focus-within:text-white transition-colors"
            size={18}
          />
          <input
            type="number"
            min="1"
            max="65535"
            value={port}
            onChange={(e) => setPort(e.target.value)}
            className="w-full pl-12 pr-6 py-4 glass-input rounded-2xl font-mono"
            placeholder="22"
          />
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="p-4 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-bold uppercase tracking-tight">
          {error}
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-4 pt-2">
        <button
          type="button"
          onClick={onClose}
          className="flex-1 py-4 bg-white/5 hover:bg-white/10 text-slate-400 font-black uppercase text-xs tracking-widest rounded-2xl border border-white/5 transition-all"
        >
          Annuler
        </button>
        <button
          type="submit"
          disabled={loading || !label.trim() || !host.trim()}
          className="flex-[2] py-4 text-white font-black uppercase text-xs tracking-widest rounded-2xl shadow-2xl transition-all flex items-center justify-center gap-3 active:scale-95 disabled:opacity-30"
          style={{ backgroundColor: accent, boxShadow: `0 10px 15px -3px ${accent}4d` }}
        >
          {loading ? (
            <RefreshCw className="animate-spin" size={18} />
          ) : (
            <Plus size={18} strokeWidth={3} />
          )}
          Enregistrer le VPS
        </button>
      </div>
    </form>
  );

  // ── Étape 2 : one-liner + suivi ────────────────────────────────────────────
  const renderProvision = () => (
    <div className="space-y-6">
      {/* One-liner */}
      <div>
        <label className="block text-[10px] font-black text-slate-500 mb-2 uppercase tracking-widest">
          Commande de provisioning
        </label>
        <div className="relative">
          <pre className="w-full max-h-40 overflow-auto p-4 pr-14 rounded-2xl bg-slate-950/80 border border-white/10 text-emerald-300 text-[11px] leading-relaxed font-mono whitespace-pre-wrap break-all">
            <code>{provision?.oneLiner}</code>
          </pre>
          <button
            type="button"
            onClick={handleCopy}
            title="Copier"
            className="absolute top-3 right-3 p-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white border border-white/10 transition-all"
          >
            {copied ? <Check size={16} className="text-emerald-400" /> : <Copy size={16} />}
          </button>
        </div>
        <p className="mt-3 flex items-start gap-2 text-[11px] text-slate-400 leading-relaxed">
          <Terminal size={14} className="mt-0.5 flex-shrink-0 text-slate-500" />
          Collez cette commande en root sur votre VPS, puis attendez ~30s.
        </p>
      </div>

      {/* Statut */}
      <div
        className={cn(
          'flex items-center gap-4 p-5 rounded-2xl border transition-colors duration-500',
          isOnline
            ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
            : isError
              ? 'bg-red-500/10 border-red-500/20 text-red-400'
              : expired
                ? 'bg-amber-500/10 border-amber-500/20 text-amber-400'
                : 'bg-white/5 border-white/10 text-slate-300'
        )}
      >
        {isOnline ? (
          <CheckCircle2 size={22} className="flex-shrink-0" />
        ) : isError || expired ? (
          <AlertTriangle size={22} className="flex-shrink-0" />
        ) : (
          <Loader2 size={22} className="flex-shrink-0 animate-spin" />
        )}
        <div className="flex-1 min-w-0">
          {isOnline ? (
            <p className="text-xs font-black uppercase tracking-widest">Serveur en ligne</p>
          ) : isError ? (
            <>
              <p className="text-xs font-black uppercase tracking-widest">Échec du provisioning</p>
              {created?.lastError && (
                <p className="mt-1 text-[11px] font-mono opacity-80 break-words">
                  {created.lastError}
                </p>
              )}
            </>
          ) : expired ? (
            <p className="text-xs font-black uppercase tracking-widest">
              Commande expirée — régénérez-la
            </p>
          ) : (
            <p className="text-xs font-black uppercase tracking-widest">En attente du serveur…</p>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-4 pt-2">
        <button
          type="button"
          onClick={onClose}
          className="flex-1 py-4 bg-white/5 hover:bg-white/10 text-slate-400 font-black uppercase text-xs tracking-widest rounded-2xl border border-white/5 transition-all"
        >
          {isOnline ? 'Fermer' : 'Plus tard'}
        </button>
        {expired ? (
          <button
            type="button"
            onClick={regenerate}
            disabled={loading}
            className="flex-[2] py-4 text-white font-black uppercase text-xs tracking-widest rounded-2xl shadow-2xl transition-all flex items-center justify-center gap-3 active:scale-95 disabled:opacity-30"
            style={{ backgroundColor: accent, boxShadow: `0 10px 15px -3px ${accent}4d` }}
          >
            {loading ? <RefreshCw className="animate-spin" size={18} /> : <RefreshCw size={18} />}
            Régénérer la commande
          </button>
        ) : isOnline ? (
          <button
            type="button"
            onClick={onClose}
            className="flex-[2] py-4 text-white font-black uppercase text-xs tracking-widest rounded-2xl shadow-2xl transition-all flex items-center justify-center gap-3 active:scale-95"
            style={{
              backgroundColor: '#059669',
              boxShadow: '0 10px 15px -3px #05966944',
            }}
          >
            <CheckCircle2 size={18} />
            Terminé
          </button>
        ) : (
          <button
            type="button"
            onClick={handleCopy}
            className="flex-[2] py-4 text-white font-black uppercase text-xs tracking-widest rounded-2xl shadow-2xl transition-all flex items-center justify-center gap-3 active:scale-95"
            style={{ backgroundColor: accent, boxShadow: `0 10px 15px -3px ${accent}4d` }}
          >
            {copied ? <Check size={18} /> : <Copy size={18} />}
            {copied ? 'Copié' : 'Copier la commande'}
          </button>
        )}
      </div>
    </div>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={step === 1 ? 'Ajouter un VPS' : 'Provisioning du VPS'}
      maxWidth="max-w-lg"
    >
      {step === 1 ? renderForm() : renderProvision()}
    </Modal>
  );
};

export default AddServerModal;
