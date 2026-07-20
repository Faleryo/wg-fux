import React, { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { CreditCard, Send, MessageCircle, Save, CheckCircle2, KeyRound } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { axiosInstance } from '../../../lib/api';
import { useLang } from '../../../context/LanguageContext';

// Champ générique. Pour un secret déjà configuré, on affiche un placeholder
// "•••• configuré" et on n'envoie la valeur que si l'admin la retape.
const Field = ({ label, icon: Icon, value, onChange, placeholder, secret, configured, isDark }) => {
  const { t } = useLang();
  return (
  <div className="space-y-2">
    <label className="flex items-center gap-2 text-[11px] font-black text-slate-500 uppercase tracking-widest">
      {Icon && <Icon size={12} />} {label}
      {secret && configured && (
        <span className="text-emerald-400/80 inline-flex items-center gap-1">
          <CheckCircle2 size={11} /> {t('configured_badge')}
        </span>
      )}
    </label>
    <input
      type={secret ? 'password' : 'text'}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={secret && configured ? t('secret_keep_placeholder') : placeholder}
      autoComplete="off"
      className={cn(
        'w-full border rounded-2xl px-5 py-3.5 font-mono text-sm focus:outline-none transition-all',
        isDark
          ? 'bg-white/5 border-white/5 text-white focus:border-white/10 focus:bg-white/10'
          : 'bg-slate-50 border-black/5 text-slate-900 focus:border-indigo-500/20 focus:bg-white'
      )}
    />
  </div>
  );
};

const BillingSettings = ({ addToast, isDark }) => {
  const { t } = useLang();
  const [settings, setSettings] = useState(null);
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await axiosInstance.get('/settings');
      setSettings(res.data || {});
    } catch (e) {
      addToast(e?.response?.data?.error || t('settings_load_err'), 'error');
    }
  }, [addToast]);

  useEffect(() => {
    load();
  }, [load]);

  const set = (key, val) => setForm((f) => ({ ...f, [key]: val }));

  const handleSave = async () => {
    setSaving(true);
    try {
      // On n'envoie que les champs saisis (les secrets vides sont ignorés côté API).
      const payload = Object.fromEntries(Object.entries(form).filter(([, v]) => v !== undefined));
      const res = await axiosInstance.put('/settings', payload);
      addToast(`${t('settings_saved')} (${res.data.updated?.length || 0})`, 'success');
      setForm({});
      load();
    } catch (e) {
      addToast(e?.response?.data?.error || t('settings_save_err'), 'error');
    } finally {
      setSaving(false);
    }
  };

  if (!settings) {
    return (
      <div className="py-16 text-center text-slate-500 text-xs uppercase tracking-widest">
        {t('loading')}
      </div>
    );
  }

  const conf = (k) => Boolean(settings[k]?.configured);
  const pub = (k) => (typeof settings[k] === 'string' ? settings[k] : '');

  return (
    <motion.div
      key="billing"
      initial={{ opacity: 0, x: 10 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -10 }}
      className="space-y-12"
    >
      {/* Stripe */}
      <section className="space-y-6">
        <h3
          className={cn(
            'text-xl font-black flex items-center gap-3 italic',
            isDark ? 'text-white' : 'text-slate-900'
          )}
        >
          <CreditCard size={20} className="text-indigo-400" /> {t('billing_stripe_title')}
        </h3>
        <p className="text-[11px] text-slate-500 leading-relaxed max-w-2xl">
          {t('billing_stripe_desc_1')}{' '}
          <code className="text-indigo-400">https://VOTRE-DOMAINE/stripe/webhook</code>.{' '}
          {t('billing_stripe_desc_2')}
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Field
            label={t('f_stripe_secret')}
            icon={KeyRound}
            secret
            configured={conf('stripe_secret_key')}
            value={form.stripe_secret_key ?? ''}
            onChange={(v) => set('stripe_secret_key', v)}
            placeholder="sk_live_…"
            isDark={isDark}
          />
          <Field
            label={t('f_stripe_webhook')}
            icon={KeyRound}
            secret
            configured={conf('stripe_webhook_secret')}
            value={form.stripe_webhook_secret ?? ''}
            onChange={(v) => set('stripe_webhook_secret', v)}
            placeholder="whsec_…"
            isDark={isDark}
          />
          <Field
            label={t('f_stripe_publishable')}
            value={form.stripe_publishable_key ?? pub('stripe_publishable_key')}
            onChange={(v) => set('stripe_publishable_key', v)}
            placeholder="pk_live_…"
            isDark={isDark}
          />
          <Field
            label={t('f_stripe_price_id')}
            value={form.stripe_price_id ?? pub('stripe_price_id')}
            onChange={(v) => set('stripe_price_id', v)}
            placeholder="price_…"
            isDark={isDark}
          />
          <Field
            label={t('f_credit_price')}
            value={form.credit_price_cents ?? pub('credit_price_cents')}
            onChange={(v) => set('credit_price_cents', v)}
            placeholder={t('ph_credit_price')}
            isDark={isDark}
          />
          <Field
            label={t('f_currency')}
            value={form.billing_currency ?? pub('billing_currency')}
            onChange={(v) => set('billing_currency', v)}
            placeholder="eur"
            isDark={isDark}
          />
        </div>
      </section>

      {/* Plateforme : CGU + gel des mises à jour de la flotte */}
      <section className="space-y-6">
        <h3
          className={cn(
            'text-xl font-black flex items-center gap-3 italic uppercase',
            isDark ? 'text-white' : 'text-slate-900'
          )}
        >
          <KeyRound size={20} className="text-amber-400" /> {t('billing_platform')}
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Field
            label={t('f_terms_url')}
            value={form.terms_url ?? pub('terms_url')}
            onChange={(v) => set('terms_url', v)}
            placeholder="https://votre-domaine/cgu"
            isDark={isDark}
          />
          <Field
            label={t('f_update_paused')}
            value={form.update_paused ?? pub('update_paused')}
            onChange={(v) => set('update_paused', v)}
            placeholder="0 ou 1"
            isDark={isDark}
          />
        </div>
      </section>

      {/* Contact de paiement (fallback sans Stripe) */}
      <section className="space-y-6">
        <h3
          className={cn(
            'text-xl font-black flex items-center gap-3 italic',
            isDark ? 'text-white' : 'text-slate-900'
          )}
        >
          <MessageCircle size={20} className="text-emerald-400" /> {t('billing_payment_contact')}
        </h3>
        <p className="text-[11px] text-slate-500 max-w-2xl">
          {t('billing_payment_contact_desc')}
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Field
            label="WhatsApp"
            icon={MessageCircle}
            value={form.payment_contact_whatsapp ?? pub('payment_contact_whatsapp')}
            onChange={(v) => set('payment_contact_whatsapp', v)}
            placeholder="+33 6 12 34 56 78"
            isDark={isDark}
          />
          <Field
            label={t('f_telegram_contact')}
            icon={Send}
            value={form.payment_contact_telegram ?? pub('payment_contact_telegram')}
            onChange={(v) => set('payment_contact_telegram', v)}
            placeholder="@moncompte"
            isDark={isDark}
          />
        </div>
        <Field
          label={t('f_payment_instructions')}
          value={form.payment_instructions ?? pub('payment_instructions')}
          onChange={(v) => set('payment_instructions', v)}
          placeholder={t('ph_payment_instructions')}
          isDark={isDark}
        />
      </section>

      {/* Telegram (bot d'alertes) */}
      <section className="space-y-6">
        <h3
          className={cn(
            'text-xl font-black flex items-center gap-3 italic',
            isDark ? 'text-white' : 'text-slate-900'
          )}
        >
          <Send size={20} className="text-sky-400" /> {t('billing_telegram_bot')}
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Field
            label={t('f_bot_token')}
            icon={KeyRound}
            secret
            configured={conf('telegram_bot_token')}
            value={form.telegram_bot_token ?? ''}
            onChange={(v) => set('telegram_bot_token', v)}
            placeholder="123456:ABC-DEF…"
            isDark={isDark}
          />
          <Field
            label="Chat ID"
            value={form.telegram_chat_id ?? pub('telegram_chat_id')}
            onChange={(v) => set('telegram_chat_id', v)}
            placeholder="-100123456789"
            isDark={isDark}
          />
        </div>
      </section>

      <div className="flex justify-end pt-2">
        <button
          onClick={handleSave}
          disabled={saving || Object.keys(form).length === 0}
          className={cn(
            'inline-flex items-center gap-2 px-8 py-3.5 rounded-2xl font-black uppercase tracking-widest text-xs transition-all',
            saving || Object.keys(form).length === 0
              ? 'bg-white/5 text-slate-600 cursor-not-allowed'
              : 'bg-indigo-500 hover:bg-indigo-400 text-white shadow-lg hover:scale-105'
          )}
        >
          <Save size={16} /> {t('save')}
        </button>
      </div>
    </motion.div>
  );
};

export default BillingSettings;
