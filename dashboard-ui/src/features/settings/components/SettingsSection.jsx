import React, { useState, useEffect } from 'react';
import {
  Settings,
  Globe,
  Shield,
  Wrench,
  RefreshCw,
  Save,
  ChevronRight,
  Server,
} from 'lucide-react';
import { useTheme } from '../../../context/ThemeContext';
import { useToast } from '../../../context/ToastContext';
import { cn, COLOR_MAP } from '../../../lib/utils';
import { axiosInstance } from '../../../lib/api';
import { AnimatePresence } from 'framer-motion';
import GeneralSettings from './GeneralSettings';
import NetworkSettings from './NetworkSettings';
import SecuritySettings from './SecuritySettings';
import MaintenanceSettings from './MaintenanceSettings';

const SettingsSection = () => {
  const { theme, isDark } = useTheme();
  const { addToast } = useToast();
  const [activeTab, setActiveTab] = useState('general');
  const [loading, setLoading] = useState(false);
  const [config, setConfig] = useState({
    port: '51820',
    mtu: '1420',
    dns: '1.1.1.1, 8.8.8.8',
    subnet: '10.0.0.0/24',
    keepalive: '25',
  });

  useEffect(() => {
    axiosInstance
      .get('/system/config')
      .then((res) => setConfig((prev) => ({ ...prev, ...res.data })))
      .catch(console.error);
  }, []);

  const handleSave = async () => {
    setLoading(true);
    try {
      await axiosInstance.post('/system/config', config);
      addToast('Configuration appliquée avec succès', 'success');
    } catch (error) {
      addToast("Erreur lors de l'application", 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleBackup = async () => {
    try {
      await axiosInstance.post('/system/backup', {});
      addToast('Sauvegarde créée avec succès', 'success');
    } catch (error) {
      addToast('Erreur lors du backup', 'error');
    }
  };

  const tabs = [
    { id: 'general', label: 'Noyau', icon: Server },
    { id: 'network', label: 'Réseau', icon: Globe },
    { id: 'security', label: 'Sûreté', icon: Shield },
    { id: 'maintenance', label: 'Terminal', icon: Wrench },
  ];

  return (
    <div className="space-y-10 animate-in fade-in slide-in-from-bottom-5 duration-700">
      {/* Header */}
      <div
        className={cn(
          'flex flex-col lg:flex-row justify-between items-center p-8 rounded-[3rem] border shadow-2xl gap-8 transition-all',
          isDark ? 'bg-slate-900/40 border-white/5 backdrop-blur-3xl' : 'bg-white border-black/5'
        )}
      >
        <div className="flex items-center gap-6">
          <div className='p-5 rounded-[2rem] bg-white/5 shadow-2xl' style={{ color: COLOR_MAP[theme]?.[400] || '#818cf8' }}>
            <Settings size={36} />
          </div>
          <div>
            <h2
              className={cn(
                'text-4xl font-black tracking-tighter italic uppercase transition-colors',
                isDark ? 'text-white' : 'text-slate-900'
              )}
            >
              Paramètres Noyau
            </h2>
            <p className="text-slate-500 text-[10px] font-black tracking-[0.4em] uppercase opacity-60">
              Deep Core Control Panel
            </p>
          </div>
        </div>

        <div className="flex gap-4 w-full lg:w-auto">
          <button
            onClick={handleSave}
            disabled={loading}
            className='flex-1 lg:flex-none flex items-center justify-center gap-3 px-10 py-5 text-white rounded-[1.5rem] font-black uppercase text-xs tracking-widest shadow-2xl transition-all active:scale-95 disabled:opacity-30'
            style={{
              backgroundColor: COLOR_MAP[theme]?.[600] || '#4f46e5',
              boxShadow: `0 8px 32px -8px ${COLOR_MAP[theme]?.[600] || '#4f46e5'}4d`,
            }}
          >
            {loading ? <RefreshCw className="animate-spin" size={20} /> : <Save size={20} />}{' '}
            Appliquer Mission
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-8">
        {/* Tabs Navigation */}
        <div className="xl:col-span-1 space-y-3">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'w-full flex items-center gap-4 px-6 py-5 rounded-[1.5rem] font-black uppercase text-[10px] tracking-widest transition-all duration-300',
                activeTab === tab.id
                  ? 'text-white shadow-2xl'
                  : cn(
                      'text-slate-500',
                      isDark
                        ? 'hover:text-white hover:bg-white/5'
                        : 'hover:text-slate-900 hover:bg-slate-100'
                    )
              )}
              style={activeTab === tab.id ? {
                backgroundColor: COLOR_MAP[theme]?.[600] || '#4f46e5',
                boxShadow: `0 8px 32px -8px ${COLOR_MAP[theme]?.[600] || '#4f46e5'}33`,
              } : undefined}
            >
              <tab.icon size={18} /> {tab.label}
              {activeTab === tab.id && <ChevronRight className="ml-auto" size={14} />}
            </button>
          ))}
        </div>

        {/* Content Area */}
        <div
          className={cn(
            'xl:col-span-3 rounded-[3rem] border p-10 shadow-2xl relative overflow-hidden h-fit transition-all',
            isDark
              ? 'bg-slate-900/40 border-white/10 backdrop-blur-3xl'
              : 'bg-white border-black/5 shadow-sm'
          )}
        >
          {/* Background Icon Watermark */}
          <div
            className={cn(
              'absolute -top-12 -right-12 p-12 opacity-[0.02] rotate-12 pointer-events-none transition-colors',
              isDark ? 'text-white' : 'text-black'
            )}
          >
            <Settings size={300} />
          </div>

          <AnimatePresence mode="wait">
            {activeTab === 'general' && (
              <GeneralSettings
                config={config}
                setConfig={setConfig}
                isDark={isDark}
                theme={theme}
              />
            )}
            {activeTab === 'network' && (
              <NetworkSettings
                config={config}
                setConfig={setConfig}
                isDark={isDark}
                theme={theme}
              />
            )}
            {activeTab === 'security' && (
              <SecuritySettings addToast={addToast} isDark={isDark} theme={theme} />
            )}
            {activeTab === 'maintenance' && (
              <MaintenanceSettings handleBackup={handleBackup} isDark={isDark} theme={theme} />
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
};

export default SettingsSection;
