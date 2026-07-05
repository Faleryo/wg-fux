import React from 'react';
import { Globe, Shield, Server } from 'lucide-react';
import { cn, COLOR_MAP } from '../../../lib/utils';

const tabs = [
  { id: 'access', label: 'Accès Peers', icon: Globe },
  { id: 'security', label: 'Sécurité', icon: Shield },
  { id: 'system', label: 'Journal Système', icon: Server },
];

const LogTabs = ({ activeTab, onTabChange, isDark, theme, liveConnected }) => (
  <div className="flex gap-2 flex-wrap">
    {tabs.map((tab) => (
      <button
        key={tab.id}
        onClick={() => onTabChange(tab.id)}
        className={cn(
          'flex items-center gap-2 px-5 py-2.5 rounded-2xl font-black uppercase text-[11px] tracking-widest transition-all',
          activeTab === tab.id
            ? 'text-white shadow-lg'
            : cn(
                'transition-all border',
                isDark
                  ? 'text-slate-500 hover:text-white hover:bg-white/5 border-white/5'
                  : 'text-slate-500 hover:text-slate-900 hover:bg-white border-black/5 shadow-sm'
              )
        )}
        style={
          activeTab === tab.id
            ? {
                backgroundColor: COLOR_MAP[theme]?.[600] || '#4f46e5',
                boxShadow: `0 8px 32px -8px ${COLOR_MAP[theme]?.[600] || '#4f46e5'}33`,
              }
            : undefined
        }
      >
        <tab.icon size={14} /> {tab.label}
        {activeTab === tab.id &&
          (tab.id === 'security' || tab.id === 'system') &&
          liveConnected && (
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          )}
      </button>
    ))}
  </div>
);

export default LogTabs;
