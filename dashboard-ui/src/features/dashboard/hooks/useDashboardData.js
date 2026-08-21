import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { axiosInstance, getWsUri, getWsToken } from '../../../lib/api';
import { useWebSocket } from '../../../lib/useWebSocket';
import { useToast } from '../../../context/ToastContext';
import { formatBytes } from '../../../lib/utils';

const CACHE_KEY = 'wg-fux-cache';
const CACHE_TTL = 30000; // 30s
const POLL_INTERVAL = 5000;
// Au-delà de ce nombre de clients, on espace le polling : re-render de toute
// la grille toutes les 5 s = UI qui rame sur les grosses flottes.
const POLL_INTERVAL_LARGE = 15000;
const LARGE_FLEET_THRESHOLD = 150;
const SENTINEL_INTERVAL = 15000;

const HEAVY_SECTIONS = new Set(['dashboard', 'containers', 'topology']);

// Les objets client sont plats (scalaires) : une égalité superficielle suffit
// pour décider de réutiliser l'objet précédent (identité stable → memo() des
// ClientCard efficace, seuls les clients dont les compteurs bougent re-rendent).
const shallowEqual = (a, b) => {
  if (a === b) return true;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every((k) => Object.is(a[k], b[k]));
};

// Pour les petits objets/tableaux re-fetchés à chaque tick (stats, health,
// interfaces…) : ne déclencher un re-render que si le contenu a changé.
const jsonEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const setIfChanged = (setter, next) => setter((prev) => (jsonEqual(prev, next) ? prev : next));

