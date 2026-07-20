import React from 'react';
import { Globe, Radio } from 'lucide-react';
import { motion } from 'framer-motion';
import { cn } from '../../../lib/utils';
import { useLang } from '../../../context/LanguageContext';
import GlassInput from './GlassInput';

const NetworkSettings = ({ config, setConfig, isDark, theme }) => {
  const { t } = useLang();
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
          'text-xl font-black flex items-center gap-3 italic transition-colors',
          isDark ? 'text-white' : 'text-slate-900'
        )}
      >
        <Globe size={20} className="text-cyan-400" /> Infrastructure
      </h3>

      {/* WireGuard Endpoint — champ le plus important, pleine largeur */}
      <div className="space-y-3">
        <GlassInput
          label="WireGuard Endpoint"
          value={config.wg_endpoint ?? ''}
          onChange={(e) => setConfig({ ...config, wg_endpoint: e.target.value })}
          badge="DOMAIN / IP"
          tooltip={t('tt_wg_endpoint')}
          placeholder={t('ph_wg_endpoint')}
        />
        <p className="px-1 text-[11px] text-slate-500 font-bold uppercase tracking-widest leading-relaxed opacity-60">
          ⚠ {t('endpoint_warn_1')} <strong>{t('endpoint_warn_new')}</strong> {t('endpoint_warn_2')}
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
        <GlassInput
          label="Primary DNS Cluster"
          value={config.dns}
          onChange={(e) => setConfig({ ...config, dns: e.target.value })}
          badge="IP-LIST"
          tooltip={t('tt_dns')}
        />
        <GlassInput
          label="VPN Base-Subnet"
          value={config.subnet}
          onChange={(e) => setConfig({ ...config, subnet: e.target.value })}
          badge="CIDR"
          tooltip={t('tt_subnet')}
        />
      </div>
    </motion.div>
  );
};

export default NetworkSettings;
