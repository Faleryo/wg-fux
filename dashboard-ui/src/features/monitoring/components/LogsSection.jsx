import React, { useState, useEffect, useRef } from 'react';
import { Terminal, Cpu } from 'lucide-react';
import { useTheme } from '../../../context/ThemeContext';
import { useToast } from '../../../context/ToastContext';
import { cn, COLOR_MAP } from '../../../lib/utils';
import { axiosInstance as axios, getWsUri, getWsToken } from '../../../lib/api';
import LogSearchBar from './LogSearchBar';
import LogTabs from './LogTabs';
import LogViewer from './LogViewer';
import LogToolbar from './LogToolbar';

const normalizeLogItem = (item, i) => ({
  id: i,
  time: item.time || item.date || item.timestamp || new Date().toISOString(),
  message:
    item.message ||
    item.MESSAGE ||
    (item.username ? `${item.username} – ${item.virtualIp || ''}` : 'Événement système'),
  ip: item.ip || item.realIp || item.unit || item._SYSTEMD_UNIT || 'Système',
  status: item.status || item.type || 'LOGGED',
});

const LogsSection = () => {
  const { theme, isDark } = useTheme();
  const { addToast } = useToast();
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeTab, setActiveTab] = useState('access');
  const wsRef = useRef(null);

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const endpoint =
        activeTab === 'access' ? '/system/logs'
        : activeTab === 'security' ? '/system/security-logs'
        : activeTab === 'system' ? '/system/container-logs'
        : '/system/logs';

      const res = await axios.get(endpoint);
      const rawData = res.data || [];
      setLogs(rawData.map(normalizeLogItem));
    } catch (e) {
      console.error('[LOGS]', e);
      setLogs([]);
    } finally {
      setLoading(false);
    }
  };

  const [confirmClear, setConfirmClear] = useState(false);

  const handleClearLogs = async () => {
    setClearing(true);
    setConfirmClear(false);
    try {
      await axios.post('/system/logs/clear');
      addToast('Journaux effacés avec succès', 'success');
      fetchLogs();
    } catch {
      addToast("Erreur lors de l'effacement", 'error');
    } finally {
      setClearing(false);
    }
  };

  useEffect(() => {
    let cancelled = false;

    // Fermer la connexion WS précédente
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    const doFetch = async () => {
      setLoading(true);
      try {
        let endpoint;
        if (activeTab === 'access') endpoint = '/system/logs';
        else if (activeTab === 'security') endpoint = '/system/security-logs';
        else if (activeTab === 'system') endpoint = '/system/container-logs';

        const res = await axios.get(endpoint);
        if (cancelled) return;

        const rawData = res.data || [];
        if (!cancelled) setLogs(rawData.map(normalizeLogItem));
      } catch (e) {
        if (!cancelled) setLogs([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    doFetch();

    const connectWs = () => {
      const type = activeTab === 'security' ? 'logs-wg' : 'logs-api';
      const wsUrl = getWsUri(type);
      if (!wsUrl) return;

      try {
        const wst = getWsToken();
        const ws = new WebSocket(wsUrl, wst ? [wst] : undefined);
        wsRef.current = ws;

        ws.onmessage = (evt) => {
          if (cancelled) return;
          try {
            const data = JSON.parse(evt.data);
            const newLog = {
              id: Date.now() + Math.random(),
              time: data.ts || data.date || data.time || new Date().toISOString(),
              message:
                data.msg ||
                data.message ||
                (typeof data === 'string' ? data : JSON.stringify(data)),
              ip: data.svc || data.ip || (activeTab === 'security' ? 'kernel' : 'api'),
              status: data.level || 'LIVE',
            };
            setLogs((prev) => [newLog, ...prev.slice(0, 199)]);
          } catch (_) {
            const line = typeof evt.data === 'string' ? evt.data.trim() : '';
            if (!line || cancelled) return;
            setLogs((prev) => [
              {
                id: Date.now() + Math.random(),
                time: new Date().toISOString(),
                message: line,
                ip: activeTab === 'security' ? 'kernel' : 'system',
                status: 'LIVE',
              },
              ...prev.slice(0, 199),
            ]);
          }
        };

        ws.onclose = () => {
          if (!cancelled) {
            setTimeout(connectWs, 3000);
          }
        };

        ws.onerror = () => {
          ws.close();
        };
      } catch (e) {
        console.warn(`[WS-LOGS-${activeTab}] Connect failed:`, e);
      }
    };

    if (activeTab === 'security' || activeTab === 'system') {
      connectWs();
    }

    return () => {
      cancelled = true;
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [activeTab]);

  const filteredLogs = (logs || []).filter((log) =>
    JSON.stringify(log || {})
      .toLowerCase()
      .includes(String(searchTerm || '').toLowerCase())
  );

  const handleDownload = () => {
    const content = filteredLogs
      .map((l) => `[${l.time}] [${l.status}] ${l.message} — ${l.ip}`)
      .join('\n');
    const blob = new Blob([content], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `wg-fux-logs-${activeTab}-${new Date().toISOString().split('T')[0]}.log`;
    a.click();
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-5 duration-700">
      {/* Header */}
      <div
        className={cn(
          'flex flex-col lg:flex-row justify-between items-start lg:items-center backdrop-blur-3xl p-6 md:p-8 rounded-[2rem] border shadow-2xl gap-6 transition-all',
          isDark ? 'bg-slate-900/40 border-white/5' : 'bg-white/80 border-black/5'
        )}
      >
        <div className="flex items-center gap-4 md:gap-6">
            <div
              className={cn(
                'p-3 md:p-4 rounded-2xl shadow-2xl flex-shrink-0 transition-colors',
                isDark ? 'bg-white/5' : 'bg-black/5'
              )}
              style={{ color: COLOR_MAP[theme]?.[400] || '#818cf8' }}
            >
            <Terminal size={28} />
          </div>
          <div>
            <h2
              className={cn(
                'text-2xl md:text-3xl font-black tracking-tighter italic uppercase transition-colors',
                isDark ? 'text-white' : 'text-slate-900'
              )}
            >
              Blackbox Protocol
            </h2>
            <p className="text-slate-500 text-[10px] font-black tracking-[0.3em] uppercase opacity-60">
              System Event History
            </p>
          </div>
        </div>
        <LogSearchBar
          searchTerm={searchTerm}
          onSearchChange={setSearchTerm}
          isDark={isDark}
          loading={loading}
          onRefresh={fetchLogs}
        />
      </div>

      {/* Tabs */}
      <LogTabs
        activeTab={activeTab}
        onTabChange={setActiveTab}
        isDark={isDark}
        theme={theme}
        liveConnected={wsRef.current?.readyState === 1}
      />

      {/* System tab notice */}
      {activeTab === 'system' && (
        <div className="flex items-center gap-3 p-4 bg-amber-500/5 border border-amber-500/10 rounded-2xl">
          <Cpu size={16} className="text-amber-400 flex-shrink-0" />
          <p className="text-[10px] font-bold text-amber-400/80 uppercase tracking-widest">
            Logs des conteneurs Docker — wg-fux-api · wg-fux-dashboard · wg-sentinel-proxy
          </p>
        </div>
      )}

      {/* Table */}
      <div
        className={cn(
          'backdrop-blur-3xl rounded-[2rem] border overflow-hidden shadow-2xl transition-all',
          isDark ? 'bg-slate-900/40 border-white/5' : 'bg-white border-black/5'
        )}
      >
        <LogViewer logs={logs} filteredLogs={filteredLogs} loading={loading} isDark={isDark} />
        {confirmClear && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="glass-panel p-8 rounded-[2rem] max-w-sm w-full mx-4 border border-white/10 shadow-2xl text-center space-y-6">
              <p className="text-sm font-black text-slate-300 uppercase tracking-wider">
                Effacer tous les journaux ?
              </p>
              <p className="text-[10px] text-slate-500">Cette action est irréversible.</p>
              <div className="flex gap-3">
                <button
                  onClick={handleClearLogs}
                  className="flex-1 py-3 bg-red-500/20 text-red-400 rounded-2xl text-[10px] font-black uppercase tracking-widest border border-red-500/30"
                >
                  Confirmer l'effacement
                </button>
                <button
                  onClick={() => setConfirmClear(false)}
                  className="flex-1 py-3 bg-white/5 text-slate-400 rounded-2xl text-[10px] font-black uppercase tracking-widest border border-white/5"
                >
                  Annuler
                </button>
              </div>
            </div>
          </div>
        )}
        <LogToolbar
          totalCount={filteredLogs.length}
          isDark={isDark}
          onClear={() => setConfirmClear(true)}
          clearing={clearing}
          onDownload={handleDownload}
        />
      </div>
    </div>
  );
};

export default LogsSection;
