import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Server, ChevronDown, Check, Globe } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { axiosInstance } from '../../../lib/api';
import { useSelectedServer } from '../../../context/SelectedServerContext';

// Sélecteur de serveur cible (Local / VPS revendeur). Injecte le choix dans le
// contexte → l'intercepteur axios pose `x-server-id` sur les appels /clients.
//
//  - admin/manager : option « Local » + chaque VPS en ligne.
//  - revendeur      : uniquement ses VPS (l'API /servers filtre par propriétaire) ;
//    pas de « Local » (aucun accès au serveur historique) → auto-sélection du
//    premier VPS en ligne si la valeur courante est 'local'/invalide.

const isAdminLike = (role) => role === 'admin' || role === 'manager';

const ServerSelector = ({ userRole }) => {
  const { selectedServerId, setSelectedServerId } = useSelectedServer();
  const [servers, setServers] = useState([]);
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const admin = isAdminLike(userRole);

  const loadServers = useCallback(async () => {
    try {
      const res = await axiosInstance.get('/servers');
      setServers(Array.isArray(res.data) ? res.data : []);
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

  // Pour un revendeur, 'local' n'a pas de sens : on bascule sur son 1er VPS en ligne.
  useEffect(() => {
    if (admin) return;
    const valid = onlineServers.some((s) => String(s.id) === String(selectedServerId));
    if (!valid && onlineServers.length > 0) {
      setSelectedServerId(String(onlineServers[0].id));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [admin, onlineServers.length, selectedServerId]);

  const options = [
    ...(admin ? [{ id: 'local', label: 'Local', host: 'Serveur historique', online: true }] : []),
    ...onlineServers.map((s) => ({ id: String(s.id), label: s.label, host: s.host, online: true })),
  ];

  const current =
    options.find((o) => String(o.id) === String(selectedServerId)) || options[0] || {
      id: 'local',
      label: admin ? 'Local' : 'Aucun serveur',
      host: '',
    };

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
          <div className="px-3 py-2 text-[10px] font-black uppercase tracking-widest opacity-50">
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
                  {opt.host && <span className="block text-[10px] opacity-50 truncate">{opt.host}</span>}
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
