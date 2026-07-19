import { useState, useEffect, useCallback } from 'react';
import { AlertTriangle, Trash2, RefreshCw, Wifi } from 'lucide-react';
import { axiosInstance } from '../../../lib/api';
import { useToast } from '../../../context/ToastContext';
import { useLang } from '../../../context/LanguageContext';

// Bandeau de réconciliation DB ↔ disque ↔ WireGuard (vue Conteneurs).
//
// Ne s'affiche QUE s'il y a quelque chose à réparer : clients fantômes en base
// (ex. vieille DB ayant survécu à une réinstallation via le volume Docker) ou
// peers absents du noyau alors que leurs fichiers existent. Invisible pour les
// rôles sans droit (l'API répond 403 → on ne montre rien).
const ReconcileBanner = () => {
  const { addToast } = useToast();
  const { t } = useLang();
  const [report, setReport] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await axiosInstance.get('/clients/reconcile');
      setReport(res.data);
    } catch {
      setReport(null); // 403 (viewer/revendeur) ou cible distante : pas de bandeau
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const repair = async (payload, okMsg) => {
    if (busy) return;
    setBusy(true);
    try {
      const { data } = await axiosInstance.post('/clients/reconcile', payload);
      addToast(okMsg(data), 'success');
      setReport(data.after || null);
    } catch (e) {
      addToast(e?.response?.data?.error || t('reconcile_error'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const orphans = report?.dbOrphans?.length || 0;
  const missing = report?.missingPeers?.length || 0;
  if (!report || (orphans === 0 && missing === 0)) return null;

  return (
    <div className="flex flex-col md:flex-row md:items-center gap-4 px-5 py-4 rounded-2xl bg-amber-500/10 border border-amber-500/25 text-amber-200">
      <AlertTriangle size={20} className="flex-shrink-0 text-amber-400" />
      <div className="flex-1 text-xs leading-relaxed">
        <span className="font-black uppercase tracking-wider text-amber-300">
          {t('desync_detected')}
        </span>
        <span className="block text-amber-200/80">
          {orphans > 0 && (
            <>
              {orphans} {t('orphans_desc')}{' '}
            </>
          )}
          {missing > 0 && (
            <>
              {missing} {t('missing_desc')}
            </>
          )}
        </span>
      </div>
      <div className="flex gap-3 flex-shrink-0">
        {missing > 0 && (
          <button
            disabled={busy}
            onClick={() =>
              repair({ applyPeers: true }, (d) =>
                d.peersApplied ? t('peers_reapplied') : t('resync_failed')
              )
            }
            className="flex items-center gap-2 px-4 py-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20 text-[11px] font-black uppercase tracking-widest text-emerald-300 transition-colors disabled:opacity-50"
          >
            <Wifi size={13} /> {t('resync_peers')}
          </button>
        )}
        {orphans > 0 && (
          <button
            disabled={busy}
            onClick={() =>
              repair({ purgeDbOrphans: true }, (d) => `${d.purged} ${t('ghosts_purged')}`)
            }
            className="flex items-center gap-2 px-4 py-2 rounded-xl border border-red-500/30 bg-red-500/10 hover:bg-red-500/20 text-[11px] font-black uppercase tracking-widest text-red-300 transition-colors disabled:opacity-50"
          >
            <Trash2 size={13} /> {t('purge')} {orphans} {t('ghosts')}
          </button>
        )}
        <button
          disabled={busy}
          onClick={load}
          title={t('rescan')}
          className="flex items-center px-3 py-2 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-amber-200 transition-colors disabled:opacity-50"
        >
          <RefreshCw size={13} className={busy ? 'animate-spin' : ''} />
        </button>
      </div>
    </div>
  );
};

export default ReconcileBanner;
