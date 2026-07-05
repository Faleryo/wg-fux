import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Activity, Plus, Minus, RefreshCw } from 'lucide-react';
import { useTheme } from '../../../context/ThemeContext';
import { cn, COLOR_MAP } from '../../../lib/utils';
import MapSvg from './MapSvg';

const NetworkMap = ({ clients, onSelectClient, onlinePeers = [] }) => {
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

  useEffect(() => {
    const updateDimensions = () => {
      if (containerRef.current) {
        setDimensions({
          width: containerRef.current.offsetWidth,
          height: containerRef.current.offsetHeight,
        });
      }
    };
    updateDimensions();
    window.addEventListener('resize', updateDimensions);
    return () => window.removeEventListener('resize', updateDimensions);
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
    return <div ref={containerRef} className="col-span-12 w-full h-[calc(100vh-100px)]" />;

  return (
    <div
      ref={containerRef}
      className={cn(
        'col-span-12 w-full relative h-[calc(100vh-100px)] backdrop-blur-xl rounded-3xl border overflow-hidden group select-none shadow-2xl cursor-grab active:cursor-grabbing transition-all',
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
        sortedClients={sortedClients}
        selectedNodeId={selectedNodeId}
        nowSec={nowSec}
        handleNodeClick={handleNodeClick}
        getContainerColor={getContainerColor}
      />

      {/* Control Overlay */}
      <div className="absolute top-8 left-8 z-30 pointer-events-none transition-all">
        <div
          className={cn(
            'flex items-center gap-4 p-4 backdrop-blur-2xl border rounded-3xl',
            isDark ? 'bg-slate-950/40 border-white/5' : 'bg-white/80 border-black/5 shadow-sm'
          )}
        >
          <div
            className="p-3 rounded-2xl shadow-2xl animate-pulse text-white"
            style={{ backgroundColor: COLOR_MAP[theme]?.[600] || '#4f46e5' }}
          >
            <Activity size={24} />
          </div>
          <div>
            <h3
              className={cn(
                'text-xl font-black tracking-tight transition-colors',
                isDark ? 'text-white' : 'text-slate-900'
              )}
            >
              Tactical Radar
            </h3>
            <p
              className="text-[11px] font-black tracking-widest uppercase opacity-60"
              style={{ color: COLOR_MAP[theme]?.[400] || '#818cf8' }}
            >
              Deep Space Network Monitoring
            </p>
          </div>
        </div>
      </div>

      {/* Zoom Controls */}
      <div className="absolute bottom-8 right-8 flex flex-col gap-3 z-30">
        <button
          onClick={() => setView((v) => ({ ...v, zoom: Math.min(v.zoom + 0.2, 4) }))}
          className={cn(
            'p-3 rounded-2xl border shadow-2xl transition-all',
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
            'p-3 rounded-2xl border shadow-2xl transition-all',
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
            'p-3 rounded-2xl border shadow-2xl transition-all',
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
          'absolute bottom-8 left-8 hidden md:flex flex-col gap-3 p-6 backdrop-blur-2xl border rounded-[2rem] z-20 transition-all',
          isDark ? 'bg-slate-950/40 border-white/5' : 'bg-white/80 border-black/5 shadow-sm'
        )}
      >
        <span
          className={cn(
            'text-[11px] font-black uppercase tracking-widest mb-2 opacity-60 transition-colors',
            isDark ? 'text-white' : 'text-slate-900'
          )}
        >
          Goupes Tactiques
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
