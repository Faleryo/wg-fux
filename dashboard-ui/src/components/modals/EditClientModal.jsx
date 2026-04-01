import React, { useState, useEffect } from 'react';
import { Edit, RefreshCw, Database, Gauge, Clock, Save, Shield } from 'lucide-react';
import Modal from '../ui/Modal';
import { useTheme } from '../../context/ThemeContext';
import { cn } from '../../lib/utils';
import { axiosInstance } from '../../lib/api';
import { useToast } from '../../context/ToastContext';

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
        quota: parseInt(quota),
        uploadLimit: parseInt(uploadLimit),
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

  const getContainerColor = (container) => {
    const colors = ['emerald', 'indigo', 'rose', 'amber', 'cyan', 'purple'];
    const hashCode = (s) => s.split('').reduce((a, b) => { a = ((a << 5) - a) + b.charCodeAt(0); return a & a; }, 0);
    return colors[Math.abs(hashCode(container || '')) % colors.length];
  };
  const color = getContainerColor(client.container);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Éditer Peer`} maxWidth="max-w-lg">
      <form onSubmit={handleSubmit} className="space-y-8">

        {/* Peer Identity Card */}
        <div className={cn("flex items-center gap-4 p-5 rounded-2xl border", `bg-${color}-500/5 border-${color}-500/20`)}>
          <div className={cn("w-14 h-14 rounded-2xl flex items-center justify-center text-2xl font-black text-white shadow-xl", `bg-${color}-600`)}>
            {client?.name?.charAt(0).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-lg font-black text-white uppercase tracking-tight truncate">{client?.name}</div>
            <div className="flex items-center gap-2 mt-1">
              <span className={cn("text-[9px] font-black px-2 py-0.5 rounded-full border uppercase tracking-widest", `bg-${color}-500/10 text-${color}-400 border-${color}-500/20`)}>
                {client?.container}
              </span>
              <span className="text-[10px] font-mono text-slate-500">{client?.ip}</span>
            </div>
          </div>
          <Shield size={20} className={cn("flex-shrink-0", `text-${color}-500/40`)} />
        </div>

        {/* Quota */}
        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-2">
              <Database size={14} /> Quota de Données
            </label>
            <span className={cn("text-sm font-black font-mono", `text-${theme}-400`)}>
              {quota > 0 ? `${quota} GB` : '∞ Illimité'}
            </span>
          </div>
          <div className="flex items-center gap-4">
            <input
              type="range" min="0" max="200" step="5"
              value={quota}
              onChange={(e) => setQuota(e.target.value)}
              className="w-full accent-indigo-500"
            />
          </div>
          <div className="flex justify-between text-[9px] font-mono text-slate-600">
            <span>0 (illimité)</span><span>50 GB</span><span>100 GB</span><span>200 GB</span>
          </div>
        </div>

        {/* Upload Limit */}
        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-2">
              <Gauge size={14} /> Bande Passante Max
            </label>
            <span className={cn("text-sm font-black font-mono", `text-${theme}-400`)}>
              {uploadLimit > 0 ? `${uploadLimit} Mbps` : '∞ Illimité'}
            </span>
          </div>
          <div className="flex items-center gap-4">
            <input
              type="range" min="0" max="1000" step="10"
              value={uploadLimit}
              onChange={(e) => setUploadLimit(e.target.value)}
              className="w-full accent-indigo-500"
            />
          </div>
          <div className="flex justify-between text-[9px] font-mono text-slate-600">
            <span>0 (illimité)</span><span>250 Mbps</span><span>500 Mbps</span><span>1 Gbps</span>
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
                onClick={() => setIsUnlimited(!isUnlimited)}
                className={cn(
                  "w-10 h-5 rounded-full transition-all relative border border-white/10 cursor-pointer",
                  isUnlimited ? "bg-emerald-600" : "bg-slate-800"
                )}
              >
                <div className={cn("absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full bg-white shadow-md transition-all", isUnlimited ? "left-[calc(100%-1rem)]" : "left-0.5")} />
              </div>
              <span className="text-[10px] font-black uppercase text-slate-400 group-hover:text-white transition-colors">Illimité</span>
            </label>
          </div>
          {!isUnlimited && (
            <div className="relative group animate-in slide-in-from-top-2 duration-300">
              <Clock className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
              <input
                type="date"
                value={expiryDate}
                onChange={(e) => setExpiryDate(e.target.value)}
                min={new Date().toISOString().split('T')[0]}
                className="w-full pl-12 pr-6 py-4 bg-white/5 border border-white/5 rounded-2xl text-white font-mono text-sm focus:outline-none focus:border-white/20 focus:bg-white/10 transition-all"
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
            className={cn(
              "flex-[2] py-4 text-white font-black uppercase text-xs tracking-widest rounded-2xl shadow-2xl transition-all flex items-center justify-center gap-3 active:scale-95 disabled:opacity-30",
              `bg-${theme}-600 hover:bg-${theme}-500 shadow-${theme}-600/30`
            )}
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
