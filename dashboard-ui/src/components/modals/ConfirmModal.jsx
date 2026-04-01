import React, { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, X, Trash2, ShieldAlert } from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';
import { cn } from '../../lib/utils';

/**
 * 💠 ConfirmModal — Modal de confirmation destructive premium
 * Remplace les window.confirm() basiques par un dialog Liquid Glass.
 * 
 * Props:
 *   isOpen: boolean
 *   onConfirm: () => void
 *   onCancel: () => void
 *   title: string
 *   message: string | ReactNode
 *   confirmLabel?: string  (défaut: "Supprimer")
 *   intent?: 'danger' | 'warning'  (défaut: 'danger')
 */
const ConfirmModal = ({
  isOpen,
  onConfirm,
  onCancel,
  title = 'Confirmer la suppression',
  message = 'Cette action est irréversible.',
  confirmLabel = 'Supprimer',
  intent = 'danger',
}) => {
  const { theme } = useTheme();
  const confirmRef = useRef(null);

  // Focus trap sur le bouton Confirmer
  useEffect(() => {
    if (isOpen && confirmRef.current) {
      setTimeout(() => confirmRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Fermer sur Escape
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, onCancel]);

  const isDanger = intent === 'danger';

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
          onClick={onCancel}
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-modal-title"
        >
          {/* Backdrop */}
          <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-3xl" />

          <motion.div
            initial={{ scale: 0.9, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: 10 }}
            transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
            className="relative w-full max-w-sm bg-slate-900/80 backdrop-blur-3xl border border-white/10 rounded-[2.5rem] p-8 shadow-2xl shadow-black/60 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Inner glow */}
            <div className={cn(
              'absolute inset-0 rounded-[2.5rem] opacity-[0.06]',
              isDanger ? 'bg-gradient-to-br from-red-500 to-transparent' : 'bg-gradient-to-br from-amber-500 to-transparent'
            )} />

            {/* Close */}
            <button
              onClick={onCancel}
              className="absolute top-6 right-6 p-2 text-slate-600 hover:text-white rounded-xl hover:bg-white/5 transition-all"
            >
              <X size={18} />
            </button>

            {/* Icon */}
            <div className={cn(
              'w-16 h-16 rounded-[1.5rem] flex items-center justify-center mx-auto mb-6 shadow-2xl',
              isDanger ? 'bg-red-500/10 text-red-400' : 'bg-amber-500/10 text-amber-400'
            )}>
              {isDanger ? <Trash2 size={28} strokeWidth={1.5} /> : <ShieldAlert size={28} strokeWidth={1.5} />}
            </div>

            {/* Title */}
            <h2 id="confirm-modal-title" className="text-xl font-black text-white text-center uppercase tracking-tight mb-3">
              {title}
            </h2>

            {/* Message */}
            <div className="text-sm text-slate-400 text-center leading-relaxed mb-8">
              {typeof message === 'string' ? (
                <p>{message}</p>
              ) : message}
            </div>

            {/* Warning box */}
            {isDanger && (
              <div className="flex items-start gap-3 p-4 rounded-2xl bg-red-500/10 border border-red-500/15 mb-6">
                <AlertTriangle size={16} className="text-red-400 flex-shrink-0 mt-0.5" />
                <p className="text-[11px] text-red-400 font-bold uppercase tracking-wide leading-relaxed">
                  Cette action est permanente et ne peut pas être annulée.
                </p>
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-3">
              <button
                onClick={onCancel}
                className="flex-1 py-3 rounded-2xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-black uppercase tracking-widest transition-all border border-white/5 hover:border-white/10"
              >
                Annuler
              </button>
              <button
                ref={confirmRef}
                onClick={onConfirm}
                className={cn(
                  'flex-1 py-3 rounded-2xl text-white text-xs font-black uppercase tracking-widest transition-all shadow-lg active:scale-[0.98] flex items-center justify-center gap-2',
                  isDanger
                    ? 'bg-red-600 hover:bg-red-500 shadow-red-600/30'
                    : 'bg-amber-600 hover:bg-amber-500 shadow-amber-600/30'
                )}
              >
                {isDanger ? <Trash2 size={14} /> : <ShieldAlert size={14} />}
                {confirmLabel}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default ConfirmModal;
