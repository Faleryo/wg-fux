import React, { useState, useEffect, useCallback } from 'react';

import {
  Wallet,
  Users,
  Send,
  Plus,
  Palette,
  TrendingUp,
  RefreshCw,
  Save,
  Server,
  Power,
  PencilLine,
  Tag,
  Download,
  KeyRound,
  Search,
  AlertTriangle,
  Mail,
} from 'lucide-react';
import { useTheme } from '../../../context/ThemeContext';
import { useToast } from '../../../context/ToastContext';
import { useLang } from '../../../context/LanguageContext';
import { cn, COLOR_MAP } from '../../../lib/utils';
import { axiosInstance } from '../../../lib/api';
import GlassCard from '../../../components/ui/Card';
import VibeButton from '../../../components/ui/Button';
import NetworkStats from './NetworkStats';
import InvitesPanel from './InvitesPanel';

const euros = (cents) => (cents == null ? '—' : (cents / 100).toFixed(2) + ' €');

const REASON_KEYS = {
  topup: 'reason_topup',
  topup_stripe: 'reason_topup_stripe',
  transfer_in: 'reason_transfer_in',
  transfer_out: 'reason_transfer_out',
  monthly: 'reason_monthly',
  client_renewal: 'reason_client_renewal',
  license_renewal: 'reason_license_renewal',
  refund: 'reason_refund',
};

