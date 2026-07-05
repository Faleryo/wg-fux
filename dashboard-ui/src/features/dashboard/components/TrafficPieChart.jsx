import React, { useMemo } from 'react';
import { PieChart as PieIcon } from 'lucide-react';
import { useTheme } from '../../../context/ThemeContext';
import { cn, formatBytes, COLOR_MAP } from '../../../lib/utils';
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from 'recharts';
import GlassCard from '../../../components/ui/Card';

const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];

const TrafficPieChart = ({ clients }) => {
  const { theme } = useTheme();

  const pieData = useMemo(() => {
    if (!clients || !Array.isArray(clients)) return [];
    const containerTraffic = clients.reduce((acc, client) => {
      const container = client.container || 'Défaut';
      const total = (client.downloadBytes || 0) + (client.uploadBytes || 0);
      if (total > 0) {
        if (!acc[container]) acc[container] = 0;
        acc[container] += total;
      }
      return acc;
    }, {});
    return Object.entries(containerTraffic)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [clients]);

  return (
    <GlassCard className="p-6 group flex-1" hover={true}>
      <h3 className="text-[11px] font-black text-slate-500 uppercase tracking-[0.25em] mb-4 flex items-center gap-3">
        <PieIcon size={13} style={{ color: COLOR_MAP[theme]?.[400] || '#818cf8' }} /> Répartition
        Tactique
      </h3>
      <div className="h-44 w-full">
        {pieData.length > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={pieData}
                cx="50%"
                cy="50%"
                innerRadius={50}
                outerRadius={70}
                paddingAngle={6}
                dataKey="value"
                stroke="none"
              >
                {pieData.map((e, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip
                formatter={(v) => formatBytes(v)}
                contentStyle={{
                  backgroundColor: '#020617',
                  border: 'none',
                  borderRadius: '1rem',
                  color: '#fff',
                  fontSize: '11px',
                }}
              />
            </PieChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-slate-600 opacity-40 italic gap-3">
            <PieIcon size={28} />
            <span className="text-[11px] font-black uppercase tracking-widest">
              Aucun flux détecté
            </span>
          </div>
        )}
      </div>
    </GlassCard>
  );
};

export default TrafficPieChart;
