import React from 'react';
import { useTheme } from '../../../context/ThemeContext';
import { cn } from '../../../lib/utils';
import { motion } from 'framer-motion';

export const StatBlock = ({ label, value, sub, icon: Icon, delay = 0 }) => {
  const { theme, isDark } = useTheme();

  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
      className="relative overflow-hidden glass-card p-4 md:p-6 group shadow-2xl"
    >
      <div
        className={cn(
          'absolute -inset-1 bg-gradient-to-r from-transparent opacity-0 group-hover:opacity-100 blur-xl transition-opacity duration-1000',
          isDark ? 'via-white/5' : 'via-black/5',
          `group-hover:via-${theme}-500/10`
        )}
      ></div>

      <div
        className={cn(
          'absolute -right-6 -top-6 p-4 opacity-[0.03] group-hover:opacity-10 transition-opacity duration-700 -rotate-12 group-hover:rotate-0',
          isDark ? `text-${theme}-500` : 'text-slate-900'
        )}
      >
        {Icon && <Icon size={120} />}
      </div>

      <div className="relative z-10">
        <div className="flex items-center justify-between mb-4">
          <p className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em]">
            {label}
          </p>
          {Icon && (
            <div
              className={cn(
                'p-2.5 rounded-xl transition-all duration-500 group-hover:scale-110 group-hover:rotate-6 shadow-lg shadow-black/20',
                `bg-${theme}-500/10 text-${theme}-400 border border-${theme}-500/10`
              )}
            >
              <Icon size={18} />
            </div>
          )}
        </div>

        <p className="text-3xl sm:text-4xl 2xl:text-5xl font-black text-slate-900 dark:text-white font-mono tracking-tighter mb-2 group-hover:scale-105 transition-transform duration-500 origin-left truncate">
          {value}
        </p>

        {sub && (
          <div
            className={cn(
              'flex items-center gap-2 mt-4 pt-4 border-t transition-colors',
              isDark ? 'border-white/5' : 'border-black/5'
            )}
          >
            <span
              className={cn(
                'h-1.5 w-1.5 rounded-full animate-pulse',
                `bg-${theme}-500 shadow-[0_0_8px_currentColor]`
              )}
            ></span>
            <span
              className={cn(
                'text-[10px] font-black uppercase tracking-widest opacity-60',
                `text-${theme}-400`
              )}
            >
              {sub}
            </span>
          </div>
        )}
      </div>
    </motion.div>
  );
};

export const CircularProgress = ({ value, label, color, icon: Icon }) => {
  const { isDark } = useTheme();
  const radius = 36;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (value / 100) * circumference;

  return (
    <div className="relative flex flex-col items-center group cursor-help shrink-0">
      <div className="relative w-16 h-16 sm:w-20 sm:h-20 md:w-28 md:h-28 transform transition-transform duration-500 group-hover:scale-110">
        <svg viewBox="0 0 112 112" className="w-full h-full transform -rotate-90 drop-shadow-2xl">
          <circle
            cx="56"
            cy="56"
            r={radius}
            stroke="currentColor"
            strokeWidth="8"
            fill="transparent"
            className={cn('transition-colors', isDark ? 'text-white/5' : 'text-black/5')}
          />
          <motion.circle
            cx="56"
            cy="56"
            r={radius}
            stroke="currentColor"
            strokeWidth="8"
            fill="transparent"
            initial={{ strokeDashoffset: circumference }}
            animate={{ strokeDashoffset: offset }}
            transition={{ duration: 1.5, ease: 'easeOut' }}
            className={cn('transition-all duration-500', color)}
            strokeDasharray={circumference}
            strokeLinecap="round"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <Icon
            size={18}
            className="text-slate-500 mb-1 group-hover:text-slate-900 dark:group-hover:text-white transition-colors duration-300 md:hidden"
          />
          <Icon
            size={24}
            className="text-slate-500 mb-1 group-hover:text-slate-900 dark:group-hover:text-white transition-colors duration-300 hidden md:block"
          />
          <span className="text-sm md:text-xl font-black text-slate-900 dark:text-white font-mono">
            {value}%
          </span>
        </div>
      </div>
      <span className="mt-4 text-[8px] md:text-[9px] font-black text-slate-500 uppercase tracking-[0.3em] group-hover:text-slate-300 transition-colors duration-300">
        {label}
      </span>
      <div
        className={cn(
          'absolute -bottom-2 w-0 h-0.5 bg-current transition-all duration-500 group-hover:w-12',
          color?.replace('text-', 'bg-')
        )}
      ></div>
    </div>
  );
};