const NetworkSection = ({ userRole }) => {
  const { theme } = useTheme();
  const { addToast } = useToast();
  const { t } = useLang();
  const isAdmin = userRole === 'admin';

  const [wallet, setWallet] = useState(null);
  const [network, setNetwork] = useState([]);
  const [brand, setBrand] = useState({ name: '', logoUrl: '', primaryColor: '', customDomain: '' });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // Formulaires
  const [newSub, setNewSub] = useState({ username: '', password: '', sellPriceCents: '' });
  const [transferForm, setTransferForm] = useState({ toUserId: '', credits: '' });
  const [topupForm, setTopupForm] = useState({ userId: '', credits: '', priceCents: '' });
  const [buyCredits, setBuyCredits] = useState('');
  const [myPrice, setMyPrice] = useState('');
  const [priceEdit, setPriceEdit] = useState(null); // { id, username, value }
  // Recherche / tri / pagination du tableau réseau.
  const [netQuery, setNetQuery] = useState('');
  const [sortKey, setSortKey] = useState('username');
  const [sortDir, setSortDir] = useState('asc');
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 15;
  // Relevé : filtres + recherche.
  const [ledgerType, setLedgerType] = useState('');
  const [ledgerQuery, setLedgerQuery] = useState('');
  // Contact de paiement (admin) + résultat d'un reset de mot de passe.
  const [contact, setContact] = useState(null);
  const [contactBusy, setContactBusy] = useState(false);
  const [resetResult, setResetResult] = useState(null); // { username, password }
  const LOW_BALANCE = 3; // seuil d'alerte de solde bas (crédits)

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [w, n, b] = await Promise.all([
        axiosInstance.get('/wallet').catch(() => ({ data: null })),
        axiosInstance.get('/resellers').catch(() => ({ data: [] })),
        axiosInstance.get('/brand').catch(() => ({ data: { own: null } })),
      ]);
      setWallet(w.data);
      setNetwork(Array.isArray(n.data) ? n.data : []);
      const own = b.data?.own || {};
      setBrand({
        name: own.name || '',
        logoUrl: own.logoUrl || '',
        primaryColor: own.primaryColor || '',
        customDomain: own.customDomain || '',
      });
    } catch (e) {
      addToast(t('net_load_err'), 'error');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addToast]);

  useEffect(() => {
    load();
  }, [load]);

  const guard = async (fn) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  const createSub = () =>
    guard(async () => {
      try {
        await axiosInstance.post('/resellers', {
          username: newSub.username,
          password: newSub.password,
          ...(newSub.sellPriceCents ? { sellPriceCents: Number(newSub.sellPriceCents) } : {}),
        });
        addToast(t('subreseller_created'), 'success');
        setNewSub({ username: '', password: '', sellPriceCents: '' });
        load();
      } catch (e) {
        addToast(e?.response?.data?.error || t('err_creation'), 'error');
      }
    });

  const doTransfer = () =>
    guard(async () => {
      try {
        await axiosInstance.post('/credits/transfer', {
          toUserId: Number(transferForm.toUserId),
          credits: Number(transferForm.credits),
        });
        addToast(t('credits_transferred'), 'success');
        setTransferForm({ toUserId: '', credits: '' });
        load();
      } catch (e) {
        addToast(e?.response?.data?.error || t('err_transfer'), 'error');
      }
    });

  const doTopup = () =>
    guard(async () => {
      try {
        await axiosInstance.post('/credits/topup', {
          userId: Number(topupForm.userId),
          credits: Number(topupForm.credits),
          ...(topupForm.priceCents ? { priceCents: Number(topupForm.priceCents) } : {}),
        });
        addToast(t('account_credited'), 'success');
        setTopupForm({ userId: '', credits: '', priceCents: '' });
        load();
      } catch (e) {
        addToast(e?.response?.data?.error || t('err_topup'), 'error');
      }
    });

  // Achat de crédits par Stripe Checkout (réservé aux comptes top-level ; un
  // sous-revendeur est renvoyé vers son parent par l'API).
  const doCheckout = () =>
    guard(async () => {
      try {
        const res = await axiosInstance.post('/credits/checkout', {
          credits: Number(buyCredits),
        });
        if (res.data?.url) window.location.href = res.data.url;
      } catch (e) {
        addToast(e?.response?.data?.error || t('err_payment'), 'error');
      }
    });

  // Mon prix de revente d'1 crédit (marge sur les transferts vers mon réseau).
  const saveMyPrice = () =>
    guard(async () => {
      try {
        await axiosInstance.put('/resellers/price', { sellPriceCents: Number(myPrice) });
        addToast(t('sell_price_saved'), 'success');
        load();
      } catch (e) {
        addToast(e?.response?.data?.error || t('err_price'), 'error');
      }
    });

  // Gestion d'un compte du réseau : activer/désactiver, prix de revente.
  const patchAccount = (id, payload, okMsg) =>
    guard(async () => {
      try {
        await axiosInstance.patch(`/resellers/${id}`, payload);
        addToast(okMsg, 'success');
        setPriceEdit(null);
        load();
      } catch (e) {
        addToast(e?.response?.data?.error || t('update_error'), 'error');
      }
    });

  const saveBrand = () =>
    guard(async () => {
      try {
        await axiosInstance.put('/brand', brand);
        addToast(t('brand_saved'), 'success');
        load();
      } catch (e) {
        addToast(e?.response?.data?.error || t('err_brand'), 'error');
      }
    });

  // Contact de paiement (réglages plateforme, admin uniquement).
  useEffect(() => {
    if (!isAdmin) return;
    axiosInstance
      .get('/settings')
      .then((r) =>
        setContact({
          payment_contact_whatsapp: r.data?.payment_contact_whatsapp || '',
          payment_contact_telegram: r.data?.payment_contact_telegram || '',
          payment_instructions: r.data?.payment_instructions || '',
        })
      )
      .catch(() => {});
  }, [isAdmin]);

  const saveContact = () =>
    guard(async () => {
      setContactBusy(true);
      try {
        await axiosInstance.put('/settings', contact);
        addToast(t('payment_contact_saved'), 'success');
      } catch (e) {
        addToast(e?.response?.data?.error || t('err_contact'), 'error');
      } finally {
        setContactBusy(false);
      }
    });

  // Réinitialise le mot de passe d'un compte (affiche le nouveau une fois).
  const resetPassword = (u) =>
    guard(async () => {
      try {
        const { data } = await axiosInstance.post(`/resellers/${u.id}/reset-password`);
        setResetResult({ username: data.username, password: data.password });
      } catch (e) {
        addToast(e?.response?.data?.error || t('err_reset'), 'error');
      }
    });

  // Édite l'email d'un compte (prompt simple).
  const editEmail = (u) => {
    const email = window.prompt(`${t('email_of')} ${u.username} :`, u.email || '');
    if (email === null) return;
    patchAccount(u.id, { email: email.trim() || null }, t('email_updated'));
  };

  // Export CSV du relevé de crédits (vue filtrée).
  const exportLedgerCsv = () => {
    const cols = ['reason', 'delta', 'priceCents', 'ref'];
    const esc = (v) => {
      const s = v == null ? '' : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = ['mouvement,credits,prix_centimes,ref'];
    for (const e of filteredLedger) lines.push(cols.map((c) => esc(e[c])).join(','));
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `wg-fux-releve-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 100);
  };

  const marginCents = wallet?.margin
    ? wallet.margin.resoldCents - wallet.margin.acquiredCostCents
    : 0;

  // Tri + recherche + pagination du réseau. Un compte est indenté sous son parent
  // (hiérarchie visuelle : parentId != null = sous-revendeur).
  const filteredNetwork = React.useMemo(() => {
    const q = netQuery.trim().toLowerCase();
    let rows = network.filter(
      (u) =>
        !q ||
        (u.username || '').toLowerCase().includes(q) ||
        (u.email || '').toLowerCase().includes(q) ||
        String(u.id).includes(q)
    );
    const dir = sortDir === 'asc' ? 1 : -1;
    rows = [...rows].sort((a, b) => {
      const va = a[sortKey],
        vb = b[sortKey];
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
      return String(va ?? '').localeCompare(String(vb ?? '')) * dir;
    });
    return rows;
  }, [network, netQuery, sortKey, sortDir]);

  const pageCount = Math.max(1, Math.ceil(filteredNetwork.length / PAGE_SIZE));
  const pagedNetwork = filteredNetwork.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  const filteredLedger = React.useMemo(() => {
    const q = ledgerQuery.trim().toLowerCase();
    return (wallet?.entries || []).filter(
      (e) =>
        (!ledgerType || e.reason === ledgerType) &&
        (!q ||
          (e.reason || '').toLowerCase().includes(q) ||
          (e.ref || '').toLowerCase().includes(q))
    );
  }, [wallet, ledgerType, ledgerQuery]);

  const toggleSort = (key) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key);
      setSortDir('asc');
    }
    setPage(0);
  };

  const inputCls =
    'w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-white/20 font-mono';

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-5 duration-700">
      {/* Header */}
      <GlassCard className="flex flex-col lg:flex-row justify-between items-center gap-6">
        <div className="flex items-center gap-6">
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center shadow-2xl border"
            style={{
              backgroundColor: (COLOR_MAP[theme]?.[600] || '#4f46e5') + '33',
              color: COLOR_MAP[theme]?.[400] || '#818cf8',
              borderColor: (COLOR_MAP[theme]?.[500] || '#6366f1') + '33',
            }}
          >
            <Users size={32} />
          </div>
          <div>
            <h2 className="text-3xl font-black text-white tracking-tighter italic">{t('network')}</h2>
            <p className="text-slate-500 text-[11px] font-black tracking-[0.3em] uppercase opacity-60">
              {t('net_subtitle')}
            </p>
          </div>
        </div>
        <VibeButton variant="secondary" icon={RefreshCw} onClick={load}>
          {t('refresh')}
        </VibeButton>
      </GlassCard>

      {/* Portefeuille */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <GlassCard hover={false}>
          <div className="flex items-center gap-3 text-slate-400 mb-3">
            <Wallet size={18} />{' '}
            <span className="text-[11px] font-black uppercase tracking-widest">
              {t('balance')}
            </span>
            {wallet && wallet.balance <= LOW_BALANCE && (
              <span className="ml-auto inline-flex items-center gap-1 text-[10px] font-black tracking-widest text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-lg">
                <AlertTriangle size={11} /> {t('low')}
              </span>
            )}
          </div>
          <div
            className={cn(
              'text-4xl font-black',
              wallet && wallet.balance <= LOW_BALANCE ? 'text-amber-400' : 'text-white'
            )}
          >
            {wallet?.balance ?? '—'}
          </div>
          <div className="text-[11px] text-slate-500 uppercase tracking-widest mt-1">
            {t('credits_word')}
          </div>
        </GlassCard>
        <GlassCard hover={false}>
          <div className="flex items-center gap-3 text-slate-400 mb-3">
            <TrendingUp size={18} />{' '}
            <span className="text-[11px] font-black uppercase tracking-widest">
              {t('margin')}
            </span>
          </div>
          <div
            className={cn(
              'text-4xl font-black',
              marginCents >= 0 ? 'text-emerald-400' : 'text-red-400'
            )}
          >
            {euros(marginCents)}
          </div>
          <div className="text-[11px] text-slate-500 uppercase tracking-widest mt-1">
            {t('resale_minus_acquisition')}
          </div>
        </GlassCard>
        <GlassCard hover={false}>
          <div className="flex items-center gap-3 text-slate-400 mb-3">
            <Users size={18} />{' '}
            <span className="text-[11px] font-black uppercase tracking-widest">
              {t('subresellers')}
            </span>
          </div>
          <div className="text-4xl font-black text-white">{network.length}</div>
          <div className="text-[11px] text-slate-500 uppercase tracking-widest mt-1">
            {t('linked_accounts')}
          </div>
        </GlassCard>
      </div>

      {/* Statistiques business (12 mois) */}
      <NetworkStats />

      {/* Acheter des crédits (Stripe) + mon prix */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <GlassCard hover={false}>
          <h3 className="text-lg font-black text-white tracking-tight mb-2 flex items-center gap-2">
            <Wallet size={18} /> {t('buy_credits')}
          </h3>
          <p className="text-[11px] text-slate-500 mb-4">
            {t('buy_credits_desc')}
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <input
              className={inputCls}
              placeholder={t('ph_credits_count')}
              value={buyCredits}
              onChange={(e) => setBuyCredits(e.target.value)}
            />
            <VibeButton
              variant="primary"
              icon={Wallet}
              onClick={doCheckout}
              disabled={busy || !Number(buyCredits)}
            >
              {t('pay_by_card')}
            </VibeButton>
          </div>
        </GlassCard>
        <GlassCard hover={false}>
          <h3 className="text-lg font-black text-white tracking-tight mb-2 flex items-center gap-2">
            <Tag size={18} /> {t('my_sell_price')}
          </h3>
          <p className="text-[11px] text-slate-500 mb-4">
            {t('my_sell_price_desc')}
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <input
              className={inputCls}
              placeholder={t('ph_cents_per_credit')}
              value={myPrice}
              onChange={(e) => setMyPrice(e.target.value)}
            />
            <VibeButton
              variant="secondary"
              icon={Save}
              onClick={saveMyPrice}
              disabled={busy || myPrice.trim() === '' || Number.isNaN(Number(myPrice))}
            >
              {t('save')}
            </VibeButton>
          </div>
        </GlassCard>
      </div>

      {/* Admin : top-up */}
      {isAdmin && (
        <GlassCard hover={false}>
          <h3 className="text-lg font-black text-white tracking-tight mb-4 flex items-center gap-2">
            <Plus size={18} /> {t('topup_account')}
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <input
              className={inputCls}
              placeholder="userId"
              value={topupForm.userId}
              onChange={(e) => setTopupForm({ ...topupForm, userId: e.target.value })}
            />
            <input
              className={inputCls}
              placeholder={t('ph_credits')}
              value={topupForm.credits}
              onChange={(e) => setTopupForm({ ...topupForm, credits: e.target.value })}
            />
            <input
              className={inputCls}
              placeholder={t('ph_price_per_credit')}
              value={topupForm.priceCents}
              onChange={(e) => setTopupForm({ ...topupForm, priceCents: e.target.value })}
            />
            <VibeButton variant="primary" icon={Plus} onClick={doTopup} disabled={busy}>
              {t('credit_btn')}
            </VibeButton>
          </div>
        </GlassCard>
      )}

      {/* Sous-revendeurs + création + transfert */}
      <GlassCard hover={false} className="p-0 overflow-hidden">
        <div className="p-6 border-b border-white/5 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <h3 className="text-lg font-black text-white tracking-tight flex items-center gap-2">
            <Users size={18} /> {t('my_network')}
          </h3>
          <div className="relative w-full md:w-64">
            <Search
              size={14}
              className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500"
            />
            <input
              value={netQuery}
              onChange={(e) => {
                setNetQuery(e.target.value);
                setPage(0);
              }}
              placeholder={t('ph_search_network')}
              className="w-full bg-white/5 border border-white/10 rounded-xl pl-9 pr-4 py-2.5 text-xs text-white font-mono focus:outline-none focus:border-white/20"
            />
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="text-[11px] font-black text-slate-500 uppercase tracking-[0.25em] border-b border-white/5">
                {[
                  ['username', t('col_account')],
                  ['enabled', t('col_status')],
                  ['balance', t('col_balance')],
                  ['serversCount', t('servers')],
                  ['clientsTotal', t('col_clients')],
                ].map(([key, label]) => (
                  <th
                    key={key}
                    className="px-6 py-4 cursor-pointer select-none hover:text-slate-300 transition-colors"
                    onClick={() => toggleSort(key)}
                  >
                    {label}
                    {sortKey === key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
                  </th>
                ))}
                <th className="px-6 py-4">{t('col_license_soon')}</th>
                <th className="px-6 py-4">{t('col_sell_price')}</th>
                <th className="px-6 py-4 text-right">{t('col_actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {pagedNetwork.map((u) => {
                const licDays = u.nextLicenseExpiry
                  ? Math.ceil((new Date(u.nextLicenseExpiry).getTime() - Date.now()) / 86400000)
                  : null;
                return (
                  <tr key={u.id} className={cn('hover:bg-white/5', !u.enabled && 'opacity-50')}>
                    <td className="px-6 py-4">
                      <div
                        className="flex items-center gap-2"
                        style={{ paddingLeft: u.parentId != null ? 18 : 0 }}
                      >
                        {u.parentId != null && <span className="text-slate-600">↳</span>}
                        <div>
                          <div className="text-sm font-bold text-white">{u.username}</div>
                          <div className="text-[11px] font-mono text-slate-500">
                            #{u.id}
                            {u.parentId != null
                              ? ` · ${t('subreseller_word')}`
                              : ` · ${t('reseller_word')}`}
                            {u.email ? ` · ${u.email}` : ''}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={cn(
                          'text-[11px] font-black uppercase tracking-widest px-3 py-1 rounded-lg border',
                          u.enabled
                            ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20'
                            : 'text-red-400 bg-red-500/10 border-red-500/20'
                        )}
                      >
                        {u.enabled ? t('status_active') : t('disabled_status')}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm font-mono text-emerald-400">{u.balance}</td>
                    <td className="px-6 py-4 text-xs font-mono text-slate-300">
                      <span className="inline-flex items-center gap-1.5">
                        <Server size={12} className="text-slate-500" />
                        {u.serversOnline ?? 0}/{u.serversCount ?? 0} {t('online_suffix')}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-xs font-mono text-slate-300">
                      {u.clientsTotal ?? 0}
                    </td>
                    <td className="px-6 py-4 text-[11px] font-mono">
                      {licDays === null ? (
                        <span className="text-slate-600">—</span>
                      ) : licDays <= 0 ? (
                        <span className="text-red-400 font-bold">{t('expired_short')}</span>
                      ) : (
                        <span className={licDays <= 7 ? 'text-amber-400' : 'text-slate-400'}>
                          {licDays} {t('unit_day')}
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-xs font-mono text-slate-400">
                      {priceEdit?.id === u.id ? (
                        <span className="inline-flex items-center gap-2">
                          <input
                            autoFocus
                            className="w-24 bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-white/20"
                            placeholder={t('ph_cents')}
                            value={priceEdit.value}
                            onChange={(e) => setPriceEdit({ ...priceEdit, value: e.target.value })}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter')
                                patchAccount(
                                  u.id,
                                  { sellPriceCents: Number(priceEdit.value) || 0 },
                                  t('price_updated')
                                );
                              if (e.key === 'Escape') setPriceEdit(null);
                            }}
                          />
                          <button
                            onClick={() =>
                              patchAccount(
                                u.id,
                                { sellPriceCents: Number(priceEdit.value) || 0 },
                                t('price_updated')
                              )
                            }
                            className="text-emerald-400 hover:text-emerald-300 text-[11px] font-black uppercase"
                          >
                            OK
                          </button>
                        </span>
                      ) : (
                        <button
                          className="inline-flex items-center gap-1.5 hover:text-white transition-colors"
                          title={t('edit_sell_price')}
                          onClick={() =>
                            setPriceEdit({
                              id: u.id,
                              value: u.sellPriceCents != null ? String(u.sellPriceCents) : '',
                            })
                          }
                        >
                          {euros(u.sellPriceCents)}
                          <PencilLine size={11} className="text-slate-600" />
                        </button>
                      )}
                    </td>
                    <td className="px-6 py-4 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-3">
                        <button
                          onClick={() => setTransferForm({ toUserId: String(u.id), credits: '' })}
                          className="text-indigo-400 hover:text-indigo-300 text-[11px] font-black tracking-widest"
                          title={t('prefill_transfer')}
                        >
                          {t('transfer_btn')}
                        </button>
                        {isAdmin && (
                          <button
                            onClick={() =>
                              setTopupForm({ userId: String(u.id), credits: '', priceCents: '' })
                            }
                            className="text-emerald-400 hover:text-emerald-300 text-[11px] font-black tracking-widest"
                            title={t('prefill_topup')}
                          >
                            {t('credit_btn')}
                          </button>
                        )}
                        <button
                          onClick={() => editEmail(u)}
                          className="text-slate-400 hover:text-white transition-colors"
                          title={t('edit_email')}
                        >
                          <Mail size={13} />
                        </button>
                        <button
                          onClick={() => resetPassword(u)}
                          className="text-amber-400/80 hover:text-amber-400 transition-colors"
                          title={t('reset_password')}
                        >
                          <KeyRound size={13} />
                        </button>
                        <button
                          onClick={() =>
                            patchAccount(
                              u.id,
                              { enabled: !u.enabled },
                              u.enabled ? t('account_disabled_msg') : t('account_reenabled_msg')
                            )
                          }
                          className={cn(
                            'inline-flex items-center gap-1 text-[11px] font-black tracking-widest',
                            u.enabled
                              ? 'text-red-400/80 hover:text-red-400'
                              : 'text-emerald-400 hover:text-emerald-300'
                          )}
                          title={u.enabled ? t('cut_account_access') : t('restore_access')}
                        >
                          <Power size={13} /> {u.enabled ? t('disable') : t('enable')}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filteredNetwork.length === 0 && (
                <tr>
                  <td
                    colSpan={8}
                    className="px-6 py-8 text-center text-slate-500 text-xs uppercase tracking-widest"
                  >
                    {netQuery ? t('no_account_matches') : t('no_subreseller')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {pageCount > 1 && (
          <div className="flex items-center justify-between px-6 py-3 border-t border-white/5">
            <span className="text-[11px] font-mono text-slate-500">
              {t('page_word')} {page + 1} / {pageCount} · {filteredNetwork.length}{' '}
              {t('accounts_word')}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-[11px] font-black tracking-widest text-slate-300 disabled:opacity-40 transition-colors"
              >
                {t('prev_short')}
              </button>
              <button
                onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                disabled={page >= pageCount - 1}
                className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-[11px] font-black tracking-widest text-slate-300 disabled:opacity-40 transition-colors"
              >
                {t('next_short')}
              </button>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 p-6 border-t border-white/5">
          {/* Créer un sous-revendeur */}
          <div className="space-y-3">
            <h4 className="text-[11px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
              <Plus size={14} /> {t('new_subreseller')}
            </h4>
            <input
              className={inputCls}
              placeholder={t('ph_username_simple')}
              value={newSub.username}
              onChange={(e) => setNewSub({ ...newSub, username: e.target.value })}
            />
            <input
              className={inputCls}
              type="password"
              placeholder={t('ph_password_min')}
              value={newSub.password}
              onChange={(e) => setNewSub({ ...newSub, password: e.target.value })}
            />
            <input
              className={inputCls}
              placeholder={t('ph_sell_price_opt')}
              value={newSub.sellPriceCents}
              onChange={(e) => setNewSub({ ...newSub, sellPriceCents: e.target.value })}
            />
            <VibeButton
              variant="primary"
              icon={Plus}
              onClick={createSub}
              disabled={busy}
              className="w-full"
            >
              {t('create')}
            </VibeButton>
          </div>

          {/* Transférer des crédits */}
          <div className="space-y-3">
            <h4 className="text-[11px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
              <Send size={14} /> {t('transfer_credits')}
            </h4>
            <input
              className={inputCls}
              placeholder={t('ph_recipient_userid')}
              value={transferForm.toUserId}
              onChange={(e) => setTransferForm({ ...transferForm, toUserId: e.target.value })}
            />
            <input
              className={inputCls}
              placeholder={t('ph_credits_count')}
              value={transferForm.credits}
              onChange={(e) => setTransferForm({ ...transferForm, credits: e.target.value })}
            />
            <VibeButton
              variant="primary"
              icon={Send}
              onClick={doTransfer}
              disabled={busy}
              className="w-full"
            >
              {t('transfer_btn')}
            </VibeButton>
          </div>
        </div>
      </GlassCard>

      {/* Invitations */}
      <InvitesPanel />

      {/* Contact de paiement (réglages plateforme, admin) */}
      {isAdmin && contact && (
        <GlassCard hover={false}>
          <h3 className="text-lg font-black text-white tracking-tight mb-2 flex items-center gap-2">
            <Mail size={18} /> {t('payment_contact')}
          </h3>
          <p className="text-[11px] text-slate-500 mb-4">
            {t('payment_contact_desc')}
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <input
              className={inputCls}
              placeholder={t('ph_whatsapp')}
              value={contact.payment_contact_whatsapp}
              onChange={(e) => setContact({ ...contact, payment_contact_whatsapp: e.target.value })}
            />
            <input
              className={inputCls}
              placeholder={t('ph_telegram')}
              value={contact.payment_contact_telegram}
              onChange={(e) => setContact({ ...contact, payment_contact_telegram: e.target.value })}
            />
          </div>
          <textarea
            className={cn(inputCls, 'mt-3 resize-none h-20')}
            placeholder={t('ph_payment_instructions_short')}
            value={contact.payment_instructions}
            onChange={(e) => setContact({ ...contact, payment_instructions: e.target.value })}
          />
          <div className="flex justify-end mt-4">
            <VibeButton variant="primary" icon={Save} onClick={saveContact} disabled={contactBusy}>
              {t('save')}
            </VibeButton>
          </div>
        </GlassCard>
      )}

      {/* White-label */}
      <GlassCard hover={false}>
        <h3 className="text-lg font-black text-white tracking-tight mb-4 flex items-center gap-2">
          <Palette size={18} /> {t('brand_white_label')}
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <input
            className={inputCls}
            placeholder={t('ph_brand_name')}
            value={brand.name}
            onChange={(e) => setBrand({ ...brand, name: e.target.value })}
          />
          <input
            className={inputCls}
            placeholder={t('ph_logo_url')}
            value={brand.logoUrl}
            onChange={(e) => setBrand({ ...brand, logoUrl: e.target.value })}
          />
          <input
            className={inputCls}
            placeholder={t('ph_brand_color')}
            value={brand.primaryColor}
            onChange={(e) => setBrand({ ...brand, primaryColor: e.target.value })}
          />
          <input
            className={inputCls}
            placeholder={t('ph_custom_domain')}
            value={brand.customDomain}
            onChange={(e) => setBrand({ ...brand, customDomain: e.target.value })}
          />
        </div>
        <div className="flex justify-end mt-4">
          <VibeButton variant="primary" icon={Save} onClick={saveBrand} disabled={busy}>
            {t('save')}
          </VibeButton>
        </div>
      </GlassCard>

      {/* Relevé */}
      <GlassCard hover={false} className="p-0 overflow-hidden">
        <div className="p-6 border-b border-white/5 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <h3 className="text-lg font-black text-white tracking-tight">{t('credits_ledger')}</h3>
          <div className="flex flex-wrap items-center gap-3">
            <select
              value={ledgerType}
              onChange={(e) => setLedgerType(e.target.value)}
              className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-white/20"
            >
              <option value="">{t('all_movements')}</option>
              {Object.entries(REASON_KEYS).map(([k, v]) => (
                <option key={k} value={k}>
                  {t(v)}
                </option>
              ))}
            </select>
            <div className="relative">
              <Search
                size={14}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"
              />
              <input
                value={ledgerQuery}
                onChange={(e) => setLedgerQuery(e.target.value)}
                placeholder={t('ph_ref')}
                className="w-36 bg-white/5 border border-white/10 rounded-xl pl-8 pr-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-white/20"
              />
            </div>
            <VibeButton
              variant="secondary"
              icon={Download}
              size="sm"
              onClick={exportLedgerCsv}
              disabled={filteredLedger.length === 0}
            >
              CSV
            </VibeButton>
          </div>
        </div>
        <div className="overflow-x-auto max-h-96">
          <table className="w-full text-left">
            <thead>
              <tr className="text-[11px] font-black text-slate-500 uppercase tracking-[0.25em] border-b border-white/5">
                <th className="px-6 py-3">{t('col_movement')}</th>
                <th className="px-6 py-3">{t('col_credits')}</th>
                <th className="px-6 py-3">{t('col_price')}</th>
                <th className="px-6 py-3">{t('col_ref')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {filteredLedger.map((e) => (
                <tr key={e.id} className="hover:bg-white/5">
                  <td className="px-6 py-3 text-xs text-slate-300">
                    {REASON_KEYS[e.reason] ? t(REASON_KEYS[e.reason]) : e.reason}
                  </td>
                  <td
                    className={cn(
                      'px-6 py-3 text-xs font-mono font-bold',
                      e.delta >= 0 ? 'text-emerald-400' : 'text-red-400'
                    )}
                  >
                    {e.delta >= 0 ? '+' : ''}
                    {e.delta}
                  </td>
                  <td className="px-6 py-3 text-xs font-mono text-slate-500">
                    {euros(e.priceCents)}
                  </td>
                  <td className="px-6 py-3 text-[11px] font-mono text-slate-600 truncate max-w-[160px]">
                    {e.ref || '—'}
                  </td>
                </tr>
              ))}
              {filteredLedger.length === 0 && (
                <tr>
                  <td
                    colSpan={4}
                    className="px-6 py-8 text-center text-slate-500 text-xs uppercase tracking-widest"
                  >
                    {loading ? t('loading') : t('no_movement')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </GlassCard>

      {/* Résultat d'un reset de mot de passe (affiché une seule fois) */}
      {resetResult && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="glass-panel border rounded-2xl shadow-2xl w-full max-w-sm p-8 space-y-5 text-center">
            <div className="w-12 h-12 mx-auto rounded-xl bg-amber-500/15 border border-amber-500/20 flex items-center justify-center text-amber-400">
              <KeyRound size={22} />
            </div>
            <div>
              <h3 className="text-lg font-black text-white tracking-tight">
                {t('password_reset_title')}
              </h3>
              <p className="text-[11px] text-slate-500 mt-1">
                {t('password_reset_hint_1')} {resetResult.username}.{' '}
                {t('password_reset_hint_2')}
              </p>
            </div>
            <div className="font-mono text-lg text-white bg-white/5 border border-white/10 rounded-xl py-3 select-all break-all">
              {resetResult.password}
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => {
                  navigator.clipboard?.writeText(resetResult.password).catch(() => {});
                  addToast(t('copied'), 'success');
                }}
                className="flex-1 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-[11px] font-black tracking-widest text-white transition-colors"
              >
                {t('copy')}
              </button>
              <button
                onClick={() => setResetResult(null)}
                className="flex-1 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-[11px] font-black tracking-widest text-white transition-colors"
              >
                {t('close')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default NetworkSection;
