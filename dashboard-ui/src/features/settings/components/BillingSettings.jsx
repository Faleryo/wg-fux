import React, { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { CreditCard, Send, MessageCircle, Save, CheckCircle2, KeyRound } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { axiosInstance } from '../../../lib/api';

// Champ générique. Pour un secret déjà configuré, on affiche un placeholder
// "•••• configuré" et on n'envoie la valeur que si l'admin la retape.
const Field = ({ label, icon: Icon, value, onChange, placeholder, secret, configured, isDark }) => (
  <div className="space-y-2">
    <label className="flex items-center gap-2 text-[10px] font-black text-slate-500 uppercase tracking-widest">
      {Icon && <Icon size={12} />} {label}
      {secret && configured && (
        <span className="text-emerald-400/80 inline-flex items-center gap-1">
          <CheckCircle2 size={11} /> configuré
        </span>
      )}
    </label>
    <input
      type={secret ? 'password' : 'text'}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={secret && configured ? '•••••••• (laisser vide pour conserver)' : placeholder}
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

const BillingSettings = ({ addToast, isDark }) => {
  const [settings, setSettings] = useState(null);
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await axiosInstance.get('/settings');
      setSettings(res.data || {});
    } catch (e) {
      addToast(e?.response?.data?.error || 'Erreur de chargement des réglages', 'error');
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
      addToast(`Réglages enregistrés (${res.data.updated?.length || 0})`, 'success');
      setForm({});
      load();
    } catch (e) {
      addToast(e?.response?.data?.error || "Erreur d'enregistrement", 'error');
    } finally {
      setSaving(false);
    }
  };

  if (!settings) {
    return <div className="py-16 text-center text-slate-500 text-xs uppercase tracking-widest">Chargement…</div>;
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
        <h3 className={cn('text-xl font-black flex items-center gap-3 italic uppercase', isDark ? 'text-white' : 'text-slate-900')}>
          <CreditCard size={20} className="text-indigo-400" /> Stripe — Renouvellement auto
        </h3>
        <p className="text-[11px] text-slate-500 leading-relaxed max-w-2xl">
          Quand un revendeur paie, sa licence est prolongée automatiquement. Configurez l&apos;URL du webhook
          Stripe sur <code className="text-indigo-400">https://VOTRE-DOMAINE/stripe/webhook</code>, avec dans
          les métadonnées du paiement <code className="text-indigo-400">serverId</code> et{' '}
          <code className="text-indigo-400">days</code>. Sans Stripe, le contact ci-dessous est affiché aux revendeurs.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Field label="Clé secrète Stripe" icon={KeyRound} secret configured={conf('stripe_secret_key')}
            value={form.stripe_secret_key ?? ''} onChange={(v) => set('stripe_secret_key', v)}
            placeholder="sk_live_…" isDark={isDark} />
          <Field label="Secret du webhook" icon={KeyRound} secret configured={conf('stripe_webhook_secret')}
            value={form.stripe_webhook_secret ?? ''} onChange={(v) => set('stripe_webhook_secret', v)}
            placeholder="whsec_…" isDark={isDark} />
          <Field label="Clé publiable" value={form.stripe_publishable_key ?? pub('stripe_publishable_key')}
            onChange={(v) => set('stripe_publishable_key', v)} placeholder="pk_live_…" isDark={isDark} />
          <Field label="ID de prix (Price ID)" value={form.stripe_price_id ?? pub('stripe_price_id')}
            onChange={(v) => set('stripe_price_id', v)} placeholder="price_…" isDark={isDark} />
        </div>
      </section>

      {/* Contact de paiement (fallback sans Stripe) */}
      <section className="space-y-6">
        <h3 className={cn('text-xl font-black flex items-center gap-3 italic uppercase', isDark ? 'text-white' : 'text-slate-900')}>
          <MessageCircle size={20} className="text-emerald-400" /> Contact de paiement
        </h3>
        <p className="text-[11px] text-slate-500 max-w-2xl">
          Affiché aux revendeurs pour renouveler quand Stripe n&apos;est pas actif (paiement manuel via WhatsApp/Telegram).
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Field label="WhatsApp" icon={MessageCircle} value={form.payment_contact_whatsapp ?? pub('payment_contact_whatsapp')}
            onChange={(v) => set('payment_contact_whatsapp', v)} placeholder="+33 6 12 34 56 78" isDark={isDark} />
          <Field label="Telegram (contact)" icon={Send} value={form.payment_contact_telegram ?? pub('payment_contact_telegram')}
            onChange={(v) => set('payment_contact_telegram', v)} placeholder="@moncompte" isDark={isDark} />
        </div>
        <Field label="Instructions de paiement" value={form.payment_instructions ?? pub('payment_instructions')}
          onChange={(v) => set('payment_instructions', v)} placeholder="ex: Virement / PayPal — 15€/mois par VPS" isDark={isDark} />
      </section>

      {/* Telegram (bot d'alertes) */}
      <section className="space-y-6">
        <h3 className={cn('text-xl font-black flex items-center gap-3 italic uppercase', isDark ? 'text-white' : 'text-slate-900')}>
          <Send size={20} className="text-sky-400" /> Bot Telegram (alertes)
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Field label="Token du bot" icon={KeyRound} secret configured={conf('telegram_bot_token')}
            value={form.telegram_bot_token ?? ''} onChange={(v) => set('telegram_bot_token', v)}
            placeholder="123456:ABC-DEF…" isDark={isDark} />
          <Field label="Chat ID" value={form.telegram_chat_id ?? pub('telegram_chat_id')}
            onChange={(v) => set('telegram_chat_id', v)} placeholder="-100123456789" isDark={isDark} />
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
          <Save size={16} /> Enregistrer
        </button>
      </div>
    </motion.div>
  );
};

export default BillingSettings;
