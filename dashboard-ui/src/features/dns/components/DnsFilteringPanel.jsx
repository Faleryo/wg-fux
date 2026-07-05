import React from 'react';
import { Activity, Shield, Zap, CheckCircle2 } from 'lucide-react';

const DnsFilteringPanel = ({ stats, status }) => {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {[
        {
          label: 'Requêtes',
          value: stats?.num_dns_queries || 0,
          icon: <Activity className="text-indigo-500" />,
          sub: 'Dernières 24h',
        },
        {
          label: 'Bloqués',
          value: stats?.num_blocked_filtering || 0,
          icon: <Shield className="text-rose-500" />,
          sub: `${stats?.num_dns_queries ? (((stats.num_blocked_filtering || 0) / stats.num_dns_queries) * 100).toFixed(1) : 0}%`,
        },
        {
          label: 'Latence',
          value: `${stats?.avg_processing_time || 0}ms`,
          icon: <Zap className="text-amber-500" />,
          sub: 'Moyenne',
        },
        {
          label: 'Statut',
          value: status?.version?.split(' ')[0] || 'Actif',
          icon: <CheckCircle2 className="text-emerald-500" />,
          sub: 'DNS Engine',
        },
      ].map((stat, i) => (
        <div
          key={i}
          className="glass-card p-5 border border-white/5 relative overflow-hidden group"
        >
          <div className="absolute -right-4 -bottom-4 opacity-[0.03] group-hover:scale-110 transition-transform duration-700 pointer-events-none">
            {React.cloneElement(stat.icon, { size: 80 })}
          </div>
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 rounded-xl bg-white/5 border border-white/5">{stat.icon}</div>
            <span className="text-[11px] font-black text-slate-500 uppercase tracking-widest">
              {stat.label}
            </span>
          </div>
          <div className="text-xl font-black font-mono tracking-tighter mb-1">{stat.value}</div>
          <div className="text-[11px] font-bold text-slate-500 uppercase opacity-60">
            {stat.sub}
          </div>
        </div>
      ))}
    </div>
  );
};

export default DnsFilteringPanel;
