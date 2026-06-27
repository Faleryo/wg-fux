import React, { useState, useEffect } from 'react';
import {
  Key,
  Shield,
  Eye,
  EyeOff,
  RefreshCw,
  Save,
  Calendar,
} from 'lucide-react';
import Modal from '../ui/Modal';
import { useTheme } from '../../context/ThemeContext';
import { cn, COLOR_MAP } from '../../lib/utils';
import VibeButton from '../ui/Button';

const EditUserModal = ({ isOpen, onClose, user, onSave, onReset2FA }) => {
  const { theme } = useTheme();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [role, setRole] = useState('viewer');
  const [expiry, setExpiry] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    if (user) {
      setRole(user.role || 'viewer');
      setExpiry(user.expiry ? new Date(user.expiry).toISOString().split('T')[0] : '');
      setPassword('');
      setConfirmPassword('');
      setError('');
      setSuccess('');
    }
  }, [user, isOpen]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (password && password.length < 8) {
      setError('Mot de passe : 8 caractères minimum');
      return;
    }
    if (password !== confirmPassword) {
      setError('Les mots de passe ne correspondent pas');
      return;
    }

    setSaving(true);
    try {
      const updateData = {};
      if (password) updateData.password = password;
      if (role !== user.role) updateData.role = role;
      const currentExpiry = user.expiry ? new Date(user.expiry).toISOString().split('T')[0] : '';
      if (expiry !== currentExpiry) updateData.expiry = expiry || null;

      await onSave(user.username, updateData);
      setPassword('');
      setConfirmPassword('');
      onClose();
    } catch (err) {
      setError(err?.response?.data?.error || 'Erreur lors de la mise à jour');
    } finally {
      setSaving(false);
    }
  };

  const handleReset2FA = async () => {
    if (
      !window.confirm(
        `Réinitialiser le 2FA pour ${user.username} ? L'opérateur pourra se reconnecter sans son code actuel.`
      )
    )
      return;

    setResetting(true);
    setError('');
    try {
      await onReset2FA(user.username);
      setSuccess('Secret 2FA réinitialisé');
    } catch (err) {
      setError(err?.response?.data?.error || 'Erreur reset 2FA');
    } finally {
      setResetting(false);
    }
  };

  const roles = [
    { id: 'viewer', label: 'Viewer', desc: 'Lecture seule' },
    { id: 'manager', label: 'Manager', desc: 'Gestion Clients' },
    { id: 'admin', label: 'Admin', desc: 'Accès complet' },
  ];

  if (!user) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Éditer: ${user.username}`}
      maxWidth="max-w-md"
    >
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Identity Info (ReadOnly) */}
        <div className="p-4 rounded-2xl bg-white/5 border border-white/5 flex items-center gap-4">
          <div
            className='w-12 h-12 rounded-2xl flex items-center justify-center text-white font-black'
            style={{ backgroundColor: COLOR_MAP[theme]?.[600] || '#6366f1' }}
          >
            {user.username.charAt(0).toUpperCase()}
          </div>
          <div>
            <div className="text-xs font-black text-white uppercase tracking-tight">
              {user.username}
            </div>
            <div className="text-[9px] font-bold text-slate-500 uppercase tracking-widest italic">
              Identité Verrouillée
            </div>
          </div>
        </div>

        {/* Role Selector */}
        <div>
          <label className="block text-[10px] font-black text-slate-500 mb-3 uppercase tracking-widest">
            Niveau d'Accès
          </label>
          <div className="grid grid-cols-3 gap-2">
            {roles.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => setRole(r.id)}
                className={cn(
                  'flex flex-col items-center gap-2 py-3 rounded-2xl border transition-all duration-300 text-center',
                  role === r.id
                    ? 'bg-indigo-500/10 border-indigo-500/40 text-indigo-400 shadow-lg'
                    : 'bg-white/5 border-white/5 text-slate-500 hover:text-slate-300'
                )}
              >
                <Shield size={16} />
                <div className="text-[9px] font-black uppercase tracking-tighter">{r.label}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Expiry Date */}
        <div>
          <label className="block text-[10px] font-black text-slate-500 mb-2 uppercase tracking-widest">
            Date d'Expiration
            <span className="ml-2 text-emerald-500/60">Optionnel</span>
          </label>
          <div className="relative group">
            <Calendar className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
            <input
              type="date"
              value={expiry}
              onChange={(e) => setExpiry(e.target.value)}
              min={new Date().toISOString().split('T')[0]}
              className="w-full pl-12 pr-6 py-4 glass-input rounded-2xl font-mono text-sm text-white"
            />
          </div>
          {expiry && (
            <button
              type="button"
              onClick={() => setExpiry('')}
              className="mt-1 text-[9px] text-red-400/70 hover:text-red-400 uppercase tracking-widest"
            >
              Supprimer l'expiration
            </button>
          )}
        </div>

        {/* Change Password (Optional) */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest">
              Nouveau Mot de Passe
            </label>
            <span className="text-[8px] font-bold text-emerald-500/60 uppercase">Optionnel</span>
          </div>
          <div className="relative group">
            <Key className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full pl-12 pr-12 py-4 glass-input rounded-2xl font-mono text-sm"
              placeholder="Laisser vide pour inchangé"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500"
            >
              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>

          {password && (
            <div className="relative group animate-in fade-in slide-in-from-top-2">
              <Key className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
              <input
                type={showPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full pl-12 pr-6 py-4 glass-input rounded-2xl font-mono text-sm"
                placeholder="Confirmer nouveau mot de passe"
              />
            </div>
          )}
        </div>

        {/* 2FA Reset */}
        <div className="pt-2">
          <button
            type="button"
            onClick={handleReset2FA}
            disabled={resetting || saving}
            className="w-full py-3 bg-indigo-500/5 hover:bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2 disabled:opacity-40"
          >
            <RefreshCw size={14} className={resetting ? 'animate-spin' : ''} />
            {resetting ? 'Réinitialisation...' : 'Réinitialiser 2FA (TOTP)'}
          </button>
        </div>

        {/* Messages */}
        {error && (
          <div className="p-4 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-400 text-[10px] font-black uppercase">
            {error}
          </div>
        )}
        {success && (
          <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[10px] font-black uppercase">
            {success}
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-4 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-4 bg-white/5 text-slate-400 font-black uppercase text-xs tracking-widest rounded-2xl border border-white/5"
          >
            Annuler
          </button>
          <VibeButton
            type="submit"
            variant="primary"
            loading={saving}
            icon={Save}
            className="flex-[2] py-4"
          >
            Sauvegarder
          </VibeButton>
        </div>
      </form>
    </Modal>
  );
};

export default EditUserModal;
