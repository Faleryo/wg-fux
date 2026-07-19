import React, { useState, useRef, useEffect } from 'react';
import { Users, Key, Shield, Eye, EyeOff, RefreshCw, Plus } from 'lucide-react';
import Modal from '../ui/Modal';
import { useTheme } from '../../context/ThemeContext';
import { useLang } from '../../context/LanguageContext';
import { cn, COLOR_MAP } from '../../lib/utils';

const CreateUserModal = ({ isOpen, onClose, onCreate }) => {
  const { theme } = useTheme();
  const { t } = useLang();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [role, setRole] = useState('viewer');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const submittingRef = useRef(false);

  useEffect(() => {
    if (!isOpen) return;
    submittingRef.current = false;
    setUsername('');
    setPassword('');
    setConfirmPassword('');
    setRole('viewer');
    setError('');
  }, [isOpen]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submittingRef.current) return;
    setError('');

    if (!username.trim()) {
      setError(t('username_required'));
      return;
    }
    if (!/^[a-zA-Z0-9_-]{2,64}$/.test(username.trim())) {
      setError(t('username_invalid'));
      return;
    }
    if (password.length < 8) {
      setError(t('password_min'));
      return;
    }
    if (password !== confirmPassword) {
      setError(t('passwords_mismatch'));
      return;
    }

    submittingRef.current = true;
    setLoading(true);
    try {
      await onCreate(username.trim(), password, role);
      setUsername('');
      setPassword('');
      setConfirmPassword('');
      setRole('viewer');
      onClose();
    } catch (err) {
      setError(err?.response?.data?.error || t('create_error'));
    } finally {
      setLoading(false);
      submittingRef.current = false;
    }
  };

  const roles = [
    { id: 'viewer', label: t('role_viewer_badge'), desc: t('role_viewer_desc'), color: 'slate' },
    {
      id: 'manager',
      label: t('role_manager_badge'),
      desc: t('role_manager_desc'),
      color: 'indigo',
    },
    { id: 'admin', label: t('role_admin_badge'), desc: t('role_admin_desc'), color: theme },
  ];

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t('create_operator_title')} maxWidth="max-w-md">
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Username */}
        <div>
          <label className="block text-[11px] font-black text-slate-500 mb-2 uppercase tracking-widest">
            {t('field_username')}
          </label>
          <div className="relative group">
            <Users
              className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-slate-900 dark:group-focus-within:text-white transition-colors"
              size={18}
            />
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full pl-12 pr-6 py-4 glass-input rounded-2xl font-mono"
              placeholder={t('placeholder_username')}
              autoFocus
            />
          </div>
        </div>

        {/* Password */}
        <div>
          <label className="block text-[11px] font-black text-slate-500 mb-2 uppercase tracking-widest">
            {t('field_password')}
          </label>
          <div className="relative group">
            <Key
              className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-slate-900 dark:group-focus-within:text-white transition-colors"
              size={18}
            />
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full pl-12 pr-12 py-4 glass-input rounded-2xl font-mono"
              placeholder="••••••••"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-900 dark:hover:text-white transition-colors"
            >
              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
        </div>

        {/* Confirm Password */}
        <div>
          <label className="block text-[11px] font-black text-slate-500 mb-2 uppercase tracking-widest">
            {t('field_confirm_password')}
          </label>
          <div className="relative group">
            <Key
              className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-slate-900 dark:group-focus-within:text-white transition-colors"
              size={18}
            />
            <input
              type={showPassword ? 'text' : 'password'}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full pl-12 pr-6 py-4 glass-input rounded-2xl font-mono"
              placeholder="••••••••"
            />
          </div>
        </div>

        {/* Role Selector */}
        <div>
          <label className="block text-[11px] font-black text-slate-500 mb-3 uppercase tracking-widest">
            {t('col_role')}
          </label>
          <div className="grid grid-cols-3 gap-3">
            {roles.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => setRole(r.id)}
                className={cn(
                  'flex flex-col items-center gap-2 py-4 rounded-2xl border transition-all duration-300 text-center',
                  role === r.id
                    ? ''
                    : 'bg-white/5 border-white/5 text-slate-500 hover:border-white/10 hover:text-slate-300'
                )}
                style={
                  role === r.id
                    ? {
                        backgroundColor: `${COLOR_MAP[r.color]?.[500] || '#64748b'}1a`,
                        borderColor: `${COLOR_MAP[r.color]?.[500] || '#64748b'}66`,
                        color: COLOR_MAP[r.color]?.[400] || '#94a3b8',
                        boxShadow: `0 10px 15px -3px ${COLOR_MAP[r.color]?.[500] || '#64748b'}1a`,
                      }
                    : undefined
                }
              >
                <Shield size={20} />
                <div>
                  <div className="text-[11px] font-black uppercase tracking-widest">{r.label}</div>
                  <div className="text-[11px] opacity-60 mt-0.5">{r.desc}</div>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="p-4 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-bold uppercase tracking-tight">
            {error}
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-4 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-4 bg-white/5 hover:bg-white/10 text-slate-400 font-black uppercase text-xs tracking-widest rounded-2xl border border-white/5 transition-all"
          >
            {t('cancel')}
          </button>
          <button
            type="submit"
            disabled={loading || !username || !password || !confirmPassword}
            className={cn(
              'flex-[2] py-4 text-white font-black uppercase text-xs tracking-widest rounded-2xl shadow-2xl transition-all flex items-center justify-center gap-3 active:scale-95 disabled:opacity-30'
            )}
            style={{
              backgroundColor: COLOR_MAP[theme]?.[600] || '#4f46e5',
              boxShadow: `0 10px 15px -3px ${COLOR_MAP[theme]?.[600] || '#4f46e5'}4d`,
            }}
            onMouseEnter={(e) =>
              (e.currentTarget.style.backgroundColor = COLOR_MAP[theme]?.[500] || '#6366f1')
            }
            onMouseLeave={(e) =>
              (e.currentTarget.style.backgroundColor = COLOR_MAP[theme]?.[600] || '#4f46e5')
            }
          >
            {loading ? (
              <RefreshCw className="animate-spin" size={18} />
            ) : (
              <Plus size={18} strokeWidth={3} />
            )}
            {t('create_operator_btn')}
          </button>
        </div>
      </form>
    </Modal>
  );
};

export default CreateUserModal;
