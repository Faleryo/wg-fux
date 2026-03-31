import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils';

const Modal = ({ isOpen, onClose, title, children, className, maxWidth = "max-w-md" }) => {
  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-slate-950/60 backdrop-blur-md"
          />

          {/* Modal Content */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className={cn(
              "relative w-full bg-slate-900/80 backdrop-blur-3xl border border-white/10 rounded-[2.5rem] shadow-2xl overflow-hidden shadow-black/50 p-8 md:p-10",
              maxWidth,
              className
            )}
          >
            {/* Header */}
            <div className="flex items-center justify-between mb-8">
              {title && (
                <h3 className="text-2xl font-black text-white tracking-tight uppercase">{title}</h3>
              )}
              <button
                onClick={onClose}
                className="p-3 rounded-2xl bg-white/5 text-slate-500 hover:text-white hover:bg-white/10 transition-all"
              >
                <X size={24} />
              </button>
            </div>

            {/* Body */}
            <div className="relative z-10">
              {children}
            </div>
            
            {/* Background Decoration */}
            <div className="absolute -top-24 -right-24 w-64 h-64 bg-indigo-500/10 blur-[100px] rounded-full pointer-events-none" />
            <div className="absolute -bottom-24 -left-24 w-64 h-64 bg-rose-500/10 blur-[100px] rounded-full pointer-events-none" />
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};

export default Modal;
