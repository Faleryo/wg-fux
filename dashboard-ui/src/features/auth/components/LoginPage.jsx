import React, { useState } from 'react';
import {
  ShieldCheck,
  Users,
  Key,
  Eye,
  EyeOff,
  Smartphone,
  ArrowRight,
  RefreshCw,
  AlertCircle,
  Check,
  Lock,
} from 'lucide-react';
import { useTheme } from '../../../context/ThemeContext';
import { cn } from '../../../lib/utils';
import { axiosInstance } from '../../../lib/api';
import { motion, AnimatePresence } from 'framer-motion';

const LoginPage = ({ onLogin }) => {
  const { theme, mode } = useTheme();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [totp, setTotp] = useState('');
  const [showTotp, setShowTotp] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);

  const isDark = mode === 'dark';

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const { data } = await axiosInstance.post('/auth/login', { username, password, token: totp });
      if (data.valid && data.token) {
        onLogin(data.token, rememberMe, data.role, username);
      } else {
        setError(data.error || 'Identifiants invalides');
      }
    } catch (err) {
      const data = err.response?.data;
      const status = err.response?.status;

      if (status === 429) {
        setError('Trop de tentatives. Réessayez plus tard.');
      } else if (status === 403 && (data?.error === '2FA_REQUIRED' || data?.message === '2FA_REQUIRED')) {
        setShowTotp(true);
        setError('');
      } else {
        // Extraction du message riche (Obsidian Tier)
        setError(data?.message || data?.error || 'Erreur de connexion au serveur');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden transition-colors duration-700 bg-[var(--bg-canvas)]">
      {/* ---- Ambient Background ---- */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <motion.div
          animate={{
            scale: [1, 1.3, 1],
            opacity: isDark ? [0.08, 0.18, 0.08] : [0.03, 0.06, 0.03],
          }}
          transition={{ duration: 12, repeat: Infinity, ease: 'easeInOut' }}
          className={cn(
            'absolute -top-[20%] -left-[10%] w-[80vw] h-[80vw] rounded-full blur-[160px] max-w-3xl',
            `bg-${theme}-600/20`
          )}
        />
        <motion.div
          animate={{
            scale: [1, 1.2, 1],
            opacity: isDark ? [0.05, 0.12, 0.05] : [0.02, 0.04, 0.02],
          }}
          transition={{ duration: 18, repeat: Infinity, delay: 3, ease: 'easeInOut' }}
          className="absolute -bottom-[20%] -right-[10%] w-[70vw] h-[70vw] rounded-full blur-[160px] bg-emerald-600/10 max-w-2xl"
        />
        <div
          className={cn(
            'absolute inset-0 bg-[size:50px_50px]',
            isDark
              ? 'bg-[linear-gradient(rgba(255,255,255,0.015)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.015)_1px,transparent_1px)]'
              : 'bg-[linear-gradient(rgba(0,0,0,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(0,0,0,0.02)_1px,transparent_1px)]'
          )}
        />
      </div>

      {/* ---- Login Card ---- */}
      <motion.div
        initial={{ opacity: 0, y: 32, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.8, ease: [0.23, 1, 0.32, 1] }}
        className="w-full max-w-[460px] relative z-10"
      >
        <div className="glass-card p-10 md:p-14 overflow-hidden relative shadow-2xl">
          <div
            className={cn(
              'absolute inset-0 opacity-[0.03] pointer-events-none',
              `bg-gradient-to-br from-${theme}-500 to-transparent`
            )}
          />

          {/* ---- Header ---- */}
          <div className="text-center mb-12 relative z-10">
            <motion.div
              whileHover={{ rotate: 5, scale: 1.05 }}
              transition={{ type: 'spring', stiffness: 400 }}
              className="inline-flex relative mb-8"
            >
              <div
                className={cn(
                  'absolute inset-0 blur-3xl opacity-20 rounded-full',
                  `bg-${theme}-500`
                )}
              />
              <div
                className={cn(
                  'relative p-6 rounded-[2rem] border shadow-2xl transition-all duration-700',
                  isDark
                    ? 'bg-slate-950/80 border-white/10 text-emerald-500'
                    : 'bg-white border-slate-200 text-emerald-600'
                )}
              >
                <ShieldCheck size={48} strokeWidth={1.5} />
              </div>
            </motion.div>

            <h1
              className={cn(
                'text-5xl font-black tracking-tighter mb-3 italic transition-colors duration-700 uppercase',
                isDark ? 'text-white' : 'text-slate-900'
              )}
            >
              {window.APP_TITLE || 'WG-FUX'}
            </h1>
            <p className="text-slate-500 text-[10px] font-black tracking-[0.4em] uppercase opacity-60">
              Zero Latency Engine — v4.0.1
            </p>
          </div>

          {/* ---- Form ---- */}
          <form onSubmit={handleSubmit} className="space-y-6 relative z-10">
            <AnimatePresence mode="wait">
              {!showTotp ? (
                <motion.div
                  key="login-fields"
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 10 }}
                  className="space-y-5"
                >
                  <div className="group space-y-2">
                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1 opacity-50">
                      Identifiant Unique
                    </label>
                    <div className="relative">
                      <Users
                        className={cn(
                          'absolute left-4 top-1/2 -translate-y-1/2 transition-colors duration-300',
                          isDark
                            ? 'text-slate-600 group-focus-within:text-white'
                            : 'text-slate-400 group-focus-within:text-slate-900'
                        )}
                        size={18}
                      />
                      <input
                        type="text"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        className="w-full glass-input pl-12"
                        placeholder="SECRET_ID"
                        autoFocus
                        autoComplete="username"
                      />
                    </div>
                  </div>
                  <div className="group space-y-2">
                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1 opacity-50">
                      Clé de Chiffrement
                    </label>
                    <div className="relative">
                      <Key
                        className={cn(
                          'absolute left-4 top-1/2 -translate-y-1/2 transition-colors duration-300',
                          isDark
                            ? 'text-slate-600 group-focus-within:text-white'
                            : 'text-slate-400 group-focus-within:text-slate-900'
                        )}
                        size={18}
                      />
                      <input
                        type={showPassword ? 'text' : 'password'}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="w-full glass-input pl-12 pr-12"
                        placeholder="••••••••"
                        autoComplete="current-password"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className={cn(
                          'absolute right-4 top-1/2 -translate-y-1/2 transition-colors',
                          isDark
                            ? 'text-slate-600 hover:text-white'
                            : 'text-slate-400 hover:text-slate-900'
                        )}
                      >
                        {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                      </button>
                    </div>
                  </div>
                </motion.div>
              ) : (
                <motion.div
                  key="totp-field"
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  className="text-center space-y-6"
                >
                  <div
                    className={cn(
                      'inline-flex p-5 rounded-3xl transition-colors',
                      isDark ? 'bg-white/5' : 'bg-slate-50',
                      `text-${theme}-500`
                    )}
                  >
                    <Smartphone size={40} />
                  </div>
                  <div>
                    <h3
                      className={cn(
                        'text-xl font-black uppercase tracking-tight mb-1',
                        isDark ? 'text-white' : 'text-slate-900'
                      )}
                    >
                      Double Facteur
                    </h3>
                    <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest opacity-60">
                      Synchronisation Sentinel requise
                    </p>
                  </div>
                  <input
                    type="text"
                    value={totp}
                    onChange={(e) => setTotp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    className="w-full glass-input text-center text-3xl font-mono font-black tracking-[0.6em]"
                    placeholder="000000"
                    autoFocus
                    maxLength={6}
                    inputMode="numeric"
                  />
                </motion.div>
              )}
            </AnimatePresence>

            <div className="flex items-center justify-between py-1">
              <label className="flex items-center gap-2.5 cursor-pointer group select-none">
                <div
                  onClick={() => setRememberMe(!rememberMe)}
                  className={cn(
                    'w-5 h-5 rounded-lg border flex items-center justify-center transition-all duration-300',
                    rememberMe
                      ? `bg-${theme}-600 border-${theme}-600`
                      : isDark
                        ? 'bg-slate-950 border-white/10 group-hover:border-white/20'
                        : 'bg-white border-slate-200 group-hover:border-slate-300'
                  )}
                >
                  {rememberMe && <Check size={11} className="text-white" strokeWidth={4} />}
                </div>
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="hidden"
                />
                <span
                  className={cn(
                    'text-[9px] font-black uppercase tracking-[0.2em] transition-colors',
                    isDark
                      ? 'text-slate-600 group-hover:text-slate-400'
                      : 'text-slate-400 group-hover:text-slate-600'
                  )}
                >
                  Mémoriser
                </span>
              </label>
              <p
                onClick={() =>
                  alert('Récupération de clé : Contactez votre administrateur Sentinel.')
                }
                className="text-[9px] font-black uppercase tracking-widest text-indigo-500/50 hover:text-indigo-500 cursor-pointer transition-colors duration-300"
              >
                Clé perdue ?
              </p>
            </div>

            <AnimatePresence>
              {error && (
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="flex items-center gap-3 p-4 rounded-2xl bg-red-500/5 border border-red-500/10"
                >
                  <AlertCircle size={18} className="text-red-500 flex-shrink-0" />
                  <p className="text-[10px] font-black text-red-500 leading-relaxed uppercase tracking-widest">
                    {error}
                  </p>
                </motion.div>
              )}
            </AnimatePresence>

            <button
              type="submit"
              disabled={loading || !username || !password || (showTotp && totp.length < 6)}
              className={cn(
                'group relative w-full py-5 text-white rounded-2xl font-black uppercase text-xs tracking-[0.3em] overflow-hidden transition-all duration-500 active:scale-[0.97] disabled:opacity-20 shadow-xl',
                `bg-${theme}-600 hover:bg-${theme}-500 shadow-${theme}-600/30`
              )}
            >
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-1000" />
              <div className="relative flex items-center justify-center gap-3">
                {loading ? (
                  <RefreshCw className="animate-spin text-white" size={18} />
                ) : showTotp ? (
                  <Lock size={18} />
                ) : (
                  <ArrowRight size={18} strokeWidth={3} />
                )}
                <span>
                  {loading
                    ? 'Séquençage...'
                    : !username || !password
                      ? 'Identifiants requis'
                      : showTotp
                        ? 'Valider Phase 2'
                        : 'Démarrer Session'}
                </span>
              </div>
            </button>
          </form>

          <div
            className={cn(
              'mt-12 pt-8 border-t text-center relative z-10',
              isDark ? 'border-slate-500/10' : 'border-slate-200'
            )}
          >
            <p
              className={cn(
                'text-[8px] font-black tracking-[0.5em] uppercase transition-colors duration-700 opacity-40',
                isDark ? 'text-white' : 'text-slate-500'
              )}
            >
              Sentinel Crypto-Guard — Layer v4.0.1
            </p>
          </div>
        </div>
      </motion.div>
    </div>
  );
};

export default LoginPage;
