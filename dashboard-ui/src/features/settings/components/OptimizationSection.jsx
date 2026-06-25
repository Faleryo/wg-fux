import React, { useState, useEffect } from 'react';
import {
  Gauge,
  Gamepad2,
  Film,
  BarChart3,
} from 'lucide-react';
import { useTheme } from '../../../context/ThemeContext';
import { useToast } from '../../../context/ToastContext';
import { cn } from '../../../lib/utils';
import { axiosInstance } from '../../../lib/api';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import OptimizationSummary from './OptimizationSummary';
import OptimizationCard from './OptimizationCard';
import OptimizationActions from './OptimizationActions';

const OptimizationSection = ({ systemStats }) => {
  const { theme, isDark } = useTheme();
  const { addToast } = useToast();
  const [loading, setLoading] = useState(false);
  const [currentProfile, setCurrentProfile] = useState('');
  const [cpuHistory, setCpuHistory] = useState([]);
  const [isEnabled, setIsEnabled] = useState(false);
  const [telemetry, setTelemetry] = useState({ jitter: '...', mtu: '...', bufferbloat: '...' });

  useEffect(() => {
    fetchActiveProfile();

    // Télémétrie — polling 5s (réduit de 1Hz pour éviter la surcharge VPS en production)
    const telInterval = setInterval(fetchTelemetry, 5000);
    fetchTelemetry(); // Premier fetch immédiat
    return () => clearInterval(telInterval);
  }, []);

  const fetchActiveProfile = async () => {
    try {
      const res = await axiosInstance.get('/system/optimize');
      const profile = res.data.profile;
      setCurrentProfile(profile);
      // SRE Logic: Only enable toggle if a real optimization is active
      setIsEnabled(profile !== 'default' && profile !== 'restore' && profile !== 'disable');
    } catch {
      /* Default to none */
    }
  };

  const fetchTelemetry = async () => {
    try {
      const res = await axiosInstance.get('/system/telemetry');
      setTelemetry(res.data);
      // Synchronisation du graphe avec la télémétrie (fluidité accrue)
      const now = new Date().toLocaleTimeString('fr-FR', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
      setCpuHistory((prev) => [
        ...prev.slice(-29),
        { time: now, value: parseFloat(res.data.cpu) || 0 },
      ]);
    } catch {
      /* Fail silently */
    }
  };

  const handleToggleSync = async () => {
    const nextState = !isEnabled;
    setIsEnabled(nextState);
    setLoading(true);
    try {
      const targetProfile = nextState ? currentProfile || 'gaming' : 'restore';
      await axiosInstance.post('/system/optimize', { profile: targetProfile });
      if (!nextState) setCurrentProfile('restore');
      addToast(
        nextState
          ? `Optimisation réactivée (${targetProfile})`
          : 'Optimisations système désactivées (Tunnel préservé)',
        'success'
      );
    } catch {
      setIsEnabled(!nextState);
      addToast('Échec du basculement SRE', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleOptimize = async (profile) => {
    if (!isEnabled) return;
    setLoading(true);
    try {
      await axiosInstance.post('/system/optimize', { profile });
      setCurrentProfile(profile);
      addToast(`Profil ${profile.toUpperCase()} activé avec succès`, 'success');
    } catch (e) {
      addToast('Échec de la synchronisation neurale', 'error');
    } finally {
      setLoading(false);
    }
  };

  const profiles = [
    {
      id: 'gaming',
      label: 'E-Sport / Gaming',
      desc: 'Latency Zero. BBR v2 + CAKE + UDP Buffer Tuning.',
      icon: Gamepad2,
      color: 'indigo',
    },
    {
      id: 'streaming',
      label: 'Ultra-HD Stream',
      desc: 'Throughput maximal. Optimisation BBR & MTU 1280.',
      icon: Film,
      color: 'rose',
    },
    {
      id: 'auto',
      label: 'Smart Engine',
      desc: 'Analyse heuristique & ajustement dynamique du MTU.',
      icon: Gauge,
      color: 'emerald',
    },
  ];

  return (
    <div className="space-y-10 animate-in fade-in slide-in-from-bottom-5 duration-700">
      <OptimizationSummary isEnabled={isEnabled} handleToggleSync={handleToggleSync} />

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
        <div className="xl:col-span-2 space-y-8">
          <div
            className={cn(
              'rounded-[3rem] border p-8 shadow-2xl h-80 relative overflow-hidden group transition-all',
              isDark
                ? 'bg-slate-900/40 border-white/10 backdrop-blur-3xl'
                : 'bg-white border-black/5',
              !isEnabled && 'opacity-40 grayscale'
            )}
          >
            <div className="flex justify-between items-center mb-8">
              <h3
                className={cn(
                  'text-lg font-black uppercase tracking-tighter flex items-center gap-3 transition-colors',
                  isDark ? 'text-white' : 'text-slate-900'
                )}
              >
                <BarChart3 className={cn(`text-indigo-400`)} /> Kernel Load Variance
              </h3>
              <div className="flex items-center gap-2">
                <div
                  className={cn(
                    'w-1.5 h-1.5 rounded-full border',
                    isEnabled
                      ? 'bg-emerald-500 animate-pulse border-emerald-400'
                      : 'bg-slate-500 border-slate-400'
                  )}
                />
                <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest uppercase tracking-widest">
                  Real-time Spectrum
                </span>
              </div>
            </div>
            <div className="h-48 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={cpuHistory}>
                  <defs>
                    <linearGradient id="colorCpu" x1="0" y1="0" x2="0" y2="1">
                      <stop
                        offset="5%"
                        stopColor={theme === 'rose' ? '#f43f5e' : '#6366f1'}
                        stopOpacity={0.3}
                      />
                      <stop
                        offset="95%"
                        stopColor={theme === 'rose' ? '#f43f5e' : '#6366f1'}
                        stopOpacity={0}
                      />
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke={isDark ? '#1e293b' : '#e2e8f0'}
                    vertical={false}
                  />
                  <XAxis dataKey="time" hide />
                  <YAxis hide domain={[0, 100]} />
                  <Tooltip
                    contentStyle={
                      isDark
                        ? {
                            backgroundColor: '#020617',
                            border: '1px solid #1e293b',
                            borderRadius: '1rem shadow-2xl',
                          }
                        : {
                            backgroundColor: '#fff',
                            border: '1px solid #e2e8f0',
                            borderRadius: '1rem',
                            boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)',
                          }
                    }
                    itemStyle={{
                      color: isDark ? '#fff' : '#0f172a',
                      fontSize: '12px',
                      fontFamily: 'monospace',
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="value"
                    stroke={theme === 'rose' ? '#fb7185' : '#818cf8'}
                    strokeWidth={4}
                    fillOpacity={1}
                    fill="url(#colorCpu)"
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div
            className={cn(
              'grid grid-cols-1 md:grid-cols-3 gap-6 transition-all',
              !isEnabled && 'opacity-40 pointer-events-none'
            )}
          >
            {profiles.map((profile) => (
              <OptimizationCard
                key={profile.id}
                profile={profile}
                currentProfile={currentProfile}
                loading={loading}
                onOptimize={handleOptimize}
              />
            ))}
          </div>
        </div>

        <OptimizationActions telemetry={telemetry} isEnabled={isEnabled} />
      </div>
    </div>
  );
};

export default OptimizationSection;
