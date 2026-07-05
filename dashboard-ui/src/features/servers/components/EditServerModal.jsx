import React, { useState, useEffect } from 'react';
import { PencilLine, Save, Bell } from 'lucide-react';
import { cn } from '../../../lib/utils';

// Édition d'un serveur : réseau (label/host/port), métadonnées de flotte et
// seuils d'alerte. N'envoie que les champs réellement modifiés (PATCH partiel).
const EditServerModal = ({ server, onClose, onApply, busy }) => {
  const [form, setForm] = useState(null);

  useEffect(() => {
    if (!server) return setForm(null);
    setForm({
      label: server.label || '',
      host: server.host || '',
      port: server.port != null ? String(server.port) : '',
      region: server.region || '',
      provider: server.provider || '',
      tags: Array.isArray(server.tags) ? server.tags.join(', ') : '',
      notes: server.notes || '',
      alertOfflineMin: server.alertOfflineMin != null ? String(server.alertOfflineMin) : '',
      alertLicenseDays: server.alertLicenseDays != null ? String(server.alertLicenseDays) : '',
    });
  }, [server]);

  if (!server || !form) return null;

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = () => {
    const payload = {};
    if (form.label.trim() && form.label !== server.label) payload.label = form.label.trim();
    if (form.host.trim() && form.host !== server.host) payload.host = form.host.trim();
    if (form.port.trim() && Number(form.port) !== server.port) payload.port = Number(form.port);
    // Métadonnées : chaîne vide = effacer (null).
    const meta = { region: form.region, provider: form.provider, notes: form.notes };
    for (const [k, v] of Object.entries(meta)) {
      const trimmed = v.trim();
      if (trimmed !== (server[k] || '')) payload[k] = trimmed || null;
    }
    const tags = form.tags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    const curTags = Array.isArray(server.tags) ? server.tags : [];
    if (JSON.stringify(tags) !== JSON.stringify(curTags)) payload.tags = tags.length ? tags : null;
    // Seuils d'alerte : vide = désactivé (null).
    const off = form.alertOfflineMin.trim();
    if ((off ? Number(off) : null) !== (server.alertOfflineMin ?? null))
      payload.alertOfflineMin = off ? Number(off) : null;
    const lic = form.alertLicenseDays.trim();
    if ((lic ? Number(lic) : null) !== (server.alertLicenseDays ?? null))
      payload.alertLicenseDays = lic ? Number(lic) : null;

    if (Object.keys(payload).length === 0) return onClose();
    onApply(payload);
  };

  const input =
    'w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white font-mono focus:outline-none focus:border-white/20';
  const lbl = 'text-[11px] font-black text-slate-500 tracking-widest';

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="glass-panel border rounded-2xl shadow-2xl w-full max-w-lg p-8 space-y-5 max-h-[90vh] overflow-y-auto custom-scrollbar">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-indigo-500/15 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
            <PencilLine size={20} />
          </div>
          <div>
            <h3 className="text-lg font-black text-white tracking-tight">Éditer le serveur</h3>
            <p className="text-[11px] font-mono text-slate-500">{server.label}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2 space-y-1">
            <label className={lbl}>Label</label>
            <input className={input} value={form.label} onChange={set('label')} />
          </div>
          <div className="space-y-1">
            <label className={lbl}>Host</label>
            <input className={input} value={form.host} onChange={set('host')} />
          </div>
          <div className="space-y-1">
            <label className={lbl}>Port SSH</label>
            <input className={input} value={form.port} onChange={set('port')} inputMode="numeric" />
          </div>
          <div className="space-y-1">
            <label className={lbl}>Région</label>
            <input
              className={input}
              value={form.region}
              onChange={set('region')}
              placeholder="eu-west"
            />
          </div>
          <div className="space-y-1">
            <label className={lbl}>Fournisseur</label>
            <input
              className={input}
              value={form.provider}
              onChange={set('provider')}
              placeholder="Hetzner…"
            />
          </div>
          <div className="col-span-2 space-y-1">
            <label className={lbl}>Tags (séparés par des virgules)</label>
            <input
              className={input}
              value={form.tags}
              onChange={set('tags')}
              placeholder="prod, gaming"
            />
          </div>
          <div className="col-span-2 space-y-1">
            <label className={lbl}>Notes</label>
            <textarea
              className={cn(input, 'resize-none h-20')}
              value={form.notes}
              onChange={set('notes')}
            />
          </div>
        </div>

        <div className="pt-2 border-t border-white/5 space-y-3">
          <div className="flex items-center gap-2 text-slate-400">
            <Bell size={14} />
            <span className="text-[11px] font-black tracking-widest">
              Alertes (vide = désactivé)
            </span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className={lbl}>Offline &gt; N minutes</label>
              <input
                className={input}
                value={form.alertOfflineMin}
                onChange={set('alertOfflineMin')}
                inputMode="numeric"
                placeholder="30"
              />
            </div>
            <div className="space-y-1">
              <label className={lbl}>Licence &lt; N jours</label>
              <input
                className={input}
                value={form.alertLicenseDays}
                onChange={set('alertLicenseDays')}
                inputMode="numeric"
                placeholder="7"
              />
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between pt-2 border-t border-white/5">
          <button
            disabled={busy}
            onClick={onClose}
            className="text-[11px] font-black tracking-widest text-slate-400 hover:text-white transition-colors disabled:opacity-50"
          >
            Annuler
          </button>
          <button
            disabled={busy}
            onClick={submit}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-black tracking-widest transition-colors disabled:opacity-50"
          >
            <Save size={14} /> Enregistrer
          </button>
        </div>
      </div>
    </div>
  );
};

export default EditServerModal;
