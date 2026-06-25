import React from 'react';
import { Server, Zap } from 'lucide-react';
import { motion } from 'framer-motion';
import { cn } from '../../../lib/utils';
import GlassInput from './GlassInput';

const GeneralSettings = ({ config, setConfig, isDark, theme }) => {
  return (
    <motion.div
      key="gen"
      initial={{ opacity: 0, x: 10 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -10 }}
      className="grid grid-cols-1 md:grid-cols-2 gap-10"
    >
      <div className="space-y-8">
        <h3
          className={cn(
            'text-xl font-black flex items-center gap-3 italic uppercase transition-colors',
            isDark ? 'text-white' : 'text-slate-900'
          )}
        >
          <Server size={20} className={cn(`text-${theme}-400`)} /> Main-Core
        </h3>
        <GlassInput
          label="Distant UDP Port"
          value={config.port}
          onChange={(e) => setConfig({ ...config, port: e.target.value })}
          badge="UDP"
          tooltip="Port d'écoute standard WireGuard"
        />
        <GlassInput
          label="Protocol MTU"
          value={config.mtu}
          onChange={(e) => setConfig({ ...config, mtu: e.target.value })}
          badge="BYTES"
          tooltip="Maximum Transmission Unit"
        />
      </div>
      <div className="space-y-8">
        <h3
          className={cn(
            'text-xl font-black flex items-center gap-3 italic uppercase transition-colors',
            isDark ? 'text-white' : 'text-slate-900'
          )}
        >
          <Zap size={20} className="text-emerald-400" /> Pulse-Mode
        </h3>
        <GlassInput
          label="Persistent Keepalive"
          value={config.keepalive}
          onChange={(e) => setConfig({ ...config, keepalive: e.target.value })}
          badge="SECONDS"
          tooltip="Maintient les sessions actives à travers les pare-feu NAT rigides via stimulation UDP (0 = désactivé)."
        />
        <p className="px-1 text-[9px] text-slate-500 font-bold uppercase tracking-widest leading-relaxed opacity-60">
          Recommandé : 25s (Standard), 5s (Gaming Mobile Ultra-Stable).
        </p>
      </div>
    </motion.div>
  );
};

export default GeneralSettings;
