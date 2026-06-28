import React, { useState, useEffect } from 'react';
import { Edit, RefreshCw, Database, Gauge, Clock, Save, Shield } from 'lucide-react';
import Modal from '../ui/Modal';
import { useTheme } from '../../context/ThemeContext';
import { cn, COLOR_MAP } from '../../lib/utils';
import { axiosInstance } from '../../lib/api';
import { useToast } from '../../context/ToastContext';
import { getContainerColor } from '../../features/clients/components/ClientListHelpers';

const EditClientModal = ({ isOpen, onClose, client, onSave }) => {
  const { theme } = useTheme();
  const { addToast } = useToast();
  const [quota, setQuota] = useState(0);
  const [uploadLimit, setUploadLimit] = useState(0);
  const [isUnlimited, setIsUnlimited] = useState(true);
  const [expiryDate, setExpiryDate] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (client && isOpen) {
      setQuota(client.quota || 0);
      setUploadLimit(client.uploadLimit || 0);
      const hasExpiry = !!client.expiry;
      setIsUnlimited(!hasExpiry);
      setExpiryDate(hasExpiry ? client.expiry.split('T')[0] : '');
    }
  }, [client, isOpen]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await axiosInstance.patch(`/clients/${client.container}/${client.name}`, {
        quota: parseInt(quota) || 0,
        uploadLimit: parseInt(uploadLimit) || 0,
        expiry: isUnlimited ? null : expiryDate,
      });
      addToast(`Peer ${client.name} mis à jour avec succès`, 'success');
      onSave?.();
      onClose();
    } catch (err) {
      addToast(err?.response?.data?.error || 'Erreur de mise à jour', 'error');
    } finally {
      setLoading(false);
    }
  };

  if (!client) return null;

  const color = getContainerColor(client.container);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Éditer Peer`} maxWidth="max-w-lg">
      <form onSubmit={handleSubmit} className="space-y-8">
        {/* Peer Identity Card */}
        <div className="flex items-center gap-4 p-5 rounded-2xl border bg-white/5 border-white/10">
          <div
            className="w-14 h-14 rounded-2xl flex items-center justify-center text-2xl font-black text-white shadow-xl"
            style={{ backgroundColor: COLOR_MAP[color]?.[600] || '#4f46e5' }}
          >
            {client?.name?.charAt(0).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-lg font-black text-white uppercase tracking-tight truncate">
              {client?.name}
            </div>
            <div className="flex items-center gap-2 mt-1">
              <span
                className="text-[9px] font-black px-2 py-0.5 rounded-full border uppercase tracking-widest"
                style={{
                  backgroundColor: `${COLOR_MAP[color]?.[500] || '#6366f1'}20`,
                  color: COLOR_MAP[color]?.[400] || '#818cf8',
                  borderColor: `${COLOR_MAP[color]?.[500] || '#6366f1'}40`,
                }}
              >
                {client?.container}
              </span>
              <span className="text-[10px] font-mono text-slate-500">{client?.ip}</span>
            </div>
          </div>
          <Shield size={20} style={{ color: `${COLOR_MAP[color]?.[500] || '#6366f1'}80` }} className="flex-shrink-0" />
        </div>

        {/* Quota */}
        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-2">
              <Database size={14} /> Quota de Données
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min="0"
                step="5"
                value={quota}
                onChange={(e) => setQuota(Math.max(0, parseInt(e.target.value) || 0))}
                className="w-20 px-2 py-1 bg-white/5 border border-white/10 rounded-xl text-sm font-mono text-white text-center focus:outline-none focus:border-white/30"
                aria-label="Quota en GB"
              />
              <span className="text-xs font-black font-mono text-slate-500">GB</span>
              {quota === 0 && <span className="text-[10px] text-slate-600 font-black">Illimité</span>}
            </div>
          </div>
          <input
            type="range"
            min="0"
            max="200"
            step="5"
            value={Math.min(quota, 200)}
            onChange={(e) => setQuota(Number(e.target.value))}
            className="w-full accent-indigo-500"
            aria-label="Quota de données (curseur)"
          />
          <div className="flex justify-between text-[9px] font-mono text-slate-600">
            <span>0 (illimité)</span>
            <span>50 GB</span>
            <span>100 GB</span>
            <span>200 GB+</span>
          </div>
        </div>

        {/* Upload Limit */}
        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-2">
              <Gauge size={14} /> Bande Passante Max
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min="0"
                step="10"
                value={uploadLimit}
                onChange={(e) => setUploadLimit(Math.max(0, parseInt(e.target.value) || 0))}
                className="w-20 px-2 py-1 bg-white/5 border border-white/10 rounded-xl text-sm font-mono text-white text-center focus:outline-none focus:border-white/30"
                aria-label="Limite upload en Mbps"
              />
              <span className="text-xs font-black font-mono text-slate-500">Mbps</span>
              {uploadLimit === 0 && <span className="text-[10px] text-slate-600 font-black">Illimité</span>}
            </div>
          </div>
          <input
            type="range"
            min="0"
            max="1000"
            step="10"
            value={Math.min(uploadLimit, 1000)}
            onChange={(e) => setUploadLimit(Number(e.target.value))}
            className="w-full accent-indigo-500"
            aria-label="Bande passante max (curseur)"
          />
          <div className="flex justify-between text-[9px] font-mono text-slate-600">
            <span>0 (illimité)</span>
            <span>250 Mbps</span>
            <span>500 Mbps</span>
            <span>1 Gbps+</span>
          </div>
        </div>

        {/* Expiry */}
        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-2">
              <Clock size={14} /> Expiration
            </label>
            <label className="flex items-center gap-2 cursor-pointer group">
              <div
                role="button"
                tabIndex={0}
                aria-pressed={isUnlimited}
                aria-label={isUnlimited ? 'Durée illimitée activée' : 'Durée illimitée désactivée'}
                onClick={() => setIsUnlimited(!isUnlimited)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setIsUnlimited(!isUnlimited); }
                }}
                className={cn(
                  'w-10 h-5 rounded-full transition-all relative border border-white/10 cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500',
                  isUnlimited ? 'bg-emerald-600' : 'bg-slate-800'
                )}
              >
                <div
                  className={cn(
                    'absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full bg-white shadow-md transition-all',
                    isUnlimited ? 'left-[calc(100%-1rem)]' : 'left-0.5'
                  )}
                />
              </div>
              <span className="text-[10px] font-black uppercase text-slate-400 group-hover:text-white transition-colors">
                Illimité
              </span>
            </label>
          </div>
          {!isUnlimited && (
            <div className="relative group animate-in slide-in-from-top-2 duration-300">
              <Clock
                className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500"
                size={16}
              />
              <input
                type="date"
                value={expiryDate}
                onChange={(e) => setExpiryDate(e.target.value)}
                min={new Date().toISOString().split('T')[0]}
                className="w-full pl-12 pr-6 py-4 glass-input rounded-2xl font-mono"
              />
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-4 pt-2 border-t border-white/5">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-4 bg-white/5 hover:bg-white/10 text-slate-400 font-black uppercase text-xs tracking-widest rounded-2xl border border-white/5 transition-all"
          >
            Annuler
          </button>
          <button
            type="submit"
            disabled={loading}
            className="flex-[2] py-4 text-white font-black uppercase text-xs tracking-widest rounded-2xl shadow-2xl transition-all flex items-center justify-center gap-3 active:scale-95 disabled:opacity-30"
            style={{
              backgroundColor: COLOR_MAP[theme]?.[600] || '#4f46e5',
              boxShadow: `0 10px 20px -5px ${COLOR_MAP[theme]?.[600] || '#4f46e5'}4D`,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = COLOR_MAP[theme]?.[500] || '#6366f1'; }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = COLOR_MAP[theme]?.[600] || '#4f46e5'; }}
          >
            {loading ? <RefreshCw className="animate-spin" size={18} /> : <Save size={18} />}
            Sauvegarder
          </button>
        </div>
      </form>
    </Modal>
  );
};

export default EditClientModal;
