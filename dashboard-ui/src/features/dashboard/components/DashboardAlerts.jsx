import React from 'react';
import { AlertTriangle, ChevronRight } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { useLang } from '../../../context/LanguageContext';

const DashboardAlerts = ({ clients, onNavigate }) => {
  const { t } = useLang();
  const quotaAlerts = React.useMemo(() => {
    if (!clients) return [];
    return clients
      .filter((c) => c.quota > 0)
      .map((c) => ({
        name: c.name,
        container: c.container,
        pct: Math.min(100, ((c.usageTotal || 0) / (c.quota * 1024 * 1024 * 1024)) * 100),
      }))
      .filter((c) => c.pct > 80)
      .sort((a, b) => b.pct - a.pct);
  }, [clients]);

  if (quotaAlerts.length === 0) return null;

  return (
    <div className="flex items-start gap-4 p-4 bg-rose-500/5 border border-rose-500/20 rounded-2xl animate-in slide-in-from-top-2 duration-500">
      <div className="p-2 rounded-xl bg-rose-500/10 text-rose-400 flex-shrink-0">
        <AlertTriangle size={18} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[11px] font-black text-rose-400 uppercase tracking-widest mb-2">
          ⚠ {quotaAlerts.length} Peer{quotaAlerts.length > 1 ? 's' : ''} {t('quota_critical_suffix')}
        </p>
        <div className="flex flex-wrap gap-2">
          {quotaAlerts.map((a) => (
            <span
              key={a.name}
              className="inline-flex items-center gap-1.5 text-[11px] font-mono text-rose-300 bg-rose-500/10 px-2.5 py-1 rounded-lg border border-rose-500/20"
            >
              <span
                className={cn(
                  'w-1.5 h-1.5 rounded-full',
                  a.pct >= 100 ? 'bg-red-500' : 'bg-rose-400'
                )}
              />
              {a.name} — {a.pct.toFixed(0)}%
            </span>
          ))}
        </div>
      </div>
      {onNavigate && (
        <button
          onClick={() => onNavigate('containers')}
          className="flex items-center gap-1 text-[11px] font-black text-rose-400 hover:text-rose-300 uppercase tracking-widest flex-shrink-0 transition-colors"
        >
          {t('manage')} <ChevronRight size={12} />
        </button>
      )}
    </div>
  );
};

export default DashboardAlerts;
