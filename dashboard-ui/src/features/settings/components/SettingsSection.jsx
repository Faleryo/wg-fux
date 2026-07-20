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
  CreditCard,
} from 'lucide-react';
import { useTheme } from '../../../context/ThemeContext';
import { useToast } from '../../../context/ToastContext';
import { useLang } from '../../../context/LanguageContext';
import { cn, COLOR_MAP } from '../../../lib/utils';
import { axiosInstance } from '../../../lib/api';
import { AnimatePresence } from 'framer-motion';
import GeneralSettings from './GeneralSettings';
import NetworkSettings from './NetworkSettings';
import SecuritySettings from './SecuritySettings';
import MaintenanceSettings from './MaintenanceSettings';
import BillingSettings from './BillingSettings';

const SettingsSection = () => {
  const { theme, isDark } = useTheme();
  const { addToast } = useToast();
  const { t } = useLang();
  const [activeTab, setActiveTab] = useState('general');
  const [loading, setLoading] = useState(false);
  const [config, setConfig] = useState({
    port: '51820',
    mtu: '1420',
    dns: '1.1.1.1, 8.8.8.8',
    subnet: '10.0.0.0/24',
    keepalive: '25',
    wg_endpoint: '',
  });
  const [savedConfig, setSavedConfig] = useState(null);
  const [validationErrors, setValidationErrors] = useState({});

  useEffect(() => {
    axiosInstance
      .get('/system/config')
      .then((res) => {
        const loaded = {
          port: '51820',
          mtu: '1420',
          dns: '1.1.1.1, 8.8.8.8',
          subnet: '10.0.0.0/24',
          keepalive: '25',
          wg_endpoint: '',
          ...res.data,
        };
        setConfig(loaded);
        setSavedConfig(loaded);
      })
      .catch(console.error);
  }, []);

  const isDirty = savedConfig !== null && JSON.stringify(config) !== JSON.stringify(savedConfig);

  useEffect(() => {
    if (!isDirty) return;
    const handler = (e) => {
      e.preventDefault();
      e.returnValue = t('unsaved_changes');
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  const validateConfig = () => {
    const errors = {};
    const port = parseInt(config.port, 10);
    if (!config.port || isNaN(port) || port < 1 || port > 65535)
      errors.port = t('err_port_invalid');
    const mtu = parseInt(config.mtu, 10);
    if (!config.mtu || isNaN(mtu) || mtu < 576 || mtu > 9000)
      errors.mtu = t('err_mtu_invalid');
    const ka = parseInt(config.keepalive, 10);
    if (config.keepalive !== '' && (isNaN(ka) || ka < 0 || ka > 3600))
      errors.keepalive = t('err_keepalive_invalid');
    return errors;
  };

  const handleSave = async () => {
    const errors = validateConfig();
    if (Object.keys(errors).length > 0) {
      setValidationErrors(errors);
      addToast(t('fix_errors_before_save'), 'error');
      return;
    }
    setValidationErrors({});
    setLoading(true);
    try {
      await axiosInstance.post('/system/config', config);
      setSavedConfig({ ...config });
      addToast(t('config_applied_ok'), 'success');
    } catch (error) {
      addToast(t('config_apply_err'), 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleBackup = async () => {
    try {
      await axiosInstance.post('/system/backup', {});
      addToast(t('backup_created_ok'), 'success');
    } catch (error) {
      addToast(t('backup_err'), 'error');
    }
  };

  const tabs = [
    { id: 'general', label: t('tab_core'), icon: Server },
    { id: 'network', label: t('network'), icon: Globe },
    { id: 'security', label: t('tab_security'), icon: Shield },
    { id: 'billing', label: t('tab_billing'), icon: CreditCard },
    { id: 'maintenance', label: t('tab_terminal'), icon: Wrench },
  ];

  return (
    <div className="space-y-10 animate-in fade-in slide-in-from-bottom-5 duration-700">
      {/* Header */}
      <div
        className={cn(
          'flex flex-col lg:flex-row justify-between items-center p-8 rounded-[2rem] border shadow-2xl gap-8 transition-all',
          isDark ? 'bg-slate-900/40 border-white/5 backdrop-blur-xl' : 'bg-white border-black/5'
        )}
      >
        <div className="flex items-center gap-6">
          <div
            className="p-5 rounded-[2rem] bg-white/5 shadow-2xl"
            style={{ color: COLOR_MAP[theme]?.[400] || '#818cf8' }}
          >
            <Settings size={36} />
          </div>
          <div>
            <h2
              className={cn(
                'text-4xl font-black tracking-tighter italic transition-colors',
                isDark ? 'text-white' : 'text-slate-900'
              )}
            >
              {t('settings_core_title')}
            </h2>
            <p className="text-slate-500 text-[11px] font-black tracking-[0.4em] uppercase opacity-60">
              Deep Core Control Panel
            </p>
          </div>
        </div>

        <div className="flex flex-col items-end gap-3 w-full lg:w-auto">
          {isDirty && Object.keys(validationErrors).length === 0 && (
            <span className="text-[11px] font-black text-amber-400 uppercase tracking-widest animate-pulse">
              • {t('pending_changes')}
            </span>
          )}
          {Object.keys(validationErrors).length > 0 && (
            <div className="flex flex-wrap gap-2">
              {Object.values(validationErrors).map((err) => (
                <span
                  key={err}
                  className="text-[11px] font-black text-rose-400 uppercase tracking-widest"
                >
                  ✕ {err}
                </span>
              ))}
            </div>
          )}
          <button
            onClick={handleSave}
            disabled={loading}
            className="flex items-center justify-center gap-3 px-6 py-3.5 text-white rounded-[1.5rem] font-black uppercase text-xs tracking-widest shadow-2xl transition-all active:scale-95 disabled:opacity-30"
            style={{
              backgroundColor: COLOR_MAP[theme]?.[600] || '#4f46e5',
              boxShadow: `0 8px 32px -8px ${COLOR_MAP[theme]?.[600] || '#4f46e5'}4d`,
            }}
          >
            {loading ? <RefreshCw className="animate-spin" size={20} /> : <Save size={20} />}{' '}
            {t('apply_mission')}
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
                'w-full flex items-center gap-4 px-6 py-5 rounded-[1.5rem] font-black uppercase text-[11px] tracking-widest transition-all duration-300',
                activeTab === tab.id
                  ? 'text-white shadow-2xl'
                  : cn(
                      'text-slate-500',
                      isDark
                        ? 'hover:text-white hover:bg-white/5'
                        : 'hover:text-slate-900 hover:bg-slate-100'
                    )
              )}
              style={
                activeTab === tab.id
                  ? {
                      backgroundColor: COLOR_MAP[theme]?.[600] || '#4f46e5',
                      boxShadow: `0 8px 32px -8px ${COLOR_MAP[theme]?.[600] || '#4f46e5'}33`,
                    }
                  : undefined
              }
            >
              <tab.icon size={18} /> {tab.label}
              {activeTab === tab.id && <ChevronRight className="ml-auto" size={14} />}
            </button>
          ))}
        </div>

        {/* Content Area */}
        <div
          className={cn(
            'xl:col-span-3 rounded-[2rem] border p-10 shadow-2xl relative overflow-hidden h-fit transition-all',
            isDark
              ? 'bg-slate-900/40 border-white/10 backdrop-blur-xl'
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
            {activeTab === 'billing' && <BillingSettings addToast={addToast} isDark={isDark} />}
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
