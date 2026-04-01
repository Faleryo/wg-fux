import React from 'react';
import { motion } from 'framer-motion';
import { cn } from '../../lib/utils';

/**
 * VibeButton: Bouton premium Vibe-OS avec variantes Liquid UI.
 */
const VibeButton = ({ 
  children, 
  onClick, 
  variant = 'primary', 
  className,
  icon: Icon,
  loading = false,
  disabled = false,
  size = 'md'
}) => {
  const variants = {
    primary: "bg-indigo-600 hover:bg-indigo-500 shadow-indigo-600/30 text-white border-transparent",
    secondary: "bg-white/10 hover:bg-white/15 text-white border-white/5",
    ghost: "bg-transparent hover:bg-white/5 text-slate-400 hover:text-white border-transparent",
    danger: "bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border-rose-500/20 shadow-rose-500/10",
    success: "bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border-emerald-500/20 shadow-emerald-500/10"
  };

  const sizes = {
    sm: "px-4 py-2 text-[10px]",
    md: "px-6 py-3 text-xs",
    lg: "px-8 py-4 text-sm"
  };

  return (
    <motion.button
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      disabled={disabled || loading}
      onClick={onClick}
      className={cn(
        "relative flex items-center justify-center gap-3 font-black uppercase tracking-widest border transition-all duration-300 rounded-2xl shadow-xl group",
        variants[variant],
        sizes[size],
        (disabled || loading) && "opacity-50 cursor-not-allowed grayscale",
        className
      )}
    >
      {loading ? (
        <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
      ) : Icon && <Icon size={size === 'sm' ? 14 : 18} className="opacity-80" />}
      
      <span className="relative z-10">{children}</span>
      
      {/* Effet Liquid Sparkle sur Hover */}
      <div className="absolute inset-0 bg-gradient-to-tr from-white/0 via-white/5 to-white/0 opacity-0 group-hover:opacity-100 transition-opacity duration-1000 pointer-events-none"></div>
    </motion.button>
  );
};

export default VibeButton;
