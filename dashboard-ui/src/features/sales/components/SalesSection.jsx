import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  BadgeDollarSign,
  Wallet,
  Users,
  Timer,
  AlertTriangle,
  RefreshCw,
  Search,
} from 'lucide-react';
import { useTheme } from '../../../context/ThemeContext';
import { useToast } from '../../../context/ToastContext';
import { cn, COLOR_MAP } from '../../../lib/utils';
import { axiosInstance } from '../../../lib/api';
import GlassCard from '../../../components/ui/Card';
import VibeButton from '../../../components/ui/Button';

// Onglet « Ventes » — le comptoir du vendeur.
//
// Son business : chaque client WireGuard est un abonnement à durée (expiry).
// Le vendeur encaisse son client final comme il veut (cash, mobile money…) puis
// renouvelle ici : 30 j = 1 crédit débité de son portefeuille (le revendeur lui
// vend ces crédits — la marge de chacun est garantie par le ledger).
// Admin/manager : renouvellement gratuit (c'est leur instance).

const REASON_LABEL = {
  topup: 'Rechargement',
  topup_stripe: 'Achat Stripe',
  transfer_in: 'Crédits reçus',
  transfer_out: 'Crédits envoyés',
  client_renewal: 'Renouvellement client',
  license_renewal: 'Renouvellement licence',
  refund: 'Remboursement',
};

// Jours restants avant expiration (null = illimité, négatif = expiré).
const daysLeft = (expiry) => {
  if (!expiry) return null;
  const ts = new Date(expiry).getTime();
  if (Number.isNaN(ts)) return null;
  return Math.ceil((ts - Date.now()) / 86400_000);
};

const ExpiryBadge = ({ expiry }) => {
  const d = daysLeft(expiry);
  if (d === null)
    return (
      <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">
        Illimité
      </span>
    );
  const cls =
    d <= 0
      ? 'text-red-400 bg-red-500/10 border-red-500/20'
      : d <= 7
        ? 'text-amber-400 bg-amber-500/10 border-amber-500/20'
        : 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20';
  return (
    <span
      className={cn(
        'text-[10px] font-black uppercase tracking-widest px-3 py-1 rounded-lg border',
        cls
      )}
    >
      {d <= 0 ? `Expiré (${Math.abs(d)} j)` : `${d} j restants`}
    </span>
  );
};

const RENEW_CHOICES = [
  { days: 30, label: '+30 j', credits: 1 },
  { days: 90, label: '+90 j', credits: 3 },
];

