import { memo, useState } from 'react';
import { Edit, Trash2, Pause, Play, ChevronRight, QrCode, RefreshCw, Check } from 'lucide-react';
import { cn, formatBytes, COLOR_MAP } from '../../../lib/utils';
import GlassCard from '../../../components/ui/Card';
import { isOnlineClient, isExpired, isExpiringSoon, daysUntilExpiry } from './ClientListHelpers';

const ClientCard = ({
  client,
  color,
  isOnlineOverride = false,
  isSelected = false,
  onToggleSelect,
  onSelect,
  onToggle,
  onEdit,
  onQRCode,
  onDelete,
}) => {
  const [qrLoading, setQrLoading] = useState(false);
  const online = isOnlineOverride || isOnlineClient(client);
  const expired = isExpired(client.expiry);
  const expiring = isExpiringSoon(client.expiry);
  const daysLeft = expiring ? daysUntilExpiry(client.expiry) : null;
  const quotaPct =
    client.quota > 0
      ? Math.min(100, ((client.usageTotal || 0) / (client.quota * 1024 * 1024 * 1024)) * 100)
      : 0;

  const handleQRCode = async (e) => {
    e.stopPropagation();
    if (qrLoading) return;
    setQrLoading(true);
    try {
      await onQRCode(client);
    } finally {
      setQrLoading(false);
    }
  };

  return (
    <GlassCard
      onClick={() => onSelect(client)}
      className="p-5 group cursor-pointer border-white/5 hover:border-white/20 transition-all duration-300 relative"
    >
      {/* Bulk select overlay on avatar */}
      {onToggleSelect && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleSelect(client);
          }}
          aria-label={isSelected ? 'Désélectionner' : 'Sélectionner'}
          aria-pressed={isSelected}
          className={cn(
            'absolute top-4 left-4 z-10 w-6 h-6 rounded-lg border-2 flex items-center justify-center transition-all duration-200',
            isSelected
              ? 'bg-indigo-500 border-indigo-400 shadow-[0_0_8px_rgba(99,102,241,0.5)]'
              : 'bg-slate-900/70 border-white/20 opacity-0 group-hover:opacity-100'
          )}
        >
          {isSelected && <Check size={12} className="text-white" />}
        </button>
      )}

      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-4">
          <div
            className={cn(
              'w-12 h-12 rounded-2xl flex items-center justify-center text-lg font-black text-white shadow-2xl transition-all duration-500 group-hover:scale-110 group-hover:rotate-6',
              online ? '' : 'bg-slate-800 text-slate-500'
            )}
            style={
              online
                ? {
                    backgroundColor: COLOR_MAP[color]?.[500] || '#6366f1',
                    boxShadow: `0 8px 32px -8px ${COLOR_MAP[color]?.[500] || '#6366f1'}4d`,
                  }
                : undefined
            }
          >
            {(client.name || '?').charAt(0).toUpperCase()}
          </div>
          <div>
            <h4 className="text-sm font-black text-white uppercase tracking-tight truncate">
              {client.name}
            </h4>
            <div className="flex items-center gap-2 mt-0.5">
              <span
                className={cn(
                  'w-1.5 h-1.5 rounded-full',
                  online ? 'bg-emerald-500 animate-pulse' : 'bg-slate-600'
                )}
                aria-hidden="true"
              />
              <span
                className="text-[11px] font-mono text-slate-500 font-bold uppercase tracking-widest"
                aria-label={online ? 'Peer actif' : 'Peer hors ligne'}
              >
                {online ? 'Actif' : 'Offline'}
              </span>
            </div>
          </div>
        </div>
        <div className="text-right">
          <span className="block text-[11px] font-mono font-bold text-white/40 mb-0.5">
            {client.ip}
          </span>
          {(expired || expiring) && (
            <span
              className={cn(
                'text-[8px] font-extrabold px-2 py-0.5 rounded-lg border uppercase tracking-tighter',
                expired
                  ? 'bg-red-500/10 text-red-400 border-red-500/20'
                  : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
              )}
            >
              {expired ? 'Expiré' : daysLeft !== null ? `${daysLeft}j` : 'Bientôt'}
            </span>
          )}
        </div>
      </div>

      <div className="space-y-4 mb-5">
        <div className="flex justify-between items-center bg-white/5 p-3 rounded-2xl border border-white/5">
          <div className="space-y-0.5">
            <span className="text-[8px] font-black text-slate-500 uppercase tracking-widest block">
              Download
            </span>
            <span className="text-xs font-mono font-black text-emerald-400">
              {formatBytes(client.downloadRate)}/s
            </span>
          </div>
          <div className="h-6 w-px bg-white/10" />
          <div className="space-y-0.5 text-right">
            <span className="text-[8px] font-black text-slate-500 uppercase tracking-widest block">
              Upload
            </span>
            <span className="text-xs font-mono font-black text-indigo-400">
              {formatBytes(client.uploadRate)}/s
            </span>
          </div>
        </div>

        {client.quota > 0 && (
          <div className="space-y-2">
            <div className="flex justify-between text-[11px] font-black uppercase text-slate-500">
              <span>Quota Usage</span>
              <span className={quotaPct > 80 ? 'text-rose-400' : 'text-white'}>
                {quotaPct.toFixed(1)}%
              </span>
            </div>
            <div
              className="h-1 w-full bg-white/5 rounded-full overflow-hidden"
              role="progressbar"
              aria-valuenow={Math.round(quotaPct)}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div
                className={cn('h-full rounded-full', quotaPct > 80 ? 'bg-rose-500' : '')}
                style={{
                  width: `${quotaPct}%`,
                  ...(quotaPct <= 80
                    ? { backgroundColor: COLOR_MAP[color]?.[500] || '#6366f1' }
                    : {}),
                }}
              />
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between pt-4 border-t border-white/5">
        <div className="flex gap-1.5 opacity-40 group-hover:opacity-100 transition-opacity">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onEdit(client);
            }}
            className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white transition-all"
            title="Modifier"
          >
            <Edit size={14} />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggle(client.container, client.name, !client.enabled);
            }}
            className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-400 hover:text-amber-400 transition-all"
            title={client.enabled ? 'Désactiver' : 'Activer'}
            aria-label={client.enabled ? 'Désactiver le peer' : 'Activer le peer'}
          >
            {client.enabled ? <Pause size={14} /> : <Play size={14} />}
          </button>
          <button
            onClick={handleQRCode}
            disabled={qrLoading}
            className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-400 hover:text-cyan-400 transition-all disabled:opacity-50"
            title="Configuration / QR Code"
            aria-label="Afficher la configuration QR Code"
          >
            {qrLoading ? <RefreshCw size={14} className="animate-spin" /> : <QrCode size={14} />}
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete(client);
            }}
            className="p-2 rounded-xl bg-white/5 hover:bg-red-500/10 text-slate-400 hover:text-red-400 transition-all"
            title="Supprimer"
            aria-label="Supprimer le peer"
          >
            <Trash2 size={14} />
          </button>
        </div>
        <div
          className="p-1.5 rounded-lg opacity-0 group-hover:opacity-100 transition-all duration-300"
          style={{
            backgroundColor: COLOR_MAP[color]?.[500] ? COLOR_MAP[color][500] + '1a' : '#6366f11a',
            color: COLOR_MAP[color]?.[400] || '#818cf8',
          }}
        >
          <ChevronRight size={14} className="group-hover:translate-x-0.5 transition-transform" />
        </div>
      </div>
    </GlassCard>
  );
};

export default memo(ClientCard);