const useDashboardData = (session, activeSection = 'dashboard', selectedServerId = 'local') => {
  const { addToast } = useToast();
  const prevDataRef = useRef({ clients: [], timestamp: null });
  // Derniers objets client rendus, indexés par publicKey — sert à réutiliser
  // les références quand rien n'a changé (cf. clientsWithRates plus bas).
  const renderedClientsRef = useRef({ byKey: new Map(), list: [] });
  const suppressWsUntilRef = useRef(0);
  const suppressWsToast = useCallback(() => {
    suppressWsUntilRef.current = Date.now() + 3000;
  }, []);

  const [clients, setClients] = useState([]);
  const [activeInterface, setActiveInterface] = useState('wg0');
  const [interfaces, setInterfaces] = useState([]);
  const [allContainers, setAllContainers] = useState([]);
  const [users, setUsers] = useState([]);
  const [stats, setStats] = useState({});
  const [systemStats, setSystemStats] = useState({ cpu: 0, memory: 0, disk: 0 });
  const [trafficData, setTrafficData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [health, setHealth] = useState({ status: 'unknown', ready: false });
  const [config, setConfig] = useState({});
  const [uptime, setUptime] = useState('');
  const [speedtest, setSpeedtest] = useState({ loading: false, data: null });
  const [sentinelStatus, setSentinelStatus] = useState({
    status: 'offline',
    lastHeartbeat: null,
    stats: {},
  });
  const [adguardStatus, setAdguardStatus] = useState({ status: 'unknown' });
  const [onlinePeers, setOnlinePeers] = useState([]);

  const isManagerRole = session?.role === 'admin' || session?.role === 'manager';
  const fetchAdguard = useCallback(async () => {
    if (!isManagerRole) {
      setAdguardStatus({ status: 'unknown' });
      return;
    }
    try {
      const res = await axiosInstance.get('/system/adguard-status');
      setIfChanged(setAdguardStatus, res.data);
    } catch {
      setAdguardStatus({ status: 'inactive' });
    }
  }, [isManagerRole]);

  useWebSocket(getWsUri('status'), {
    token: getWsToken(),
    onMessage: (data) => {
      if (!data || typeof data !== 'object') return;
      if (data.type === 'peer_status' && Array.isArray(data.onlinePeers)) {
        // Broadcast toutes les 5 s : ne re-rendre que si la liste a changé.
        setIfChanged(setOnlinePeers, data.onlinePeers);
        return;
      }
      const isPeerEvent =
        data.type === 'client_event' ||
        data.type === 'peer_connected' ||
        data.type === 'peer_disconnected';
      if (isPeerEvent) {
        const isSuppressed = Date.now() < suppressWsUntilRef.current;
        if (!isSuppressed) {
          const name = data.name || data.client?.name || 'Peer';
          const container = data.container || data.client?.container || '';
          const connected =
            data.type !== 'peer_disconnected' &&
            (data.event === 'connected' || data.type === 'peer_connected');
          addToast(
            `${name}${container ? ' (' + container + ')' : ''} ${connected ? 'connecté' : 'déconnecté'}`,
            connected ? 'success' : 'info'
          );
        }
        fetchData();
      }
    },
  });

  const fetchSentinel = useCallback(async () => {
    try {
      const res = await axiosInstance.get('/sentinel/status');
      setIfChanged(setSentinelStatus, res.data);
    } catch {
      setSentinelStatus((prev) => ({ ...prev, status: 'error' }));
    }
  }, []);

  const isFetchingRef = useRef(false);
  const abortControllerRef = useRef(null);
  const clientsRef = useRef(clients);
  clientsRef.current = clients;
  const containersRef = useRef(allContainers);
  containersRef.current = allContainers;
  const activeSectionRef = useRef(activeSection);
  activeSectionRef.current = activeSection;
  const activeInterfaceRef = useRef(activeInterface);
  activeInterfaceRef.current = activeInterface;
  const sessionRoleRef = useRef(session?.role);
  sessionRoleRef.current = session?.role;

  const fetchData = useCallback(async () => {
    if (isFetchingRef.current) return;

    // Cancel previous in-flight batch
    if (abortControllerRef.current) abortControllerRef.current.abort();
    abortControllerRef.current = new AbortController();
    const { signal } = abortControllerRef.current;

    isFetchingRef.current = true;
    try {
      const role = sessionRoleRef.current;
      const isAdmin = role === 'admin';
      const isManager = role === 'admin' || role === 'manager';
      const section = activeSectionRef.current;
      const needsHeavy = HEAVY_SECTIONS.has(section);
      const iface = activeInterfaceRef.current;

      const [
        clientsRes,
        statsRes,
        healthRes,
        readyCheckRes,
        containersRes,
        interfacesRes,
        usersRes,
      ] = await Promise.all([
        needsHeavy
          ? axiosInstance.get('/clients', { signal })
          : Promise.resolve({ data: clientsRef.current }),
        isManager
          ? axiosInstance
              .get(`/system/stats?interface=${iface}`, { signal })
              .catch(() => ({ data: {} }))
          : Promise.resolve({ data: {} }),
        axiosInstance
          .get('/system/health', { signal })
          .catch(() => ({ data: { status: 'unhealthy' } })),
        axiosInstance.get('/ready', { signal }).catch(() => ({ data: { status: 'not ready' } })),
        needsHeavy
          ? axiosInstance.get('/clients/containers', { signal }).catch(() => ({ data: [] }))
          : Promise.resolve({ data: containersRef.current }),
        isManager
          ? axiosInstance.get('/system/interfaces', { signal }).catch(() => ({ data: [] }))
          : Promise.resolve({ data: [] }),
        isAdmin
          ? axiosInstance.get('/users', { signal }).catch(() => ({ data: [] }))
          : Promise.resolve({ data: [] }),
      ]);

      if (signal.aborted) return;

      const fetchedInterfaces = interfacesRes.data || [];
      setIfChanged(setInterfaces, fetchedInterfaces);

      const now = Date.now();
      const fetchedClients = clientsRes.data || [];
      const { clients: prevClients, timestamp: prevTimestamp } = prevDataRef.current;
      const timeDiff = prevTimestamp ? (now - prevTimestamp) / 1000 : 0;

      setIfChanged(setAllContainers, containersRes.data || []);
      setIfChanged(setUsers, usersRes.data || []);

      // Index O(1) : prevClients.find() dans la boucle était O(n²) par poll
      // (500 clients ≈ 250 000 comparaisons toutes les 5-15 s).
      const prevByKey = new Map(prevClients.map((p) => [p.publicKey, p]));
      const rendered = renderedClientsRef.current;
      const nextRendered = new Map();
      let allReused = fetchedClients.length === rendered.list.length;
      const clientsWithRates = fetchedClients.map((client) => {
        const prevClient = prevByKey.get(client.publicKey);
        const currentDown = Number(client.downloadBytes) || 0;
        const currentUp = Number(client.uploadBytes) || 0;
        const prevDown = prevClient ? Number(prevClient.downloadBytes) || 0 : 0;
        const prevUp = prevClient ? Number(prevClient.uploadBytes) || 0 : 0;
        let downloadRate = 0,
          uploadRate = 0;
        if (prevClient && timeDiff > 0) {
          downloadRate = Math.max(0, (currentDown - prevDown) / timeDiff);
          uploadRate = Math.max(0, (currentUp - prevUp) / timeDiff);
        }
        const next = { ...client, downloadRate, uploadRate };
        const old = rendered.byKey.get(client.publicKey);
        if (old && shallowEqual(old, next)) {
          nextRendered.set(client.publicKey, old);
          return old;
        }
        allReused = false;
        nextRendered.set(client.publicKey, next);
        return next;
      });
      // Si aucun client n'a bougé, on garde l'identité du tableau : setClients
      // reçoit la même référence et React saute le re-render complet.
      const stableList = allReused ? rendered.list : clientsWithRates;
      renderedClientsRef.current = { byKey: nextRendered, list: stableList };

      setClients(stableList);
      // Ne mémoriser (clients, timestamp) que si fetchedClients vient d'un VRAI
      // fetch /clients (needsHeavy) — sinon fetchedClients === clientsRef.current
      // (compteurs figés d'un poll précédent) : avancer quand même le timestamp
      // ferait calculer downloadRate/uploadRate sur un intervalle beaucoup plus
      // long que timeDiff au prochain fetch heavy, produisant un pic de débit
      // fictif (et une entrée corrompue dans le graphe de trafic).
      if (needsHeavy) {
        prevDataRef.current = { clients: fetchedClients, timestamp: now };
      }

      let networkStats;
      if (isManager) {
        networkStats = statsRes.data?.network || {};
        setIfChanged(setSystemStats, statsRes.data?.system || { cpu: 0, memory: 0, disk: 0 });
      } else {
        const totalRx = fetchedClients.reduce((a, c) => a + (Number(c.downloadBytes) || 0), 0);
        const totalTx = fetchedClients.reduce((a, c) => a + (Number(c.uploadBytes) || 0), 0);
        networkStats = {
          totalDownload: formatBytes(totalRx),
          totalUpload: formatBytes(totalTx),
          connectedClients: fetchedClients.filter((c) => c.isOnline).length,
        };
        setIfChanged(setSystemStats, { cpu: 0, memory: 0, disk: 0 });
      }
      setIfChanged(setStats, networkStats);
      setIfChanged(setHealth, {
        ...(healthRes.data || { status: 'unknown' }),
        ready: readyCheckRes.data?.status === 'ready',
      });

      const totalDownRate = clientsWithRates.reduce((acc, c) => acc + (c.downloadRate || 0), 0);
      const totalUpRate = clientsWithRates.reduce((acc, c) => acc + (c.uploadRate || 0), 0);
      const timeLabel = new Date().toLocaleTimeString('fr-FR', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
      setTrafficData((prev) =>
        [...prev, { time: timeLabel, download: totalDownRate, upload: totalUpRate }].slice(-20)
      );

      setLoading(false);

      // Cache write — use a fast signature instead of full JSON.stringify
      try {
        const clientSig =
          fetchedClients.length +
          ':' +
          fetchedClients.reduce((s, c) => s + (Number(c.downloadBytes) || 0), 0) +
          ':' +
          fetchedClients.reduce((s, c) => s + (Number(c.uploadBytes) || 0), 0);
        const prevCache = sessionStorage.getItem(CACHE_KEY);
        if (!prevCache || JSON.parse(prevCache).sig !== clientSig) {
          sessionStorage.setItem(
            CACHE_KEY,
            JSON.stringify({
              clients: clientsWithRates,
              stats: networkStats,
              sig: clientSig,
              ts: now,
            })
          );
        }
      } catch {
        /* storage full */
      }
    } catch (error) {
      if (error.name === 'AbortError' || error.name === 'CanceledError') return;
      console.error('[useDashboardData] Fetch error:', error);
      setLoading(false);
    } finally {
      isFetchingRef.current = false;
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Changement de serveur cible (Local ↔ VPS) : on purge l'état du serveur
  // précédent et on recharge immédiatement. Le 1er rendu est ignoré (le montage
  // principal déclenche déjà fetchData).
  const didMountServerRef = useRef(false);
  useEffect(() => {
    if (!didMountServerRef.current) {
      didMountServerRef.current = true;
      return;
    }
    prevDataRef.current = { clients: [], timestamp: null };
    renderedClientsRef.current = { byKey: new Map(), list: [] };
    setClients([]);
    setAllContainers([]);
    setLoading(true);
    try {
      sessionStorage.removeItem(CACHE_KEY);
    } catch {
      /* ignore */
    }
    fetchData();
  }, [selectedServerId, fetchData]);

  useEffect(() => {
    axiosInstance
      .get('/system/uptime')
      .then((r) => setUptime(r.data.uptime))
      .catch(() => {});
    if (session?.role === 'admin') {
      axiosInstance
        .get('/system/config')
        .then((r) => setConfig(r.data))
        .catch(() => {});
    }
  }, [session?.role]);

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
      } catch {
        /* ignore malformed cache */
      }
    }

    fetchData();
    fetchSentinel();
    fetchAdguard();

    // Polling adaptatif : setTimeout récursif (pas setInterval) pour relire la
    // taille de flotte à chaque tick — grosses flottes = cadence relâchée.
    let mainTimer = null;
    let stopped = false;
    const scheduleNext = () => {
      if (stopped) return;
      const delay =
        clientsRef.current.length > LARGE_FLEET_THRESHOLD ? POLL_INTERVAL_LARGE : POLL_INTERVAL;
      mainTimer = setTimeout(async () => {
        await fetchData();
        scheduleNext();
      }, delay);
    };
    scheduleNext();
    const iSent = setInterval(fetchSentinel, SENTINEL_INTERVAL);
    const iAdg = setInterval(fetchAdguard, SENTINEL_INTERVAL);

    return () => {
      stopped = true;
      if (mainTimer) clearTimeout(mainTimer);
      clearInterval(iSent);
      clearInterval(iAdg);
      if (abortControllerRef.current) abortControllerRef.current.abort();
    };
  }, [fetchData, fetchSentinel, fetchAdguard]);

  const handleRunSpeedtest = useCallback(async () => {
    setSpeedtest({ loading: true, data: null });
    try {
      const res = await axiosInstance.post('/system/speedtest');
      setSpeedtest({ loading: false, data: res.data });
      addToast('Test de flux complété', 'success');
    } catch {
      setSpeedtest({ loading: false, data: null });
      addToast('Erreur Speedtest', 'error');
    }
  }, [addToast]);

  return useMemo(
    () => ({
      clients,
      allContainers,
      users,
      stats,
      systemStats,
      trafficData,
      loading,
      health,
      config,
      uptime,
      speedtest,
      sentinelStatus,
      adguardStatus,
      onlinePeers,
      fetchData,
      fetchSentinel,
      handleRunSpeedtest,
      suppressWsToast,
      setUsers,
      activeInterface,
      setActiveInterface,
      interfaces,
    }),
    [
      clients,
      allContainers,
      users,
      stats,
      systemStats,
      trafficData,
      loading,
      health,
      config,
      uptime,
      speedtest,
      sentinelStatus,
      adguardStatus,
      onlinePeers,
      fetchData,
      fetchSentinel,
      handleRunSpeedtest,
      suppressWsToast,
      setUsers,
      activeInterface,
      setActiveInterface,
      interfaces,
    ]
  );
};

export default useDashboardData;
