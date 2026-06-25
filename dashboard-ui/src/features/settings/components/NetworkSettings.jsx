import React from 'react';
import { Globe } from 'lucide-react';
import { motion } from 'framer-motion';
import { cn } from '../../../lib/utils';
import GlassInput from './GlassInput';

const NetworkSettings = ({ config, setConfig, isDark, theme }) => {
  return (
    <motion.div
      key="net"
      initial={{ opacity: 0, x: 10 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -10 }}
      className="space-y-10"
    >
      <h3
        className={cn(
          'text-xl font-black flex items-center gap-3 italic uppercase transition-colors',
          isDark ? 'text-white' : 'text-slate-900'
        )}
      >
        <Globe size={20} className="text-cyan-400" /> Infrastructure
      </h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
        <GlassInput
          label="Primary DNS Cluster"
          value={config.dns}
          onChange={(e) => setConfig({ ...config, dns: e.target.value })}
          badge="IP-LIST"
          tooltip="Serveurs DNS transmis aux clients"
        />
        <GlassInput
          label="VPN Base-Subnet"
          value={config.subnet}
          onChange={(e) => setConfig({ ...config, subnet: e.target.value })}
          badge="CIDR"
          tooltip="Plage d'IP interne du tunnel vpn"
        />
      </div>
    </motion.div>
  );
};

export default NetworkSettings;
