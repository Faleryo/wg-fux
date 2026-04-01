import React, { useState, useMemo } from 'react';
import { 
  Server, Activity, Users, Wifi, Shield, ShieldCheck, 
  ArrowDown, ArrowUp, Cpu, Zap, HardDrive, Gauge, 
  RefreshCw, BarChart3, PieChart as PieIcon, AlertTriangle, ChevronRight
} from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';
import { cn, formatBytes } from '../../lib/utils';
import { StatBlock, CircularProgress } from '../dashboard/StatCards';
import { 
  ResponsiveContainer, PieChart, Pie, Cell, Tooltip
} from 'recharts';

import { motion } from 'framer-motion';
import GlassCard from '../ui/Card';
import VibeButton from '../ui/Button';
import { LiveTelemetryChart } from '../dashboard/LiveTelemetryChart';

const DashboardSection = ({ stats, trafficData, systemStats, clients, health, config, onRunSpeedtest, speedtest, sentinel, onNavigate }) => {

  const { theme } = useTheme();
  const cpu = systemStats?.cpu || 0;
  const ram = systemStats?.memory || 0;
  const disk = systemStats?.disk || 0;

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
    
  const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];

  const { topClient, topClientRate } = useMemo(() => {
    if (!clients || !Array.isArray(clients) || clients.length === 0) {
       return { topClient: { name: 'Aucun', downloadRate: 0, uploadRate: 0 }, topClientRate: 0 };
    }
    const top = clients.reduce((prev, current) => {
      const prevRate = (prev.downloadRate || 0) + (prev.uploadRate || 0);
      const currRate = (current.downloadRate || 0) + (current.uploadRate || 0);
      return currRate > prevRate ? current : prev;
    }, { name: 'Aucun', downloadRate: 0, uploadRate: 0 });
    const rate = (top.downloadRate || 0) + (top.uploadRate || 0);
    return { topClient: top, topClientRate: rate };
  }, [clients]);

  // ── Quota alert: peers with >80% quota usage ───────────────────────────────
  const quotaAlerts = useMemo(() => {
    if (!clients) return [];
    return clients
      .filter(c => c.quota > 0)
      .map(c => ({
        name: c.name,
        container: c.container,
        pct: Math.min(100, (c.usageTotal / (c.quota * 1024 * 1024 * 1024)) * 100)
      }))
      .filter(c => c.pct > 80)
      .sort((a, b) => b.pct - a.pct);
  }, [clients]);

  return (
    <div className="space-y-6 md:space-y-10 animate-in slide-in-from-bottom-10 duration-700">
      
      {/* ── Quota Alert Banner ──────────────────────────────────────────────── */}
      {quotaAlerts.length > 0 && (
        <div className="flex items-start gap-4 p-4 bg-rose-500/5 border border-rose-500/20 rounded-2xl animate-in slide-in-from-top-2 duration-500">
          <div className="p-2 rounded-xl bg-rose-500/10 text-rose-400 flex-shrink-0">
            <AlertTriangle size={18} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-black text-rose-400 uppercase tracking-widest mb-2">
              ⚠ {quotaAlerts.length} Peer{quotaAlerts.length > 1 ? 's' : ''} en Quota Critique
            </p>
            <div className="flex flex-wrap gap-2">
              {quotaAlerts.map(a => (
                <span key={a.name} className="inline-flex items-center gap-1.5 text-[9px] font-mono text-rose-300 bg-rose-500/10 px-2.5 py-1 rounded-lg border border-rose-500/20">
                  <span className={cn("w-1.5 h-1.5 rounded-full", a.pct >= 100 ? 'bg-red-500' : 'bg-rose-400')} />
                  {a.name} — {a.pct.toFixed(0)}%
                </span>
              ))}
            </div>
          </div>
          {onNavigate && (
            <button onClick={() => onNavigate('containers')} className="flex items-center gap-1 text-[10px] font-black text-rose-400 hover:text-rose-300 uppercase tracking-widest flex-shrink-0 transition-colors">
              Gérer <ChevronRight size={12} />
            </button>
          )}
        </div>
      )}

      {/* === ROW 1: Hero Banner + Right Stats ===
          Wrapper divs carry the col-span classes so the grid works correctly
          (GlassCard's motion.div wrapper cannot have col-span) */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        
        {/* Hero Card — xl:col-span-8 */}
        <div className="xl:col-span-8">
          <GlassCard className="p-6 md:p-10 flex flex-col justify-between group min-h-[320px]">
            {/* Decorative server icon — pointer-events-none always */}
            <div className="absolute -right-10 -bottom-10 pointer-events-none">
              <Server className="text-white/[0.015] w-[200px] h-[200px] md:w-[300px] md:h-[300px] group-hover:scale-110 group-hover:rotate-6 transition-transform duration-1000 ease-in-out" />
            </div>

            <div className="space-y-6 md:space-y-10">
              <div className="flex items-start justify-between flex-wrap gap-4">
                <div>
                  <div className="flex items-center gap-3 mb-2">
                    <Shield className={cn("fill-current opacity-80", `text-${theme}-500`)} size={28} />
                    <h2 className="text-2xl md:text-4xl font-black text-white tracking-widest italic uppercase">Protocole Actif</h2>
                  </div>
                  <p className="text-slate-500 font-mono text-[10px] tracking-[0.3em] uppercase opacity-60">System Security Integrated: 100% Integrity</p>
                </div>
                <div className={cn(
                  "px-4 py-2 rounded-full text-[10px] font-black tracking-[0.2em] border whitespace-nowrap",
                  health.status === 'healthy' 
                    ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400 animate-pulse' 
                    : 'bg-amber-500/10 border-amber-500/20 text-amber-400'
                )}>
                  {health.status === 'healthy' ? 'OPERATIONAL' : 'CHECKING'}
                </div>
              </div>

              {/* Stat grid */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-8">
                <StatBlock label="Peers Actifs" value={stats.connectedClients ?? 0} sub="CONNECTÉS" icon={Users} delay={0} />
                <StatBlock label="MTU Tunnel" value={config?.mtu || '1420'} icon={Activity} delay={0.1} />
                <StatBlock label="Port Liaison" value={config?.port || '51820'} icon={Wifi} delay={0.2} />
                <StatBlock label="Health Shield" 
                  value={health.status === 'healthy' ? 'Optimal' : 'Checking'} 
                  sub={health.status === 'healthy' ? 'STABLE' : 'PENDING'} 
                  icon={ShieldCheck} 
                  delay={0.3}
                />
              </div>

              {/* Traffic RX/TX */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="bg-slate-950/40 backdrop-blur-3xl p-5 md:p-8 rounded-[1.5rem] border border-white/5 flex items-center justify-between group/rx hover:border-emerald-500/20 transition-all duration-500">
                  <div>
                    <p className="text-[10px] font-black text-emerald-500/70 uppercase tracking-widest mb-1">Total Download (RX)</p>
                    <p className="text-2xl md:text-4xl font-mono font-black text-white tracking-tighter">{stats?.totalDownload || '0 B'}</p>
                  </div>
                  <div className="p-3 md:p-4 rounded-2xl bg-emerald-500/10 text-emerald-500 group-hover/rx:scale-110 group-hover/rx:rotate-12 transition-transform shadow-2xl">
                    <ArrowDown size={24} />
                  </div>
                </div>
                <div className="bg-slate-950/40 backdrop-blur-3xl p-5 md:p-8 rounded-[1.5rem] border border-white/5 flex items-center justify-between group/tx hover:border-indigo-500/20 transition-all duration-500">
                  <div>
                    <p className="text-[10px] font-black text-indigo-500/70 uppercase tracking-widest mb-1">Total Upload (TX)</p>
                    <p className="text-2xl md:text-4xl font-mono font-black text-white tracking-tighter">{stats?.totalUpload || '0 B'}</p>
                  </div>
                  <div className="p-3 md:p-4 rounded-2xl bg-indigo-500/10 text-indigo-500 group-hover/tx:scale-110 group-hover/tx:rotate-12 transition-transform shadow-2xl">
                    <ArrowUp size={24} />
                  </div>
                </div>
              </div>
            </div>
          </GlassCard>
        </div>

        {/* Right sidebar cards — xl:col-span-4 */}
        <div className="xl:col-span-4 flex flex-col gap-6">
          {/* Sentinel */}
          <GlassCard className="p-6 flex items-center justify-between group bg-gradient-to-br from-emerald-500/10 to-teal-950/20 border-emerald-500/20">
            <div className="min-w-0">
              <div className="flex items-center gap-2 mb-2">
                <div className={cn("h-1.5 w-1.5 rounded-full animate-pulse flex-shrink-0", sentinel?.status === 'healthy' ? "bg-emerald-500 shadow-[0_0_10px_#10b981]" : "bg-red-500")} />
                <p className="text-[10px] font-black text-emerald-500/80 uppercase tracking-widest truncate">Sentinel Watchdog V2</p>
              </div>
              <h4 className="text-lg md:text-xl font-black text-white italic tracking-tight uppercase">
                {sentinel?.status === 'healthy' ? 'Secured' : (sentinel?.status === 'error' ? 'Offline' : 'Searching')}
              </h4>
              <p className="text-[9px] font-mono font-bold text-slate-500 mt-1 uppercase tracking-tight truncate">
                Last Pulse: {sentinel?.lastHeartbeat ? new Date(sentinel.lastHeartbeat).toLocaleTimeString() : 'Await Heartbeat'}
              </p>
            </div>
            <div className="p-3 md:p-4 rounded-2xl bg-emerald-500/10 text-emerald-500 shadow-2xl group-hover:scale-110 transition-transform flex-shrink-0 ml-4">
              <ShieldCheck size={24} />
            </div>
          </GlassCard>

          {/* Core Resources */}
          <GlassCard className="flex-1 p-6 md:p-8 flex flex-col justify-center gap-6 group" hover={true}>
            <div className="absolute top-0 left-0 p-8 opacity-[0.02] text-white pointer-events-none">
              <Activity size={100} />
            </div>
            <h3 className="text-lg font-black text-white flex items-center gap-3 italic uppercase tracking-tighter">
              <Cpu className={cn(`text-${theme}-400`)} size={18} /> Core Resources
            </h3>
            <div className="flex justify-around items-center py-2">
              <CircularProgress label="CPU" value={cpu} color="text-indigo-500" icon={Cpu} />
              <CircularProgress label="RAM" value={ram} color="text-purple-500" icon={Zap} />
              <CircularProgress label="DISK" value={disk} color="text-emerald-500" icon={HardDrive} />
            </div>
          </GlassCard>

          {/* Top Client */}
          <GlassCard className="p-5 md:p-6 flex items-center gap-4 group bg-gradient-to-br from-slate-900/60 to-indigo-900/20">
            <div className={cn("p-3 rounded-2xl bg-white/5 shadow-2xl transition-all duration-500 group-hover:scale-110 group-hover:rotate-3 flex-shrink-0", topClientRate > 0 ? `text-${theme}-400` : "text-slate-600")}>
              <Activity size={22} className={topClientRate > 0 ? "animate-[pulse_1s_infinite]" : ""} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">Top Active Client</p>
              <h4 className="text-base md:text-lg font-black text-white truncate italic tracking-tight">{topClient.name || 'Station Inactive'}</h4>
              <p className={cn("text-xs font-mono font-bold mt-0.5", `text-${theme}-400`)}>{formatBytes(topClientRate)}/s Burst</p>
            </div>
          </GlassCard>
        </div>
      </div>

      {/* === ROW 2: Telemetry + Pie + Speedtest === */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Telemetry — xl:col-span-2 */}
        <div className="xl:col-span-2">
          <LiveTelemetryChart />
        </div>

        {/* Pie + Speedtest */}
        <div className="flex flex-col gap-6">
          {/* Traffic Répartition */}
          <GlassCard className="p-6 group flex-1" hover={true}>
            <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-[0.25em] mb-4 flex items-center gap-3">
              <PieIcon size={13} className={cn(`text-${theme}-400`)} /> Répartition Tactique
            </h3>
            <div className="h-44 w-full">
              {pieData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie 
                      data={pieData} 
                      cx="50%" cy="50%" 
                      innerRadius={50} outerRadius={70} 
                      paddingAngle={6} dataKey="value" stroke="none"
                    >
                      {pieData.map((e, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Pie>
                    <Tooltip 
                      formatter={(v) => formatBytes(v)}
                      contentStyle={{ backgroundColor: '#020617', border: 'none', borderRadius: '1rem', color: '#fff', fontSize: '11px' }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-slate-600 opacity-40 italic gap-3">
                  <PieIcon size={28} />
                  <span className="text-[10px] font-black uppercase tracking-widest">Aucun flux détecté</span>
                </div>
              )}
            </div>
          </GlassCard>

          {/* Speedtest */}
          <GlassCard className="p-6 group flex-1" hover={true}>
            <div className="absolute top-0 right-0 p-6 opacity-[0.02] text-white pointer-events-none">
              <Gauge size={80} />
            </div>
            <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-[0.25em] mb-5">System Speedtest</h3>
            
            {speedtest?.loading ? (
              <div className="flex flex-col items-center justify-center py-4 gap-3">
                <RefreshCw size={36} className={cn("animate-spin", `text-${theme}-600`)} />
                <p className="text-[10px] font-black text-white animate-pulse uppercase tracking-[0.3em]">Test en cours...</p>
              </div>
            ) : speedtest?.data ? (
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-emerald-400">
                    <ArrowDown size={13} /> <span className="text-[9px] font-black uppercase">Down</span>
                  </div>
                  <div className="text-2xl md:text-3xl font-mono font-black text-white">{(speedtest.data.download / 1000000).toFixed(0)}</div>
                  <div className="text-[9px] text-slate-500 font-bold uppercase">Mbps</div>
                </div>
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-indigo-400">
                    <ArrowUp size={13} /> <span className="text-[9px] font-black uppercase">Up</span>
                  </div>
                  <div className="text-2xl md:text-3xl font-mono font-black text-white">{(speedtest.data.upload / 1000000).toFixed(0)}</div>
                  <div className="text-[9px] text-slate-500 font-bold uppercase">Mbps</div>
                </div>
                <div className="col-span-2 pt-3 border-t border-white/5 flex justify-between items-center">
                  <span className="text-[10px] font-mono text-slate-500 uppercase">Ping: {speedtest.data?.ping ? `${speedtest.data.ping.toFixed(0)}ms` : 'N/A'}</span>
                  <VibeButton variant="ghost" size="sm" onClick={onRunSpeedtest} className="text-indigo-400 text-[10px]">Relancer</VibeButton>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-4 gap-4">
                <div className="text-3xl font-black text-white/10 italic">--Mbps</div>
                <VibeButton 
                  variant="primary" 
                  onClick={onRunSpeedtest}
                  className="w-full"
                >
                  Lancer Test de Flux
                </VibeButton>
              </div>
            )}
          </GlassCard>
        </div>
      </div>
    </div>
  );
};

export default DashboardSection;
