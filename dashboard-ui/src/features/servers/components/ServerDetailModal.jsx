import React, { useState, useEffect, useCallback } from 'react';
import {
  X,
  Activity,
  Cpu,
  HardDrive,
  MemoryStick,
  Clock,
  AlertTriangle,
  Server,
} from 'lucide-react';
import { cn } from '../../../lib/utils';
import { axiosInstance } from '../../../lib/api';

const pct = (v) => (v == null ? '—' : `${Math.round(v)} %`);
const fmtUptime = (s) => {
  if (!s) return '—';
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  return d > 0 ? `${d}j ${h}h` : `${h}h`;
};
const barColor = (v) =>
  v == null ? 'bg-slate-600' : v >= 90 ? 'bg-red-500' : v >= 70 ? 'bg-amber-500' : 'bg-emerald-500';

// Jauge horizontale d'une métrique système.
const Gauge = ({ icon: Icon, label, value }) => (
  <div className="space-y-1.5">
    <div className="flex items-center justify-between text-[11px] text-slate-400">
      <span className="inline-flex items-center gap-1.5">
        <Icon size={12} /> {label}
      </span>
      <span className="font-mono font-bold text-white">{pct(value)}</span>
    </div>
    <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
      <div
        className={cn('h-full rounded-full transition-all', barColor(value))}
        style={{ width: `${value == null ? 0 : Math.min(100, value)}%` }}
      />
    </div>
  </div>
);

// Barre de disponibilité : un segment par point d'historique (vert=online).
const UptimeStrip = ({ history }) => {
  if (!history || history.length === 0)
    return <p className="text-[11px] text-slate-600 italic">Aucun historique encore collecté.</p>;
  const onlineCount = history.filter((h) => h.status === 'online').length;
  const ratio = Math.round((onlineCount / history.length) * 100);
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-[11px] text-slate-400">
        <span>Disponibilité ({history.length} points)</span>
        <span className="font-mono font-bold text-emerald-400">{ratio} %</span>
      </div>
      <div className="flex gap-0.5 h-8 items-end">
        {history.slice(-80).map((h, i) => (
          <div
            key={i}
            title={new Date((h.ts || 0) * 1000).toLocaleString('fr-FR')}
            className={cn(
              'flex-1 rounded-sm min-w-[2px]',
              h.status === 'online' ? 'bg-emerald-500/70' : 'bg-red-500/60'
            )}
            style={{ height: `${h.cpuPct != null ? Math.max(15, Math.min(100, h.cpuPct)) : 60}%` }}
          />
        ))}
      </div>
    </div>
  );
};

const ServerDetailModal = ({ serverId, onClose, onHealthcheck, checking }) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!serverId) return;
    setLoading(true);
    try {
      const res = await axiosInstance.get(`/servers/${serverId}`);
      setData(res.data);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [serverId]);

  useEffect(() => {
    load();
  }, [load]);

  if (!serverId) return null;

  const s = data || {};
  const meta = [
    ['Région', s.region],
    ['Fournisseur', s.provider],
    ['Version', s.version ? `v${s.version}` : null],
    ['Clients', s.clientCount],
    ['Uptime', fmtUptime(s.uptimeSec)],
    ['Licence', s.licenseExpiry ? new Date(s.licenseExpiry).toLocaleDateString('fr-FR') : null],
  ];

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="glass-panel border rounded-2xl shadow-2xl w-full max-w-2xl p-8 space-y-6 max-h-[90vh] overflow-y-auto custom-scrollbar">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-indigo-500/15 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
              <Server size={20} />
            </div>
            <div>
              <h3 className="text-lg font-black text-white tracking-tight">{s.label || '…'}</h3>
              <p className="text-[11px] font-mono text-slate-500">
                {s.host}
                {s.port ? `:${s.port}` : ''}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onHealthcheck}
              disabled={checking}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-[11px] font-black tracking-widest text-white transition-colors disabled:opacity-50"
              title="Sonder maintenant (SSH)"
            >
              <Activity size={13} className={checking ? 'animate-pulse' : ''} /> Sonder
            </button>
            <button
              onClick={onClose}
              className="p-2 text-slate-500 hover:text-white transition-colors"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {loading ? (
          <p className="text-center py-10 text-slate-500 italic">Chargement…</p>
        ) : (
          <>
            {s.lastError && (
              <div className="flex items-start gap-3 p-4 rounded-xl bg-red-500/10 border border-red-500/15">
                <AlertTriangle size={16} className="text-red-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-[11px] font-black text-red-400 tracking-widest mb-1">
                    Dernière erreur
                  </p>
                  <p className="text-xs font-mono text-red-300/90 break-all">{s.lastError}</p>
                </div>
              </div>
            )}

            {/* Télémétrie machine */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Gauge icon={Cpu} label="CPU" value={s.cpuPct} />
              <Gauge icon={MemoryStick} label="RAM" value={s.memPct} />
              <Gauge icon={HardDrive} label="Disque" value={s.diskPct} />
            </div>
            {s.healthAt && (
              <p className="text-[10px] text-slate-600 font-mono inline-flex items-center gap-1.5">
                <Clock size={10} /> télémétrie du {new Date(s.healthAt).toLocaleString('fr-FR')}
              </p>
            )}

            {/* Historique de disponibilité */}
            <div className="pt-2 border-t border-white/5">
              <UptimeStrip history={s.history} />
            </div>

            {/* Métadonnées */}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 pt-2 border-t border-white/5">
              {meta.map(([k, v]) => (
                <div key={k}>
                  <div className="text-[10px] font-black text-slate-600 tracking-widest">{k}</div>
                  <div className="text-sm text-white font-mono">{v ?? '—'}</div>
                </div>
              ))}
            </div>

            {Array.isArray(s.tags) && s.tags.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {s.tags.map((t) => (
                  <span
                    key={t}
                    className="px-2.5 py-1 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-[10px] font-bold text-indigo-300"
                  >
                    {t}
                  </span>
                ))}
              </div>
            )}

            {s.notes && (
              <div className="pt-2 border-t border-white/5">
                <div className="text-[10px] font-black text-slate-600 tracking-widest mb-1">
                  Notes
                </div>
                <p className="text-xs text-slate-300 whitespace-pre-wrap">{s.notes}</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default ServerDetailModal;
