import React from 'react';
import { Info } from 'lucide-react';
import { useTheme } from '../../../context/ThemeContext';
import { cn, COLOR_MAP } from '../../../lib/utils';

const GlassInput = ({ label, value, onChange, badge, tooltip }) => {
  const { theme, isDark } = useTheme();
  return (
    <div className="group space-y-3">
      <div className="flex items-center justify-between px-1">
        <label className="text-[11px] font-black text-slate-500 uppercase tracking-widest leading-none">
          {label}
        </label>
        {tooltip && (
          <div className="group/tip relative">
            <Info
              size={12}
              className={cn(
                'cursor-help transition-colors',
                isDark ? 'text-slate-600 hover:text-white' : 'text-slate-400 hover:text-slate-900'
              )}
            />
            <div
              className={cn(
                'absolute bottom-full right-0 mb-4 w-64 p-4 border rounded-2xl text-[11px] font-bold uppercase tracking-widest opacity-0 group-hover/tip:opacity-100 transition-all pointer-events-none z-50 shadow-2xl',
                isDark
                  ? 'bg-slate-950/95 backdrop-blur-xl border-white/10 text-slate-400'
                  : 'bg-white border-black/10 text-slate-500'
              )}
            >
              {tooltip}
            </div>
          </div>
        )}
      </div>
      <div className="relative group/field">
        <div
          className="absolute -inset-0.5 rounded-2xl blur opacity-0 group-focus-within/field:opacity-40 transition-opacity"
          style={{
            backgroundColor: COLOR_MAP[theme]?.[500] ? COLOR_MAP[theme][500] + '33' : '#6366f133',
          }}
        />
        <input
          type="text"
          value={value}
          onChange={onChange}
          className={cn(
            'relative w-full border rounded-2xl px-6 py-4 font-mono text-sm focus:outline-none transition-all',
            isDark
              ? 'bg-white/5 border-white/5 text-white focus:border-white/10 focus:bg-white/10'
              : 'bg-slate-50 border-black/5 text-slate-900 focus:border-indigo-500/20 focus:bg-white'
          )}
        />
        {badge && (
          <div
            className={cn(
              'absolute right-4 top-1/2 -translate-y-1/2 px-3 py-1 border rounded-xl text-[11px] font-black font-mono uppercase tracking-widest transition-colors',
              isDark
                ? 'bg-slate-900 border-white/5 text-slate-500'
                : 'bg-white border-black/5 text-slate-400'
            )}
          >
            {badge}
          </div>
        )}
      </div>
    </div>
  );
};

export default GlassInput;
