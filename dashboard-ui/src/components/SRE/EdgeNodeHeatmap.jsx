import React from 'react';
import { motion } from 'framer-motion';
import { cn } from '../../lib/utils';
import { Globe } from 'lucide-react';

const EdgeNodeHeatmap = ({ interfaces }) => {
  // Mocking some geo/node data if not present
  const nodes = interfaces.map((iface, i) => ({
    ...iface,
    latency: Math.floor(Math.random() * 40) + 10, // Mock latency for heat visualization
    load: Math.floor(Math.random() * 60) + 10,
    region: ['EU-West', 'US-East', 'ASIA-South', 'Edge-Local'][i % 4],
  }));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-[0.25em] flex items-center gap-2">
          <Globe size={12} className="text-indigo-400" /> Distributed Node Fabric
        </h3>
        <span className="text-[9px] font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
          MESH STATUS: ACTIVE
        </span>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {nodes.map((node) => (
          <motion.div
            key={node.name}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className={cn(
              'relative p-4 rounded-2xl border transition-all duration-500 overflow-hidden group',
              'bg-slate-900/40 border-slate-800 hover:border-indigo-500/30'
            )}
          >
            {/* Heat Pulse Background */}
            <div
              className={cn(
                'absolute -right-4 -bottom-4 w-16 h-16 blur-2xl opacity-20 transition-all',
                node.load > 50 ? 'bg-amber-500' : 'bg-indigo-500'
              )}
            />

            <div className="relative z-10">
              <div className="flex justify-between items-start mb-3">
                <span className="text-[10px] font-black text-slate-400 group-hover:text-white transition-colors">
                  {node.name.toUpperCase()}
                </span>
                <div
                  className={cn(
                    'w-1.5 h-1.5 rounded-full animate-pulse',
                    node.status === 'up'
                      ? 'bg-emerald-500 shadow-[0_0_8px_#10b981]'
                      : 'bg-slate-500'
                  )}
                />
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-[9px] font-mono">
                  <span className="text-slate-500">LATENCY</span>
                  <span className="text-indigo-400 font-bold">{node.latency}ms</span>
                </div>
                <div className="w-full h-1 bg-slate-800 rounded-full overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${node.load}%` }}
                    className={cn(
                      'h-full rounded-full',
                      node.load > 80
                        ? 'bg-rose-500'
                        : node.load > 50
                          ? 'bg-amber-500'
                          : 'bg-indigo-500'
                    )}
                  />
                </div>
                <p className="text-[8px] text-slate-600 font-bold uppercase tracking-tighter mt-1">
                  Region: {node.region}
                </p>
              </div>
            </div>
          </motion.div>
        ))}

        {/* Placeholder for expansion */}
        <div className="p-4 rounded-2xl border border-dashed border-slate-800 flex flex-col items-center justify-center opacity-40 hover:opacity-100 transition-opacity cursor-pointer group">
          <div className="w-6 h-6 rounded-full border border-slate-600 flex items-center justify-center text-slate-600 group-hover:border-indigo-500 group-hover:text-indigo-500 mb-2">
            +
          </div>
          <span className="text-[9px] font-black uppercase text-slate-600 tracking-widest">
            Connect Edge
          </span>
        </div>
      </div>
    </div>
  );
};

export default EdgeNodeHeatmap;
