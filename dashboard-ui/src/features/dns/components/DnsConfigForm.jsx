import React from 'react';
import { Globe, Shield, Zap, Settings2, AlertCircle } from 'lucide-react';
import { motion } from 'framer-motion';
import { cn } from '../../../lib/utils';
import DnsRecordsTable from './DnsRecordsTable';

const DnsConfigForm = ({
  activeTab,
  setActiveTab,
  config,
  setConfig,
  filtering,
  handleRemoveFilter,
  handleAddFilter,
  newFilterName,
  newFilterUrl,
  setNewFilterName,
  setNewFilterUrl,
}) => {
  return (
    <div className="glass-card border border-white/5 overflow-hidden p-0">
      <div className="flex border-b border-white/5 bg-black/10 overflow-x-auto custom-scrollbar no-scrollbar">
        {[
          { id: 'upstream', label: 'Upstream', icon: <Globe size={14} /> },
          { id: 'filters', label: 'Filters', icon: <Shield size={14} /> },
          { id: 'bootstrap', label: 'Bootstrap', icon: <Zap size={14} /> },
          { id: 'settings', label: 'Harden', icon: <Settings2 size={14} /> },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              'flex items-center gap-2 px-5 sm:px-8 py-4 sm:py-5 text-[9px] sm:text-[10px] font-black uppercase tracking-widest transition-all relative shrink-0',
              activeTab === tab.id
                ? 'text-white bg-indigo-600/10'
                : 'text-slate-500 hover:text-slate-200 hover:bg-white/5'
            )}
          >
            {tab.icon}
            {tab.label}
            {activeTab === tab.id && (
              <motion.div
                layoutId="dnsTab"
                className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-500 shadow-[0_0_10px_#6366f1]"
              />
            )}
          </button>
        ))}
      </div>

      <div className="p-4 sm:p-8">
        {activeTab === 'upstream' && (
          <div className="space-y-6">
            <div className="flex items-start gap-4">
              <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-500">
                <AlertCircle size={24} />
              </div>
              <div>
                <h4 className="text-sm font-black uppercase tracking-tight mb-1">
                  Serveurs DNS Amont
                </h4>
                <p className="text-xs text-slate-500 leading-relaxed max-w-2xl">
                  Entrez un serveur par ligne. Ces serveurs seront utilisés par AdGuard pour
                  résoudre les requêtes de vos clients. Privilégiez les serveurs DoH ou DoT pour une
                  sécurité maximale.
                </p>
              </div>
            </div>

            <textarea
              value={config?.upstream_dns?.join('\n') ?? ''}
              onChange={(e) =>
                setConfig({
                  ...config,
                  upstream_dns: e.target.value.split('\n').filter((l) => l.trim()),
                })
              }
              className="w-full h-64 glass-input font-mono text-sm leading-relaxed p-6 focus:ring-2 focus:ring-indigo-500/20 border-white/10"
              placeholder="https://dns.cloudflare.com/dns-query&#10;8.8.8.8&#10;8.8.4.4"
            />

            <div className="flex flex-wrap gap-2 pt-2">
              {['Cloudflare (DoH)', 'Google (DoH)', 'Quad9 (DoH)'].map((preset) => (
                <button
                  key={preset}
                  onClick={() => {
                    const urls = {
                      'Cloudflare (DoH)': 'https://dns.cloudflare.com/dns-query',
                      'Google (DoH)': 'https://dns.google/dns-query',
                      'Quad9 (DoH)': 'https://dns.quad9.net/dns-query',
                    };
                    const url = urls[preset];
                    if (!(config.upstream_dns || []).includes(url)) {
                      setConfig({ ...config, upstream_dns: [...(config.upstream_dns || []), url] });
                    }
                  }}
                  className="px-3 py-1.5 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-[10px] font-bold text-indigo-400 hover:bg-indigo-500/20 transition-all"
                >
                  + {preset}
                </button>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'filters' && (
          <DnsRecordsTable
            filtering={filtering}
            handleRemoveFilter={handleRemoveFilter}
            handleAddFilter={handleAddFilter}
            newFilterName={newFilterName}
            newFilterUrl={newFilterUrl}
            setNewFilterName={setNewFilterName}
            setNewFilterUrl={setNewFilterUrl}
          />
        )}

        {activeTab === 'bootstrap' && (
          <div className="space-y-4">
            <h4 className="text-sm font-black uppercase tracking-tight">Bootstrap DNS</h4>
            <p className="text-xs text-slate-500 max-w-xl">
              Ces serveurs sont utilisés pour résoudre les noms d'hôtes des DNS amont (ex:
              dns.cloudflare.com).
            </p>
            <textarea
              value={config?.bootstrap_dns?.join('\n') ?? ''}
              onChange={(e) =>
                setConfig({
                  ...config,
                  bootstrap_dns: e.target.value.split('\n').filter((l) => l.trim()),
                })
              }
              className="w-full h-48 glass-input font-mono text-sm p-6 focus:ring-2 focus:ring-indigo-500/20 border-white/10"
            />
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {[
              {
                key: 'filtering_enabled',
                label: 'Filtrage AdGuard',
                desc: 'Active le blocage des publicités et du tracking.',
              },
              {
                key: 'safebrowsing_enabled',
                label: 'Navigation Sécurisée',
                desc: 'Bloque les sites malveillants et de phishing.',
              },
              {
                key: 'parental_enabled',
                label: 'Contrôle Parental',
                desc: 'Bloque le contenu réservé aux adultes.',
              },
              {
                key: 'safesearch_enabled',
                label: 'SafeSearch',
                desc: 'Force le mode sécurisé sur Google, YouTube, etc.',
              },
            ].map((item) => (
              <button
                key={item.key}
                onClick={() => setConfig({ ...config, [item.key]: !config[item.key] })}
                className={cn(
                  'flex items-center justify-between p-6 rounded-2xl border transition-all text-left group',
                  config?.[item.key]
                    ? 'bg-indigo-500/10 border-indigo-500/30 text-white'
                    : 'bg-white/5 border-white/5 text-slate-500 hover:border-white/10'
                )}
              >
                <div>
                  <div className="font-extrabold text-xs uppercase tracking-wider mb-1">
                    {item.label}
                  </div>
                  <div className="text-[10px] opacity-60 leading-relaxed">{item.desc}</div>
                </div>
                <div
                  className={cn(
                    'w-10 h-6 rounded-full relative transition-all duration-300',
                    config?.[item.key] ? 'bg-indigo-500' : 'bg-slate-700'
                  )}
                >
                  <div
                    className={cn(
                      'absolute top-1 w-4 h-4 rounded-full bg-white transition-all duration-300',
                      config?.[item.key] ? 'left-5' : 'left-1'
                    )}
                  />
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default DnsConfigForm;
