import React, { useRef, useEffect } from 'react';
import { Settings, Sun, Moon, Ghost, Check } from 'lucide-react';
import { useTheme } from '../../../context/ThemeContext';
import { useLang } from '../../../context/LanguageContext';

const ACCENTS = [
  { id: 'indigo', hex: '#6366f1' },
  { id: 'cyan', hex: '#06b6d4' },
  { id: 'rose', hex: '#f43f5e' },
];

const MODES = [
  { id: 'light', icon: Sun, label: 'Light' },
  { id: 'dark', icon: Moon, label: 'Dark' },
  { id: 'spectre', icon: Ghost, label: 'Spectre' },
];

const ACCENT_MAP = {
  indigo: { hex: '#6366f1', glow: '99,102,241' },
  cyan: { hex: '#06b6d4', glow: '6,182,212' },
  rose: { hex: '#f43f5e', glow: '244,63,94' },
};

const PrefsPopover = ({ isLight }) => {
  const { theme, setTheme, mode, setMode } = useTheme();
  const { lang, setLang } = useLang();
  const prefsRef = useRef(null);
  const [open, setOpen] = React.useState(false);
  const accent = ACCENT_MAP[theme] || ACCENT_MAP.indigo;

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e) => {
      if (prefsRef.current && !prefsRef.current.contains(e.target)) setOpen(false);
    };
    const onEsc = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  const popoverSurface = isLight
    ? 'bg-white border-slate-200 shadow-[0_8px_32px_-12px_rgba(15,23,42,0.18)]'
    : 'bg-[#101015] border-white/10 shadow-[0_8px_32px_-12px_rgba(0,0,0,0.6)]';
  const popoverBtn = isLight
    ? 'bg-slate-100 hover:bg-slate-200 text-slate-700'
    : 'bg-white/5 hover:bg-white/10 text-neutral-300';
  const popoverBtnActive = isLight ? 'bg-slate-900 text-white' : 'bg-white text-black';
  const textDim = isLight ? 'text-slate-600' : 'text-neutral-500';

  return (
    <div ref={prefsRef} className="absolute right-6 top-6 z-50">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Préférences"
        aria-expanded={open}
        className={`group inline-flex h-9 w-9 items-center justify-center rounded-full border ${
          isLight
            ? 'border-slate-300 bg-white/80 text-slate-600 hover:text-slate-900'
            : 'border-white/10 bg-white/5 text-neutral-300 hover:text-white'
        } backdrop-blur transition`}
        style={open ? { borderColor: accent.hex, color: accent.hex } : undefined}
      >
        <Settings
          size={16}
          className={`transition-transform duration-500 ${open ? 'rotate-90' : 'group-hover:rotate-45'}`}
        />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Préférences d'affichage"
          className={`absolute right-0 mt-3 w-64 origin-top-right rounded-lg border p-4 backdrop-blur-xl ${popoverSurface}`}
        >
          <div className="mb-4">
            <div className={`mb-2 font-mono text-[10px] uppercase tracking-[0.3em] ${textDim}`}>
              Mode
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              {MODES.map(({ id, icon: Icon, label }) => {
                const active = mode === id;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setMode(id)}
                    aria-pressed={active}
                    title={label}
                    className={`flex flex-col items-center gap-1 rounded-md px-2 py-2 text-[10px] font-mono uppercase tracking-[0.15em] transition ${
                      active ? popoverBtnActive : popoverBtn
                    }`}
                  >
                    <Icon size={14} />
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mb-4">
            <div className={`mb-2 font-mono text-[10px] uppercase tracking-[0.3em] ${textDim}`}>
              Accent
            </div>
            <div className="flex items-center gap-2">
              {ACCENTS.map(({ id, hex }) => {
                const active = theme === id;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setTheme(id)}
                    aria-pressed={active}
                    aria-label={id}
                    className={`group relative h-8 w-8 rounded-full transition ${
                      active ? 'ring-2 ring-offset-2' : 'hover:scale-110'
                    } ${isLight ? 'ring-offset-white' : 'ring-offset-[#101015]'}`}
                    style={{
                      background: hex,
                      boxShadow: `0 4px 14px -4px ${hex}99`,
                      '--tw-ring-color': hex,
                    }}
                  >
                    {active && (
                      <Check
                        size={14}
                        strokeWidth={3}
                        className="absolute inset-0 m-auto text-white"
                      />
                    )}
                  </button>
                );
              })}
              <span className={`ml-auto font-mono text-[10px] uppercase tracking-[0.2em] ${textDim}`}>
                {theme}
              </span>
            </div>
          </div>

          <div>
            <div className={`mb-2 font-mono text-[10px] uppercase tracking-[0.3em] ${textDim}`}>
              Langue
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {['fr', 'en'].map((id) => {
                const active = lang === id;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setLang(id)}
                    aria-pressed={active}
                    className={`rounded-md px-3 py-2 font-mono text-[11px] uppercase tracking-[0.25em] transition ${
                      active ? popoverBtnActive : popoverBtn
                    }`}
                  >
                    {id}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PrefsPopover;
