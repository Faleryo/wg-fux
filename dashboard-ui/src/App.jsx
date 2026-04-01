import React, { useState, useEffect, useRef, useCallback } from 'react';
import { axiosInstance, getWsUri } from './lib/api';
import { useWebSocket } from './lib/useWebSocket';
import { Menu, RefreshCw, Search } from 'lucide-react';
import { useTheme } from './context/ThemeContext';
import { useToast } from './context/ToastContext';
import { AnimatePresence, motion } from 'framer-motion';
import Sidebar from './components/layout/Sidebar';
import LoginPage from './components/auth/LoginPage';
import GlobalSearch from './components/ui/GlobalSearch';
import { SkeletonDashboard } from './components/ui/Skeleton';

// Sections
import DashboardSection from './components/sections/DashboardSection';
import ContainersSection from './components/management/ClientList'; 
import UsersSection from './components/sections/UsersSection';
import LogsSection from './components/sections/LogsSection';
import SettingsSection from './components/sections/SettingsSection';
import OptimizationSection from './components/sections/OptimizationSection';
import AuditSection from './components/sections/AuditSection';
import ClientDetail from './components/management/ClientDetail';
import NetworkMap from './components/dashboard/NetworkMap';

// Modals
import CreateClientModal from './components/modals/CreateClientModal';
import QRCodeModal from './components/modals/QRCodeModal';
import CreateUserModal from './components/modals/CreateUserModal';
import EditClientModal from './components/modals/EditClientModal';

// ─── App Shell ────────────────────────────────────────────────────────────────
const App = () => {
  const { theme } = useTheme();
  const { addToast } = useToast();
  const [session, setSession] = useState({
    token: localStorage.getItem('wg-api-token') || sessionStorage.getItem('wg-api-token'),
    role: localStorage.getItem('wg-user-role'),
    username: localStorage.getItem('wg-user-username')
  });

  const handleLogin = (token, rememberMe) => {
    if (rememberMe) {
      localStorage.setItem('wg-api-token', token);
    } else {
      sessionStorage.setItem('wg-api-token', token);
    }
    setSession({ 
      token, 
      role: localStorage.getItem('wg-user-role'), 
      username: localStorage.getItem('wg-user-username') 
    });
  };

  const handleLogout = () => {
    localStorage.removeItem('wg-api-token');
    sessionStorage.removeItem('wg-api-token');
    localStorage.removeItem('wg-user-role');
    localStorage.removeItem('wg-user-username');
    sessionStorage.removeItem('wg-fux-cache');
    setSession({ token: null, role: null, username: null });
  };

  if (!session.token) {
    return <LoginPage onLogin={handleLogin} />;
  }

  return <WireGuardDashboard onLogout={handleLogout} />;
};

