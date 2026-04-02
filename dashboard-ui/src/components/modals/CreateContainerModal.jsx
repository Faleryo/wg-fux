import React, { useState, useEffect } from 'react';
import { Plus, Package } from 'lucide-react';
import Modal from '../ui/Modal';
import { useTheme } from '../../context/ThemeContext';
import { cn } from '../../lib/utils';
import VibeButton from '../ui/Button';

const CreateContainerModal = ({ isOpen, onClose, onCreate }) => {
  const { theme } = useTheme();
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setName('');
    }
  }, [isOpen]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (name.trim()) {
      setLoading(true);
      try {
        await onCreate(name.trim());
        onClose();
      } catch (error) {
        console.error('Erreur création conteneur:', error);
      } finally {
        setLoading(false);
      }
    }
  };

  return (
    <Modal 
      isOpen={isOpen} 
      onClose={onClose} 
      title="Nouveau Conteneur"
      maxWidth="max-w-md"
    >
      <form onSubmit={handleSubmit} className="space-y-8">
        <div className="space-y-6">
            <div>
              <label className="block text-[10px] font-black text-slate-500 mb-2 uppercase tracking-widest leading-loose">Nom du Conteneur (Groupe)</label>
              <div className="relative group">
                <Package className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-white transition-colors" size={18} />
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value.replace(/[^a-zA-Z0-9_\-]/g, ''))} // only allow safe chars
                  className="w-full pl-12 pr-6 py-4 bg-white/5 border border-white/5 rounded-2xl focus:outline-none focus:border-white/10 focus:bg-white/10 text-white font-mono placeholder:text-slate-600 transition-all text-sm"
                  placeholder="ex: famille, serveurs"
                  maxLength={30}
                  autoFocus
                  required
                />
              </div>
              <p className="mt-2 text-[9px] text-slate-500">Uniquement lettres, chiffres, tirets et underscores.</p>
            </div>
        </div>

        <div className="flex items-center gap-3 pt-4 border-t border-white/5">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 px-4 py-3.5 rounded-2xl font-black text-[10px] uppercase tracking-widest bg-white/5 text-slate-400 hover:text-white hover:bg-white/10 transition-all"
            disabled={loading}
          >
            Annuler
          </button>
          <VibeButton
            type="submit"
            variant="primary"
            icon={Plus}
            loading={loading}
            disabled={!name.trim() || loading}
            className="flex-1 py-3.5 shadow-xl"
          >
            Créer
          </VibeButton>
        </div>
      </form>
    </Modal>
  );
};

export default CreateContainerModal;
