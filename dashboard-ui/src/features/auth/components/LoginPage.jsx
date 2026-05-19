import React, { useState } from 'react';
import { ShieldCheck, Eye, EyeOff, AlertCircle, Loader2 } from 'lucide-react';
import { axiosInstance } from '../../../lib/api';

const LoginPage = ({ onLogin }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [totp, setTotp] = useState('');
  const [showTotp, setShowTotp] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

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
        onLogin(data.token, rememberMe, data.role, username);
      } else {
        setError(data.error || 'Identifiants invalides');
      }
    } catch (err) {
      const data = err.response?.data;
      const status = err.response?.status;
      if (status === 429) {
        setError('Trop de tentatives. Réessayez plus tard.');
      } else if (
        status === 403 &&
        (data?.error === '2FA_REQUIRED' || data?.code === '2FA_REQUIRED')
      ) {
        setShowTotp(true);
        setError('');
      } else {
        setError(data?.message || data?.error || 'Erreur de connexion');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      <div className="w-full max-w-sm">
        {/* Header */}
        <div className="flex flex-col items-center mb-8">
          <div className="p-3 rounded-2xl bg-slate-900 dark:bg-slate-800 text-white mb-4">
            <ShieldCheck size={28} strokeWidth={1.8} />
          </div>
          <h1 className="text-xl font-semibold tracking-tight">wg-fux</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Connexion à l'administration
          </p>
        </div>

        {/* Card */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm">
          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            {!showTotp ? (
              <>
                <div className="space-y-1.5">
                  <label
                    htmlFor="username"
                    className="block text-sm font-medium text-slate-700 dark:text-slate-300"
                  >
                    Nom d'utilisateur
                  </label>
                  <input
                    id="username"
                    name="username"
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    autoComplete="username"
                    autoFocus
                    className="block w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900 dark:focus:ring-slate-100 focus:border-transparent"
                    placeholder="admin"
                  />
                </div>

                <div className="space-y-1.5">
                  <label
                    htmlFor="password"
                    className="block text-sm font-medium text-slate-700 dark:text-slate-300"
                  >
                    Mot de passe
                  </label>
                  <div className="relative">
                    <input
                      id="password"
                      name="password"
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      autoComplete="current-password"
                      className="block w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 pr-10 text-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900 dark:focus:ring-slate-100 focus:border-transparent"
                      placeholder="••••••••"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      aria-label={showPassword ? 'Masquer' : 'Afficher'}
                      tabIndex={-1}
                      className="absolute inset-y-0 right-0 px-3 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                    >
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>

                <label className="flex items-center gap-2 select-none cursor-pointer pt-1">
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                    className="w-4 h-4 rounded border-slate-300 dark:border-slate-700 text-slate-900 focus:ring-slate-900 dark:focus:ring-slate-100"
                  />
                  <span className="text-sm text-slate-600 dark:text-slate-400">
                    Rester connecté
                  </span>
                </label>
              </>
            ) : (
              <div className="space-y-3">
                <div>
                  <h2 className="text-base font-semibold">Code à deux facteurs</h2>
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    Saisis le code à 6 chiffres de ton authenticator.
                  </p>
                </div>
                <input
                  type="text"
                  value={totp}
                  onChange={(e) => setTotp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  inputMode="numeric"
                  maxLength={6}
                  autoFocus
                  className="block w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-3 text-center text-xl font-mono tracking-[0.4em] focus:outline-none focus:ring-2 focus:ring-slate-900 dark:focus:ring-slate-100 focus:border-transparent"
                  placeholder="000000"
                />
              </div>
            )}

            {error && (
              <div
                role="alert"
                className="flex items-start gap-2 px-3 py-2 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-red-700 dark:text-red-300"
              >
                <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
                <p className="text-sm leading-snug">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !username || !password || (showTotp && totp.length < 6)}
              className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 px-4 py-2 text-sm font-medium hover:bg-slate-800 dark:hover:bg-white disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-slate-900 dark:focus:ring-slate-100 dark:focus:ring-offset-slate-900 transition-colors"
            >
              {loading && <Loader2 size={16} className="animate-spin" />}
              {loading
                ? 'Connexion…'
                : showTotp
                  ? 'Valider'
                  : 'Se connecter'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;
