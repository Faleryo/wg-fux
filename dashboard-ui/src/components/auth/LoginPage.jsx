import React, { useState } from 'react';
import { 
  ShieldCheck, Users, Key, Eye, EyeOff, Smartphone, 
  ArrowRight, RefreshCw, AlertCircle, Check 
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
        localStorage.setItem('wg-user-role', data.role);
        localStorage.setItem('wg-user-username', username);
        onLogin(data.token, rememberMe);
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
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6 relative overflow-hidden">
      {/* Background Effects */}
      <div className={cn("absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] via-slate-950 to-slate-950 pointer-events-none opacity-40", `from-${theme}-900/30`)} />
      
      <div className="absolute inset-0 z-0 pointer-events-none">
        <motion.div 
          animate={{ scale: [1, 1.2, 1], opacity: [0.1, 0.2, 0.1] }}
          transition={{ duration: 10, repeat: Infinity }}
          className={cn("absolute top-[-10%] left-[-10%] w-[50%] h-[50%] rounded-full blur-[120px]", `bg-${theme}-600/20`)} 
        />
        <motion.div 
          animate={{ scale: [1, 1.3, 1], opacity: [0.1, 0.15, 0.1] }}
          transition={{ duration: 15, repeat: Infinity, delay: 2 }}
          className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-emerald-600/10 rounded-full blur-[120px]" 
        />
      </div>

      <motion.div 
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-[480px] bg-slate-900/40 backdrop-blur-3xl rounded-[3rem] border border-white/10 shadow-2xl p-10 md:p-14 relative z-10 overflow-hidden shadow-black/50"
      >
        {/* Decorative Grid */}
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:40px_40px] pointer-events-none"></div>

        {/* Header */}
        <div className="text-center mb-12 relative z-10">
          <motion.div 
            whileHover={{ rotate: 10, scale: 1.1 }}
            className="relative inline-flex mb-8"
          >
            <div className={cn("absolute inset-0 blur-2xl opacity-30", `bg-${theme}-500`)} />
            <div className={cn("relative p-6 rounded-[2rem] bg-slate-950 border border-white/10 shadow-2xl", `text-${theme}-400`)}>
              <ShieldCheck size={56} strokeWidth={1.5} />
            </div>
          </motion.div>
          <h1 className="text-5xl font-black text-white tracking-tighter mb-3 italic bg-gradient-to-br from-white via-white to-slate-500 bg-clip-text text-transparent">
            {window.APP_TITLE || 'WG-FUX'}
          </h1>
          <p className="text-slate-500 text-[10px] font-black tracking-[0.4em] uppercase opacity-60">System Security Terminal</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-8 relative z-10">
          <AnimatePresence mode="wait">
            {!showTotp ? (
              <motion.div 
                key="login"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                className="space-y-6"
              >
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Identifiant</label>
                  <div className="relative group">
                    <Users className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-white transition-colors" size={20} />
                    <input
                      type="text"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      className="w-full bg-white/5 border border-white/5 rounded-2xl px-6 py-4.5 pl-14 text-white placeholder-slate-700 focus:outline-none focus:border-white/10 focus:bg-white/10 transition-all font-mono text-sm"
                      placeholder="Access ID"
                      autoFocus
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Clé d'accès</label>
                  <div className="relative group">
                    <Key className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-white transition-colors" size={20} />
                    <input
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full bg-white/5 border border-white/5 rounded-2xl px-6 py-4.5 pl-14 pr-14 text-white placeholder-slate-700 focus:outline-none focus:border-white/10 focus:bg-white/10 transition-all font-mono text-sm"
                      placeholder="••••••••"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white transition-colors"
                    >
                      {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                    </button>
                  </div>
                </div>
              </motion.div>
            ) : (
              <motion.div 
                key="totp"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="text-center space-y-8"
              >
                <div className="space-y-2">
                   <div className={cn("inline-flex p-4 rounded-2xl bg-white/5 mb-2", `text-${theme}-400`)}>
                      <Smartphone size={32} />
                   </div>
                   <h3 className="text-xl font-black text-white uppercase tracking-tight">Authentification 2FA</h3>
                   <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Entrez le code de sécurité</p>
                </div>
                <input
                  type="text"
                  value={totp}
                  onChange={(e) => setTotp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  className="w-full bg-slate-950/50 border border-white/10 rounded-2xl px-6 py-5 text-center text-3xl font-mono font-black text-white tracking-[0.5em] focus:outline-none focus:border-white/20 transition-all"
                  placeholder="000000"
                  autoFocus
                  maxLength={6}
                />
              </motion.div>
            )}
          </AnimatePresence>

          <div className="flex items-center justify-between">
            <label className="flex items-center gap-3 cursor-pointer group select-none">
              <div className={cn(
                "w-5 h-5 rounded-lg border flex items-center justify-center transition-all",
                rememberMe ? `bg-${theme}-600 border-${theme}-600 shadow-[0_0_10px_rgba(var(--color-${theme}-600),0.5)]` : 'bg-slate-950 border-white/10 group-hover:border-white/20'
              )}>
                {rememberMe && <Check size={12} className="text-white" strokeWidth={4} />}
              </div>
              <input type="checkbox" checked={rememberMe} onChange={(e) => setRememberMe(e.target.checked)} className="hidden" />
              <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest group-hover:text-slate-300 transition-colors">Maintenir Session</span>
            </label>
          </div>

          <AnimatePresence>
            {error && (
              <motion.div 
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="p-4 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-start gap-4"
              >
                <AlertCircle size={20} className="text-red-400 shrink-0" />
                <p className="text-xs font-bold text-red-400 leading-relaxed uppercase tracking-tight">{error}</p>
              </motion.div>
            )}
          </AnimatePresence>

          <button
            type="submit"
            disabled={loading || !username || !password || (showTotp && totp.length < 6)}
            className={cn(
              "group relative w-full py-5 text-white rounded-[1.5rem] font-black uppercase text-xs tracking-[0.3em] shadow-2xl transition-all disabled:opacity-30 disabled:cursor-not-allowed overflow-hidden active:scale-95",
              `bg-${theme}-600 hover:bg-${theme}-500 shadow-${theme}-600/30`
            )}
          >
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-1000" />
            <div className="relative flex items-center justify-center gap-3">
              {loading ? <RefreshCw className="animate-spin" size={20} /> : (showTotp ? <ShieldCheck size={20} /> : <ArrowRight size={20} strokeWidth={3} />)}
              <span>{loading ? 'Validation...' : (showTotp ? 'Analyser Code' : 'Ouvrir Session')}</span>
            </div>
          </button>
        </form>

        <div className="mt-14 pt-8 border-t border-white/5 text-center relative z-10">
          <p className="text-[9px] text-slate-700 font-black tracking-[0.5em] uppercase">
            Encrypted by <span className={cn("font-bold", `text-${theme}-600`)}>{window.APP_TITLE || 'WG-FUX'}</span> Core v3.1
          </p>
        </div>
      </motion.div>
    </div>
  );
};

export default LoginPage;
