import React from 'react';
import { motion } from 'framer-motion';
import { cn } from '../../lib/utils';

/**
 * GlassCard: Composant de base "Liquid Glass" de Vibe-OS.
 * Centralise les effets de flou, les bordures et les ombres.
 */
const GlassCard = ({ children, className, animate = true, delay = 0, hover = true, onClick }) => {
  const content = (
    <div
      onClick={onClick}
      className={cn(
        'relative overflow-hidden glass-card rounded-[2.5rem] p-8 shadow-2xl transition-all duration-500',
        hover && 'hover:shadow-indigo-500/5 hover:-translate-y-1',
        onClick && 'cursor-pointer active:scale-95',
        className
      )}
    >
      {/* Rayonnement interne de style Liquid Glass */}
      <div className="absolute -inset-1 bg-gradient-to-r from-transparent via-white/5 to-transparent opacity-0 hover:opacity-100 blur-xl transition-opacity duration-1000"></div>

      <div className="relative z-10">{children}</div>
    </div>
  );

  if (!animate) return content;

  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{
        duration: 0.8,
        delay,
        ease: [0.16, 1, 0.3, 1], // Custom ease-out pour un effet liquide
      }}
    >
      {content}
    </motion.div>
  );
};

export default GlassCard;
