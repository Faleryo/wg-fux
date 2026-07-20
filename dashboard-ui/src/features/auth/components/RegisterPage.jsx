import React, { useState, useEffect, useCallback } from 'react';
import { Eye, EyeOff, AlertCircle, CheckCircle2, UserPlus } from 'lucide-react';
import { axiosInstance } from '../../../lib/api';
import { useLang } from '../../../context/LanguageContext';

// Page d'inscription par invitation (?invite=<token> dans l'URL).
// Affiche la marque de l'inviteur (white-label) et exige les CGU si la
// plateforme en a configuré. À la réussite, renvoie vers l'écran de connexion.
const RegisterPage = ({ inviteToken, onDone }) => {
  const { t } = useLang();
  const [info, setInfo] = useState(null); // { inviter, termsUrl, brand } | 'invalid'
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const loadInvite = useCallback(async () => {
    try {
      const { data } = await axiosInstance.get(`/auth/invite/${inviteToken}`);
      setInfo(data);
    } catch {
      setInfo('invalid');
    }
  }, [inviteToken]);

  useEffect(() => {
    loadInvite();
  }, [loadInvite]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!username || !password || loading) return;
    setLoading(true);
    setError('');
    try {
      await axiosInstance.post('/auth/register', {
        token: inviteToken,
        username,
        password,
        ...(email ? { email } : {}),
        ...(info?.termsUrl ? { acceptTerms } : {}),
      });
      setSuccess(true);
    } catch (err) {
      setError(err.response?.data?.error || t('register_failed'));
    } finally {
      setLoading(false);
    }
  };

  const brand = info && info !== 'invalid' ? info.brand : null;
  const brandName = brand?.name || 'wg-fux';
  const accent = brand?.primaryColor || '#6366f1';

  const inputCls =
    'w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-white/25 font-mono';

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950 p-4">
      <div className="w-full max-w-md bg-white/5 border border-white/10 rounded-3xl p-10 space-y-6 shadow-2xl">
        <div className="flex items-center gap-4">
          {brand?.logoUrl ? (
            <img
              src={brand.logoUrl}
              alt={brandName}
              className="w-12 h-12 rounded-xl object-contain"
            />
          ) : (
            <div
              className="w-12 h-12 rounded-xl flex items-center justify-center"
              style={{ backgroundColor: accent + '33', color: accent }}
            >
              <UserPlus size={24} />
            </div>
          )}
          <div>
            <h1 className="text-2xl font-black text-white tracking-tight italic">{brandName}</h1>
            <p className="text-[11px] font-black text-slate-500 uppercase tracking-[0.3em]">
              {t('register_subtitle')}
            </p>
          </div>
        </div>

        {info === null && (
          <div className="text-center text-slate-500 text-xs uppercase tracking-widest py-8">
            {t('verifying')}
          </div>
        )}

        {info === 'invalid' && (
          <div className="flex items-center gap-3 text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3">
            <AlertCircle size={18} /> {t('invite_invalid')}
          </div>
        )}

        {success && (
          <div className="space-y-5">
            <div className="flex items-center gap-3 text-emerald-400 text-sm bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-4 py-3">
              <CheckCircle2 size={18} /> {t('account_created')}
            </div>
            <button
              onClick={onDone}
              className="w-full py-3.5 rounded-xl font-black uppercase tracking-widest text-xs text-white transition-all hover:scale-[1.02]"
              style={{ backgroundColor: accent }}
            >
              {t('sign_in')}
            </button>
          </div>
        )}

        {info && info !== 'invalid' && !success && (
          <form onSubmit={handleSubmit} className="space-y-4">
            <p className="text-[11px] text-slate-500">
              {t('invited_by')} <span className="text-slate-300 font-bold">{info.inviter}</span>
            </p>
            <input
              className={inputCls}
              placeholder={t('ph_username_simple')}
              value={username}
              autoComplete="username"
              onChange={(e) => setUsername(e.target.value)}
            />
            <div className="relative">
              <input
                className={inputCls}
                type={showPassword ? 'text' : 'password'}
                placeholder={t('ph_password_min8')}
                value={password}
                autoComplete="new-password"
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white"
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            <input
              className={inputCls}
              type="email"
              placeholder={t('ph_email_reco')}
              value={email}
              autoComplete="email"
              onChange={(e) => setEmail(e.target.value)}
            />

            {info.termsUrl && (
              <label className="flex items-start gap-3 text-[11px] text-slate-400 cursor-pointer">
                <input
                  type="checkbox"
                  checked={acceptTerms}
                  onChange={(e) => setAcceptTerms(e.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  {t('accept_terms_prefix')}{' '}
                  <a
                    href={info.termsUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="underline"
                    style={{ color: accent }}
                  >
                    {t('terms_link_label')}
                  </a>
                </span>
              </label>
            )}

            {error && (
              <div className="flex items-center gap-2 text-red-400 text-xs bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-2.5">
                <AlertCircle size={14} /> {error}
              </div>
            )}

            <button
              type="submit"
              disabled={
                loading || !username || password.length < 8 || (info.termsUrl && !acceptTerms)
              }
              className="w-full py-3.5 rounded-xl font-black uppercase tracking-widest text-xs text-white transition-all hover:scale-[1.02] disabled:opacity-40 disabled:hover:scale-100"
              style={{ backgroundColor: accent }}
            >
              {loading ? t('creating') : t('create_my_account')}
            </button>
          </form>
        )}
      </div>
    </div>
  );
};

export default RegisterPage;
