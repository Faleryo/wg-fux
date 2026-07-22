import React, { useState, useEffect } from 'react';
import { Eye, EyeOff, AlertCircle, ArrowUpRight } from 'lucide-react';
import { axiosInstance } from '../../../lib/api';
import { useTheme } from '../../../context/ThemeContext';
import { useLang } from '../../../context/LanguageContext';
import PrefsPopover from './PrefsPopover';
import NeuralNetworkAnimation from './NeuralNetworkAnimation';

const ACCENT_MAP = {
  indigo: { hex: '#6366f1', glow: '99,102,241' },
  cyan: { hex: '#06b6d4', glow: '6,182,212' },
  rose: { hex: '#f43f5e', glow: '244,63,94' },
};

const LoginPage = ({ onLogin }) => {
  const { theme, mode } = useTheme();
  const { t, lang } = useLang();
  const isLight = mode === 'light';
  const accent = ACCENT_MAP[theme] || ACCENT_MAP.indigo;

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [totp, setTotp] = useState('');
  const [showTotp, setShowTotp] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!username || !password) return;
    setLoading(true);
    setError('');
    try {
      const { data } = await axiosInstance.post('/auth/login', {
        username,
        password,
        token: totp,
      });
      if (data.valid && data.token) {
        onLogin(data.token, rememberMe, data.role, username, data.twoFactorEnabled);
      } else {
        setError(data.error || t('login_invalid_credentials'));
      }
    } catch (err) {
      const data = err.response?.data;
      const status = err.response?.status;
      if (status === 429) {
        setError(t('login_too_many'));
      } else if (
        status === 403 &&
        (data?.error === '2FA_REQUIRED' || data?.code === '2FA_REQUIRED')
      ) {
        setShowTotp(true);
        setError('');
      } else {
        setError(data?.message || data?.error || t('login_error'));
      }
    } finally {
      setLoading(false);
    }
  };

  const canSubmit = !loading && username && password && (!showTotp || totp.length === 6);

  // Theme-aware tokens
  const surface = isLight ? 'bg-white' : 'bg-[#0a0a0c]';
  const text = isLight ? 'text-slate-900' : 'text-neutral-100';
  const textMuted = isLight ? 'text-slate-700' : 'text-neutral-400';
  const textDim = isLight ? 'text-slate-600' : 'text-neutral-500';
  const textFaint = isLight ? 'text-slate-500' : 'text-neutral-600';
  const border = isLight ? 'border-slate-300' : 'border-white/10';
  const inputBorder = isLight ? 'border-slate-400' : 'border-white/15';
  const focusBorder = isLight ? 'focus:border-slate-900' : 'focus:border-white';
  const grainOpacity = isLight ? 0.03 : 0.07;

  return (
    <div className={`relative min-h-screen w-full overflow-hidden ${surface} ${text} font-sans`}>
      <PrefsPopover isLight={isLight} />

      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 mix-blend-overlay"
        style={{
          opacity: grainOpacity,
          backgroundImage:
            "url(\"data:image/svg+xml;utf8,<svg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 1 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")",
        }}
      />

      <div className={`relative grid min-h-screen grid-cols-1 lg:grid-cols-[1.15fr_1fr]`}>
        {/* ── LEFT: neural canvas ───────────────────────────────────────── */}
        <section
          className={`relative flex flex-col justify-between overflow-hidden border-b ${border} px-8 py-10 lg:border-b-0 lg:border-r lg:px-14 lg:py-14`}
        >
          <NeuralNetworkAnimation accent={accent} isLight={isLight} />

          {/* Soft vignette so text reads cleanly over the viz */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{
              background: isLight
                ? 'radial-gradient(ellipse at 50% 50%, rgba(255,255,255,0.55) 0%, rgba(255,255,255,0.8) 60%, rgba(255,255,255,0.95) 100%)'
                : 'radial-gradient(ellipse at 50% 50%, rgba(0,0,0,0) 0%, rgba(10,10,12,0.5) 70%, rgba(10,10,12,0.85) 100%)',
            }}
          />

          {/* Top bar */}
          <header className="relative z-10 flex items-start justify-between">
            <div className="flex items-center gap-2.5">
              <span
                className="block h-2 w-2 rotate-45"
                style={{ background: accent.hex, boxShadow: `0 0 12px rgba(${accent.glow},0.6)` }}
              />
              <span className={`font-mono text-[11px] uppercase tracking-[0.25em] ${textMuted}`}>
                wg-fux / vpn manager
              </span>
            </div>
            <div
              className={`hidden font-mono text-[11px] uppercase tracking-[0.25em] ${textDim} sm:block`}
            >
              v3.1 — 2026
            </div>
          </header>

          {/* Editorial headline */}
          <div className="relative z-10 my-10 lg:my-0">
            <div className="mb-6 flex items-center gap-3">
              <span className={`font-mono text-[11px] uppercase tracking-[0.3em] ${textDim}`}>
                01 — {t('login_step_access')}
              </span>
              <span className={`h-px flex-1 ${isLight ? 'bg-slate-200' : 'bg-white/10'}`} />
            </div>
            <h1
              className={`font-serif text-[12vw] font-light leading-[0.85] tracking-tight sm:text-[7rem] lg:text-[8.5rem] ${text}`}
            >
              <span className={`block italic ${isLight ? 'text-slate-800' : 'text-neutral-200'}`}>
                {t('login_headline_1')}
              </span>
              <span className="block">
                {t('login_headline_2a')}{' '}
                <span style={{ color: accent.hex }}>{t('login_headline_2b')}</span>
              </span>
            </h1>
            <p className={`mt-8 max-w-md text-sm leading-relaxed ${textMuted}`}>
              {t('login_tagline')}
            </p>
          </div>

          {/* Bottom meta strip */}
          <footer className="relative z-10 flex flex-wrap items-end justify-between gap-6">
            <div
              className={`grid grid-cols-3 gap-8 font-mono text-[11px] uppercase tracking-[0.2em] ${textDim}`}
            >
              <div>
                <div className={textFaint}>{t('meta_status')}</div>
                <div className={`mt-1 flex items-center gap-1.5 ${text}`}>
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{
                      background: accent.hex,
                      boxShadow: `0 0 10px ${accent.hex}`,
                    }}
                  />
                  {t('meta_operational')}
                </div>
              </div>
              <div>
                <div className={textFaint}>{t('meta_latency')}</div>
                <div className={`mt-1 ${text}`}>{'< 12 ms'}</div>
              </div>
              <div>
                <div className={textFaint}>{t('meta_time')}</div>
                <div className={`mt-1 ${text}`}>
                  {now.toLocaleTimeString(lang === 'fr' ? 'fr-FR' : 'en-GB', { hour12: false })}
                </div>
              </div>
            </div>
            <div className={`font-mono text-[11px] uppercase tracking-[0.3em] ${textFaint}`}>
              {t('sovereign_edition')}
            </div>
          </footer>
        </section>

        {/* ── RIGHT: bare form ───────────────────────────────────────────── */}
        <section className="relative flex items-center justify-center px-8 py-14 lg:px-14 lg:py-0">
          <div className="w-full max-w-sm">
            <div className="mb-10 flex items-center gap-3">
              <span className={`font-mono text-[11px] uppercase tracking-[0.3em] ${textDim}`}>
                02 — {showTotp ? t('login_step_verification') : t('login_step_identification')}
              </span>
              <span className={`h-px flex-1 ${isLight ? 'bg-slate-200' : 'bg-white/10'}`} />
            </div>

            <form onSubmit={handleSubmit} className="space-y-7" noValidate>
              {!showTotp ? (
                <>
                  <div className="group">
                    <label
                      htmlFor="username"
                      className={`mb-2 block font-mono text-[11px] tracking-[0.3em] ${textDim}`}
                    >
                      {t('field_username')}
                    </label>
                    <input
                      id="username"
                      name="username"
                      type="text"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      autoComplete="username"
                      autoFocus
                      placeholder="admin"
                      className={`block w-full border-0 border-b ${inputBorder} ${focusBorder} bg-transparent px-0 py-2.5 text-xl ${text} ${isLight ? 'placeholder-slate-400' : 'placeholder-neutral-700'} transition focus:outline-none focus:ring-0`}
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="password"
                      className={`mb-2 block font-mono text-[11px] uppercase tracking-[0.3em] ${textDim}`}
                    >
                      {t('field_password')}
                    </label>
                    <div className="relative">
                      <input
                        id="password"
                        name="password"
                        type={showPassword ? 'text' : 'password'}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        autoComplete="current-password"
                        placeholder="••••••••••"
                        className={`block w-full border-0 border-b ${inputBorder} ${focusBorder} bg-transparent px-0 py-2.5 pr-9 text-xl tracking-wider ${text} ${isLight ? 'placeholder-slate-400' : 'placeholder-neutral-700'} transition focus:outline-none focus:ring-0`}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((v) => !v)}
                        aria-label={showPassword ? t('hide_label') : t('show_label')}
                        tabIndex={-1}
                        className={`absolute bottom-3 right-0 ${textDim} transition ${isLight ? 'hover:text-slate-900' : 'hover:text-white'}`}
                      >
                        {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                  </div>

                  <label className="flex cursor-pointer select-none items-center gap-3 pt-1">
                    <span className="relative inline-flex">
                      <input
                        type="checkbox"
                        checked={rememberMe}
                        onChange={(e) => setRememberMe(e.target.checked)}
                        className={`peer h-4 w-4 cursor-pointer appearance-none rounded-none border ${isLight ? 'border-slate-400' : 'border-white/25'} bg-transparent transition focus:outline-none focus:ring-1`}
                        style={{ accentColor: accent.hex }}
                      />
                      <svg
                        className="pointer-events-none absolute left-0 top-0 h-4 w-4 scale-0 transition peer-checked:scale-100"
                        viewBox="0 0 16 16"
                        fill="none"
                      >
                        <path
                          d="M3 8.5l3.5 3.5L13 5"
                          stroke={accent.hex}
                          strokeWidth="2"
                          strokeLinecap="square"
                        />
                      </svg>
                    </span>
                    <span
                      className={`font-mono text-[11px] uppercase tracking-[0.25em] ${textMuted}`}
                    >
                      {t('remember_session')}
                    </span>
                  </label>
                </>
              ) : (
                <div>
                  <label
                    htmlFor="totp"
                    className={`mb-2 block font-mono text-[11px] uppercase tracking-[0.3em] ${textDim}`}
                  >
                    {t('totp_label')}
                  </label>
                  <input
                    id="totp"
                    type="text"
                    value={totp}
                    onChange={(e) => setTotp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    inputMode="numeric"
                    maxLength={6}
                    autoFocus
                    placeholder="000000"
                    className={`block w-full border-0 border-b ${inputBorder} ${focusBorder} bg-transparent px-0 py-3 text-center font-mono text-3xl tracking-[0.5em] ${text} ${isLight ? 'placeholder-slate-400' : 'placeholder-neutral-700'} transition focus:outline-none focus:ring-0`}
                  />
                  <p
                    className={`mt-3 font-mono text-[11px] uppercase tracking-[0.25em] ${textDim}`}
                  >
                    {t('totp_hint')}
                  </p>
                </div>
              )}

              {error && (
                <div
                  role="alert"
                  className={`flex items-start gap-2.5 border-l-2 border-rose-400 ${isLight ? 'bg-rose-50' : 'bg-rose-500/5'} px-3 py-2.5`}
                >
                  <AlertCircle size={14} className="mt-0.5 flex-shrink-0 text-rose-500" />
                  <p
                    className={`font-mono text-[11px] uppercase tracking-[0.15em] leading-snug ${isLight ? 'text-rose-700' : 'text-rose-200'}`}
                  >
                    {error}
                  </p>
                </div>
              )}

              {/* CTA brutaliste */}
              <button
                type="submit"
                disabled={!canSubmit}
                className={`group relative mt-2 flex w-full items-center justify-between gap-3 overflow-hidden border ${isLight ? 'border-slate-300' : 'border-white/15'} bg-transparent px-5 py-4 text-left transition hover:border-transparent disabled:cursor-not-allowed disabled:opacity-40`}
              >
                <span
                  aria-hidden
                  className="absolute inset-0 origin-left scale-x-0 transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:scale-x-100 group-disabled:scale-x-0"
                  style={{ background: accent.hex }}
                />
                <span
                  className={`relative font-mono text-xs uppercase tracking-[0.3em] ${text} transition group-hover:text-white`}
                >
                  {loading
                    ? t('login_connecting')
                    : showTotp
                      ? t('login_validate_code')
                      : t('login_enter_tunnel')}
                </span>
                <ArrowUpRight
                  size={18}
                  className={`relative ${text} transition group-hover:rotate-12 group-hover:text-white`}
                />
              </button>
            </form>

            <div
              className={`mt-12 flex items-center justify-between font-mono text-[11px] uppercase tracking-[0.25em] ${textFaint}`}
            >
              <span>{t('forgot_credentials')}</span>
              <span className={textDim}>{t('contact_admin_short')}</span>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};

export default LoginPage;
