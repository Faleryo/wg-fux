import React, { useState, useEffect } from 'react';
import { Plus, RefreshCw, Smartphone, Laptop, Globe, Info, Clock, Database, Gauge } from 'lucide-react';
import Modal from '../ui/Modal';
import { useTheme } from '../../context/ThemeContext';
import { cn } from '../../lib/utils';
import { axiosInstance } from '../../lib/api';

const CreateClientModal = ({ isOpen, onClose, onCreate, targetContainer }) => {
  const { theme } = useTheme();
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [quota, setQuota] = useState(0);
  const [uploadLimit, setUploadLimit] = useState(0);
  const [expiryDuration, setExpiryDuration] = useState({ value: 30, unit: 'days' });
  const [isUnlimited, setIsUnlimited] = useState(true);

  const generateSuggestion = (cnt) => {
    if (!cnt) return;
    axiosInstance.get('/clients').then(res => {
      const clients = res.data || [];
      const containerClients = clients.filter(c => c.container === cnt);
      let next = containerClients.length + 1;
      let candidate = `${cnt}-${String(next).padStart(2, '0')}`;
      while (containerClients.some(c => c.name === candidate)) {
        next++;
        candidate = `${cnt}-${String(next).padStart(2, '0')}`;
      }
      setName(candidate);
    }).catch(() => { });
  };

  useEffect(() => {
    if (isOpen) {
      setName('');
      if (targetContainer) {
         generateSuggestion(targetContainer);
      }
    }
  }, [isOpen, targetContainer]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (name.trim() && targetContainer) {
      setLoading(true);
      try {
        let expiry = '';
        if (!isUnlimited) {
          const date = new Date();
          if (expiryDuration.unit === 'days') date.setDate(date.getDate() + parseInt(expiryDuration.value));
          if (expiryDuration.unit === 'hours') date.setHours(date.getHours() + parseInt(expiryDuration.value));
          // Server validation expects YYYY-MM-DD format only
          expiry = date.toISOString().split('T')[0];
        }

        await onCreate(name, targetContainer, expiry, quota, uploadLimit);
        onClose();
      } catch (error) {
        console.error('Erreur création client:', error);
      } finally {
        setLoading(false);
      }
    }
  };

  return (
    <Modal 
      isOpen={isOpen} 
      onClose={onClose} 
      title="Initialisation de Peer"
      maxWidth="max-w-xl"
    >
      <form onSubmit={handleSubmit} className="space-y-10">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
           {/* Basic Info */}
           <div className="space-y-6">
              <div>
                <label className="block text-[10px] font-black text-slate-500 mb-2 uppercase tracking-widest leading-loose">Nom du Client</label>
                <div className="relative group">
                  <Smartphone className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-white transition-colors" size={18} />
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full pl-12 pr-6 py-4 bg-white/5 border border-white/5 rounded-2xl focus:outline-none focus:border-white/10 focus:bg-white/10 text-white font-mono placeholder:text-slate-600 transition-all text-sm"
                    placeholder="ex: galaxy-s24"
                    autoFocus
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-black text-slate-500 mb-2 uppercase tracking-widest leading-loose">Groupe Tactique (Conteneur)</label>
                <div className="relative group">
                  <Database className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                  <input
                    type="text"
                    value={targetContainer || 'Aucun'}
                    disabled
                    className="w-full pl-12 pr-6 py-4 bg-white/5 border border-white/5 rounded-2xl text-slate-400 font-mono transition-all text-sm cursor-not-allowed opacity-50"
                  />
                </div>
                <p className="mt-2 text-[9px] text-slate-500 italic">Le client sera ajouté dans ce conteneur en cours.</p>
              </div>
           </div>

           {/* Technical Options */}
           <div className="space-y-6">
              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Validité temporelle</label>
                  <label className="flex items-center gap-2 cursor-pointer group">
                    <input type="checkbox" checked={isUnlimited} onChange={(e) => setIsUnlimited(e.target.checked)} className={cn("w-4 h-4 rounded border-white/10 bg-slate-950", `text-${theme}-600 focus:ring-${theme}-500`)} />
                    <span className="text-[10px] font-black uppercase text-slate-400 group-hover:text-white transition-colors">Illimité</span>
                  </label>
                </div>
                {!isUnlimited && (
                   <div className="flex gap-4 animate-in slide-in-from-top-2 duration-300">
                     <div className="relative flex-1">
                        <Clock className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
                        <input
                          type="number"
                          value={expiryDuration.value}
                          onChange={(e) => setExpiryDuration({ ...expiryDuration, value: e.target.value })}
                          className="w-full pl-12 pr-4 py-4 bg-white/5 border border-white/5 rounded-2xl text-white font-mono text-sm focus:outline-none focus:border-white/10 focus:bg-white/10 transition-all"
                        />
                     </div>
                     <select 
                       value={expiryDuration.unit} 
                       onChange={(e) => setExpiryDuration({ ...expiryDuration, unit: e.target.value })} 
                       className="px-4 py-4 bg-white/5 border border-white/5 rounded-2xl text-white font-bold uppercase tracking-widest text-[10px] focus:outline-none focus:bg-white/10 transition-all"
                     >
                       <option value="days">Jours</option>
                       <option value="hours">Heures</option>
                     </select>
                   </div>
                )}
              </div>

              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Quota de Données</label>
                  <span className={cn("text-[10px] font-black font-mono", `text-${theme}-400`)}>{quota > 0 ? `${quota} GB` : '∞ GB'}</span>
                </div>
                <div className="flex items-center gap-4 py-2">
                   <Database size={16} className="text-slate-500" />
                   <input type="range" min="0" max="100" value={quota} onChange={(e) => setQuota(e.target.value)} className={cn("w-full h-1.5 bg-white/5 rounded-full appearance-none cursor-pointer", `accent-${theme}-500`)} />
                </div>
              </div>

              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Bande passante</label>
                  <span className={cn("text-[10px] font-black font-mono", `text-${theme}-400`)}>{uploadLimit > 0 ? `${uploadLimit} Mbps` : '∞ Mbps'}</span>
                </div>
                <div className="flex items-center gap-4 py-2">
                   <Gauge size={16} className="text-slate-500" />
                   <input type="range" min="0" max="100" step="5" value={uploadLimit} onChange={(e) => setUploadLimit(e.target.value)} className={cn("w-full h-1.5 bg-white/5 rounded-full appearance-none cursor-pointer", `accent-${theme}-500`)} />
                </div>
              </div>
           </div>
        </div>

        <div className="pt-6 border-t border-white/5 flex flex-col sm:flex-row gap-4">
           <button
             type="button"
             onClick={onClose}
             className="flex-1 py-4 bg-white/5 hover:bg-white/10 text-slate-400 font-black uppercase text-xs tracking-[0.2em] rounded-2xl border border-white/5 hover:border-white/10 transition-all"
           >
             Annuler Mission
           </button>
           <button
             type="submit"
             disabled={loading || !name.trim() || !targetContainer}
             className={cn(
               "flex-[2] py-4 text-white font-black uppercase text-xs tracking-[0.2em] rounded-2xl shadow-2xl transition-all flex items-center justify-center gap-3 active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed",
               `bg-${theme}-600 hover:bg-${theme}-500 shadow-${theme}-600/30`
             )}
           >
             {loading ? <RefreshCw className="animate-spin" size={18} /> : <Plus size={18} strokeWidth={3} />}
             Initialiser l'accès Peer
           </button>
        </div>
      </form>
    </Modal>
  );
};

export default CreateClientModal;
