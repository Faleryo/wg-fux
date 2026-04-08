import React, { useState, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Menu, Search } from 'lucide-react';
import { axiosInstance } from '../../lib/api';
import { useToast } from '../../context/ToastContext';
import { useTheme } from '../../context/ThemeContext';
import { cn } from '../../lib/utils';
import ErrorBoundary from '../ErrorBoundary';

// Layout
import Sidebar from './Sidebar';
import { SkeletonDashboard } from '../ui/Skeleton';
import GlobalSearch from '../ui/GlobalSearch';

// Modals
import ConfirmModal from '../modals/ConfirmModal';
import CreateClientModal from '../modals/CreateClientModal';
import CreateContainerModal from '../modals/CreateContainerModal';
import QRCodeModal from '../modals/QRCodeModal';
import CreateUserModal from '../modals/CreateUserModal';
import EditClientModal from '../modals/EditClientModal';

// Feature: Dashboard
import useDashboardData from '../../features/dashboard/hooks/useDashboardData';

// Features Components
import DashboardSection from '../../features/dashboard/components/DashboardSection';
import NetworkMap from '../../features/dashboard/components/NetworkMap';
import ContainersSection from '../../features/clients/components/ClientList';
import ClientDetail from '../../features/clients/components/ClientDetail';
import UsersSection from '../../features/users/components/UsersSection';
import LogsSection from '../../features/monitoring/components/LogsSection';
import SettingsSection from '../../features/settings/components/SettingsSection';
import OptimizationSection from '../../features/settings/components/OptimizationSection';
import AuditSection from '../../features/monitoring/components/AuditSection';
import DnsSection from '../../features/dns/components/DnsEditor';


/**
 * Feature: Main Layout
 * Extracted from App.jsx. Handles UI shell (sidebar, search, modals)
 * and delegates all data fetching to useDashboardData.
 */
