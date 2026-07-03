import React, { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  Wallet,
  Users,
  Send,
  Plus,
  Palette,
  TrendingUp,
  RefreshCw,
  Save,
} from 'lucide-react';
import { useTheme } from '../../../context/ThemeContext';
import { useToast } from '../../../context/ToastContext';
import { cn, COLOR_MAP } from '../../../lib/utils';
import { axiosInstance } from '../../../lib/api';
import GlassCard from '../../../components/ui/Card';
import VibeButton from '../../../components/ui/Button';

const euros = (cents) => (cents == null ? '—' : (cents / 100).toFixed(2) + ' €');

const REASON_LABEL = {
  topup: 'Rechargement',
  transfer_in: 'Reçu',
  transfer_out: 'Envoyé',
  monthly: 'Débit mensuel',
  refund: 'Remboursement',
};

const NetworkSection = ({ userRole }) => {
  const { theme } = useTheme();
  const { addToast } = useToast();
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
      addToast('Erreur de chargement du réseau', 'error');
    } finally {
      setLoading(false);
    }
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
        addToast('Sous-revendeur créé', 'success');
        setNewSub({ username: '', password: '', sellPriceCents: '' });
        load();
      } catch (e) {
        addToast(e?.response?.data?.error || 'Erreur création', 'error');
      }
    });

  const doTransfer = () =>
    guard(async () => {
      try {
        await axiosInstance.post('/credits/transfer', {
          toUserId: Number(transferForm.toUserId),
          credits: Number(transferForm.credits),
        });
        addToast('Crédits transférés', 'success');
        setTransferForm({ toUserId: '', credits: '' });
        load();
      } catch (e) {
        addToast(e?.response?.data?.error || 'Erreur transfert', 'error');
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
        addToast('Compte crédité', 'success');
        setTopupForm({ userId: '', credits: '', priceCents: '' });
        load();
      } catch (e) {
        addToast(e?.response?.data?.error || 'Erreur top-up', 'error');
      }
    });

  const saveBrand = () =>
    guard(async () => {
      try {
        await axiosInstance.put('/brand', brand);
        addToast('Marque enregistrée', 'success');
        load();
      } catch (e) {
        addToast(e?.response?.data?.error || 'Erreur marque', 'error');
      }
    });

  const marginCents =
    wallet?.margin ? wallet.margin.resoldCents - wallet.margin.acquiredCostCents : 0;

  const inputCls =
    'w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-white/20 font-mono';

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-5 duration-700">
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
            <h2 className="text-3xl font-black text-white tracking-tighter italic uppercase">Réseau</h2>
            <p className="text-slate-500 text-[10px] font-black tracking-[0.3em] uppercase opacity-60">
              Crédits · Revendeurs · Marge
            </p>
          </div>
        </div>
        <VibeButton variant="secondary" icon={RefreshCw} onClick={load}>
          Actualiser
        </VibeButton>
      </GlassCard>

      {/* Portefeuille */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <GlassCard hover={false}>
          <div className="flex items-center gap-3 text-slate-400 mb-3">
            <Wallet size={18} /> <span className="text-[11px] font-black uppercase tracking-widest">Solde</span>
          </div>
          <div className="text-4xl font-black text-white">{wallet?.balance ?? '—'}</div>
          <div className="text-[10px] text-slate-500 uppercase tracking-widest mt-1">crédits</div>
        </GlassCard>
        <GlassCard hover={false}>
          <div className="flex items-center gap-3 text-slate-400 mb-3">
            <TrendingUp size={18} /> <span className="text-[11px] font-black uppercase tracking-widest">Marge</span>
          </div>
          <div className={cn('text-4xl font-black', marginCents >= 0 ? 'text-emerald-400' : 'text-red-400')}>
            {euros(marginCents)}
          </div>
          <div className="text-[10px] text-slate-500 uppercase tracking-widest mt-1">revente − acquisition</div>
        </GlassCard>
        <GlassCard hover={false}>
          <div className="flex items-center gap-3 text-slate-400 mb-3">
            <Users size={18} /> <span className="text-[11px] font-black uppercase tracking-widest">Sous-revendeurs</span>
          </div>
          <div className="text-4xl font-black text-white">{network.length}</div>
          <div className="text-[10px] text-slate-500 uppercase tracking-widest mt-1">comptes rattachés</div>
        </GlassCard>
      </div>

      {/* Admin : top-up */}
      {isAdmin && (
        <GlassCard hover={false}>
          <h3 className="text-lg font-black text-white uppercase tracking-tight mb-4 flex items-center gap-2">
            <Plus size={18} /> Créditer un compte (top-up)
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <input className={inputCls} placeholder="userId" value={topupForm.userId}
              onChange={(e) => setTopupForm({ ...topupForm, userId: e.target.value })} />
            <input className={inputCls} placeholder="crédits" value={topupForm.credits}
              onChange={(e) => setTopupForm({ ...topupForm, credits: e.target.value })} />
            <input className={inputCls} placeholder="prix/crédit (centimes)" value={topupForm.priceCents}
              onChange={(e) => setTopupForm({ ...topupForm, priceCents: e.target.value })} />
            <VibeButton variant="primary" icon={Plus} onClick={doTopup} disabled={busy}>Créditer</VibeButton>
          </div>
        </GlassCard>
      )}

      {/* Sous-revendeurs + création + transfert */}
      <GlassCard hover={false} className="p-0 overflow-hidden">
        <div className="p-6 border-b border-white/5">
          <h3 className="text-lg font-black text-white uppercase tracking-tight flex items-center gap-2">
            <Users size={18} /> Mon réseau
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="text-[10px] font-black text-slate-500 uppercase tracking-[0.25em] border-b border-white/5">
                <th className="px-6 py-4">Compte</th>
                <th className="px-6 py-4">ID</th>
                <th className="px-6 py-4">Solde</th>
                <th className="px-6 py-4">Prix revente</th>
                <th className="px-6 py-4 text-right">Transfert</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {network.map((u) => (
                <tr key={u.id} className="hover:bg-white/5">
                  <td className="px-6 py-4 text-sm font-bold text-white">{u.username}</td>
                  <td className="px-6 py-4 text-xs font-mono text-slate-500">{u.id}</td>
                  <td className="px-6 py-4 text-sm font-mono text-emerald-400">{u.balance}</td>
                  <td className="px-6 py-4 text-xs font-mono text-slate-400">{euros(u.sellPriceCents)}</td>
                  <td className="px-6 py-4 text-right">
                    <button
                      onClick={() => setTransferForm({ toUserId: String(u.id), credits: '' })}
                      className="text-indigo-400 hover:text-indigo-300 text-[11px] font-black uppercase tracking-widest"
                    >
                      Sélectionner
                    </button>
                  </td>
                </tr>
              ))}
              {network.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-slate-500 text-xs uppercase tracking-widest">
                    Aucun sous-revendeur
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 p-6 border-t border-white/5">
          {/* Créer un sous-revendeur */}
          <div className="space-y-3">
            <h4 className="text-[11px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
              <Plus size={14} /> Nouveau sous-revendeur
            </h4>
            <input className={inputCls} placeholder="nom d'utilisateur" value={newSub.username}
              onChange={(e) => setNewSub({ ...newSub, username: e.target.value })} />
            <input className={inputCls} type="password" placeholder="mot de passe (min 8)" value={newSub.password}
              onChange={(e) => setNewSub({ ...newSub, password: e.target.value })} />
            <input className={inputCls} placeholder="prix revente/crédit (centimes, opt.)" value={newSub.sellPriceCents}
              onChange={(e) => setNewSub({ ...newSub, sellPriceCents: e.target.value })} />
            <VibeButton variant="primary" icon={Plus} onClick={createSub} disabled={busy} className="w-full">
              Créer
            </VibeButton>
          </div>

          {/* Transférer des crédits */}
          <div className="space-y-3">
            <h4 className="text-[11px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
              <Send size={14} /> Transférer des crédits
            </h4>
            <input className={inputCls} placeholder="userId destinataire" value={transferForm.toUserId}
              onChange={(e) => setTransferForm({ ...transferForm, toUserId: e.target.value })} />
            <input className={inputCls} placeholder="nombre de crédits" value={transferForm.credits}
              onChange={(e) => setTransferForm({ ...transferForm, credits: e.target.value })} />
            <VibeButton variant="primary" icon={Send} onClick={doTransfer} disabled={busy} className="w-full">
              Transférer
            </VibeButton>
          </div>
        </div>
      </GlassCard>

      {/* White-label */}
      <GlassCard hover={false}>
        <h3 className="text-lg font-black text-white uppercase tracking-tight mb-4 flex items-center gap-2">
          <Palette size={18} /> Marque (white-label)
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <input className={inputCls} placeholder="Nom de marque" value={brand.name}
            onChange={(e) => setBrand({ ...brand, name: e.target.value })} />
          <input className={inputCls} placeholder="URL du logo (https://…)" value={brand.logoUrl}
            onChange={(e) => setBrand({ ...brand, logoUrl: e.target.value })} />
          <input className={inputCls} placeholder="Couleur (#RRGGBB)" value={brand.primaryColor}
            onChange={(e) => setBrand({ ...brand, primaryColor: e.target.value })} />
          <input className={inputCls} placeholder="Domaine perso (vpn.exemple.com)" value={brand.customDomain}
            onChange={(e) => setBrand({ ...brand, customDomain: e.target.value })} />
        </div>
        <div className="flex justify-end mt-4">
          <VibeButton variant="primary" icon={Save} onClick={saveBrand} disabled={busy}>Enregistrer</VibeButton>
        </div>
      </GlassCard>

      {/* Relevé */}
      <GlassCard hover={false} className="p-0 overflow-hidden">
        <div className="p-6 border-b border-white/5">
          <h3 className="text-lg font-black text-white uppercase tracking-tight">Relevé de crédits</h3>
        </div>
        <div className="overflow-x-auto max-h-96">
          <table className="w-full text-left">
            <thead>
              <tr className="text-[10px] font-black text-slate-500 uppercase tracking-[0.25em] border-b border-white/5">
                <th className="px-6 py-3">Mouvement</th>
                <th className="px-6 py-3">Crédits</th>
                <th className="px-6 py-3">Prix</th>
                <th className="px-6 py-3">Réf.</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {(wallet?.entries || []).map((e) => (
                <tr key={e.id} className="hover:bg-white/5">
                  <td className="px-6 py-3 text-xs text-slate-300">{REASON_LABEL[e.reason] || e.reason}</td>
                  <td className={cn('px-6 py-3 text-xs font-mono font-bold', e.delta >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                    {e.delta >= 0 ? '+' : ''}{e.delta}
                  </td>
                  <td className="px-6 py-3 text-xs font-mono text-slate-500">{euros(e.priceCents)}</td>
                  <td className="px-6 py-3 text-[10px] font-mono text-slate-600 truncate max-w-[160px]">{e.ref || '—'}</td>
                </tr>
              ))}
              {(!wallet?.entries || wallet.entries.length === 0) && (
                <tr>
                  <td colSpan={4} className="px-6 py-8 text-center text-slate-500 text-xs uppercase tracking-widest">
                    {loading ? 'Chargement…' : 'Aucun mouvement'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </GlassCard>
    </div>
  );
};

export default NetworkSection;
