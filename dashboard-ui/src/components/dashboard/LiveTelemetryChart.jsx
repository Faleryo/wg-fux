import React, { useState, useEffect } from 'react';
import { 
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ReferenceArea
} from 'recharts';
import { useTheme } from '../../context/ThemeContext';
import { axiosInstance as axios } from '../../lib/api';
import { motion } from 'framer-motion';
import { Activity, Download, Upload, Zap } from 'lucide-react';
import { cn } from '../../lib/utils';

export const LiveTelemetryChart = () => {
    const { theme } = useTheme();
    const [data, setData] = useState([]);
    const [loading, setLoading] = useState(true);

    const fetchData = async () => {
        try {
            const res = await axios.get('/system/traffic-history');
            const formatted = res.data.map(h => ({
                name: h.time.split('T')[1]?.slice(0, 5) || h.time,
                down: h.rx / (1024 * 1024), // MB
                up: h.tx / (1024 * 1024)     // MB
            }));
            setData(formatted);
            setLoading(false);
        } catch (e) {
            console.error('Failed to fetch telemetry:', e);
        }
    };

    useEffect(() => {
        fetchData();
        const interval = setInterval(fetchData, 60000); // Check every minute
        return () => clearInterval(interval);
    }, []);

    const CustomTooltip = ({ active, payload, label }) => {
        if (active && payload && payload.length) {
            return (
                <div className="bg-slate-900/90 backdrop-blur-2xl border border-white/10 p-4 rounded-2xl shadow-2xl">
                    <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2 border-b border-white/5 pb-2">
                        {label} - LIVE TELEMETRY
                    </p>
                    <div className="space-y-1">
                        <div className="flex items-center justify-between gap-8">
                            <span className="text-xs text-indigo-400 font-bold flex items-center gap-1">
                                <Download size={10} /> DOWNLOAD
                            </span>
                            <span className="text-sm font-black text-white font-mono">{(payload[0]?.value ?? 0).toFixed(2)} MB</span>
                        </div>
                        <div className="flex items-center justify-between gap-8">
                            <span className="text-xs text-rose-400 font-bold flex items-center gap-1">
                                <Upload size={10} /> UPLOAD
                            </span>
                            <span className="text-sm font-black text-white font-mono">{(payload[1]?.value ?? 0).toFixed(2)} MB</span>
                        </div>
                    </div>
                </div>
            );
        }
        return null;
    };


    if (loading) return (
        <div className="h-80 w-full flex items-center justify-center bg-slate-900/20 rounded-3xl animate-pulse">
            <Zap className="text-slate-700 animate-bounce" size={32} />
        </div>
    );

    return (
        <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-slate-900/40 backdrop-blur-2xl border border-white/5 rounded-3xl p-8 relative overflow-hidden group"
        >
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-indigo-500/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-1000"></div>
            
            <div className="flex items-center justify-between mb-8">
                <div>
                  <h3 className="text-xs font-black text-slate-500 uppercase tracking-[0.3em] mb-1">Système SENTINEL</h3>
                  <h2 className="text-2xl font-black text-white tracking-tighter flex items-center gap-2">
                    Télémétrie Live <span className="h-2 w-2 rounded-full bg-indigo-500 animate-ping"></span>
                  </h2>
                </div>
                <div className="flex gap-2">
                   <div className="flex items-center gap-2 bg-indigo-500/10 border border-indigo-500/20 px-3 py-1.5 rounded-full">
                      <Download size={12} className="text-indigo-400" />
                      <span className="text-[10px] font-black text-indigo-100">DOWNLOAD</span>
                   </div>
                   <div className="flex items-center gap-2 bg-rose-500/10 border border-rose-500/20 px-3 py-1.5 rounded-full">
                      <Upload size={12} className="text-rose-400" />
                      <span className="text-[10px] font-black text-rose-100">UPLOAD</span>
                   </div>
                </div>
            </div>

            <div className="h-72 w-full relative">
                {data.length === 0 ? (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/[0.02] rounded-3xl border border-dashed border-white/5">
                        <Activity size={48} className="text-slate-800 mb-4" />
                        <p className="text-[10px] font-black text-slate-600 uppercase tracking-[0.3em]">Initialisation des flux Sentinel...</p>
                        <p className="text-[8px] font-bold text-slate-700 uppercase tracking-widest mt-2">(Données disponibles après le premier cycle d'audit)</p>
                    </div>
                ) : (
                    <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={data}>
                            <defs>
                                <linearGradient id="colorDown" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.4}/>
                                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
                                </linearGradient>
                                <linearGradient id="colorUp" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.4}/>
                                    <stop offset="95%" stopColor="#f43f5e" stopOpacity={0}/>
                                </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.03)" />
                            <XAxis 
                                dataKey="name" 
                                axisLine={false} 
                                tickLine={false} 
                                tick={{ fill: '#475569', fontSize: 10, fontWeight: 900 }} 
                            />
                            <YAxis 
                                axisLine={false} 
                                tickLine={false} 
                                tick={{ fill: '#475569', fontSize: 10, fontWeight: 900 }}
                                tickFormatter={(value) => `${value}MB`}
                            />
                            <Tooltip content={<CustomTooltip />} />
                            <Area 
                                type="monotone" 
                                dataKey="down" 
                                stroke="#6366f1" 
                                strokeWidth={3}
                                fillOpacity={1} 
                                fill="url(#colorDown)" 
                                animationDuration={2000}
                                isAnimationActive={true}
                            />
                            <Area 
                                type="monotone" 
                                dataKey="up" 
                                stroke="#f43f5e" 
                                strokeWidth={3}
                                fillOpacity={1} 
                                fill="url(#colorUp)" 
                                animationDuration={2000}
                                isAnimationActive={true}
                            />
                        </AreaChart>
                    </ResponsiveContainer>
                )}
            </div>
            
            <div className="mt-6 pt-6 border-t border-white/5 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <Activity size={18} className="text-indigo-500 animate-pulse" />
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Mise à jour en temps réel via Drizzle/SQLite</span>
                </div>
                <div className="flex items-center gap-2 px-4 py-2 bg-white/5 rounded-xl border border-white/5">
                    <span className="text-[10px] font-black text-slate-400">STATUS:</span>
                    <span className="text-[10px] font-black text-emerald-500 tracking-widest">OPTIMAL</span>
                </div>
            </div>
        </motion.div>
    );
};
