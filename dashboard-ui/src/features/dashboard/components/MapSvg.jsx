import React from 'react';
import { motion } from 'framer-motion';
import { Server } from 'lucide-react';
import { cn } from '../../../lib/utils';
import NetworkEdge from './NetworkEdge';
import NetworkNode from './NetworkNode';

const MapSvg = ({
  view,
  isDragging,
  centerX,
  centerY,
  radius,
  isDark,
  isMobile,
  theme,
  sortedClients,
  selectedNodeId,
  nowSec,
  handleNodeClick,
  getContainerColor,
}) => {
  return (
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

      {/* Radar Sweeper */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[200vmax] h-[200vmax] pointer-events-none flex items-center justify-center">
        <div
          className={cn(
            'w-full h-full rounded-full bg-[conic-gradient(from_0deg_at_50%_50%,transparent_0deg,transparent_320deg,currentColor_360deg)] opacity-[0.07] animate-[spin_8s_linear_infinite]',
            `text-${theme}-500`
          )}
        ></div>
      </div>

      {/* Orbital Rings */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none flex items-center justify-center">
        <div
          className={cn(
            'absolute rounded-full border transition-colors',
            isDark ? 'border-white/5' : 'border-black/5'
          )}
          style={{ width: radius * 0.8, height: radius * 0.8 }}
        ></div>
        <div
          className={cn(
            'absolute rounded-full border-2 transition-colors',
            isDark ? 'border-white/10' : 'border-black/10'
          )}
          style={{ width: radius * 2, height: radius * 2 }}
        ></div>
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
      <NetworkEdge
        clients={sortedClients}
        centerX={centerX}
        centerY={centerY}
        radius={radius}
        isDark={isDark}
        getContainerColor={getContainerColor}
      />

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
      {sortedClients.map((client, i) => (
        <NetworkNode
          key={client.id}
          client={client}
          index={i}
          total={sortedClients.length}
          centerX={centerX}
          centerY={centerY}
          radius={radius}
          isDark={isDark}
          isMobile={isMobile}
          selectedNodeId={selectedNodeId}
          nowSec={nowSec}
          onNodeClick={handleNodeClick}
          getContainerColor={getContainerColor}
        />
      ))}
    </motion.div>
  );
};

export default MapSvg;
