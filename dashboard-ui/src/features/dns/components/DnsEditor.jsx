import React, { useState, useEffect } from 'react';
import { Save, RefreshCw } from 'lucide-react';
import { axiosInstance } from '../../../lib/api';
import { useToast } from '../../../context/ToastContext';
import { useTheme } from '../../../context/ThemeContext';
import { cn } from '../../../lib/utils';
import DnsFilteringPanel from './DnsFilteringPanel';
import DnsConfigForm from './DnsConfigForm';

const DnsEditor = () => {
  const { mode } = useTheme();
  const isDark = mode === 'dark';
  const { addToast } = useToast();

  const [config, setConfig] = useState(null);
  const [stats, setStats] = useState(null);
  const [status, setStatus] = useState(null);
  const [filtering, setFiltering] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState('upstream');

  const [newFilterName, setNewFilterName] = useState('');
  const [newFilterUrl, setNewFilterUrl] = useState('');

  const fetchData = async () => {
    setLoading(true);
    try {
      const [configRes, statsRes, statusRes, filteringRes] = await Promise.all([
        axiosInstance.get('/dns/config'),
        axiosInstance.get('/dns/stats'),
        axiosInstance.get('/dns/status'),
        axiosInstance.get('/dns/filtering'),
      ]);
      setConfig(configRes.data);
      setStats(statsRes.data);
      setStatus(statusRes.data);
      setFiltering(filteringRes.data);
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
      } catch (e) {
        if (import.meta.env.DEV) {
          console.warn('[DNS] stats poll failed', e?.message);
        }
      }
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

  const handleAddFilter = async (name, url) => {
    try {
      await axiosInstance.post('/dns/filtering/add', { name, url });
      addToast('Blocklist ajoutée', 'success');
      fetchData();
    } catch (error) {
      addToast("Erreur lors de l'ajout", 'error');
    }
  };

  const handleRemoveFilter = async (url) => {
    try {
      await axiosInstance.post('/dns/filtering/remove', { url });
      addToast('Blocklist supprimée', 'success');
      fetchData();
    } catch (error) {
      addToast('Erreur lors de la suppression', 'error');
    }
  };

  if (loading && !config) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
        <RefreshCw className="animate-spin text-indigo-500" size={32} />
        <p className="text-sm font-bold text-slate-500 uppercase tracking-widest">
          Initialisation DNS...
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h2
            className={cn(
              'text-3xl font-black italic tracking-tighter transition-colors duration-500',
              isDark ? 'text-white' : 'text-slate-900'
            )}
          >
            DNS COMMAND CENTER
          </h2>
          <div className="flex items-center gap-2 mt-1">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
            <p
              className={cn(
                'text-[10px] font-extrabold tracking-[0.2em] uppercase opacity-70',
                isDark ? 'text-white' : 'text-slate-500'
              )}
            >
              ADGUARD ENGINE ACTIVE
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={fetchData}
            className={cn(
              'p-3 rounded-2xl border transition-all hover:scale-105 active:scale-95',
              isDark
                ? 'bg-white/5 border-white/10 text-slate-400'
                : 'bg-black/5 border-slate-200 text-slate-500'
            )}
          >
            <RefreshCw size={18} className={cn(loading && 'animate-spin')} />
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-5 py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-2xl font-bold text-[10px] sm:text-xs uppercase tracking-widest shadow-lg shadow-indigo-600/20 transition-all hover:scale-105 active:scale-95 disabled:opacity-50"
          >
            {saving ? <RefreshCw className="animate-spin" size={16} /> : <Save size={16} />}
            <span className="hidden xs:inline">{saving ? 'Déploiement...' : 'Appliquer'}</span>
          </button>
        </div>
      </div>

      <DnsFilteringPanel stats={stats} status={status} />

      <DnsConfigForm
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        config={config}
        setConfig={setConfig}
        filtering={filtering}
        handleRemoveFilter={handleRemoveFilter}
        handleAddFilter={handleAddFilter}
        newFilterName={newFilterName}
        newFilterUrl={newFilterUrl}
        setNewFilterName={setNewFilterName}
        setNewFilterUrl={setNewFilterUrl}
      />
    </div>
  );
};

export default DnsEditor;
