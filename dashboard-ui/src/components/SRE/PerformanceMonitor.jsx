import React, { useState, useEffect } from 'react';
import { axiosInstance } from '../../lib/api';
import GlassCard from '../ui/Card';
import { useLang } from '../../context/LanguageContext';

const PerformanceMonitor = () => {
  const { t } = useLang();
  const [metrics, setMetrics] = useState(null);
  const [error, setError] = useState(false);

  const fetchMetrics = async () => {
    try {
      const response = await axiosInstance.get('/system/telemetry');
      setMetrics(response.data);
      setError(false);
    } catch (e) {
      console.error(t('perf_fetch_error'), e);
      setError(true);
    }
  };

  useEffect(() => {
    fetchMetrics();
    const timer = setInterval(fetchMetrics, 5000);
    return () => clearInterval(timer);
  }, []);

  if (!metrics) return null;

  const p95 = metrics.p95 || 0;
  const statusColor = p95 < 100 ? 'text-green-400' : p95 < 500 ? 'text-yellow-400' : 'text-red-500';
  const statusLabel =
    p95 < 100 ? t('perf_optimal') : p95 < 500 ? t('perf_nominal') : t('perf_congested');

  return (
    <GlassCard className="p-4 flex flex-col gap-2 min-w-[200px]">
      <div className="flex justify-between items-center">
        <span className="text-zinc-400 text-xs font-medium uppercase tracking-wider">
          Performance SRE
        </span>
        <span
          className={`text-[11px] px-1.5 py-0.5 rounded-full border ${p95 < 500 ? 'bg-green-500/10 border-green-500/20 text-green-400' : 'bg-red-500/10 border-red-500/20 text-red-400'}`}
        >
          {statusLabel}
        </span>
      </div>

      <div className="flex items-baseline gap-1">
        <span className={`text-2xl font-bold font-mono ${statusColor}`}>{p95}</span>
        <span className="text-zinc-500 text-sm">ms</span>
        <span className="text-zinc-400 text-xs ml-auto">(p95 latence)</span>
      </div>

      <div className="grid grid-cols-3 gap-2 mt-2 pt-2 border-t border-white/5 text-[11px]">
        <div className="flex flex-col">
          <span className="text-zinc-500">{t('perf_jitter')}</span>
          <span className="text-zinc-300 font-mono">{metrics.jitter}ms</span>
        </div>
        <div className="flex flex-col">
          <span className="text-zinc-500">{t('perf_load')}</span>
          <span className="text-zinc-300 font-mono">{metrics.load_avg}</span>
        </div>
        <div className="flex flex-col">
          <span className="text-zinc-500">{t('perf_bloat')}</span>
          <span
            className={`font-bold ${metrics.bufferbloat === 'A+' ? 'text-green-400' : 'text-yellow-400'}`}
          >
            {metrics.bufferbloat}
          </span>
        </div>
      </div>

      {error && (
        <span className="text-[11px] text-red-400 animate-pulse">{t('perf_conn_error')}</span>
      )}
    </GlassCard>
  );
};

export default PerformanceMonitor;
