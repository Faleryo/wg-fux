import { useTheme } from '../../../context/ThemeContext';
import { cn } from '../../../lib/utils';

const OptimizationCard = ({ profile, currentProfile, loading, onOptimize }) => {
  const { isDark } = useTheme();

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-[2.5rem] border p-8 group transition-all duration-500',
        isDark
          ? 'bg-slate-900/40 backdrop-blur-3xl'
          : 'bg-white border-black/5 shadow-sm',
        currentProfile === profile.id
          ? `border-${profile.color}-500/50 shadow-2xl shadow-${profile.color}-500/20 bg-${profile.color}-500/5`
          : isDark
            ? 'border-white/5 hover:border-white/10'
            : 'border-black/5 hover:border-indigo-500/20'
      )}
    >
      {currentProfile === profile.id && (
        <div
          className={cn(
            'absolute top-6 right-6 px-3 py-1 rounded-full border text-[8px] font-black uppercase tracking-[0.2em] animate-pulse',
            `bg-${profile.color}-500/20 text-${profile.color}-400 border-${profile.color}-500/30`
          )}
        >
          Vecteur Actif
        </div>
      )}
      <div
        className={cn(
          'absolute -right-6 -top-6 p-4 opacity-[0.03] group-hover:opacity-10 transition-opacity duration-700 -rotate-12 pointer-events-none',
          `text-${profile.color}-500`
        )}
      >
        <profile.icon size={120} />
      </div>
      <div
        className={cn(
          'p-4 rounded-2xl mb-6 w-fit transition-transform group-hover:scale-110',
          isDark ? 'bg-white/5' : 'bg-black/5',
          `text-${profile.color}-400`
        )}
      >
        <profile.icon size={24} />
      </div>
      <h4
        className={cn(
          'text-xl font-black uppercase tracking-tight mb-2 italic transition-colors',
          isDark ? 'text-white' : 'text-slate-900'
        )}
      >
        {profile.label}
      </h4>
      <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest leading-loose mb-8 h-10">
        {profile.desc}
      </p>
      <button
        onClick={() => onOptimize(profile.id)}
        disabled={loading}
        className={cn(
          'w-full py-4 rounded-2xl font-black uppercase text-[10px] tracking-widest transition-all shadow-2xl active:scale-95 disabled:opacity-30',
          currentProfile === profile.id
            ? `bg-${profile.color}-600 text-white shadow-${profile.color}-600/30`
            : cn(
                isDark
                  ? 'bg-white/5 border-white/5 text-slate-400 hover:text-white'
                  : 'bg-slate-50 border-black/5 text-slate-500 hover:text-slate-900'
              )
        )}
      >
        {currentProfile === profile.id ? 'Optimisation Active' : 'Activer Profil'}
      </button>
    </div>
  );
};

export default OptimizationCard;
