import React, { useState, useEffect } from 'react';
import { 
  Globe, Zap, Shield, Search, Save, RefreshCw, 
  Settings2, Activity, CheckCircle2, AlertCircle 
} from 'lucide-react';
import { motion } from 'framer-motion';
import { axiosInstance } from '../../../lib/api';
import { useToast } from '../../../context/ToastContext';
import { useTheme } from '../../../context/ThemeContext';
import { cn } from '../../../lib/utils';

const DnsEditor = () => {
    const { mode } = useTheme();
    const isDark = mode === 'dark';
    const { addToast } = useToast();
    
    const [config, setConfig] = useState(null);
    const [stats, setStats] = useState(null);
    const [status, setStatus] = useState(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [activeTab, setActiveTab] = useState('upstream');

    const fetchData = async () => {
        setLoading(true);
        try {
            const [configRes, statsRes, statusRes] = await Promise.all([
                axiosInstance.get('/dns/config'),
                axiosInstance.get('/dns/stats'),
                axiosInstance.get('/dns/status')
            ]);
            setConfig(configRes.data);
            setStats(statsRes.data);
            setStatus(statusRes.data);
        } catch (error) {
            addToast('Impossible de charger les données AdGuard Home', 'error');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
        const interval = setInterval(async () => {
            try {
                const statsRes = await axiosInstance.get('/dns/stats');
                setStats(statsRes.data);
            } catch (e) {}
        }, 10000);
        return () => clearInterval(interval);
    }, []);

    const handleSave = async () => {
        setSaving(true);
        try {
            await axiosInstance.post('/dns/config', config);
            addToast('Configuration DNS mise à jour avec succès', 'success');
        } catch (error) {
            addToast('Erreur lors de la sauvegarde de la configuration', 'error');
        } finally {
            setSaving(false);
        }
    };

    if (loading && !config) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
                <RefreshCw className="animate-spin text-indigo-500" size={32} />
                <p className="text-sm font-bold text-slate-500 uppercase tracking-widest">Initialisation DNS...</p>
            </div>
        );
    }

    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
            {/* ── Header ─────────────────────────────────────────────────── */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                <div>
                    <h2 className={cn("text-3xl font-black italic tracking-tighter transition-colors duration-500", isDark ? "text-white" : "text-slate-900")}>
                        DNS COMMAND CENTER
                    </h2>
                    <div className="flex items-center gap-2 mt-1">
                        <span className="relative flex h-2 w-2">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                        </span>
                        <p className={cn("text-[10px] font-extrabold tracking-[0.2em] uppercase opacity-70", isDark ? "text-white" : "text-slate-500")}>
                            ADGUARD ENGINE ACTIVE
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    <button 
                        onClick={fetchData}
                        className={cn("p-3 rounded-2xl border transition-all hover:scale-105 active:scale-95", isDark ? "bg-white/5 border-white/10 text-slate-400" : "bg-black/5 border-slate-200 text-slate-500")}
                    >
                        <RefreshCw size={18} className={cn(loading && "animate-spin")} />
                    </button>
                    <button 
                        onClick={handleSave}
                        disabled={saving}
                        className="flex items-center gap-2 px-6 py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-2xl font-bold text-xs uppercase tracking-widest shadow-lg shadow-indigo-600/20 transition-all hover:scale-105 active:scale-95 disabled:opacity-50"
                    >
                        {saving ? <RefreshCw className="animate-spin" size={16} /> : <Save size={16} />}
                        {saving ? 'Déploiement...' : 'Appliquer'}
                    </button>
                </div>
            </div>

            {/* ── Stats Row ─────────────────────────────────────────────── */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {[
                    { label: 'Requêtes Totales', value: stats?.num_dns_queries || 0, icon: <Activity className="text-indigo-500" />, sub: 'Dernières 24h' },
                    { label: 'Menaces Bloquées', value: stats?.num_blocked_filtering || 0, icon: <Shield className="text-rose-500" />, sub: `${((stats?.num_blocked_filtering/stats?.num_dns_queries)*100 || 0).toFixed(1)}% du trafic` },
                    { label: 'Moyenne Latence', value: `${stats?.avg_processing_time || 0}ms`, icon: <Zap className="text-amber-500" />, sub: 'Temps de réponse' },
                    { label: 'Statut DNS', value: status?.version || 'Online', icon: <CheckCircle2 className="text-emerald-500" />, sub: 'Stable' },
                ].map((stat, i) => (
                    <div key={i} className="glass-card p-6 border border-white/5 relative overflow-hidden group">
                        <div className="absolute -right-4 -bottom-4 opacity-[0.03] group-hover:scale-110 transition-transform duration-700">
                             {React.cloneElement(stat.icon, { size: 100 })}
                        </div>
                        <div className="flex items-center gap-3 mb-4">
                            <div className="p-2 rounded-xl bg-white/5 border border-white/5">{stat.icon}</div>
                            <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{stat.label}</span>
                        </div>
                        <div className="text-2xl font-black font-mono tracking-tighter mb-1">{stat.value}</div>
                        <div className="text-[10px] font-bold text-slate-500 uppercase opacity-60">{stat.sub}</div>
                    </div>
                ))}
            </div>

            {/* ── Editor Tabs ───────────────────────────────────────────── */}
            <div className="glass-card border border-white/5 overflow-hidden">
                <div className="flex border-b border-white/5 bg-black/10">
                    {[
                        { id: 'upstream', label: 'Upstream DNS', icon: <Globe size={14} /> },
                        { id: 'bootstrap', label: 'Bootstrap DNS', icon: <Zap size={14} /> },
                        { id: 'settings', label: 'Protection', icon: <Settings2 size={14} /> }
                    ].map(tab => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={cn(
                                "flex items-center gap-2 px-8 py-5 text-[10px] font-black uppercase tracking-widest transition-all relative",
                                activeTab === tab.id 
                                    ? "text-white bg-indigo-600/10" 
                                    : "text-slate-500 hover:text-slate-200 hover:bg-white/5"
                            )}
                        >
                            {tab.icon}
                            {tab.label}
                            {activeTab === tab.id && (
                                <motion.div layoutId="dnsTab" className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-500 shadow-[0_0_10px_#6366f1]" />
                            )}
                        </button>
                    ))}
                </div>

                <div className="p-8">
                    {activeTab === 'upstream' && (
                        <div className="space-y-6">
                            <div className="flex items-start gap-4">
                                <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-500">
                                    <AlertCircle size={24} />
                                </div>
                                <div>
                                    <h4 className="text-sm font-black uppercase tracking-tight mb-1">Serveurs DNS Amont</h4>
                                    <p className="text-xs text-slate-500 leading-relaxed max-w-2xl">
                                        Entrez un serveur par ligne. Ces serveurs seront utilisés par AdGuard pour résoudre les requêtes de vos clients. 
                                        Privilégiez les serveurs DoH ou DoT pour une sécurité maximale.
                                    </p>
                                </div>
                            </div>

                            <textarea
                                value={config?.upstream_dns?.join('\n')}
                                onChange={(e) => setConfig({ ...config, upstream_dns: e.target.value.split('\n') })}
                                className="w-full h-64 glass-input font-mono text-sm leading-relaxed p-6 focus:ring-2 focus:ring-indigo-500/20 border-white/10"
                                placeholder="https://dns.cloudflare.com/dns-query&#10;8.8.8.8&#10;8.8.4.4"
                            />

                            <div className="flex flex-wrap gap-2 pt-2">
                                {['Cloudflare (DoH)', 'Google (DoH)', 'Quad9 (DoH)'].map(preset => (
                                    <button 
                                        key={preset}
                                        onClick={() => {
                                            const urls = {
                                                'Cloudflare (DoH)': 'https://dns.cloudflare.com/dns-query',
                                                'Google (DoH)': 'https://dns.google/dns-query',
                                                'Quad9 (DoH)': 'https://dns.quad9.net/dns-query'
                                            };
                                            const url = urls[preset];
                                            if (!config.upstream_dns.includes(url)) {
                                                setConfig({ ...config, upstream_dns: [...config.upstream_dns, url] });
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

                    {activeTab === 'bootstrap' && (
                        <div className="space-y-4">
                            <h4 className="text-sm font-black uppercase tracking-tight">Bootstrap DNS</h4>
                            <p className="text-xs text-slate-500 max-w-xl">Ces serveurs sont utilisés pour résoudre les noms d'hôtes des DNS amont (ex: dns.cloudflare.com).</p>
                            <textarea
                                value={config?.bootstrap_dns?.join('\n')}
                                onChange={(e) => setConfig({ ...config, bootstrap_dns: e.target.value.split('\n') })}
                                className="w-full h-48 glass-input font-mono text-sm p-6 focus:ring-2 focus:ring-indigo-500/20 border-white/10"
                            />
                        </div>
                    )}

                    {activeTab === 'settings' && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            {[
                                { key: 'filtering_enabled', label: 'Filtrage AdGuard', desc: 'Active le blocage des publicités et du tracking.' },
                                { key: 'safebrowsing_enabled', label: 'Navigation Sécurisée', desc: 'Bloque les sites malveillants et de phishing.' },
                                { key: 'parental_enabled', label: 'Contrôle Parental', desc: 'Bloque le contenu réservé aux adultes.' },
                                { key: 'safesearch_enabled', label: 'SafeSearch', desc: 'Force le mode sécurisé sur Google, YouTube, etc.' }
                            ].map((item) => (
                                <button
                                    key={item.key}
                                    onClick={() => setConfig({ ...config, [item.key]: !config[item.key] })}
                                    className={cn(
                                        "flex items-center justify-between p-6 rounded-2xl border transition-all text-left group",
                                        config?.[item.key] 
                                            ? "bg-indigo-500/10 border-indigo-500/30 text-white" 
                                            : "bg-white/5 border-white/5 text-slate-500 hover:border-white/10"
                                    )}
                                >
                                    <div>
                                        <div className="font-extrabold text-xs uppercase tracking-wider mb-1">{item.label}</div>
                                        <div className="text-[10px] opacity-60 leading-relaxed">{item.desc}</div>
                                    </div>
                                    <div className={cn(
                                        "w-10 h-6 rounded-full relative transition-all duration-300",
                                        config?.[item.key] ? "bg-indigo-500" : "bg-slate-700"
                                    )}>
                                        <div className={cn(
                                            "absolute top-1 w-4 h-4 rounded-full bg-white transition-all duration-300",
                                            config?.[item.key] ? "left-5" : "left-1"
                                        )} />
                                    </div>
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default DnsEditor;
