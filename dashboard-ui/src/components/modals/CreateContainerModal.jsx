import React, { useState, useEffect, useRef } from 'react';
import { Plus, Package } from 'lucide-react';
import Modal from '../ui/Modal';
import { useTheme } from '../../context/ThemeContext';
import { cn } from '../../lib/utils';
import VibeButton from '../ui/Button';
import { useLang } from '../../context/LanguageContext';

const CreateContainerModal = ({ isOpen, onClose, onCreate }) => {
  const { theme } = useTheme();
  const { t } = useLang();
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const submittingRef = useRef(false);

  useEffect(() => {
    if (isOpen) {
      setName('');
      submittingRef.current = false;
    }
  }, [isOpen]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submittingRef.current) return;
    if (name.trim()) {
      submittingRef.current = true;
      setLoading(true);
      try {
        await onCreate(name.trim());
        onClose();
      } catch (error) {
        console.error('Erreur création conteneur:', error);
      } finally {
        setLoading(false);
        submittingRef.current = false;
      }
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t('new_container_title')} maxWidth="max-w-md">
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="space-y-6">
          <div>
            <label className="block text-[11px] font-black text-slate-500 mb-2 uppercase tracking-widest leading-loose">
              {t('f_container_name')}
            </label>
            <div className="relative group">
              <Package
                className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-slate-900 dark:group-focus-within:text-white transition-colors"
                size={18}
              />
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value.replace(/[^a-zA-Z0-9_-]/g, ''))} // only allow safe chars
                className="w-full pl-12 pr-6 py-4 glass-input rounded-2xl font-mono"
                placeholder={t('ph_container_name')}
                maxLength={30}
                autoFocus
                required
              />
            </div>
            <p className="mt-2 text-[11px] text-slate-500">
              {t('container_name_hint')}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 pt-4 border-t border-white/5">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 px-4 py-3.5 rounded-2xl font-black text-[11px] uppercase tracking-widest bg-white/5 text-slate-400 hover:text-white hover:bg-white/10 transition-all"
            disabled={loading}
          >
            {t('cancel')}
          </button>
          <VibeButton
            type="submit"
            variant="primary"
            icon={Plus}
            loading={loading}
            disabled={!name.trim() || loading}
            className="flex-1 py-3.5 shadow-xl"
          >
            {t('create')}
          </VibeButton>
        </div>
      </form>
    </Modal>
  );
};

export default CreateContainerModal;
