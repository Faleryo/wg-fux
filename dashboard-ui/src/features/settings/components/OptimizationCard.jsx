import { useTheme } from '../../../context/ThemeContext';
import { useLang } from '../../../context/LanguageContext';
import { cn, COLOR_MAP } from '../../../lib/utils';

const OptimizationCard = ({ profile, currentProfile, loading, onOptimize }) => {
  const { isDark } = useTheme();
  const { t } = useLang();

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-[2rem] border p-8 group transition-all duration-500',
        isDark ? 'bg-slate-900/40 backdrop-blur-xl' : 'bg-white border-black/5 shadow-sm',
        currentProfile === profile.id
          ? 'shadow-2xl'
          : isDark
            ? 'border-white/5 hover:border-white/10'
            : 'border-black/5 hover:border-indigo-500/20'
      )}
      style={
        currentProfile === profile.id
          ? {
              borderColor: COLOR_MAP[profile.color]?.[500]
                ? COLOR_MAP[profile.color][500] + '80'
                : '#6366f180',
              boxShadow: `0 8px 32px -8px ${COLOR_MAP[profile.color]?.[500] || '#6366f1'}33`,
              backgroundColor: COLOR_MAP[profile.color]?.[500]
                ? COLOR_MAP[profile.color][500] + '0d'
                : '#6366f10d',
            }
          : undefined
      }
    >
      {currentProfile === profile.id && (
        <div
          className="absolute top-6 right-6 px-3 py-1 rounded-full border text-[8px] font-black uppercase tracking-[0.2em] animate-pulse"
          style={{
            backgroundColor: COLOR_MAP[profile.color]?.[500]
              ? COLOR_MAP[profile.color][500] + '33'
              : '#6366f133',
            color: COLOR_MAP[profile.color]?.[400] || '#818cf8',
            borderColor: COLOR_MAP[profile.color]?.[500]
              ? COLOR_MAP[profile.color][500] + '4d'
              : '#6366f14d',
          }}
        >
          {t('optim_active_vector')}
        </div>
      )}
      <div
        className="absolute -right-6 -top-6 p-4 opacity-[0.03] group-hover:opacity-10 transition-opacity duration-700 -rotate-12 pointer-events-none"
        style={{ color: COLOR_MAP[profile.color]?.[500] || '#6366f1' }}
      >
        <profile.icon size={120} />
      </div>
      <div
        className={cn(
          'p-4 rounded-2xl mb-6 w-fit transition-transform group-hover:scale-110',
          isDark ? 'bg-white/5' : 'bg-black/5'
        )}
        style={{ color: COLOR_MAP[profile.color]?.[400] || '#818cf8' }}
      >
        <profile.icon size={24} />
      </div>
      <h4
        className={cn(
          'text-xl font-black tracking-tight mb-2 italic transition-colors',
          isDark ? 'text-white' : 'text-slate-900'
        )}
      >
        {profile.label}
      </h4>
      <p className="text-[11px] text-slate-500 font-bold uppercase tracking-widest leading-loose mb-8 h-10">
        {profile.desc}
      </p>
      <button
        onClick={() => onOptimize(profile.id)}
        disabled={loading}
        className={cn(
          'w-full py-4 rounded-2xl font-black uppercase text-[11px] tracking-widest transition-all shadow-2xl active:scale-95 disabled:opacity-30',
          currentProfile === profile.id
            ? 'text-white'
            : cn(
                isDark
                  ? 'bg-white/5 border-white/5 text-slate-400 hover:text-white'
                  : 'bg-slate-50 border-black/5 text-slate-500 hover:text-slate-900'
              )
        )}
        style={
          currentProfile === profile.id
            ? {
                backgroundColor: COLOR_MAP[profile.color]?.[600] || '#4f46e5',
                boxShadow: `0 8px 32px -8px ${COLOR_MAP[profile.color]?.[600] || '#4f46e5'}4d`,
              }
            : undefined
        }
      >
        {currentProfile === profile.id ? t('optim_active') : t('optim_activate_profile')}
      </button>
    </div>
  );
};

export default OptimizationCard;
