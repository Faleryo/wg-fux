import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Users } from 'lucide-react';
import { cn, formatBytes, COLOR_MAP } from '../../../lib/utils';

const NetworkNode = ({
  client,
  index,
  total,
  centerX,
  centerY,
  radius,
  isDark,
  isMobile,
  selectedNodeId,
  nowSec,
  onNodeClick,
  getContainerColor,
}) => {
  const angle = (index * (2 * Math.PI)) / total - Math.PI / 2;
  const x = centerX + radius * Math.cos(angle);
  const y = centerY + radius * Math.sin(angle);
  const isOnline = client.isOnline;
  const color = getContainerColor(client.container);

  return (
    <motion.div
      key={client.id}
      initial={{ scale: 0, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ delay: index * 0.05, type: 'spring' }}
      className="absolute z-20 group/node cursor-pointer"
      style={{ left: x, top: y, transform: 'translate(-50%, -50%)' }}
      onClick={() => onNodeClick(client)}
    >
      <div
        className={cn(
          'backdrop-blur-md border-[3px] rounded-2xl flex items-center justify-center transition-all duration-500 group-hover/node:scale-125 shadow-2xl',
          isMobile ? 'w-10 h-10' : 'w-16 h-16',
          isOnline
            ? cn(isDark ? 'bg-slate-900/80' : 'bg-white/80')
            : cn(
                isDark
                  ? 'bg-slate-950/80 border-white/5 group-hover/node:bg-slate-900'
                  : 'bg-white border-black/5 group-hover/node:bg-slate-50',
                'group-hover/node:border-white/20'
              )
        )}
        style={
          isOnline
            ? {
                borderColor: COLOR_MAP[color.name]?.[500]
                  ? COLOR_MAP[color.name][500] + '80'
                  : '#6366f180',
                backgroundColor: COLOR_MAP[color.name]?.[800]
                  ? COLOR_MAP[color.name][800] + 'e6'
                  : '#312e81e6',
              }
            : undefined
        }
      >
        <Users
          size={isMobile ? 18 : 28}
          className={cn(
            'transition-all duration-300',
            isOnline
              ? 'group-hover/node:text-white group-hover/node:rotate-6'
              : 'text-slate-700 group-hover/node:text-slate-400'
          )}
          style={isOnline ? { color: COLOR_MAP[color.name]?.[400] || '#818cf8' } : undefined}
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
                className="text-[9px] font-black uppercase tracking-widest"
                style={{ color: COLOR_MAP[color.name]?.[400] || '#818cf8' }}
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
              <span className={isDark ? 'text-slate-100' : 'text-slate-900'}>{client.ip}</span>
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
                <span className="text-amber-400 font-bold">{formatBytes(client.usageTotal)}</span>
              </div>
            )}
            {client.lastHandshake > 0 && (
              <div className="flex justify-between">
                <span>Last seen</span>
                <span className="text-slate-400">
                  {Math.floor((nowSec - client.lastHandshake) / 60)}m ago
                </span>
              </div>
            )}
          </div>
        </div>
      </AnimatePresence>
    </motion.div>
  );
};

export default NetworkNode;