// ─── Main Dashboard ───────────────────────────────────────────────────────────
const WireGuardDashboard = ({ onLogout }) => {
  const { theme } = useTheme();
  const { addToast } = useToast();
  const [activeSection, setActiveSection] = useState(localStorage.getItem('active-tab') || 'dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [clients, setClients] = useState([]);
  const [stats, setStats] = useState({});
  const [systemStats, setSystemStats] = useState({ cpu: 0, memory: 0, disk: 0 });
  const [trafficData, setTrafficData] = useState([]);
  const [clientsHistory, setClientsHistory] = useState({});
  const [loading, setLoading] = useState(true);
  const [health, setHealth] = useState({ status: 'unknown' });
  const [topologySelectedClient, setTopologySelectedClient] = useState(null);
  const [config, setConfig] = useState({});
  const [uptime, setUptime] = useState('');
  const [speedtest, setSpeedtest] = useState({ loading: false, data: null });
  const [sentinelStatus, setSentinelStatus] = useState({ status: 'offline', lastHeartbeat: null, stats: {} });

  // Modal states
  const [showQRModal, setShowQRModal] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showCreateUserModal, setShowCreateUserModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [selectedClientForModal, setSelectedClientForModal] = useState(null);
  const [selectedClientForEdit, setSelectedClientForEdit] = useState(null);

  const prevDataRef = useRef({ clients: [], timestamp: null });

  // ── Persist active tab ─────────────────────────────────────────────────────
  useEffect(() => {
    localStorage.setItem('active-tab', activeSection);
  }, [activeSection]);

  // ── Global Ctrl+K shortcut ─────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setShowSearch(prev => !prev);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  // ── WebSocket for real-time events ─────────────────────────────────────────
  const { data: wsEvent } = useWebSocket(getWsUri('status'), {
    onMessage: (data) => {
      if (data.type === 'client_event') {
        const { event: type, client } = data;
        addToast(
          `${client.name} (${client.container}) ${type === 'connected' ? 'vient de se connecter' : 'vient de se déconnecter'}`,
          type === 'connected' ? 'success' : 'info'
        );
        fetchData();
      }
    }
  });

  // ── Bootstrap + polling ────────────────────────────────────────────────────
  useEffect(() => {
    // Restore from sessionStorage cache for instant display (avoid blank flash)
    const cached = sessionStorage.getItem('wg-fux-cache');
    if (cached) {
      try {
        const { clients: c, stats: s, ts } = JSON.parse(cached);
        if (Date.now() - ts < 30000) {
          setClients(c);
          setStats(s);
          setLoading(false);
        }
      } catch { /* ignore malformed cache */ }
    }

    const fetchStaticData = async () => {
      try {
        const [uptimeRes, configRes] = await Promise.all([
          axiosInstance.get('/system/uptime'),
          axiosInstance.get('/system/config')
        ]);
        setUptime(uptimeRes.data.uptime);
        setConfig(configRes.data);
      } catch (e) {
        console.error('[APP] Failed to fetch static data:', e.message);
      }
    };

    fetchStaticData();
    fetchData();
    fetchSentinel();
    const intervalId  = setInterval(fetchData, 5000);
    const sentinelId  = setInterval(fetchSentinel, 15000);
    return () => { clearInterval(intervalId); clearInterval(sentinelId); };
  }, []);

  // ── Sentinel ───────────────────────────────────────────────────────────────
  const fetchSentinel = async () => {
    try {
      const res = await axiosInstance.get('/sentinel/status');
      setSentinelStatus(res.data);
    } catch {
      setSentinelStatus(prev => ({ ...prev, status: 'error' }));
    }
  };

  // ── Main Data Fetch ────────────────────────────────────────────────────────
  const fetchData = async () => {
    try {
      const [clientsRes, statsRes, healthRes] = await Promise.all([
        axiosInstance.get('/clients'),
        axiosInstance.get('/stats'),
        axiosInstance.get('/health').catch(() => ({ data: { status: 'unhealthy' } }))
      ]);

      const now = Date.now();
      const fetchedClients = clientsRes.data || [];
      const { clients: prevClients, timestamp: prevTimestamp } = prevDataRef.current;
      const timeDiff = prevTimestamp ? (now - prevTimestamp) / 1000 : 0;

      const clientsWithRates = fetchedClients.map(client => {
        const prevClient = prevClients.find(p => p.publicKey === client.publicKey);
        let downloadRate = 0, uploadRate = 0;
        if (prevClient && timeDiff > 0) {
          downloadRate = Math.max(0, (client.downloadBytes - prevClient.downloadBytes) / timeDiff);
          uploadRate   = Math.max(0, (client.uploadBytes  - prevClient.uploadBytes)  / timeDiff);
        }
        return { ...client, downloadRate, uploadRate };
      });

      setClients(clientsWithRates);
      prevDataRef.current = { clients: fetchedClients, timestamp: now };

      const networkStats = statsRes.data?.network || {};
      setStats(networkStats);
      setSystemStats(statsRes.data?.system || { cpu: 0, memory: 0, disk: 0 });
      setHealth(healthRes.data || { status: 'unknown' });

      // Traffic history
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

      // Persist to sessionStorage for next page load (avoid blank flash)
      try {
        sessionStorage.setItem('wg-fux-cache', JSON.stringify({
          clients: clientsWithRates,
          stats: networkStats,
          ts: now,
        }));
      } catch { /* storage full, ignore */ }

    } catch (error) {
      console.error('[APP] Fetch error:', error);
      setLoading(false);
    }
  };

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

  const handleToggleClient = async (container, name, enabled) => {
    try {
      await axiosInstance.post(`/clients/${container}/${name}/toggle`, { enabled });
      fetchData();
    } catch { addToast('Erreur toggle client', 'error'); }
  };

  const handleDownloadConfig = (name, configText) => {
    const element = document.createElement('a');
    const file = new Blob([configText], { type: 'text/plain' });
    element.href = URL.createObjectURL(file);
    element.download = `${name}.conf`;
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  const handleDeleteClient = async (client) => {
    if (window.confirm('Voulez-vous vraiment supprimer ce client ?')) {
      try {
        await axiosInstance.delete(`/clients/${client.container}/${client.name}`);
        addToast('Client supprimé', 'success');
        fetchData();
        if (topologySelectedClient?.id === client.id) setTopologySelectedClient(null);
      } catch { addToast('Erreur suppression', 'error'); }
    }
  };

  const handleNavigate = (sectionId) => {
    setActiveSection(sectionId);
    setTopologySelectedClient(null);
    setSidebarOpen(false);
  };

  // ── Section Renderer ───────────────────────────────────────────────────────
  const renderSection = () => {
    if (topologySelectedClient) {
      return (
        <ClientDetail
          client={topologySelectedClient}
          onBack={() => setTopologySelectedClient(null)}
          onToggle={(name, enabled) => handleToggleClient(topologySelectedClient.container, name, enabled)}
          onDelete={() => handleDeleteClient(topologySelectedClient)}
          onQRCode={() => { setSelectedClientForModal(topologySelectedClient); setShowQRModal(true); }}
          onEdit={() => { setSelectedClientForEdit(topologySelectedClient); setShowEditModal(true); }}
        />
      );
    }

    switch (activeSection) {
      case 'dashboard':
        return (
          <DashboardSection
            stats={stats} trafficData={trafficData} systemStats={systemStats}
            clients={clients} health={health} config={config}
            speedtest={speedtest} onRunSpeedtest={handleRunSpeedtest}
            sentinel={sentinelStatus}
            onNavigate={handleNavigate}
          />
        );
      case 'containers':
        return (
          <ContainersSection
            clients={clients}
            loading={loading}
            onSelect={setTopologySelectedClient}
            onQRCode={(name, configText) => { setSelectedClientForModal({ name, config: configText }); setShowQRModal(true); }}
            onToggle={(container, name, enabled) => handleToggleClient(container, name, enabled)}
            onDelete={handleDeleteClient}
            onEdit={(client) => { setSelectedClientForEdit(client); setShowEditModal(true); }}
            onCreateClient={() => setShowCreateModal(true)}
          />
        );
      case 'topology':
        return (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-5 duration-700">
            <NetworkMap clients={clients} onSelectClient={setTopologySelectedClient} />
          </div>
        );
      case 'users':    return <UsersSection onCreateUser={() => setShowCreateUserModal(true)} />;
      case 'logs':     return <LogsSection />;
      case 'settings': return <SettingsSection />;
      case 'optimization': return <OptimizationSection systemStats={systemStats} />;
      case 'audit':    return <AuditSection />;
      default:         return null;
    }
  };

  // ── Loading state with Skeleton ────────────────────────────────────────────
  if (loading && clients.length === 0) {
    return (
      <div className="min-h-screen bg-slate-950 flex font-sans text-slate-200 antialiased overflow-x-hidden">
        {/* Skeleton sidebar */}
        <div className="hidden md:block w-72 shrink-0 bg-slate-900/70 border-r border-white/5 h-screen" />
        <main className="flex-1 min-w-0 p-6 md:p-12 overflow-y-auto">
          <SkeletonDashboard />
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 flex font-sans text-slate-200 antialiased overflow-x-hidden selection:bg-indigo-500/30">
      
      {/* Mobile Menu Button */}
      <button 
        onClick={() => setSidebarOpen(true)}
        className="fixed top-4 left-4 z-40 p-2.5 bg-slate-900/90 backdrop-blur-xl border border-white/10 rounded-xl md:hidden text-white shadow-2xl active:scale-95 transition-transform"
        aria-label="Ouvrir le menu"
      >
        <Menu size={22} />
      </button>

      {/* Ctrl+K Search Button (desktop) */}
      <button
        onClick={() => setShowSearch(true)}
        className="fixed top-4 right-4 z-40 hidden md:flex items-center gap-2 px-3 py-2 bg-slate-900/80 backdrop-blur-xl border border-white/10 rounded-xl text-slate-500 hover:text-white hover:border-white/20 transition-all text-[11px] font-black uppercase tracking-widest shadow-xl"
      >
        <Search size={14} />
        <span>Rechercher</span>
        <kbd className="ml-1 px-1.5 py-0.5 bg-white/10 rounded text-[9px] border border-white/10">Ctrl K</kbd>
      </button>

      <Sidebar 
        activeSection={topologySelectedClient ? 'containers' : activeSection} 
        setActiveSection={handleNavigate}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onLogout={onLogout}
        uptime={uptime}
      />

      <main className="flex-1 min-w-0 pt-16 md:pt-0 px-4 pb-4 md:p-12 overflow-y-auto custom-scrollbar relative z-10">
        {/* Background decorations */}
        <div className="absolute top-0 right-0 w-[800px] h-[800px] bg-indigo-600/10 blur-[180px] -z-10 animate-pulse pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-[600px] h-[600px] bg-emerald-600/5 blur-[150px] -z-10 pointer-events-none" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[1000px] h-[600px] bg-sky-600/5 blur-[200px] -z-10 pointer-events-none" />

        <div className="max-w-7xl mx-auto space-y-12">
          {/* AnimatePresence gives smooth transitions between sections */}
          <AnimatePresence mode="wait">
            <motion.div
              key={topologySelectedClient ? 'client-detail' : activeSection}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            >
              {renderSection()}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>

      {/* ── Global Search ───────────────────────────────────────────────────── */}
      <GlobalSearch
        isOpen={showSearch}
        onClose={() => setShowSearch(false)}
        clients={clients}
        onNavigate={handleNavigate}
      />

      {/* ── Modals ──────────────────────────────────────────────────────────── */}
      {showQRModal && (
        <QRCodeModal 
          isOpen={showQRModal} 
          onClose={() => setShowQRModal(false)} 
          client={selectedClientForModal}
          onDownload={handleDownloadConfig}
        />
      )}
      {showCreateModal && (
        <CreateClientModal
          isOpen={showCreateModal}
          onClose={() => setShowCreateModal(false)}
          onCreate={async (name, container, expiry, quota, uploadLimit) => {
            await axiosInstance.post('/clients', { name, container, expiry, quota, uploadLimit });
            fetchData();
            addToast(`Peer ${name} créé avec succès`, 'success');
          }}
        />
      )}
      {showCreateUserModal && (
        <CreateUserModal
          isOpen={showCreateUserModal}
          onClose={() => setShowCreateUserModal(false)}
          onCreate={async (username, password, role) => {
            await axiosInstance.post('/users', { username, password, role });
            addToast(`Opérateur ${username} créé avec succès`, 'success');
          }}
        />
      )}
      {showEditModal && selectedClientForEdit && (
        <EditClientModal
          isOpen={showEditModal}
          onClose={() => { setShowEditModal(false); setSelectedClientForEdit(null); }}
          client={selectedClientForEdit}
          onSave={fetchData}
        />
      )}
    </div>
  );
};

export default App;
