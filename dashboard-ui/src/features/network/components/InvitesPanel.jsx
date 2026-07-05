import React, { useState, useEffect, useCallback } from 'react';
import { Send, Plus, Trash2, Copy, Check } from 'lucide-react';
import GlassCard from '../../../components/ui/Card';
import VibeButton from '../../../components/ui/Button';
import { cn } from '../../../lib/utils';
import { axiosInstance } from '../../../lib/api';
import { useToast } from '../../../context/ToastContext';

const STATUS = {
  active: { label: 'Active', cls: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' },
  used: { label: 'Utilisée', cls: 'text-slate-400 bg-white/5 border-white/10' },
  expired: { label: 'Expirée', cls: 'text-red-400 bg-red-500/10 border-red-500/20' },
};

// Liste + gestion des liens d'invitation (générer, suivre le statut, révoquer).
const InvitesPanel = () => {
  const { addToast } = useToast();
  const [invites, setInvites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [lastUrl, setLastUrl] = useState(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axiosInstance.get('/resellers/invites');
      setInvites(Array.isArray(res.data) ? res.data : []);
    } catch {
      setInvites([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const generate = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await axiosInstance.post('/resellers/invites');
      const url = res.data?.url || res.data?.token;
      setLastUrl(url);
      if (navigator.clipboard && url) await navigator.clipboard.writeText(url).catch(() => {});
      addToast('Lien généré et copié (valide 7 jours)', 'success');
      load();
    } catch (e) {
      addToast(e?.response?.data?.error || 'Erreur invitation', 'error');
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (id) => {
    try {
      await axiosInstance.delete(`/resellers/invites/${id}`);
      addToast('Invitation révoquée', 'success');
      load();
    } catch (e) {
      addToast(e?.response?.data?.error || 'Erreur de révocation', 'error');
    }
  };

  const copyLast = async () => {
    if (!lastUrl) return;
    await navigator.clipboard.writeText(lastUrl).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <GlassCard hover={false} className="p-0 overflow-hidden">
      <div className="p-6 border-b border-white/5 flex items-center justify-between gap-4">
        <h3 className="text-lg font-black text-white tracking-tight flex items-center gap-2">
          <Send size={18} /> Invitations
        </h3>
        <VibeButton variant="primary" icon={Plus} onClick={generate} disabled={busy} size="sm">
          Générer un lien
        </VibeButton>
      </div>

      {lastUrl && (
        <div className="px-6 py-3 flex items-center gap-3 bg-indigo-500/5 border-b border-white/5">
          <span className="flex-1 text-[11px] font-mono text-indigo-300 break-all select-all">
            {lastUrl}
          </span>
          <button
            onClick={copyLast}
            className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 transition-colors"
            title="Copier"
          >
            {copied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
          </button>
        </div>
      )}

      <div className="overflow-x-auto max-h-72">
        <table className="w-full text-left">
          <thead>
            <tr className="text-[11px] font-black text-slate-500 tracking-[0.25em] border-b border-white/5">
              <th className="px-6 py-3">Créée</th>
              <th className="px-6 py-3">Expire</th>
              <th className="px-6 py-3">Statut</th>
              <th className="px-6 py-3">Utilisée par</th>
              <th className="px-6 py-3 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {invites.map((i) => {
              const st = STATUS[i.status] || STATUS.active;
              return (
                <tr key={i.id} className="hover:bg-white/5">
                  <td className="px-6 py-3 text-[11px] font-mono text-slate-400">
                    {i.createdAt ? new Date(i.createdAt).toLocaleDateString('fr-FR') : '—'}
                  </td>
                  <td className="px-6 py-3 text-[11px] font-mono text-slate-400">
                    {i.expiresAt ? new Date(i.expiresAt).toLocaleDateString('fr-FR') : '—'}
                  </td>
                  <td className="px-6 py-3">
                    <span
                      className={cn(
                        'text-[10px] font-black tracking-widest px-2.5 py-1 rounded-lg border',
                        st.cls
                      )}
                    >
                      {st.label}
                    </span>
                  </td>
                  <td className="px-6 py-3 text-[11px] font-mono text-slate-400">
                    {i.usedBy || '—'}
                  </td>
                  <td className="px-6 py-3 text-right">
                    {i.status === 'active' ? (
                      <button
                        onClick={() => revoke(i.id)}
                        className="inline-flex items-center gap-1.5 text-[11px] font-black tracking-widest text-red-400/80 hover:text-red-400 transition-colors"
                      >
                        <Trash2 size={12} /> Révoquer
                      </button>
                    ) : (
                      <span className="text-slate-700">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {invites.length === 0 && (
              <tr>
                <td
                  colSpan={5}
                  className="px-6 py-4 text-center text-slate-500 text-xs tracking-widest"
                >
                  {loading ? 'Chargement…' : 'Aucune invitation'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </GlassCard>
  );
};

export default InvitesPanel;
