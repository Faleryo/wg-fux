import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Activity, Server, Users, Plus, Minus, RefreshCw, Wifi, WifiOff } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTheme } from '../../../context/ThemeContext';
import { cn, formatBytes } from '../../../lib/utils';

const NetworkMap = ({ clients, onSelectClient, onlinePeers = [] }) => {
  const containerRef = useRef(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [view, setView] = useState({ x: 0, y: 0, zoom: 1 });
  const [isDragging, setIsDragging] = useState(false);
  const [lastPos, setLastPos] = useState({ x: 0, y: 0 });
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const clickTimeoutRef = useRef(null);
  const { theme, isDark } = useTheme();

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
    // Gérer l'affichage des tooltips persistants sur mobile
    if (selectedNodeId === client.id) {
      setSelectedNodeId(null);
    } else {
      setSelectedNodeId(client.id);
    }

    if (clickTimeoutRef.current) {
      clearTimeout(clickTimeoutRef.current);
      clickTimeoutRef.current = null;
    } else {
      clickTimeoutRef.current = setTimeout(() => {
        if (onSelectClient) onSelectClient(client);
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
        'col-span-12 w-full relative h-[calc(100vh-100px)] backdrop-blur-3xl rounded-3xl border overflow-hidden group select-none shadow-2xl cursor-grab active:cursor-grabbing transition-all',
        isDark ? 'bg-slate-900/40 border-white/5' : 'bg-white/80 border-black/5'
      )}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      <motion.div
        animate={{ x: view.x, y: view.y, scale: view.zoom }}
        transition={isDragging ? { type: 'just' } : { type: 'spring', stiffness: 300, damping: 30 }}
        style={{ width: '100%', height: '100%', position: 'absolute', top: 0, left: 0 }}
      >
        {/* Background Grid */}
        <div
          className={cn(
            'absolute inset-0 bg-[size:60px_60px] pointer-events-none transition-colors',
            isDark
              ? 'bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)]'
              : 'bg-[linear-gradient(rgba(0,0,0,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(0,0,0,0.03)_1px,transparent_1px)]'
          )}
        ></div>

        {/* Radar Sweeper - Fixed Aspect Ratio 1:1 */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[200vmax] h-[200vmax] pointer-events-none flex items-center justify-center">
          <div
            className={cn(
              'w-full h-full rounded-full bg-[conic-gradient(from_0deg_at_50%_50%,transparent_0deg,transparent_320deg,currentColor_360deg)] opacity-[0.07] animate-[spin_8s_linear_infinite]',
              `text-${theme}-500`
            )}
          ></div>
        </div>

        {/* Orbital Rings - Precisely centered and synced with Radius */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none flex items-center justify-center">
          {/* Inner Ring */}
          <div
            className={cn(
              'absolute rounded-full border transition-colors',
              isDark ? 'border-white/5' : 'border-black/5'
            )}
            style={{ width: radius * 0.8, height: radius * 0.8 }}
          ></div>
          {/* Main Orbital Ring (Aligned with Nodes) */}
          <div
            className={cn(
              'absolute rounded-full border-2 transition-colors',
              isDark ? 'border-white/10' : 'border-black/10'
            )}
            style={{ width: radius * 2, height: radius * 2 }}
          ></div>
          {/* Outer Ring */}
          <div
            className={cn(
              'absolute rounded-full border animate-pulse transition-colors',
              isDark
                ? 'border-white/10 shadow-[inset_0_0_100px_rgba(255,255,255,0.03)]'
                : 'border-black/10 shadow-[inset_0_0_100px_rgba(0,0,0,0.03)]'
            )}
            style={{ width: radius * 3, height: radius * 3 }}
          ></div>
        </div>

        {/* Connections Layer */}
        <svg className="absolute inset-0 w-full h-full pointer-events-none drop-shadow-2xl">
          {sortedClients.map((client, i) => {
            const angle = (i * (2 * Math.PI)) / sortedClients.length - Math.PI / 2;
            const x = centerX + radius * Math.cos(angle);
            const y = centerY + radius * Math.sin(angle);
            const isOnline = client.isOnline;
            const hasTraffic = client.downloadRate + client.uploadRate > 1024;
            const color = getContainerColor(client.container);

            if (!centerX || !centerY) return null;

            return (
              <g key={`link-${client.id}`}>
                <motion.line
                  x1={centerX}
                  y1={centerY}
                  x2={x}
                  y2={y}
                  initial={{ pathLength: 0, opacity: 0 }}
                  animate={{ pathLength: 1, opacity: isOnline ? 0.6 : 0.1 }}
                  stroke={
                    isOnline
                      ? hasTraffic
                        ? color.hex
                        : isDark
                          ? 'rgba(255, 255, 255, 0.2)'
                          : 'rgba(0, 0, 0, 0.2)'
                      : isDark
                        ? 'rgba(255, 255, 255, 0.05)'
                        : 'rgba(0, 0, 0, 0.05)'
                  }
                  strokeWidth={isOnline ? (hasTraffic ? '2' : '1.5') : '1'}
                  strokeDasharray={isOnline ? '0' : '5,5'}
                />
                {isOnline && (
                  <circle r={hasTraffic ? '3' : '2'} fill={hasTraffic ? color.hex : '#818cf8'}>
                    <animateMotion
                      dur={
                        hasTraffic
                          ? `${Math.max(0.4, 4 - Math.log10(client.downloadRate + client.uploadRate + 1))}s`
                          : '4s'
                      }
                      repeatCount="indefinite"
                      path={`M${centerX},${centerY} L${x},${y}`}
                    />
                  </circle>
                )}
              </g>
            );
          })}
        </svg>

        {/* Hub */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-10 flex flex-col items-center justify-center group/hub">
          <div
            className={cn(
              'rounded-[3.5rem] shadow-[0_0_100px_-20px_rgba(0,0,0,0.5)] flex items-center justify-center relative z-10 transition-all duration-700 group-hover/hub:scale-110 border-4',
              isMobile ? 'w-16 h-16 rounded-[2rem]' : 'w-32 h-32',
              `bg-${theme}-600 shadow-${theme}-600/40 border-${theme}-400/20`
            )}
          >
            <Server size={isMobile ? 28 : 48} className="text-white drop-shadow-2xl" />
            <div
              className={cn(
                'absolute inset-0 border border-white/20 animate-pulse',
                isMobile ? 'rounded-[2rem]' : 'rounded-[3.5rem]'
              )}
            ></div>
          </div>
          <div
            className={cn(
              'mt-8 px-6 py-2 backdrop-blur-3xl border rounded-2xl text-[10px] font-black uppercase tracking-[0.3em] opacity-0 group-hover/hub:opacity-100 transition-all duration-500 transform translate-y-4 group-hover/hub:translate-y-0 shadow-2xl',
              isDark ? 'bg-slate-950/90 border-white/10' : 'bg-white border-black/10',
              `text-${theme}-400 shadow-${theme}-500/10`
            )}
          >
            HUB-CORE-ALPHA
          </div>
        </div>

        {/* Nodes */}
        {sortedClients.map((client, i) => {
          const angle = (i * (2 * Math.PI)) / sortedClients.length - Math.PI / 2;
          const x = centerX + radius * Math.cos(angle);
          const y = centerY + radius * Math.sin(angle);
          const isOnline = client.isOnline;
          const color = getContainerColor(client.container);

          return (
            <motion.div
              key={client.id}
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: i * 0.05, type: 'spring' }}
              className="absolute z-20 group/node cursor-pointer"
              style={{ left: x, top: y, transform: 'translate(-50%, -50%)' }}
              onClick={() => handleNodeClick(client)}
            >
              <div
                className={cn(
                  'backdrop-blur-md border-[3px] rounded-2xl flex items-center justify-center transition-all duration-500 group-hover/node:scale-125 shadow-2xl',
                  isMobile ? 'w-10 h-10' : 'w-16 h-16',
                  isOnline
                    ? cn(
                        isDark ? 'bg-slate-900/80' : 'bg-white/80',
                        `border-${color.name}-500/50 group-hover/node:bg-${color.name}-900/90 group-hover/node:border-${color.name}-400 group-hover/node:shadow-${color.name}-600/20`
                      )
                    : cn(
                        isDark
                          ? 'bg-slate-950/80 border-white/5 group-hover/node:bg-slate-900'
                          : 'bg-white border-black/5 group-hover/node:bg-slate-50',
                        'group-hover/node:border-white/20'
                      )
                )}
              >
                <Users
                  size={isMobile ? 18 : 28}
                  className={cn(
                    'transition-all duration-300',
                    isOnline
                      ? `text-${color.name}-400 group-hover/node:text-white group-hover/node:rotate-6`
                      : 'text-slate-700 group-hover/node:text-slate-400'
                  )}
                />
                {isOnline && (
                  <span
                    className={cn(
                      'absolute -top-1.5 -right-1.5 rounded-full border-4',
                      isMobile ? 'w-3.5 h-3.5 border-[3px]' : 'w-4 h-4',
                      isDark ? 'border-slate-950' : 'border-white',
                      `bg-emerald-500 shadow-[0_0_15px_#10b981]`
                    )}
                  ></span>
                )}
              </div>

              {/* Tactical Tooltip */}
              <AnimatePresence>
                <div
                  className={cn(
                    'absolute top-full left-1/2 -translate-x-1/2 mt-8 w-64 backdrop-blur-3xl border rounded-2xl p-6 transition-all duration-500 pointer-events-none scale-90 z-50 shadow-2xl origin-top',
                    isDark ? 'bg-slate-950/90 border-white/10' : 'bg-white border-black/10',
                    selectedNodeId === client.id
                      ? 'opacity-100 scale-100'
                      : 'opacity-0 group-hover/node:opacity-100 group-hover/node:scale-100'
                  )}
                >
                  <div
                    className={cn(
                      'absolute -top-2 left-1/2 -translate-x-1/2 w-4 h-4 rotate-45 border-t border-l',
                      isDark ? 'bg-slate-950 border-white/10' : 'bg-white border-black/10'
                    )}
                  ></div>

                  <div
                    className={cn(
                      'flex items-center justify-between mb-6 pb-4 border-b',
                      isDark ? 'border-white/5' : 'border-black/5'
                    )}
                  >
                    <div>
                      <span
                        className={cn(
                          'text-md font-black tracking-tight block truncate max-w-[140px] transition-colors',
                          isDark ? 'text-white' : 'text-slate-900'
                        )}
                      >
                        {client.name}
                      </span>
                      <span
                        className={cn(
                          'text-[9px] font-black uppercase tracking-widest',
                          `text-${color.name}-400`
                        )}
                      >
                        {client.container}
                      </span>
                    </div>
                    <div
                      className={cn(
                        'px-2.5 py-1 rounded-lg border text-[9px] font-black uppercase',
                        isOnline
                          ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                          : isDark
                            ? 'bg-slate-900 text-slate-500 border-white/5'
                            : 'bg-slate-100 text-slate-400 border-black/5'
                      )}
                    >
                      {isOnline ? 'Active' : 'Offline'}
                    </div>
                  </div>

                  <div className="space-y-3 font-mono text-[10px] text-slate-500">
                    <div className="flex justify-between">
                      <span>Tact IP</span>{' '}
                      <span className={isDark ? 'text-slate-100' : 'text-slate-900'}>
                        {client.ip}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>Endpoint</span>{' '}
                      <span className={isDark ? 'text-slate-300' : 'text-slate-600'}>
                        {client.endpoint || '—'}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>Burst DL</span>{' '}
                      <span className="text-emerald-400">
                        {formatBytes(client.downloadRate || client.rx || 0)}/s
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>Burst UL</span>{' '}
                      <span className="text-indigo-400">
                        {formatBytes(client.uploadRate || client.tx || 0)}/s
                      </span>
                    </div>
                    {client.usageTotal > 0 && (
                      <div
                        className={cn(
                          'flex justify-between border-t pt-2 mt-2',
                          isDark ? 'border-white/5' : 'border-black/5'
                        )}
                      >
                        <span>Total usage</span>
                        <span className="text-amber-400 font-bold">
                          {formatBytes(client.usageTotal)}
                        </span>
                      </div>
                    )}
                    {client.lastHandshake > 0 && (
                      <div className="flex justify-between">
                        <span>Last seen</span>
                        <span className="text-slate-400">
                          {Math.floor((Date.now() / 1000 - client.lastHandshake) / 60)}m ago
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </AnimatePresence>
            </motion.div>
          );
        })}
      </motion.div>

      {/* Control Overlay */}
      <div className="absolute top-8 left-8 z-30 pointer-events-none transition-all">
        <div
          className={cn(
            'flex items-center gap-4 p-4 backdrop-blur-2xl border rounded-3xl',
            isDark ? 'bg-slate-950/40 border-white/5' : 'bg-white/80 border-black/5 shadow-sm'
          )}
        >
          <div
            className={cn('p-3 rounded-2xl shadow-2xl animate-pulse', `bg-${theme}-600 text-white`)}
          >
            <Activity size={24} />
          </div>
          <div>
            <h3
              className={cn(
                'text-xl font-black tracking-tight uppercase transition-colors',
                isDark ? 'text-white' : 'text-slate-900'
              )}
            >
              Tactical Radar
            </h3>
            <p
              className={cn(
                'text-[10px] font-black tracking-widest uppercase opacity-60',
                `text-${theme}-400`
              )}
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
            'text-[10px] font-black uppercase tracking-widest mb-2 opacity-60 transition-colors',
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
                  className={cn(
                    'w-2 h-2 rounded-full',
                    `bg-${color.name}-500 shadow-[0_0_8px_currentColor]`
                  )}
                ></span>
                <span className="text-[9px] font-bold text-slate-400 font-mono uppercase truncate max-w-[80px]">
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
