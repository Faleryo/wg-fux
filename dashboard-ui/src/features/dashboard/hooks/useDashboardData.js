import { useState, useRef, useEffect, useCallback } from 'react';
import { axiosInstance, getWsUri } from '../../../lib/api';
import { useWebSocket } from '../../../lib/useWebSocket';
import { useToast } from '../../../context/ToastContext';

const CACHE_KEY = 'wg-fux-cache';
const CACHE_TTL = 30000; // 30s
const POLL_INTERVAL = 5000;
const SENTINEL_INTERVAL = 15000;

/**
 * Feature: Dashboard
 * Central data-fetching hook. Extracts all API calls from App.jsx (was ~200 lines).
 * Manages clients, stats, health, sentinel, and traffic history.
 */
const useDashboardData = (session) => {
  const { addToast } = useToast();
  const prevDataRef = useRef({ clients: [], timestamp: null });

  const [clients, setClients] = useState([]);
  const [allContainers, setAllContainers] = useState([]);
  const [users, setUsers] = useState([]);
  const [stats, setStats] = useState({});
  const [systemStats, setSystemStats] = useState({ cpu: 0, memory: 0, disk: 0 });
  const [trafficData, setTrafficData] = useState([]);
  const [clientsHistory, setClientsHistory] = useState({});
  const [loading, setLoading] = useState(true);
  const [health, setHealth] = useState({ status: 'unknown' });
  const [config, setConfig] = useState({});
  const [uptime, setUptime] = useState('');
  const [speedtest, setSpeedtest] = useState({ loading: false, data: null });
  const [sentinelStatus, setSentinelStatus] = useState({ status: 'offline', lastHeartbeat: null, stats: {} });
  const [adguardStatus, setAdguardStatus] = useState({ status: 'unknown' });
  const [onlinePeers, setOnlinePeers] = useState([]);

  // ── AdGuard ───────────────────────────────────────────────────────────────
  const fetchAdguard = useCallback(async () => {
    try {
      const res = await axiosInstance.get('/system/adguard-status');
      setAdguardStatus(res.data);
    } catch {
      setAdguardStatus({ status: 'inactive' });
    }
  }, []);

  // ── WebSocket ─────────────────────────────────────────────────────────────
  useWebSocket(getWsUri('status'), {
    onMessage: (data) => {
      if (!data || typeof data !== 'object') return;
      if (data.type === 'peer_status' && Array.isArray(data.onlinePeers)) {
        setOnlinePeers(data.onlinePeers);
        return;
      }
      const isPeerEvent = data.type === 'client_event' || data.type === 'peer_connected' || data.type === 'peer_disconnected';
      if (isPeerEvent) {
        const name = data.name || data.client?.name || 'Peer';
        const container = data.container || data.client?.container || '';
        const connected = data.type !== 'peer_disconnected' && (data.event === 'connected' || data.type === 'peer_connected');
        addToast(`${name}${container ? ' (' + container + ')' : ''} ${connected ? 'connecté' : 'déconnecté'}`, connected ? 'success' : 'info');
        fetchData();
      }
    }
  });

  // ── Sentinel ──────────────────────────────────────────────────────────────
  const fetchSentinel = useCallback(async () => {
    try {
      const res = await axiosInstance.get('/sentinel/status');
      setSentinelStatus(res.data);
    } catch {
      setSentinelStatus(prev => ({ ...prev, status: 'error' }));
    }
  }, []);

  // ── Main Data Fetch ───────────────────────────────────────────────────────
  const sessionRole = session?.role;
  const fetchData = useCallback(async () => {
    try {
      const isAdmin = sessionRole === 'admin';
      const [clientsRes, statsRes, healthRes, containersRes, usersRes] = await Promise.all([
        axiosInstance.get('/clients'),
        axiosInstance.get('/system/stats').catch(() => ({ data: {} })),
        axiosInstance.get('/system/health').catch(() => ({ data: { status: 'unhealthy' } })),
        axiosInstance.get('/clients/containers').catch(() => ({ data: [] })),
        isAdmin ? axiosInstance.get('/users').catch(() => ({ data: [] })) : Promise.resolve({ data: [] })
      ]);

      const now = Date.now();
      const fetchedClients = clientsRes.data || [];
      const { clients: prevClients, timestamp: prevTimestamp } = prevDataRef.current;
      const timeDiff = prevTimestamp ? (now - prevTimestamp) / 1000 : 0;

      setAllContainers(containersRes.data || []);
      setUsers(usersRes.data || []);

      const clientsWithRates = fetchedClients.map(client => {
        const prevClient = prevClients.find(p => p.publicKey === client.publicKey);
        const currentDown = Number(client.downloadBytes) || 0;
        const currentUp = Number(client.uploadBytes) || 0;
        const prevDown = prevClient ? (Number(prevClient.downloadBytes) || 0) : 0;
        const prevUp = prevClient ? (Number(prevClient.uploadBytes) || 0) : 0;
        let downloadRate = 0, uploadRate = 0;
        if (prevClient && timeDiff > 0) {
          downloadRate = Math.max(0, (currentDown - prevDown) / timeDiff);
          uploadRate   = Math.max(0, (currentUp - prevUp) / timeDiff);
        }
        return { ...client, downloadRate, uploadRate };
      });

      setClients(clientsWithRates);
      prevDataRef.current = { clients: fetchedClients, timestamp: now };

      const networkStats = statsRes.data?.network || {};
      setStats(networkStats);
      setSystemStats(statsRes.data?.system || { cpu: 0, memory: 0, disk: 0 });
      setHealth(healthRes.data || { status: 'unknown' });

      const totalDownRate = clientsWithRates.reduce((acc, c) => acc + (c.downloadRate || 0), 0);
      const totalUpRate   = clientsWithRates.reduce((acc, c) => acc + (c.uploadRate   || 0), 0);
      const timeLabel = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      setTrafficData(prev => [...prev, { time: timeLabel, download: totalDownRate, upload: totalUpRate }].slice(-20));
      setClientsHistory(prev => {
        const newMap = { ...prev };
        clientsWithRates.forEach(c => {
          const current = newMap[c.id] || [];
          newMap[c.id] = [...current, { time: timeLabel, dl: c.downloadRate || 0, ul: c.uploadRate || 0 }].slice(-20);
        });
        return newMap;
      });

      setLoading(false);
      try { sessionStorage.setItem(CACHE_KEY, JSON.stringify({ clients: clientsWithRates, stats: networkStats, ts: now })); } catch { /* storage full */ }
    } catch (error) {
      console.error('[useDashboardData] Fetch error:', error);
      setLoading(false);
    }
  }, [sessionRole]);

  // ── Bootstrap + Polling ───────────────────────────────────────────────────
  useEffect(() => {
    // Restore cache instantly
    const cached = sessionStorage.getItem(CACHE_KEY);
    if (cached) {
      try {
        const { clients: c, stats: s, ts } = JSON.parse(cached);
        if (Date.now() - ts < CACHE_TTL) {
          setTimeout(() => {
            setClients(c);
            setStats(s);
            setLoading(false);
          }, 0);
        }
      } catch { /* ignore malformed cache */ }
    }
    // Static data
    axiosInstance.get('/system/uptime').then(r => setUptime(r.data.uptime)).catch(() => {});
    axiosInstance.get('/system/config').then(r => setConfig(r.data)).catch(() => {});

    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchData();
    fetchSentinel();
    fetchAdguard();

    const iMain = setInterval(fetchData, POLL_INTERVAL);
    const iSent = setInterval(fetchSentinel, SENTINEL_INTERVAL);
    const iAdg  = setInterval(fetchAdguard, SENTINEL_INTERVAL);

    return () => {
      clearInterval(iMain);
      clearInterval(iSent);
      clearInterval(iAdg);
    };
  }, [fetchData, fetchSentinel, fetchAdguard]);

  // ── Actions ───────────────────────────────────────────────────────────────
  const handleRunSpeedtest = async () => {
    setSpeedtest({ loading: true, data: null });
    try {
      const res = await axiosInstance.post('/system/speedtest');
      setSpeedtest({ loading: false, data: res.data });
      addToast('Test de flux complété', 'success');
    } catch {
      setSpeedtest({ loading: false, data: null });
      addToast('Erreur Speedtest', 'error');
    }
  };

  return {
    // State
    clients, allContainers, users, stats, systemStats,
    trafficData, clientsHistory, loading, health, config,
    uptime, speedtest, sentinelStatus, adguardStatus, onlinePeers,
    // Mutators
    fetchData, fetchSentinel, handleRunSpeedtest,
    // Setters needed by MainLayout
    setUsers,
  };
};

export default useDashboardData;
