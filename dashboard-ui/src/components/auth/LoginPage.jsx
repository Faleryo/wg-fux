import React, { useState } from 'react';
import { 
  ShieldCheck, Users, Key, Eye, EyeOff, Smartphone, 
  ArrowRight, RefreshCw, AlertCircle, Check, Lock
} from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';
import { cn } from '../../lib/utils';
import { axiosInstance } from '../../lib/api';
import { motion, AnimatePresence } from 'framer-motion';

const LoginPage = ({ onLogin }) => {
  const { theme } = useTheme();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [totp, setTotp] = useState('');
  const [showTotp, setShowTotp] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const { data } = await axiosInstance.post('/auth/login', { username, password, token: totp });
      if (data.valid && data.token) {
        // BUG-FIX: Passer role et username directement à onLogin (cohérent avec le nouveau contrat)
        // App.jsx gère la persistance localStorage centralement
        onLogin(data.token, rememberMe, data.role, username);
      } else {
        setError(data.error || 'Identifiants invalides');
      }
    } catch (err) {
      if (err.response?.status === 429) {
        setError('Trop de tentatives. Réessayez plus tard.');
      } else if (err.response?.status === 403 && err.response.data.error === '2FA_REQUIRED') {
        setShowTotp(true);
        setError('');
      } else {
        setError(err.response?.data?.error || 'Erreur de connexion au serveur');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4 relative overflow-hidden">
      
      {/* ---- Ambient Background ---- */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <motion.div
          animate={{ scale: [1, 1.3, 1], opacity: [0.08, 0.18, 0.08] }}
          transition={{ duration: 12, repeat: Infinity, ease: 'easeInOut' }}
          className={cn('absolute -top-[20%] -left-[10%] w-[80vw] h-[80vw] rounded-full blur-[160px] max-w-3xl', `bg-${theme}-600/30`)}
        />
        <motion.div
          animate={{ scale: [1, 1.2, 1], opacity: [0.05, 0.12, 0.05] }}
          transition={{ duration: 18, repeat: Infinity, delay: 3, ease: 'easeInOut' }}
          className="absolute -bottom-[20%] -right-[10%] w-[70vw] h-[70vw] rounded-full blur-[160px] bg-emerald-600/20 max-w-2xl"
        />
        {/* Grid */}
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.015)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.015)_1px,transparent_1px)] bg-[size:50px_50px]" />
      </div>

      {/* ---- Login Card ---- */}
      <motion.div
        initial={{ opacity: 0, y: 32, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.6, ease: [0.23, 1, 0.32, 1] }}
        className="w-full max-w-[440px] relative z-10"
      >
        <div className="bg-slate-900/50 backdrop-blur-3xl border border-white/10 rounded-[2.5rem] shadow-2xl shadow-black/60 p-8 md:p-12 overflow-hidden relative">
          {/* Card inner glow */}
          <div className={cn('absolute inset-0 rounded-[2.5rem] opacity-[0.04]', `bg-gradient-to-br from-${theme}-500 to-transparent`)} />
          
          {/* ---- Header ---- */}
          <div className="text-center mb-10 relative z-10">
            <motion.div
              whileHover={{ rotate: 8, scale: 1.08 }}
              transition={{ type: 'spring', stiffness: 300 }}
              className="inline-flex relative mb-6"
            >
              <div className={cn('absolute inset-0 blur-2xl opacity-25 rounded-full', `bg-${theme}-500`)} />
              <div className={cn('relative p-5 rounded-[1.5rem] bg-slate-950/80 border border-white/10 shadow-2xl', `text-${theme}-400`)}>
                <ShieldCheck size={44} strokeWidth={1.5} />
              </div>
            </motion.div>
            
            <h1 className="text-4xl md:text-5xl font-black text-white tracking-tighter mb-2 italic">
              {window.APP_TITLE || 'WG-FUX'}
            </h1>
            <p className="text-slate-500 text-[10px] font-black tracking-[0.35em] uppercase">
              Security Terminal — v3.1
            </p>
          </div>

          {/* ---- Form ---- */}
          <form onSubmit={handleSubmit} className="space-y-5 relative z-10">
            <AnimatePresence mode="wait">
              {!showTotp ? (
                <motion.div
                  key="login-fields"
                  initial={{ opacity: 0, x: -16 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 16 }}
                  className="space-y-4"
                >
                  {/* Username */}
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Identifiant</label>
                    <div className="relative group">
                      <Users className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-600 group-focus-within:text-white transition-colors" size={18} />
                      <input
                        type="text"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        className="w-full bg-slate-950/60 border border-white/8 rounded-2xl px-5 py-4 pl-12 text-white placeholder-slate-700 focus:outline-none focus:border-white/20 focus:bg-slate-950/80 transition-all font-mono text-sm"
                        placeholder="Access ID"
                        autoFocus
                        autoComplete="username"
                      />
                    </div>
                  </div>

                  {/* Password */}
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Clé d'accès</label>
                    <div className="relative group">
                      <Key className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-600 group-focus-within:text-white transition-colors" size={18} />
                      <input
                        type={showPassword ? 'text' : 'password'}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="w-full bg-slate-950/60 border border-white/8 rounded-2xl px-5 py-4 pl-12 pr-12 text-white placeholder-slate-700 focus:outline-none focus:border-white/20 focus:bg-slate-950/80 transition-all font-mono text-sm"
                        placeholder="••••••••"
                        autoComplete="current-password"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-600 hover:text-white transition-colors"
                      >
                        {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                      </button>
                    </div>
                  </div>
                </motion.div>
              ) : (
                <motion.div
                  key="totp-field"
                  initial={{ opacity: 0, x: 16 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -16 }}
                  className="text-center space-y-5"
                >
                  <div className={cn('inline-flex p-4 rounded-2xl bg-white/5', `text-${theme}-400`)}>
                    <Smartphone size={32} />
                  </div>
                  <div>
                    <h3 className="text-lg font-black text-white uppercase tracking-tight mb-1">Authentification 2FA</h3>
                    <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Entrez le code de votre authenticator</p>
                  </div>
                  <input
                    type="text"
                    value={totp}
                    onChange={(e) => setTotp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    className="w-full bg-slate-950/60 border border-white/10 rounded-2xl px-6 py-5 text-center text-3xl font-mono font-black text-white tracking-[0.5em] focus:outline-none focus:border-white/20 transition-all"
                    placeholder="000000"
                    autoFocus
                    maxLength={6}
                    inputMode="numeric"
                  />
                </motion.div>
              )}
            </AnimatePresence>

            {/* Remember me */}
            <label className="flex items-center gap-3 cursor-pointer group select-none py-1">
              <div
                onClick={() => setRememberMe(!rememberMe)}
                className={cn(
                  'w-5 h-5 rounded-lg border flex items-center justify-center transition-all flex-shrink-0',
                  rememberMe
                    ? `bg-${theme}-600 border-${theme}-600 shadow-[0_0_12px_rgba(99,102,241,0.4)]`
                    : 'bg-slate-900 border-white/10 group-hover:border-white/20'
                )}
              >
                {rememberMe && <Check size={11} className="text-white" strokeWidth={3.5} />}
              </div>
              <input type="checkbox" checked={rememberMe} onChange={(e) => setRememberMe(e.target.checked)} className="hidden" />
              <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest group-hover:text-slate-300 transition-colors">
                Maintenir Session
              </span>
            </label>

            {/* Error Banner */}
            <AnimatePresence>
              {error && (
                <motion.div
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="flex items-center gap-3 p-4 rounded-2xl bg-red-500/10 border border-red-500/20"
                >
                  <AlertCircle size={18} className="text-red-400 flex-shrink-0" />
                  <p className="text-xs font-bold text-red-400 leading-relaxed uppercase tracking-tight">{error}</p>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Submit */}
            <button
              type="submit"
              disabled={loading || !username || !password || (showTotp && totp.length < 6)}
              className={cn(
                'group relative w-full py-4 md:py-5 text-white rounded-[1.25rem] font-black uppercase text-xs tracking-[0.25em] shadow-2xl transition-all disabled:opacity-30 disabled:cursor-not-allowed overflow-hidden active:scale-[0.98]',
                `bg-${theme}-600 hover:bg-${theme}-500 shadow-${theme}-600/30`
              )}
            >
              {/* Shimmer effect */}
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700" />
              <div className="relative flex items-center justify-center gap-3">
                {loading
                  ? <RefreshCw className="animate-spin" size={18} />
                  : showTotp
                    ? <Lock size={18} />
                    : <ArrowRight size={18} strokeWidth={2.5} />
                }
                <span>{loading ? 'Validation...' : showTotp ? 'Analyser Code' : 'Ouvrir Session'}</span>
              </div>
            </button>
          </form>

          {/* Footer */}
          <div className="mt-8 pt-6 border-t border-white/5 text-center relative z-10">
            <p className="text-[9px] text-slate-700 font-black tracking-[0.4em] uppercase">
              Chiffré par <span className={cn('font-bold', `text-${theme}-700`)}>{window.APP_TITLE || 'WG-FUX'}</span> Core v3.1
            </p>
          </div>
        </div>
      </motion.div>
    </div>
  );
};

export default LoginPage;