const MainLayout = ({ session, onLogout }) => {
  const { theme, mode } = useTheme();
  const { addToast } = useToast();
  const [activeSection, setActiveSection] = useState(localStorage.getItem('active-tab') || 'dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [topologySelectedClient, setTopologySelectedClient] = useState(null);
  const [activeContainer, setActiveContainer] = useState(null);

  const isDark = mode === 'dark';

  // Modal states
  const [showQRModal, setShowQRModal] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showCreateContainerModal, setShowCreateContainerModal] = useState(false);
  const [targetContainerForCreate, setTargetContainerForCreate] = useState(null);
  const [showCreateUserModal, setShowCreateUserModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [selectedClientForEdit, setSelectedClientForEdit] = useState(null);
  const [selectedClientForModal, setSelectedClientForModal] = useState(null);
  const [confirmModal, setConfirmModal] = useState({ open: false, client: null });

  // ── All data comes from the dedicated hook ────────────────────────────────
  const {
    clients, allContainers, users, stats, systemStats,
    trafficData, loading, health, config,
    uptime, speedtest, sentinelStatus, adguardStatus, onlinePeers,
    fetchData, handleRunSpeedtest,
  } = useDashboardData(session);

  // ── Persist active tab ────────────────────────────────────────────────────
  useEffect(() => { localStorage.setItem('active-tab', activeSection); }, [activeSection]);

  // ── Global Ctrl+K shortcut ────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); setShowSearch(prev => !prev); }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  const handleNavigate = (sectionId) => {
    setActiveSection(sectionId);
    setTopologySelectedClient(null);
    setSidebarOpen(false);
  };

  // ── Client CRUD handlers ──────────────────────────────────────────────────
  const handleCreateClient = async (name, container, expiry, quota, uploadLimit) => {
    try {
      await axiosInstance.post('/clients', { name, container, expiry, quota, uploadLimit });
      fetchData();
      addToast(`Peer ${name} créé avec succès`, 'success');
    } catch (e) {
      addToast(e.response?.data?.error || 'Erreur lors de la création du client', 'error');
    }
  };

  const handleCreateContainer = async (name) => {
    try {
      await axiosInstance.post('/clients/containers', { name });
      addToast(`Conteneur ${name} créé.`, 'success');
      fetchData();
    } catch (e) {
      addToast(e.response?.data?.error || `Erreur lors de la création du conteneur ${name}`, 'error');
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

  const handleDeleteClient = (client) => setConfirmModal({ open: true, type: 'delete-client', client });
  const handleDeleteContainerPrompt = (containerName) => setConfirmModal({ open: true, type: 'delete-container', container: containerName });

  const handleDeleteUser = async (username) => {
    try {
      await axiosInstance.delete(`/users/${username}`);
      addToast(`Opérateur ${username} supprimé`, 'success');
      fetchData();
    } catch (err) { addToast(err.response?.data?.error || 'Erreur suppression', 'error'); }
  };

  const executeDeleteClient = async () => {
    const { type, client, container } = confirmModal;
    setConfirmModal({ open: false, client: null, container: null });
    if (type === 'delete-container' && container) {
      try {
        await axiosInstance.delete(`/clients/containers/${container}`);
        addToast('Conteneur supprimé avec succès', 'success');
        fetchData();
      } catch (err) { addToast(err.response?.data?.error || 'Erreur lors de la suppression', 'error'); }
      return;
    }
    if (!client) return;
    try {
      await axiosInstance.delete(`/clients/${client.container}/${client.name}`);
      addToast('Client supprimé', 'success');
      fetchData();
      if (topologySelectedClient?.id === client.id) setTopologySelectedClient(null);
    } catch (err) { addToast(err.response?.data?.error || 'Erreur lors de la suppression', 'error'); }
  };

  // ── Section Renderer ──────────────────────────────────────────────────────
  const renderSection = () => {
    if (topologySelectedClient) {
      return (
        <ClientDetail
          client={topologySelectedClient}
          onBack={() => setTopologySelectedClient(null)}
          onToggle={handleToggleClient}
          onDelete={() => handleDeleteClient(topologySelectedClient)}
          onQRCode={async (client) => {
            try {
              const res = await axiosInstance.get(`/clients/${client.container}/${client.name}/config`);
              setSelectedClientForModal({ name: client.name, config: res.data.config || '' });
              setShowQRModal(true);
            } catch { addToast('Erreur chargement configuration', 'error'); }
          }}
          onEdit={() => { setSelectedClientForEdit(topologySelectedClient); setShowEditModal(true); }}
        />
      );
    }
    switch (activeSection) {
      case 'dashboard': return <DashboardSection stats={stats} trafficData={trafficData} systemStats={systemStats} clients={clients} health={health} config={config} speedtest={speedtest} onRunSpeedtest={handleRunSpeedtest} sentinel={sentinelStatus} adguardStatus={adguardStatus} onCreateClient={() => setShowCreateModal(true)} onNavigate={handleNavigate} />;
      case 'containers': return <ContainersSection clients={clients} allContainers={allContainers} loading={loading} activeContainer={activeContainer} setActiveContainer={setActiveContainer} onSelect={setTopologySelectedClient} onQRCode={async (client) => { try { const res = await axiosInstance.get(`/clients/${client.container}/${client.name}/config`); setSelectedClientForModal({ name: client.name, config: res.data.config || '' }); setShowQRModal(true); } catch { addToast('Erreur de configuration', 'error'); }}} onToggle={handleToggleClient} onDelete={handleDeleteClient} onDeleteContainer={handleDeleteContainerPrompt} onEdit={(client) => { setSelectedClientForEdit(client); setShowEditModal(true); }} onCreateClient={(container) => { setTargetContainerForCreate(container); setShowCreateModal(true); }} onCreateContainer={() => setShowCreateContainerModal(true)} />;
      case 'topology': return <div className="space-y-6 animate-in fade-in slide-in-from-bottom-5 duration-700"><NetworkMap clients={clients} onSelectClient={setTopologySelectedClient} onlinePeers={onlinePeers} /></div>;
      case 'users': return <UsersSection users={users} loading={loading} onRefresh={fetchData} onDelete={handleDeleteUser} onCreateUser={() => setShowCreateUserModal(true)} />;
      case 'logs': return <LogsSection />;
      case 'settings': return <SettingsSection />;
      case 'optimization': return <OptimizationSection systemStats={systemStats} />;
      case 'audit': return <AuditSection />;
      case 'dns': return <DnsSection />;
      default: return null;
    }
  };

  // ── Loading Skeleton ──────────────────────────────────────────────────────
  if (loading && clients.length === 0) {
    return (
      <div className="min-h-screen flex font-sans antialiased bg-[var(--bg-canvas)] transition-colors duration-300">
        <div className="hidden md:block w-64 lg:w-72 shrink-0 border-r h-screen glass-panel" />
        <main className="flex-1 min-w-0 p-4 sm:p-6 md:p-8 lg:p-10 overflow-y-auto"><SkeletonDashboard /></main>
      </div>

    );
  }

  return (
    <div className="min-h-screen flex font-sans antialiased overflow-x-hidden transition-colors duration-700 selection:bg-indigo-500/30 bg-[var(--bg-canvas)]">
      
      <button onClick={() => setSidebarOpen(true)} className="fixed top-4 left-4 z-40 p-2.5 glass-panel border rounded-xl md:hidden shadow-lg active:scale-95 transition-all">
        <Menu size={20} />
      </button>

      <button onClick={() => setShowSearch(true)} className="fixed top-4 right-4 z-40 hidden md:flex items-center gap-2 px-4 py-2.5 glass-panel border rounded-xl transition-all text-[11px] font-black uppercase tracking-widest shadow-lg hover:scale-105">
        <Search size={14} />
        <span>Rechercher</span>
        <kbd className={cn("ml-2 px-1.5 py-0.5 rounded text-[9px] border transition-colors", isDark ? "bg-white/5 border-white/10 text-white/40" : "bg-black/5 border-slate-200 text-slate-400")}>Ctrl K</kbd>
      </button>


      <Sidebar activeSection={topologySelectedClient ? 'containers' : activeSection} setActiveSection={handleNavigate} isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} onLogout={onLogout} uptime={uptime} />

      <main className="flex-1 min-w-0 pt-20 md:pt-0 pb-10 overflow-x-hidden relative transition-all duration-300">
        <div className="fixed inset-0 pointer-events-none -z-10 bg-transparent">
          <div className={cn("absolute top-0 right-0 w-[600px] h-[600px] blur-[150px] opacity-40 animate-pulse transition-all duration-1000", isDark ? "bg-indigo-600/10" : "bg-indigo-500/15")} />
          <div className={cn("absolute bottom-0 left-0 w-[400px] h-[400px] blur-[120px] opacity-30 transition-all duration-1000", isDark ? "bg-emerald-600/5" : "bg-emerald-500/10")} />
        </div>

        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 md:px-8 lg:px-10 xl:px-12 space-y-12">

          <AnimatePresence mode="wait">
            <motion.div key={topologySelectedClient ? 'client-detail' : activeSection} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}>
              <ErrorBoundary sectionName={activeSection}>{renderSection()}</ErrorBoundary>
            </motion.div>
          </AnimatePresence>
        </div>
      </main>

      <GlobalSearch isOpen={showSearch} onClose={() => setShowSearch(false)} clients={clients} onNavigate={handleNavigate} />

      {showQRModal && <QRCodeModal isOpen={showQRModal} onClose={() => setShowQRModal(false)} client={selectedClientForModal} onDownload={handleDownloadConfig} />}
      {showCreateContainerModal && <CreateContainerModal isOpen={showCreateContainerModal} onClose={() => setShowCreateContainerModal(false)} onCreate={handleCreateContainer} />}
      {showCreateModal && <CreateClientModal isOpen={showCreateModal} onClose={() => { setShowCreateModal(false); setTargetContainerForCreate(null); }} onCreate={handleCreateClient} targetContainer={targetContainerForCreate} />}
      {showCreateUserModal && <CreateUserModal isOpen={showCreateUserModal} onClose={() => setShowCreateUserModal(false)} onCreate={async (username, password, role) => { try { await axiosInstance.post('/users', { username, password, role }); addToast(`Opérateur ${username} créé avec succès`, 'success'); fetchData(); } catch (err) { addToast(err.response?.data?.error || 'Erreur lors de la création', 'error'); }}} />}
      {showEditModal && selectedClientForEdit && <EditClientModal isOpen={showEditModal} onClose={() => { setShowEditModal(false); setSelectedClientForEdit(null); }} client={selectedClientForEdit} onSave={fetchData} />}
      
      <ConfirmModal
        isOpen={confirmModal.open}
        title={confirmModal.type === 'delete-container' ? "Supprimer le conteneur" : "Supprimer le client"}
        message={confirmModal.type === 'delete-container' ? (<span>Supprimer le conteneur vide <strong className={cn("font-mono", isDark ? "text-white" : "text-slate-900")}>{confirmModal.container}</strong> ?</span>) : confirmModal.client ? (<span>Supprimer <strong className={cn("font-mono", isDark ? "text-white" : "text-slate-900")}>{confirmModal.client.name}</strong> du conteneur <strong className={cn("font-mono", isDark ? "text-white" : "text-slate-900")}>{confirmModal.client.container}</strong> ?</span>) : 'Cette action est irréversible.'}
        confirmLabel="Supprimer définitivement"
        intent="danger"
        onConfirm={executeDeleteClient}
        onCancel={() => setConfirmModal({ open: false, client: null, container: null })}
      />
    </div>
  );
};

export default MainLayout;