const SalesSection = ({ userRole = '' }) => {
  const { theme } = useTheme();
  const { addToast } = useToast();
  const isFree = userRole === 'admin' || userRole === 'manager';

  const [wallet, setWallet] = useState(null);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState(null);
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    try {
      const [w, c] = await Promise.all([
        axiosInstance.get('/wallet').catch(() => ({ data: null })),
        axiosInstance.get('/clients').catch(() => ({ data: [] })),
      ]);
      setWallet(w.data);
      setClients(Array.isArray(c.data) ? c.data : []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const renew = async (client, days, credits) => {
    const key = `${client.container}/${client.name}`;
    if (busyKey) return;
    setBusyKey(key);
    try {
      const { data } = await axiosInstance.post(
        `/clients/${encodeURIComponent(client.container)}/${encodeURIComponent(client.name)}/renew`,
        { days }
      );
      addToast(
        `${client.name} prolongé jusqu'au ${new Date(data.expiry).toLocaleDateString('fr-FR')}` +
          (data.cost > 0 ? ` (−${data.cost} crédit${data.cost > 1 ? 's' : ''})` : ''),
        'success'
      );
      load();
    } catch (e) {
      addToast(e?.response?.data?.error || 'Erreur de renouvellement', 'error');
    } finally {
      setBusyKey(null);
    }
  };

  // Tri : expirés d'abord, puis les plus proches de l'échéance ; illimités en bas.
  const sorted = useMemo(() => {
    const q = query.trim().toLowerCase();
    return clients
      .filter(
        (c) =>
          !q ||
          (c.name || '').toLowerCase().includes(q) ||
          (c.container || '').toLowerCase().includes(q)
      )
      .slice()
      .sort((a, b) => {
        const da = daysLeft(a.expiry);
        const db = daysLeft(b.expiry);
        if (da === null && db === null) return (a.name || '').localeCompare(b.name || '');
        if (da === null) return 1;
        if (db === null) return -1;
        return da - db;
      });
  }, [clients, query]);

  const stats = useMemo(() => {
    const ds = clients.map((c) => daysLeft(c.expiry));
    const renewals = (wallet?.entries || []).filter((e) => e.reason === 'client_renewal').length;
    return {
      total: clients.length,
      expiringSoon: ds.filter((d) => d !== null && d > 0 && d <= 7).length,
      expired: ds.filter((d) => d !== null && d <= 0).length,
      renewals,
    };
  }, [clients, wallet]);

  const cards = [
    ...(isFree
      ? []
      : [
          {
            icon: Wallet,
            label: 'Solde crédits',
            value: wallet?.balance ?? '—',
            cls: 'text-white',
          },
        ]),
    { icon: Users, label: 'Abonnements', value: stats.total, cls: 'text-sky-400' },
    {
      icon: Timer,
      label: 'Expirent ≤ 7 j',
      value: stats.expiringSoon,
      cls: stats.expiringSoon > 0 ? 'text-amber-400' : 'text-slate-300',
    },
    {
      icon: AlertTriangle,
      label: 'Expirés',
      value: stats.expired,
      cls: stats.expired > 0 ? 'text-red-400' : 'text-slate-300',
    },
  ];

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
            <BadgeDollarSign size={32} />
          </div>
          <div>
            <h2 className="text-3xl font-black text-white tracking-tighter italic uppercase">
              Ventes
            </h2>
            <p className="text-slate-500 text-[10px] font-black tracking-[0.3em] uppercase opacity-60">
              Abonnements · Renouvellements · Crédits
            </p>
          </div>
        </div>
        <div className="flex gap-4 items-center w-full lg:w-auto">
          <div className="relative flex-1 lg:w-56">
            <Search
              size={14}
              className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500"
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filtrer un client…"
              className="w-full bg-white/5 border border-white/10 rounded-xl pl-9 pr-4 py-2.5 text-xs text-white font-mono focus:outline-none focus:border-white/20"
            />
          </div>
          <VibeButton variant="secondary" icon={RefreshCw} onClick={load}>
            Actualiser
          </VibeButton>
        </div>
      </GlassCard>

      {/* Synthèse */}
      <div className={cn('grid grid-cols-2 gap-4', isFree ? 'md:grid-cols-3' : 'md:grid-cols-4')}>
        {cards.map((c) => (
          <GlassCard key={c.label} hover={false} className="py-5">
            <div className="flex items-center gap-2 text-slate-500 mb-2">
              <c.icon size={14} />
              <span className="text-[10px] font-black uppercase tracking-widest">{c.label}</span>
            </div>
            <div className={cn('text-3xl font-black', c.cls)}>{c.value}</div>
          </GlassCard>
        ))}
      </div>

      {!isFree && (
        <p className="text-[11px] text-slate-500 px-1">
          Tarif : <strong className="text-slate-300">30 jours = 1 crédit</strong>. Encaissez votre
          client comme vous voulez, puis renouvelez ici — les crédits s’achètent auprès de votre
          fournisseur.
        </p>
      )}

      {/* Abonnements */}
      <GlassCard hover={false} className="p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="text-[10px] font-black text-slate-500 uppercase tracking-[0.25em] border-b border-white/5">
                <th className="px-6 py-4">Client</th>
                <th className="px-6 py-4">Conteneur</th>
                <th className="px-6 py-4">Abonnement</th>
                <th className="px-6 py-4">État</th>
                <th className="px-6 py-4 text-right">Renouveler</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {sorted.map((c) => {
                const key = `${c.container}/${c.name}`;
                return (
                  <tr key={key} className="hover:bg-white/5">
                    <td className="px-6 py-4 text-sm font-bold text-white">{c.name}</td>
                    <td className="px-6 py-4 text-xs font-mono text-slate-400">{c.container}</td>
                    <td className="px-6 py-4">
                      <ExpiryBadge expiry={c.expiry} />
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={cn(
                          'text-[10px] font-black uppercase tracking-widest',
                          c.enabled === false ? 'text-red-400' : 'text-emerald-400'
                        )}
                      >
                        {c.enabled === false ? 'Coupé' : 'Actif'}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right whitespace-nowrap">
                      {RENEW_CHOICES.map((r) => (
                        <button
                          key={r.days}
                          disabled={busyKey === key}
                          onClick={() => renew(c, r.days, r.credits)}
                          title={
                            isFree
                              ? 'Gratuit (admin)'
                              : `${r.credits} crédit${r.credits > 1 ? 's' : ''}`
                          }
                          className="ml-3 px-3 py-1.5 rounded-lg border border-indigo-500/30 bg-indigo-500/10 hover:bg-indigo-500/25 text-[10px] font-black uppercase tracking-widest text-indigo-300 transition-colors disabled:opacity-40"
                        >
                          {r.label}
                          {!isFree && <span className="text-indigo-400/60"> · {r.credits} cr</span>}
                        </button>
                      ))}
                    </td>
                  </tr>
                );
              })}
              {sorted.length === 0 && (
                <tr>
                  <td
                    colSpan={5}
                    className="px-6 py-10 text-center text-slate-500 text-xs uppercase tracking-widest"
                  >
                    {loading
                      ? 'Chargement…'
                      : 'Aucun abonnement — créez des clients dans Conteneurs'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </GlassCard>

      {/* Relevé de crédits */}
      {!isFree && (
        <GlassCard hover={false} className="p-0 overflow-hidden">
          <div className="p-6 border-b border-white/5">
            <h3 className="text-lg font-black text-white uppercase tracking-tight">
              Relevé de crédits
            </h3>
          </div>
          <div className="overflow-x-auto max-h-80">
            <table className="w-full text-left">
              <thead>
                <tr className="text-[10px] font-black text-slate-500 uppercase tracking-[0.25em] border-b border-white/5">
                  <th className="px-6 py-3">Mouvement</th>
                  <th className="px-6 py-3">Crédits</th>
                  <th className="px-6 py-3">Réf.</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {(wallet?.entries || []).map((e) => (
                  <tr key={e.id} className="hover:bg-white/5">
                    <td className="px-6 py-3 text-xs text-slate-300">
                      {REASON_LABEL[e.reason] || e.reason}
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
                    <td className="px-6 py-3 text-[10px] font-mono text-slate-600 truncate max-w-[200px]">
                      {e.ref || '—'}
                    </td>
                  </tr>
                ))}
                {(!wallet?.entries || wallet.entries.length === 0) && (
                  <tr>
                    <td
                      colSpan={3}
                      className="px-6 py-8 text-center text-slate-500 text-xs uppercase tracking-widest"
                    >
                      Aucun mouvement
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </GlassCard>
      )}
    </div>
  );
};

export default SalesSection;
