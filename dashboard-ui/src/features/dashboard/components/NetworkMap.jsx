import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Activity, Plus, Minus, RefreshCw, ChevronLeft } from 'lucide-react';
import { useTheme } from '../../../context/ThemeContext';
import { useLang } from '../../../context/LanguageContext';
import { cn, COLOR_MAP } from '../../../lib/utils';
import MapSvg from './MapSvg';

const NetworkMap = ({ clients, onSelectClient, onlinePeers = [] }) => {
  const { t } = useLang();
  const containerRef = useRef(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [view, setView] = useState({ x: 0, y: 0, zoom: 1 });
  const [isDragging, setIsDragging] = useState(false);
  const [lastPos, setLastPos] = useState({ x: 0, y: 0 });
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const clickTimeoutRef = useRef(null);
  const { theme, isDark } = useTheme();
  // Ticker for "X min ago" so the value updates without a parent re-render.
  // Date.now() at render time is impure (React purity rule) and the displayed
  // "last seen" would otherwise stay frozen until something else re-rendered.
  const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), 30000);
    return () => clearInterval(t);
  }, []);

  // Enrichir les clients avec les données de statut live (via onlinePeers du WS)
  const enrichedClients = useMemo(() => {
    const onlineSet = new Set(onlinePeers);
    return [...clients].map((c) => ({
      ...c,
      // Priorité : WS live > lastHandshake calculé > offline
      isOnline: c.isOnline || onlineSet.has(c.publicKey),
    }));
  }, [clients, onlinePeers]);

  const sortedClients = useMemo(() => {
    return [...enrichedClients].sort(
      (a, b) =>
        (a.container || '').localeCompare(b.container || '') ||
        (a.name || '').localeCompare(b.name || '')
    );
  }, [enrichedClients]);

  const uniqueContainers = useMemo(
    () => [...new Set(enrichedClients.map((c) => c.container))].sort(),
    [enrichedClients]
  );

  // Vue hiérarchique : niveau 0 = les conteneurs, niveau 1 = les peers de celui
  // qu'on a ouvert. Afficher toute la flotte d'un coup devenait illisible.
  const [focusedContainer, setFocusedContainer] = useState(null);
  // La carte ne montre QUE les peers connectés par défaut : afficher toute la
  // flotte noie l'information utile (qui est en ligne maintenant). Bascule
  // possible pour revoir l'ensemble.
  const [onlineOnly, setOnlineOnly] = useState(true);

  // Un conteneur disparu (peer supprimé, changement de serveur) ne doit pas
  // laisser la carte vide sur un niveau qui n'existe plus.
  useEffect(() => {
    if (focusedContainer && !uniqueContainers.includes(focusedContainer)) {
      setFocusedContainer(null);
    }
  }, [focusedContainer, uniqueContainers]);

  // Agrégat par conteneur. On lui donne la même forme qu'un peer (id, isOnline,
  // débits) pour que la couche de liens fonctionne sans distinction de type.
  const containerGroups = useMemo(
    () =>
      uniqueContainers
        // En mode « connectés », un conteneur sans aucun peer en ligne n'a rien
        // à montrer : on l'écarte plutôt que d'offrir un niveau vide au clic.
        .filter(
          (name) =>
            !onlineOnly || enrichedClients.some((c) => c.container === name && c.isOnline)
        )
        .map((name) => {
        const members = enrichedClients.filter(
          (c) => c.container === name && (!onlineOnly || c.isOnline)
        );
        const online = members.filter((c) => c.isOnline).length;
        return {
          id: `container:${name}`,
          name,
          container: name,
          total: members.length,
          online,
          isOnline: online > 0,
          downloadRate: members.reduce((a, c) => a + (c.downloadRate || 0), 0),
          uploadRate: members.reduce((a, c) => a + (c.uploadRate || 0), 0),
        };
      }),
    [uniqueContainers, enrichedClients, onlineOnly]
  );

  // Peers du conteneur ouvert, filtrés par l'état de connexion comme le niveau
  // au-dessus : sans ça, descendre dans un conteneur ré-affichait les peers
  // hors ligne que le filtre venait justement d'écarter.
  const visibleClients = useMemo(
    () =>
      focusedContainer
        ? sortedClients.filter(
            (c) => c.container === focusedContainer && (!onlineOnly || c.isOnline)
          )
        : [],
    [focusedContainer, sortedClients, onlineOnly]
  );

  // Hauteur adaptée à l'espace RÉELLEMENT disponible : l'ancien
  // h-[calc(100vh-100px)] ignorait le header et les paddings du layout → la
  // carte débordait de l'écran (scroll vertical permanent sur la topologie).
  const [mapHeight, setMapHeight] = useState(560);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;

    const updateDimensions = () => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      // Position absolue du panneau dans la page (indépendante du scroll).
      const absoluteTop = rect.top + window.scrollY;
      const BOTTOM_GAP = 24;
      setMapHeight(Math.max(420, window.innerHeight - absoluteTop - BOTTOM_GAP));
      // On mesure la boîte RENDUE (getBoundingClientRect), pas offsetWidth/Height
      // qui arrondit à l'entier et inclut les bordures : le centre des peers
      // doit coller au pixel près à celui du noyau et des anneaux.
      setDimensions({ width: rect.width, height: rect.height });
    };

    updateDimensions();

    // ResizeObserver plutôt que l'événement `resize` de la fenêtre : le panneau
    // change aussi de taille SANS redimensionnement (bandeau licence ou mise à
    // jour qui apparaît, sidebar repliée, police chargée). L'ancienne écoute
    // laissait alors une mesure périmée → peers et liens décentrés par rapport
    // au noyau, sans qu'aucun événement ne le corrige.
    const ro = new ResizeObserver(updateDimensions);
    ro.observe(el);
    window.addEventListener('resize', updateDimensions);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', updateDimensions);
    };
  }, []);

  const handleMouseDown = (e) => {
    if (e.target.closest('button')) return;
    setIsDragging(true);
    setLastPos({ x: e.clientX, y: e.clientY });
  };

  const handleMouseMove = (e) => {
    if (!isDragging) return;
    const dx = e.clientX - lastPos.x;
    const dy = e.clientY - lastPos.y;
    setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
    setLastPos({ x: e.clientX, y: e.clientY });
  };

  const handleMouseUp = () => setIsDragging(false);

  const centerX = dimensions.width / 2;
  const centerY = dimensions.height / 2;

  // Détection mobile multi-sources pour plus de fiabilité
  const isMobile =
    dimensions.width < 768 || (typeof window !== 'undefined' && window.innerWidth < 768);

  // Dimensions dynamiques pour éviter les chevauchements sur mobile
  const hubRadius = isMobile ? 32 : 64; // w-16 vs w-32
  const nodeRadius = isMobile ? 20 : 32; // w-10 vs w-16
  const minPadding = 60; // Augmentation drastique de la marge de sécurité

  const radius = Math.max(
    hubRadius + nodeRadius + minPadding,
    Math.min(centerX, centerY) * (isMobile ? 0.45 : 0.7)
  );

  const handleNodeClick = (client) => {
    // Single click = select/highlight, double-click (within 250ms) = navigate
    if (selectedNodeId === client.id) {
      setSelectedNodeId(null);
    } else {
      setSelectedNodeId(client.id);
    }

    if (clickTimeoutRef.current) {
      clearTimeout(clickTimeoutRef.current);
      clickTimeoutRef.current = null;
      // Second click within the delay = double-click → navigate
      if (onSelectClient) onSelectClient(client);
    } else {
      clickTimeoutRef.current = setTimeout(() => {
        clickTimeoutRef.current = null;
      }, 250);
    }
  };

  const getContainerColor = (container) => {
    const colorMap = {
      emerald: '#10b981',
      indigo: '#6366f1',
      rose: '#f43f5e',
      amber: '#f59e0b',
      cyan: '#06b6d4',
      purple: '#a855f7',
      sky: '#0ea5e9',
    };
    const colors = ['emerald', 'indigo', 'rose', 'amber', 'cyan', 'purple', 'sky'];
    const colorName = colors[uniqueContainers.indexOf(container) % colors.length];
    return { name: colorName, hex: colorMap[colorName] };
  };

  if (dimensions.width === 0)
    return <div ref={containerRef} className="col-span-12 w-full" style={{ height: mapHeight }} />;

  return (
    <div
      ref={containerRef}
      style={{ height: mapHeight }}
      className={cn(
        'col-span-12 w-full relative backdrop-blur-xl rounded-3xl border overflow-hidden group select-none shadow-2xl cursor-grab active:cursor-grabbing transition-all',
        isDark ? 'bg-slate-900/40 border-white/5' : 'bg-white/80 border-black/5'
      )}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      <MapSvg
        view={view}
        isDragging={isDragging}
        centerX={centerX}
        centerY={centerY}
        radius={radius}
        isDark={isDark}
        isMobile={isMobile}
        theme={theme}
        sortedClients={visibleClients}
        containerGroups={containerGroups}
        focusedContainer={focusedContainer}
        onSelectContainer={setFocusedContainer}
        selectedNodeId={selectedNodeId}
        nowSec={nowSec}
        handleNodeClick={handleNodeClick}
        getContainerColor={getContainerColor}
      />

      {/* Control Overlay — sur mobile il occupait une seule rangée non
          sécable avec des marges de 32 px : le titre passait à la ligne et la
          bascule sortait de l'écran. Il est désormais borné à la largeur
          disponible (left+right) et les éléments passent à la ligne. */}
      <div className="absolute top-3 left-3 right-3 md:top-8 md:left-8 md:right-auto z-30 pointer-events-none transition-all">
        <div
          className={cn(
            'flex flex-wrap items-center gap-x-3 gap-y-2 p-3 md:p-4 md:gap-4 backdrop-blur-2xl border rounded-2xl md:rounded-3xl',
            isDark ? 'bg-slate-950/40 border-white/5' : 'bg-white/80 border-black/5 shadow-sm'
          )}
        >
          <div
            className="p-2 md:p-3 rounded-xl md:rounded-2xl shadow-2xl animate-pulse text-white flex-shrink-0"
            style={{ backgroundColor: COLOR_MAP[theme]?.[600] || '#4f46e5' }}
          >
            <Activity size={isMobile ? 18 : 24} />
          </div>
          <div className="min-w-0">
            <h3
              className={cn(
                'text-base md:text-xl font-black tracking-tight transition-colors whitespace-nowrap',
                isDark ? 'text-white' : 'text-slate-900'
              )}
            >
              Tactical Radar
            </h3>
            <p
              className="text-[10px] md:text-[11px] font-black tracking-widest uppercase opacity-60 truncate"
              style={{ color: COLOR_MAP[theme]?.[400] || '#818cf8' }}
            >
              {focusedContainer
                ? `${focusedContainer} — ${visibleClients.length} ${t('peers_word')}`
                : `${containerGroups.length} ${t('containers_word')}`}
            </p>
          </div>

          {/* Connectés / Tous — le filtre par défaut masque les peers hors
              ligne ; la bascule évite de croire la flotte disparue. */}
          <div className="pointer-events-auto flex rounded-xl md:rounded-2xl border border-white/10 overflow-hidden flex-shrink-0">
            {[
              { id: true, label: t('only_connected') },
              { id: false, label: t('show_all') },
            ].map((opt) => (
              <button
                key={String(opt.id)}
                onClick={() => setOnlineOnly(opt.id)}
                className={cn(
                  'px-2.5 md:px-3 py-1.5 md:py-2 text-[10px] md:text-[11px] font-black uppercase tracking-widest transition-colors',
                  onlineOnly === opt.id
                    ? 'bg-indigo-500/30 text-white'
                    : 'text-slate-500 hover:text-slate-300'
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* Fil d'Ariane : sans lui, on descend dans un conteneur sans pouvoir
              remonter (le clic sur le fond sert au déplacement de la carte). */}
          {focusedContainer && (
            <button
              onClick={() => setFocusedContainer(null)}
              className={cn(
                'pointer-events-auto flex items-center gap-1.5 px-2.5 md:px-4 py-1.5 md:py-2.5 rounded-xl md:rounded-2xl border text-[10px] md:text-[11px] font-black uppercase tracking-widest transition-all flex-shrink-0',
                isDark
                  ? 'bg-white/5 border-white/10 text-slate-300 hover:text-white hover:bg-white/10'
                  : 'bg-black/5 border-black/10 text-slate-600 hover:text-slate-900'
              )}
            >
              <ChevronLeft size={14} /> {t('all_containers')}
            </button>
          )}
        </div>
        {!focusedContainer && containerGroups.length > 0 && (
          <p className="mt-3 ml-2 text-[11px] text-slate-500 italic">{t('topology_hint')}</p>
        )}
        {/* Sans ce message, un filtre « connectés » sans aucun peer en ligne
            donne une carte vide et inexplicable. */}
        {containerGroups.length === 0 && (
          <p className="mt-3 ml-2 text-[11px] text-amber-400/80 italic">
            {onlineOnly ? t('topology_none_online') : t('topology_empty')}
          </p>
        )}
      </div>

      {/* Zoom Controls */}
      <div className="absolute bottom-4 right-4 md:bottom-8 md:right-8 flex flex-col gap-2 md:gap-3 z-30">
        <button
          onClick={() => setView((v) => ({ ...v, zoom: Math.min(v.zoom + 0.2, 4) }))}
          className={cn(
            'p-2.5 md:p-3 rounded-xl md:rounded-2xl border shadow-2xl transition-all',
            isDark
              ? 'bg-slate-900/90 hover:bg-slate-800 text-white border-white/10'
              : 'bg-white hover:bg-slate-50 text-slate-900 border-black/10'
          )}
        >
          <Plus size={20} />
        </button>
        <button
          onClick={() => setView((v) => ({ ...v, zoom: Math.max(v.zoom - 0.2, 0.5) }))}
          className={cn(
            'p-2.5 md:p-3 rounded-xl md:rounded-2xl border shadow-2xl transition-all',
            isDark
              ? 'bg-slate-900/90 hover:bg-slate-800 text-white border-white/10'
              : 'bg-white hover:bg-slate-50 text-slate-900 border-black/10'
          )}
        >
          <Minus size={20} />
        </button>
        <button
          onClick={() => setView({ x: 0, y: 0, zoom: 1 })}
          className={cn(
            'p-2.5 md:p-3 rounded-xl md:rounded-2xl border shadow-2xl transition-all',
            isDark
              ? 'bg-slate-900/90 hover:bg-slate-800 text-white border-white/10'
              : 'bg-white hover:bg-slate-50 text-slate-900 border-black/10'
          )}
        >
          <RefreshCw size={20} />
        </button>
      </div>

      {/* Container Groups Legend */}
      <div
        className={cn(
          'absolute bottom-6 left-6 hidden md:flex flex-col gap-3 p-6 backdrop-blur-2xl border rounded-[2rem] z-20 transition-all',
          isDark ? 'bg-slate-950/40 border-white/5' : 'bg-white/80 border-black/5 shadow-sm'
        )}
      >
        <span
          className={cn(
            'text-[11px] font-black uppercase tracking-widest mb-2 opacity-60 transition-colors',
            isDark ? 'text-white' : 'text-slate-900'
          )}
        >
          {t('tactical_groups')}
        </span>
        <div className="grid grid-cols-2 gap-x-6 gap-y-3">
          {uniqueContainers.map((c) => {
            const color = getContainerColor(c);
            return (
              <div key={c} className="flex items-center gap-3">
                <span
                  className="w-2 h-2 rounded-full"
                  style={{
                    backgroundColor: COLOR_MAP[color.name]?.[500] || '#6366f1',
                    boxShadow: `0 0 8px ${COLOR_MAP[color.name]?.[500] || '#6366f1'}`,
                  }}
                ></span>
                <span className="text-[11px] font-bold text-slate-400 font-mono uppercase truncate max-w-[80px]">
                  {c}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default NetworkMap;
