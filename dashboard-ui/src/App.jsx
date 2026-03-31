import React, { useState, useEffect, useRef } from 'react';
import { axiosInstance, getWsUri } from './lib/api';
import { useWebSocket } from './lib/useWebSocket';
import { RefreshCw } from 'lucide-react';
import { useTheme } from './context/ThemeContext';
import { useToast } from './context/ToastContext';
import Sidebar from './components/layout/Sidebar';
import LoginPage from './components/auth/LoginPage';

// Sections
import DashboardSection from './components/sections/DashboardSection';
import ContainersSection from './components/management/ClientList'; 
import UsersSection from './components/sections/UsersSection';
import LogsSection from './components/sections/LogsSection';
import SettingsSection from './components/sections/SettingsSection';
import OptimizationSection from './components/sections/OptimizationSection';
import AuditSection from './components/sections/AuditSection';
import ClientDetail from './components/management/ClientDetail';

// Modals
import CreateClientModal from './components/modals/CreateClientModal';
import QRCodeModal from './components/modals/QRCodeModal';

// --- MAIN WRAPPER ---
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
    setSession({ token: null, role: null, username: null });
  };

  if (!session.token) {
    return <LoginPage onLogin={handleLogin} />;
  }

  return <WireGuardDashboard onLogout={handleLogout} />;
};

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
  const [showQRModal, setShowQRModal] = useState(false);
  const [showEditClientModal, setShowEditClientModal] = useState(false);
  const [selectedClientForModal, setSelectedClientForModal] = useState(null);
  const [speedtest, setSpeedtest] = useState({ loading: false, data: null });

  const prevDataRef = useRef({ clients: [], timestamp: null });

  useEffect(() => {
    localStorage.setItem('active-tab', activeSection);
  }, [activeSection]);

  // WebSocket for real-time notifications
  const { data: wsEvent } = useWebSocket(getWsUri('status'), {
    onMessage: (data) => {
      if (data.type === 'client_event') {
        const { event: type, client } = data;
        addToast(`${client.name} (${client.container}) ${type === 'connected' ? 'est connecté' : 'est déconnecté'}`, type === 'connected' ? 'success' : 'info');
        fetchData();
      }
    }
  });

  // Initial and Periodic Fetch
  useEffect(() => {
    const fetchStaticData = async () => {
      try {
        const [uptimeRes, configRes] = await Promise.all([
          axiosInstance.get('/system/uptime'),
          axiosInstance.get('/system/config')
        ]);
        setUptime(uptimeRes.data.uptime);
        setConfig(configRes.data);
      } catch (e) { }
    };
    fetchStaticData();
    fetchData();
    const intervalId = setInterval(fetchData, 5000);
    return () => clearInterval(intervalId);
  }, []);

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
          downloadRate = (client.downloadBytes - prevClient.downloadBytes) / timeDiff;
          uploadRate = (client.uploadBytes - prevClient.uploadBytes) / timeDiff;
        }
        return { ...client, downloadRate, uploadRate };
      });

      setClients(clientsWithRates);
      prevDataRef.current = { clients: fetchedClients, timestamp: now };
      setStats(statsRes.data?.network || {});
      setSystemStats(statsRes.data?.system || { cpu: 0, memory: 0, disk: 0 });
      setHealth(healthRes.data || { status: 'unknown' });

      const totalDownRate = clientsWithRates.reduce((acc, c) => acc + (c.downloadRate || 0), 0);
      const totalUpRate = clientsWithRates.reduce((acc, c) => acc + (c.uploadRate || 0), 0);
      const timeLabel = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

      setTrafficData(prev => {
        const newHistory = [...prev, { time: timeLabel, download: totalDownRate, upload: totalUpRate }];
        return newHistory.slice(-20);
      });

      setClientsHistory(prev => {
        const newMap = { ...prev };
        clientsWithRates.forEach(c => {
          const current = newMap[c.id] || [];
          newMap[c.id] = [...current, { time: timeLabel, dl: c.downloadRate || 0, ul: c.uploadRate || 0 }].slice(-20);
        });
        return newMap;
      });

      setLoading(false);
    } catch (error) {
      console.error('Fetch error:', error);
      if (clients.length > 0) setLoading(false);
    }
  };

  const handleRunSpeedtest = async () => {
    setSpeedtest({ loading: true, data: null });
    try {
      const res = await axiosInstance.post('/system/speedtest');
      setSpeedtest({ loading: false, data: res.data });
      addToast('Test de flux complété', 'success');
    } catch (e) {
      setSpeedtest({ loading: false, data: null });
      addToast('Erreur Speedtest', 'error');
    }
  };

  const handleToggleClient = async (container, name, enabled) => {
    try {
      await axiosInstance.post(`/clients/${container}/${name}/toggle`, { enabled });
      fetchData();
    } catch (error) { addToast('Erreur toggle client', 'error'); }
  };

  const handleDownloadConfig = (name, configText) => {
    const element = document.createElement("a");
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
      } catch (error) { addToast('Erreur suppression', 'error'); }
    }
  };

  const renderSection = () => {
    if (topologySelectedClient) {
      return (
        <ClientDetail
          client={topologySelectedClient}
          onBack={() => setTopologySelectedClient(null)}
          onToggle={(name, enabled) => handleToggleClient(topologySelectedClient.container, name, enabled)}
          onDelete={() => handleDeleteClient(topologySelectedClient)}
          onQRCode={() => { setSelectedClientForModal(topologySelectedClient); setShowQRModal(true); }}
          onEdit={() => { setSelectedClientForModal(topologySelectedClient); setShowEditClientModal(true); }}
        />
      );
    }

    switch (activeSection) {
      case 'dashboard':
        return <DashboardSection stats={stats} trafficData={trafficData} systemStats={systemStats} clients={clients} health={health} config={config} speedtest={speedtest} onRunSpeedtest={handleRunSpeedtest} />;
      case 'management':
        return (
          <ContainersSection
            clients={clients}
            loading={loading}
            onClientUpdate={fetchData}
            onShowQRCode={(name, configText) => { setSelectedClientForModal({ name, config: configText }); setShowQRModal(true); }}
            onDownloadConfig={handleDownloadConfig}
            onToggleClient={handleToggleClient}
            onDeleteClient={handleDeleteClient}
            onEditClient={(client) => { setSelectedClientForModal(client); setShowEditClientModal(true); }}
            onSelectClient={setTopologySelectedClient}
            clientsHistory={clientsHistory}
          />
        );
      case 'users': return <UsersSection />;
      case 'logs': return <LogsSection />;
      case 'settings': return <SettingsSection />;
      case 'optimization': return <OptimizationSection systemStats={systemStats} />;
      case 'audit': return <AuditSection />;
      default: return null;
    }
  };

  if (loading && clients.length === 0) {
    return <div className="min-h-screen bg-slate-950 flex items-center justify-center"><RefreshCw size={48} className="animate-spin text-indigo-500" /></div>;
  }

  return (
    <div className="min-h-screen bg-slate-950 flex font-sans text-slate-200 antialiased overflow-hidden selection:bg-indigo-500/30">
      <Sidebar 
        activeSection={topologySelectedClient ? 'management' : activeSection} 
        onSectionChange={(id) => { setActiveSection(id); setTopologySelectedClient(null); }} 
        onLogout={onLogout}
        uptime={uptime}
      />

      <main className="flex-1 p-8 md:p-12 overflow-y-auto custom-scrollbar relative z-10">
        {/* Modern Background Decorations */}
        <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-indigo-600/5 blur-[150px] -z-10 animate-pulse" />
        <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-emerald-600/5 blur-[150px] -z-10" />

        <div className="max-w-7xl mx-auto space-y-12">
           {renderSection()}
        </div>
      </main>

      {/* Global Modals */}
      {showQRModal && (
        <QRCodeModal 
          isOpen={showQRModal} 
          onClose={() => setShowQRModal(false)} 
          clientName={selectedClientForModal?.name} 
          configText={selectedClientForModal?.config} 
        />
      )}
      {/* Edit modal should be implemented similarly or reused */}
    </div>
  );
};

export default App;
