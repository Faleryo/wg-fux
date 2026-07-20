import React, { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useTheme } from '../../context/ThemeContext';
import { useLang } from '../../context/LanguageContext';

const FOCUSABLE_SELECTORS =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const Modal = ({ isOpen, onClose, title, children, className, maxWidth = 'max-w-md' }) => {
  const { mode } = useTheme();
  const { t } = useLang();
  const isDark = mode === 'dark';
  const contentRef = useRef(null);
  const previousFocusRef = useRef(null);

  // Save focus target and restore on close
  useEffect(() => {
    if (isOpen) {
      previousFocusRef.current = document.activeElement;
      const timer = setTimeout(() => {
        const focusable = contentRef.current?.querySelectorAll(FOCUSABLE_SELECTORS);
        focusable?.[0]?.focus();
      }, 60);
      return () => clearTimeout(timer);
    } else {
      previousFocusRef.current?.focus();
    }
  }, [isOpen]);

  // Focus trap + ESC
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const focusable = [...(contentRef.current?.querySelectorAll(FOCUSABLE_SELECTORS) || [])];
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  return (
    <AnimatePresence>
      {isOpen && (
        <div
          className="fixed inset-0 z-[100] overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-labelledby={title ? 'modal-title' : undefined}
        >
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className={cn(
              'fixed inset-0 backdrop-blur-sm',
              isDark ? 'bg-slate-950/70' : 'bg-indigo-50/95'
            )}
          />

          {/* Centering wrapper */}
          <div className="flex min-h-full items-center justify-center p-4 sm:p-6">
            <motion.div
              ref={contentRef}
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className={cn(
                'relative w-full backdrop-blur-xl rounded-[2rem] shadow-2xl overflow-hidden p-8 md:p-10',
                isDark
                  ? 'bg-slate-900/80 border border-white/10 shadow-black/50'
                  : 'bg-white border border-slate-200/80 shadow-slate-200/60',
                maxWidth,
                className
              )}
            >
              {/* Header */}
              <div className="flex items-center justify-between mb-8">
                {title && (
                  <h3
                    id="modal-title"
                    className={cn(
                      'text-2xl font-black tracking-tight',
                      isDark ? 'text-white' : 'text-slate-900'
                    )}
                  >
                    {title}
                  </h3>
                )}
                <button
                  onClick={onClose}
                  aria-label={t('close')}
                  className={cn(
                    'p-3 rounded-2xl transition-all',
                    isDark
                      ? 'bg-white/5 text-slate-500 hover:text-white hover:bg-white/10'
                      : 'bg-slate-100 text-slate-400 hover:text-slate-700 hover:bg-slate-200'
                  )}
                >
                  <X size={24} />
                </button>
              </div>

              {/* Body */}
              <div className="relative z-10">{children}</div>

              {/* Background Decoration */}
              <div className="absolute -top-24 -right-24 w-64 h-64 bg-indigo-500/10 blur-[100px] rounded-full pointer-events-none" />
              <div className="absolute -bottom-24 -left-24 w-64 h-64 bg-rose-500/10 blur-[100px] rounded-full pointer-events-none" />
            </motion.div>
          </div>
        </div>
      )}
    </AnimatePresence>
  );
};

export default Modal;
