import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Server, ChevronDown, Check, Globe } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { axiosInstance } from '../../../lib/api';
import { useSelectedServer } from '../../../context/SelectedServerContext';

// Sélecteur de serveur cible (Local / VPS revendeur). Injecte le choix dans le
// contexte → l'intercepteur axios pose `x-server-id` sur les appels /clients.
//
// Depuis le pivot "instance complète" (2026-07-03), le contexte LOCAL est
// valide pour TOUT rôle (le backend scope par propriétaire) : un revendeur
// travaille en local sur son instance, et voit en plus ses VPS encore pilotés
// par l'ancien socle SSH s'il en reste.

const ServerSelector = () => {
  const { selectedServerId, setSelectedServerId } = useSelectedServer();
  const [servers, setServers] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  const loadServers = useCallback(async () => {
    try {
      const res = await axiosInstance.get('/servers');
      setServers(Array.isArray(res.data) ? res.data : []);
      setLoaded(true);
    } catch {
      setServers([]);
    }
  }, []);

  useEffect(() => {
    loadServers();
  }, [loadServers]);

  // Ferme le menu au clic extérieur.
  useEffect(() => {
    const onClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const onlineServers = servers.filter((s) => s.status === 'online');

  // Une sélection persistée (localStorage) qui ne correspond plus à rien —
  // serveur supprimé, base réinstallée — est ramenée sur 'local' au lieu de
  // laisser l'UI envoyer un x-server-id mort (403 en boucle sur /clients).
  useEffect(() => {
    if (String(selectedServerId) === 'local') return;
    if (!loaded) return; // liste pas encore chargée
    const valid = onlineServers.some((s) => String(s.id) === String(selectedServerId));
    if (!valid) setSelectedServerId('local');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, onlineServers.length, selectedServerId]);

  const options = [
    { id: 'local', label: 'Local', host: 'Ce serveur', online: true },
    ...onlineServers.map((s) => ({ id: String(s.id), label: s.label, host: s.host, online: true })),
  ];

  const current = options.find((o) => String(o.id) === String(selectedServerId)) || options[0];

  const isLocal = String(current.id) === 'local';

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 px-3 py-2.5 glass-panel border rounded-xl transition-all text-[11px] font-black uppercase tracking-widest shadow-lg hover:scale-105 max-w-[200px]"
        title="Serveur cible"
      >
        {isLocal ? <Globe size={14} /> : <Server size={14} />}
        <span className="truncate">{current.label}</span>
        <ChevronDown size={14} className={cn('transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-64 glass-panel border rounded-xl shadow-2xl z-50 overflow-hidden">
          <div className="px-3 py-2 text-[11px] font-black uppercase tracking-widest opacity-50">
            Serveur cible
          </div>
          {options.length === 0 && (
            <div className="px-3 py-3 text-xs opacity-60">
              Aucun serveur en ligne. Enregistrez un VPS dans l’onglet Serveurs.
            </div>
          )}
          {options.map((opt) => {
            const active = String(opt.id) === String(current.id);
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => {
                  setSelectedServerId(opt.id);
                  setOpen(false);
                }}
                className={cn(
                  'w-full flex items-center gap-2 px-3 py-2.5 text-left transition-colors hover:bg-white/5',
                  active && 'bg-white/5'
                )}
              >
                {String(opt.id) === 'local' ? <Globe size={14} /> : <Server size={14} />}
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-semibold truncate">{opt.label}</span>
                  {opt.host && (
                    <span className="block text-[11px] opacity-50 truncate">{opt.host}</span>
                  )}
                </span>
                {active && <Check size={14} className="text-emerald-400" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default ServerSelector;
