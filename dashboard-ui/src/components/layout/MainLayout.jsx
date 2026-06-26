import React, { useState, useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Menu, Search } from 'lucide-react';
import { axiosInstance } from '../../lib/api';
import { useToast } from '../../context/ToastContext';
import { useTheme } from '../../context/ThemeContext';
import { cn, COLOR_MAP } from '../../lib/utils';
import ErrorBoundary from '../ErrorBoundary';

// Layout
import Sidebar from './Sidebar';
import { SkeletonDashboard } from '../ui/Skeleton';
import GlobalSearch from '../ui/GlobalSearch';
import PerformanceMonitor from '../SRE/PerformanceMonitor';

// Modals
import ConfirmModal from '../modals/ConfirmModal';
import CreateClientModal from '../modals/CreateClientModal';
import CreateContainerModal from '../modals/CreateContainerModal';
import QRCodeModal from '../modals/QRCodeModal';
import CreateUserModal from '../modals/CreateUserModal';
import EditUserModal from '../modals/EditUserModal';
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
  const [activeSection, setActiveSection] = useState(
    localStorage.getItem('active-tab') || 'dashboard'
  );
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
  const [showEditUserModal, setShowEditUserModal] = useState(false);
  const [selectedUserForEdit, setSelectedUserForEdit] = useState(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [selectedClientForEdit, setSelectedClientForEdit] = useState(null);
  const [selectedClientForModal, setSelectedClientForModal] = useState(null);
  const [confirmModal, setConfirmModal] = useState({ open: false, client: null });
  // Guard anti-double-appel pour executeDeleteClient (filet de sécurité supplémentaire)
  const isDeletingRef = useRef(false);

  // ── All data comes from the dedicated hook ────────────────────────────────
  const {
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
    handleRunSpeedtest,
    suppressWsToast,
    activeInterface,
    setActiveInterface,
    interfaces,
  } = useDashboardData(session, activeSection);

  // ── Persist active tab ────────────────────────────────────────────────────
  useEffect(() => {
    localStorage.setItem('active-tab', activeSection);
  }, [activeSection]);

  // Update topologySelectedClient with fresh data when clients refresh
  useEffect(() => {
    if (topologySelectedClient) {
      const fresh = clients.find((c) => c.publicKey === topologySelectedClient.publicKey);
      if (fresh) setTopologySelectedClient(fresh);
    }
    // BUG-FIX: topologySelectedClient must be in deps so the closure captures the current value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clients, topologySelectedClient?.publicKey]);

  // ── Global Ctrl+K shortcut ────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setShowSearch((prev) => !prev);
      }
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
      // 📊 SaaS Tracking
      window.posthog?.capture('client_created', { container, name });
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
      addToast(
        e.response?.data?.error || `Erreur lors de la création du conteneur ${name}`,
        'error'
      );
    }
  };

  const handleToggleClient = async (container, name, enabled) => {
    try {
      await axiosInstance.post(`/clients/${container}/${name}/toggle`, { enabled });
      fetchData();
    } catch {
      addToast('Erreur toggle client', 'error');
    }
  };

  const handleDownloadConfig = (name, configText) => {
    const element = document.createElement('a');
    const file = new Blob([configText], { type: 'text/plain' });
    const url = URL.createObjectURL(file);
    element.href = url;
    element.download = `${name}.conf`;
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
    URL.revokeObjectURL(url);
  };

  const handleDeleteClient = (client) =>
    setConfirmModal({ open: true, type: 'delete-client', client });
  const handleDeleteContainerPrompt = (containerName) =>
    setConfirmModal({ open: true, type: 'delete-container', container: containerName });

  const handleDeleteUser = (user) => {
    setConfirmModal({ open: true, type: 'delete-user', user });
  };

  const executeDeleteClient = async () => {
    // Protection absolue contre le double-appel (modal, WS, StrictMode...)
    if (isDeletingRef.current) return;
    isDeletingRef.current = true;

    const { type, client, container, user } = confirmModal;
    setConfirmModal({ open: false, client: null, container: null, user: null });
    // Bloque les toasts WebSocket (peer_disconnected) pendant 3s pour éviter le doublon
    suppressWsToast();

    try {
      if (type === 'delete-user' && user) {
        try {
          await axiosInstance.delete(`/users/${user.username}`);
          addToast(`Opérateur ${user.username} supprimé`, 'success');
          fetchData();
        } catch (err) {
          addToast(err.response?.data?.error || 'Erreur suppression', 'error');
        }
        return;
      }

      if (type === 'delete-container' && container) {
        try {
          await axiosInstance.delete(`/clients/containers/${container}`);
          addToast('Conteneur supprimé avec succès', 'success');
          fetchData();
        } catch (err) {
          addToast(err.response?.data?.error || 'Erreur lors de la suppression', 'error');
        }
        return;
      }

      if (!client) return;
      try {
        await axiosInstance.delete(`/clients/${client.container}/${client.name}`);
        addToast('Client supprimé', 'success');
        fetchData();
        // 📊 SaaS Tracking
        window.posthog?.capture('client_deleted', { container: client.container, name: client.name });
        if (topologySelectedClient?.id === client.id) setTopologySelectedClient(null);
      } catch (err) {
        addToast(err.response?.data?.error || 'Erreur lors de la suppression', 'error');
      }
    } finally {
      setTimeout(() => {
        isDeletingRef.current = false;
      }, 500);
    }
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
              const res = await axiosInstance.get(
                `/clients/${client.container}/${client.name}/config`
              );
              setSelectedClientForModal({ name: client.name, config: res.data.config || '' });
              setShowQRModal(true);
            } catch {
              addToast('Erreur chargement configuration', 'error');
            }
          }}
          onEdit={() => {
            setSelectedClientForEdit(topologySelectedClient);
            setShowEditModal(true);
          }}
        />
      );
    }
    switch (activeSection) {
      case 'dashboard':
        return (
          <DashboardSection
            stats={stats}
            trafficData={trafficData}
            systemStats={systemStats}
            clients={clients}
            health={health}
            config={config}
            speedtest={speedtest}
            onRunSpeedtest={handleRunSpeedtest}
            sentinel={sentinelStatus}
            adguardStatus={adguardStatus}
            onCreateClient={() => setShowCreateModal(true)}
            onNavigate={handleNavigate}
            activeInterface={activeInterface}
            setActiveInterface={setActiveInterface}
            interfaces={interfaces}
          />
        );
      case 'containers':
        return (
          <ContainersSection
            clients={clients}
            allContainers={allContainers}
            loading={loading}
            activeContainer={activeContainer}
            setActiveContainer={setActiveContainer}
            onSelect={setTopologySelectedClient}
            onQRCode={async (client) => {
              try {
                const res = await axiosInstance.get(
                  `/clients/${client.container}/${client.name}/config`
                );
                setSelectedClientForModal({ name: client.name, config: res.data.config || '' });
                setShowQRModal(true);
              } catch {
                addToast('Erreur de configuration', 'error');
              }
            }}
            onToggle={handleToggleClient}
            onDelete={handleDeleteClient}
            onDeleteContainer={handleDeleteContainerPrompt}
            onEdit={(client) => {
              setSelectedClientForEdit(client);
              setShowEditModal(true);
            }}
            onCreateClient={(container) => {
              setTargetContainerForCreate(container);
              setShowCreateModal(true);
            }}
            onCreateContainer={() => setShowCreateContainerModal(true)}
          />
        );
      case 'topology':
        return (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-5 duration-700">
            <NetworkMap
              clients={clients}
              onSelectClient={setTopologySelectedClient}
              onlinePeers={onlinePeers}
            />
          </div>
        );
      case 'users':
        return (
          <UsersSection
            users={users}
            loading={loading}
            onRefresh={fetchData}
            onDelete={handleDeleteUser}
            onEdit={(user) => {
              setSelectedUserForEdit(user);
              setShowEditUserModal(true);
            }}
            onCreateUser={() => setShowCreateUserModal(true)}
          />
        );
      case 'logs':
        return <LogsSection />;
      case 'settings':
        return <SettingsSection />;
      case 'optimization':
        return <OptimizationSection systemStats={systemStats} />;
      case 'audit':
        return <AuditSection />;
      case 'dns':
        return <DnsSection />;
      default:
        return null;
    }
  };

  // ── Loading Skeleton ──────────────────────────────────────────────────────
  if (loading && clients.length === 0) {
    return (
      <div className="min-h-screen flex font-sans antialiased bg-[var(--bg-canvas)] transition-colors duration-300">
        <div className="hidden md:block w-64 lg:w-72 shrink-0 border-r h-screen glass-panel" />
        <main className="flex-1 min-w-0 p-4 sm:p-6 md:p-8 lg:p-10 overflow-y-auto">
          <SkeletonDashboard />
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex font-sans antialiased overflow-x-hidden transition-colors duration-700 selection:bg-indigo-500/30 bg-[var(--bg-canvas)]">
      <div className="mesh-bg" />
      <button
        onClick={() => setSidebarOpen(true)}
        className="fixed top-4 left-4 z-40 p-2.5 glass-panel border rounded-xl md:hidden shadow-lg active:scale-95 transition-all"
      >
        <Menu size={20} />
      </button>

      <button
        onClick={() => setShowSearch(true)}
        className="fixed top-4 right-4 z-40 hidden md:flex items-center gap-2 px-4 py-2.5 glass-panel border rounded-xl transition-all text-[11px] font-black uppercase tracking-widest shadow-lg hover:scale-105"
      >
        <Search size={14} />
        <span>Rechercher</span>
        <kbd
          className={cn(
            'ml-2 px-1.5 py-0.5 rounded text-[9px] border transition-colors',
            isDark
              ? 'bg-white/5 border-white/10 text-white/40'
              : 'bg-black/5 border-slate-200 text-slate-400'
          )}
        >
          Ctrl K
        </kbd>
      </button>

      <ErrorBoundary sectionName="Sidebar">
        <Sidebar
          activeSection={topologySelectedClient ? 'containers' : activeSection}
          setActiveSection={handleNavigate}
          isOpen={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          onLogout={onLogout}
          uptime={uptime}
          userRole={session?.role || ''}
        />
      </ErrorBoundary>

      <AnimatePresence>
        {loading && (
          <motion.div
            initial={{ width: '0%' }}
            animate={{ width: '100%' }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1.5, ease: 'easeInOut' }}
            className="fixed top-0 left-0 h-[2px] z-[100]"
            style={{
              backgroundColor: COLOR_MAP[theme]?.[500] || '#6366f1',
              boxShadow: `0 0 8px ${COLOR_MAP[theme]?.[500] || '#6366f1'}`,
            }}
          />
        )}
      </AnimatePresence>

      <main className="flex-1 min-w-0 pt-20 md:pt-0 pb-10 overflow-x-hidden relative transition-all duration-300">
        <div className="fixed inset-0 pointer-events-none -z-10 bg-transparent">
          <div
            className={cn(
              'absolute top-0 right-0 w-[600px] h-[600px] blur-[150px] opacity-40 animate-pulse transition-all duration-1000',
              isDark ? 'bg-indigo-600/10' : 'bg-indigo-500/15'
            )}
          />
          <div
            className={cn(
              'absolute bottom-0 left-0 w-[400px] h-[400px] blur-[120px] opacity-30 transition-all duration-1000',
              isDark ? 'bg-emerald-600/5' : 'bg-emerald-500/10'
            )}
          />
        </div>

        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 md:px-8 lg:px-10 xl:px-12 space-y-12">
          <AnimatePresence mode="wait">
            <motion.div
              key={topologySelectedClient ? 'client-detail' : activeSection}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            >
              {/* Status Banner */}
              {!topologySelectedClient && activeSection === 'dashboard' && (
                <div className="mb-8 grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div
                    className={cn(
                      'flex items-center justify-between px-5 py-4 rounded-2xl glass-panel border transition-all duration-500',
                      sentinelStatus?.status === 'active' || sentinelStatus?.status === 'online'
                        ? 'border-emerald-500/20 bg-emerald-500/5 shadow-[0_0_20px_rgba(16,185,129,0.05)]'
                        : 'border-red-500/20 bg-red-500/5 shadow-[0_0_20px_rgba(239,68,68,0.05)]'
                    )}
                  >
                    <div className="flex items-center gap-4">
                      <div
                        className={cn(
                          'w-2.5 h-2.5 rounded-full animate-pulse shadow-[0_0_8px_currentColor]',
                          sentinelStatus?.status === 'active' || sentinelStatus?.status === 'online'
                            ? 'text-emerald-500'
                            : 'text-red-500'
                        )}
                        style={{ backgroundColor: 'currentColor' }}
                      />
                      <div>
                        <p className="text-[10px] font-black uppercase tracking-tighter opacity-40">
                          Sentinel V2 Node
                        </p>
                        <p className="text-sm font-semibold tracking-tight">
                          {sentinelStatus?.status === 'active' ||
                          sentinelStatus?.status === 'online'
                            ? 'Surveillance Active'
                            : 'Sentinel Hors-ligne'}
                        </p>
                      </div>
                    </div>
                    {sentinelStatus?.lastHeartbeat && (
                      <span className="text-[9px] font-mono opacity-30">
                        {new Date(sentinelStatus.lastHeartbeat).toLocaleTimeString()}
                      </span>
                    )}
                  </div>

                  <div
                    className={cn(
                      'flex items-center justify-between px-5 py-4 rounded-2xl glass-panel border transition-all duration-500',
                      adguardStatus?.status === 'active'
                        ? 'border-indigo-500/20 bg-indigo-500/5 shadow-[0_0_20px_rgba(99,102,241,0.05)]'
                        : 'border-amber-500/20 bg-amber-500/5 shadow-[0_0_20px_rgba(245,158,11,0.05)]'
                    )}
                  >
                    <div className="flex items-center gap-4">
                      <div
                        className={cn(
                          'w-2.5 h-2.5 rounded-full shadow-[0_0_8px_currentColor]',
                          adguardStatus?.status === 'active' ? 'text-indigo-500' : 'text-amber-500'
                        )}
                        style={{ backgroundColor: 'currentColor' }}
                      />
                      <div>
                        <p className="text-[10px] font-black uppercase tracking-tighter opacity-40">
                          DNS Protection
                        </p>
                        <p className="text-sm font-semibold tracking-tight">
                          {adguardStatus?.status === 'active'
                            ? 'Filtrage DNS Actif'
                            : 'DNS Interrompu'}
                        </p>
                      </div>
                    </div>
                    <span className="text-[9px] font-mono opacity-30 uppercase">
                      {adguardStatus?.version || 'v0.107+'}
                    </span>
                  </div>
                </div>
              )}

              <ErrorBoundary sectionName={activeSection}>{renderSection()}</ErrorBoundary>
            </motion.div>
          </AnimatePresence>

          {/* SaaS Footer (Legal & Versioning) */}
          <footer className="pt-10 pb-6 border-t border-white/5 opacity-40 hover:opacity-100 transition-opacity duration-500">
            <div className="flex flex-col md:flex-row items-center justify-between gap-6">
              <div className="flex items-center gap-4 text-[10px] font-medium tracking-widest uppercase">
                <span className="text-indigo-500">WG-FUX Enterprise</span>
                <span className="w-1 h-1 rounded-full bg-white/20" />
                <span>v6.5.0</span>
              </div>
              <div className="flex items-center gap-8 text-[11px] font-bold">
                <a
                  href="/legal/privacy.html"
                  target="_blank"
                  className="hover:text-indigo-400 transition-colors"
                >
                  Privacy Policy
                </a>
                <a
                  href="/legal/tos.html"
                  target="_blank"
                  className="hover:text-indigo-400 transition-colors"
                >
                  Terms of Service
                </a>
                <a href="#" className="hover:text-indigo-400 transition-colors">
                  Documentation
                </a>
                <a
                  href="https://github.com/faleryo/wg-fux"
                  target="_blank"
                  rel="noreferrer"
                  className="hover:text-indigo-400 transition-colors"
                >
                  GitHub
                </a>
              </div>
              <div className="text-[10px] opacity-60">
                &copy; {new Date().getFullYear()} Faleryo Labs. All rights reserved.
              </div>
            </div>
          </footer>
        </div>
      </main>

      <div className="fixed bottom-6 right-6 z-40 hidden xl:block animate-in fade-in slide-in-from-right-10 duration-1000">
        <PerformanceMonitor />
      </div>

      <ErrorBoundary sectionName="Modals">
        <GlobalSearch
          isOpen={showSearch}
          onClose={() => setShowSearch(false)}
          clients={clients}
          onNavigate={handleNavigate}
        />

        {showQRModal && (
          <QRCodeModal
            isOpen={showQRModal}
            onClose={() => setShowQRModal(false)}
            client={selectedClientForModal}
            onDownload={handleDownloadConfig}
          />
        )}
        {showCreateContainerModal && (
          <CreateContainerModal
            isOpen={showCreateContainerModal}
            onClose={() => setShowCreateContainerModal(false)}
            onCreate={handleCreateContainer}
          />
        )}
        {showCreateModal && (
          <CreateClientModal
            isOpen={showCreateModal}
            onClose={() => {
              setShowCreateModal(false);
              setTargetContainerForCreate(null);
            }}
            onCreate={handleCreateClient}
            targetContainer={targetContainerForCreate}
          />
        )}
        {showCreateUserModal && (
          <CreateUserModal
            isOpen={showCreateUserModal}
            onClose={() => setShowCreateUserModal(false)}
            onCreate={async (username, password, role) => {
              try {
                await axiosInstance.post('/users', { username, password, role });
                addToast(`Opérateur ${username} créé avec succès`, 'success');
                fetchData();
              } catch (err) {
                addToast(err.response?.data?.error || 'Erreur lors de la création', 'error');
              }
            }}
          />
        )}
        {showEditModal && selectedClientForEdit && (
          <EditClientModal
            isOpen={showEditModal}
            onClose={() => {
              setShowEditModal(false);
              setSelectedClientForEdit(null);
            }}
            client={selectedClientForEdit}
            onSave={fetchData}
          />
        )}

        {showEditUserModal && selectedUserForEdit && (
          <EditUserModal
            isOpen={showEditUserModal}
            onClose={() => {
              setShowEditUserModal(false);
              setSelectedUserForEdit(null);
            }}
            user={selectedUserForEdit}
            onSave={async (username, updateData) => {
              await axiosInstance.patch(`/users/${username}`, updateData);
              fetchData();
            }}
            onReset2FA={async (username) => {
              await axiosInstance.post(`/users/${username}/reset-2fa`);
              fetchData();
            }}
          />
        )}

        <ConfirmModal
          isOpen={confirmModal.open}
          title={
            confirmModal.type === 'delete-container'
              ? 'Supprimer le conteneur'
              : confirmModal.type === 'delete-user'
                ? "Supprimer l'opérateur"
                : 'Supprimer le client'
          }
          message={
            confirmModal.type === 'delete-container' ? (
              <span>
                Supprimer le conteneur vide{' '}
                <strong className={cn('font-mono', isDark ? 'text-white' : 'text-slate-900')}>
                  {confirmModal.container}
                </strong>{' '}
                ?
              </span>
            ) : confirmModal.client ? (
              <span>
                Supprimer{' '}
                <strong className={cn('font-mono', isDark ? 'text-white' : 'text-slate-900')}>
                  {confirmModal.client.name}
                </strong>{' '}
                du conteneur{' '}
                <strong className={cn('font-mono', isDark ? 'text-white' : 'text-slate-900')}>
                  {confirmModal.client.container}
                </strong>{' '}
                ?
              </span>
            ) : confirmModal.type === 'delete-user' && confirmModal.user ? (
              <span>
                Supprimer l'opérateur{' '}
                <strong className={cn('font-mono', isDark ? 'text-white' : 'text-slate-900')}>
                  {confirmModal.user.username}
                </strong>{' '}
                ? Cette action révoquera immédiatement ses accès système.
              </span>
            ) : (
              'Cette action est irréversible.'
            )
          }
          confirmLabel="Supprimer définitivement"
          intent="danger"
          onConfirm={executeDeleteClient}
          onCancel={() =>
            setConfirmModal({ open: false, client: null, container: null, user: null })
          }
        />
      </ErrorBoundary>
    </div>
  );
};

export default MainLayout;
