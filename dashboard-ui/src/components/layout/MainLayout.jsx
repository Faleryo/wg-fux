import React, { useState, useEffect, useRef, lazy, Suspense } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Menu, Search, ShieldAlert, X as XIcon } from 'lucide-react';
import { useToast } from '../../context/ToastContext';
import { useTheme } from '../../context/ThemeContext';
import { useSelectedServer } from '../../context/SelectedServerContext';
import { cn, COLOR_MAP } from '../../lib/utils';
import { axiosInstance } from '../../lib/api';
import ErrorBoundary from '../ErrorBoundary';
import ServerSelector from '../../features/servers/components/ServerSelector';

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
import UserReportModal from '../modals/UserReportModal';

// Feature: Dashboard
import useDashboardData from '../../features/dashboard/hooks/useDashboardData';
import useClientActions from './hooks/useClientActions';
import useDeleteActions from './hooks/useDeleteActions';
import useUserActions from './hooks/useUserActions';

// Features Components
import DashboardSection from '../../features/dashboard/components/DashboardSection';
import NetworkMap from '../../features/dashboard/components/NetworkMap';
import ContainersSection from '../../features/clients/components/ClientList';
import ClientDetail from '../../features/clients/components/ClientDetail';
import UsersSection from '../../features/users/components/UsersSection';
// Heavy sections are lazy-loaded so the initial bundle stays small.
// They are only fetched the first time the user navigates to them.
const ServersSection = lazy(() => import('../../features/servers/components/ServersSection'));
const NetworkSection = lazy(() => import('../../features/network/components/NetworkSection'));
const LogsSection = lazy(() => import('../../features/monitoring/components/LogsSection'));
const SettingsSection = lazy(() => import('../../features/settings/components/SettingsSection'));
const OptimizationSection = lazy(
  () => import('../../features/settings/components/OptimizationSection')
);
const AuditSection = lazy(() => import('../../features/monitoring/components/AuditSection'));
const DnsSection = lazy(() => import('../../features/dns/components/DnsEditor'));

const TWOFА_BANNER_KEY = '2fa-banner-v1-dismissed';

const TwoFABanner = ({ onNavigate }) => {
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(TWOFА_BANNER_KEY) === '1');
  if (dismissed) return null;
  const dismiss = () => {
    localStorage.setItem(TWOFА_BANNER_KEY, '1');
    setDismissed(true);
  };
  return (
    <div className="mx-auto max-w-[1600px] px-4 sm:px-6 md:px-8 lg:px-10 xl:px-12 pt-4">
      <div className="flex items-center gap-4 px-5 py-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-300">
        <ShieldAlert size={18} className="flex-shrink-0 text-amber-400" />
        <p className="text-[11px] font-black uppercase tracking-wider flex-1">
          Votre compte admin n'a pas de 2FA activé —{' '}
          <button onClick={onNavigate} className="underline hover:text-amber-200 transition-colors">
            configurer maintenant
          </button>
        </p>
        <button onClick={dismiss} className="p-1 hover:text-white transition-colors">
          <XIcon size={14} />
        </button>
      </div>
    </div>
  );
};

// Bandeau licence de l'instance revendeur : marque (white-label poussée par la
// plateforme mère), échéance proche/expirée, mise à jour disponible. Ne rend
// rien sur l'instance mère (licence désactivée).
const LicenseBanner = ({ lic }) => {
  const [now] = useState(() => Date.now());

  // White-label : le nom de marque devient le titre de l'onglet.
  useEffect(() => {
    if (lic?.brand?.name) document.title = lic.brand.name;
  }, [lic]);

  if (!lic || !lic.enabled) return null;
  const daysLeft = lic.expiresAt
    ? Math.ceil((new Date(lic.expiresAt).getTime() - now) / 86400000)
    : null;
  const expired = !lic.valid;
  const soon = !expired && daysLeft != null && daysLeft <= 7;
  if (!expired && !soon && !lic.updateAvailable) return null;

  return (
    <div className="mx-auto max-w-[1600px] px-4 sm:px-6 md:px-8 lg:px-10 xl:px-12 pt-4 space-y-2">
      {(expired || soon) && (
        <div
          className={cn(
            'px-5 py-3.5 rounded-2xl border space-y-1.5',
            expired
              ? 'bg-red-500/10 border-red-500/20 text-red-300'
              : 'bg-amber-500/10 border-amber-500/20 text-amber-300'
          )}
        >
          <div className="flex items-center gap-4">
            <ShieldAlert size={18} className="flex-shrink-0" />
            <p className="text-[11px] font-black uppercase tracking-wider flex-1">
              {expired
                ? 'Licence expirée — la création de clients est bloquée. Renouvelez pour continuer.'
                : `Licence : ${daysLeft} jour${daysLeft > 1 ? 's' : ''} restant${daysLeft > 1 ? 's' : ''} — pensez à renouveler.`}
            </p>
          </div>
          {/* Comment payer : contact poussé par la plateforme (vente manuelle sans Stripe) */}
          {lic.reseller?.contact &&
            (lic.reseller.contact.whatsapp ||
              lic.reseller.contact.telegram ||
              lic.reseller.contact.instructions) && (
              <p className="text-[11px] pl-9 opacity-90">
                Pour renouveler :{' '}
                {lic.reseller.contact.whatsapp && (
                  <a
                    href={`https://wa.me/${lic.reseller.contact.whatsapp.replace(/[^0-9]/g, '')}`}
                    target="_blank"
                    rel="noreferrer"
                    className="font-bold underline"
                  >
                    WhatsApp {lic.reseller.contact.whatsapp}
                  </a>
                )}
                {lic.reseller.contact.whatsapp && lic.reseller.contact.telegram && ' · '}
                {lic.reseller.contact.telegram && (
                  <a
                    href={`https://t.me/${lic.reseller.contact.telegram.replace(/^@/, '')}`}
                    target="_blank"
                    rel="noreferrer"
                    className="font-bold underline"
                  >
                    Telegram {lic.reseller.contact.telegram}
                  </a>
                )}
                {lic.reseller.contact.instructions && (
                  <span className="block opacity-80">{lic.reseller.contact.instructions}</span>
                )}
              </p>
            )}
        </div>
      )}
      {lic.updateAvailable && !expired && (
        <div className="flex items-center gap-4 px-5 py-3 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-300">
          <p className="text-[10px] font-black uppercase tracking-wider">
            Mise à jour disponible ({lic.currentVersion} → {lic.latestVersion}) — appliquée
            automatiquement par le cron quotidien.
          </p>
        </div>
      )}
    </div>
  );
};

/**
 * Feature: Main Layout
 * Extracted from App.jsx. Handles UI shell (sidebar, search, modals)
 * and delegates all data fetching to useDashboardData.
 */
const MainLayout = ({ session, onLogout }) => {
  const { theme, mode } = useTheme();
  const { addToast } = useToast();
  // Un viewer (revendeur) n'a pas les droits manager : on masque les sections
  // et widgets qui appellent /system/* (sinon 403 + fuite de métriques globales).
  const isManager = session?.role === 'admin' || session?.role === 'manager';
  const isAdmin = session?.role === 'admin';
  const isReseller = session?.role === 'reseller';
  const MANAGER_ONLY_SECTIONS = new Set(['logs', 'dns', 'optimization', 'audit']);
  const ADMIN_ONLY_SECTIONS = new Set(['users', 'settings', 'servers']);
  const [activeSection, setActiveSection] = useState(
    localStorage.getItem('active-tab') || 'dashboard'
  );
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [topologySelectedClient, setTopologySelectedClient] = useState(null);
  const [activeContainer, setActiveContainer] = useState(() => {
    const savedTab = localStorage.getItem('active-tab');
    return savedTab === 'containers' ? localStorage.getItem('active-container') || null : null;
  });

  const isDark = mode === 'dark';

  // Licence de CETTE instance (revendeur) : pilote le bandeau (expiration,
  // maj, white-label) ET le masquage des onglets plateforme (Serveurs/Réseau
  // n'ont pas de sens sur une instance licenciée — c'est la mère qui enrôle).
  const [instanceLic, setInstanceLic] = useState(null);
  useEffect(() => {
    let mounted = true;
    axiosInstance
      .get('/system/license')
      .then((res) => mounted && setInstanceLic(res.data))
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);
  const instanceLicensed = Boolean(instanceLic?.enabled);

  // Modal states
  const [showQRModal, setShowQRModal] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showCreateContainerModal, setShowCreateContainerModal] = useState(false);
  const [targetContainerForCreate, setTargetContainerForCreate] = useState(null);
  const [showCreateUserModal, setShowCreateUserModal] = useState(false);
  const [showEditUserModal, setShowEditUserModal] = useState(false);
  const [selectedUserForEdit, setSelectedUserForEdit] = useState(null);
  const [showUserReportModal, setShowUserReportModal] = useState(false);
  const [selectedUserForReport, setSelectedUserForReport] = useState(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [selectedClientForEdit, setSelectedClientForEdit] = useState(null);
  const [selectedClientForModal, setSelectedClientForModal] = useState(null);
  // ── Modal state for QR + create/edit (owned here; delete modal owned by useDeleteActions) ─

  // Serveur cible courant (Local / VPS). Pilote l'en-tête x-server-id et le re-fetch.
  const { selectedServerId } = useSelectedServer();

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
  } = useDashboardData(session, activeSection, selectedServerId);

  // ── Persist active tab + container ───────────────────────────────────────
  useEffect(() => {
    localStorage.setItem('active-tab', activeSection);
  }, [activeSection]);

  useEffect(() => {
    if (activeSection === 'containers') {
      if (activeContainer) {
        localStorage.setItem('active-container', activeContainer);
      } else {
        localStorage.removeItem('active-container');
      }
    }
  }, [activeContainer, activeSection]);

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

  // ── Mobile back navigation (bouton retour Android / swipe iOS) ────────────
  // Principe : pushState à chaque navigation en avant → popstate intercepté en retour.
  // isBackNavRef évite de re-pousher quand c'est popstate qui a changé l'état.
  // topologySelectedClient?.id (pas l'objet entier) pour ignorer les rafraîchissements de données.
  const navRef = useRef(null);
  const isBackNavRef = useRef(false);
  const navMountedRef = useRef(false);

  useEffect(() => {
    navRef.current = { activeSection, activeContainer, client: topologySelectedClient };
  }, [activeSection, activeContainer, topologySelectedClient]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!navMountedRef.current) {
      navMountedRef.current = true;
      window.history.replaceState({ wgFux: true }, '');
      return;
    }
    if (isBackNavRef.current) {
      isBackNavRef.current = false;
      return;
    }
    window.history.pushState({ wgFux: true }, '');
  }, [activeSection, activeContainer, topologySelectedClient?.id ?? null]);

  useEffect(() => {
    const onPopState = (e) => {
      if (!e.state?.wgFux) return;
      const { activeSection: sec, activeContainer: ctr, client } = navRef.current;
      isBackNavRef.current = true;
      setSidebarOpen(false);
      if (client) {
        navRef.current = { ...navRef.current, client: null };
        setTopologySelectedClient(null);
      } else if (ctr) {
        navRef.current = { ...navRef.current, activeContainer: null };
        setActiveContainer(null);
      } else if (sec !== 'dashboard') {
        navRef.current = { ...navRef.current, activeSection: 'dashboard' };
        setActiveSection('dashboard');
      } else {
        isBackNavRef.current = false; // root — le navigateur gère
      }
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Redirect + toast when a viewer navigates to a forbidden section
  useEffect(() => {
    const forbidden =
      (!isManager && MANAGER_ONLY_SECTIONS.has(activeSection)) ||
      (!isAdmin && ADMIN_ONLY_SECTIONS.has(activeSection)) ||
      (activeSection === 'network' && !(isAdmin || isReseller));
    if (forbidden) {
      setActiveSection('dashboard');
      addToast('Accès refusé — section réservée aux administrateurs', 'error');
    }
  }, [activeSection, isManager, isAdmin, addToast]);

  const handleNavigate = (sectionId, opts = {}) => {
    setActiveSection(sectionId);
    if (opts.container) setActiveContainer(opts.container);
    if (opts.client) setTopologySelectedClient(opts.client);
    else setTopologySelectedClient(null);
    setSidebarOpen(false);
  };

  // ── Extracted CRUD hooks ──────────────────────────────────────────────────
  const {
    handleCreateClient,
    handleCreateContainer,
    handleToggleClient,
    handleShowQRCode,
    handleDownloadConfig,
  } = useClientActions({
    fetchData,
    addToast,
    suppressWsToast,
    setShowQRModal,
    setSelectedClientForModal,
  });

  const {
    confirmModal,
    setConfirmModal,
    handleDeleteClient,
    handleDeleteContainerPrompt,
    handleBulkDelete,
    handleDeleteUser,
    executeDelete,
  } = useDeleteActions({
    fetchData,
    addToast,
    suppressWsToast,
    topologySelectedClient,
    setTopologySelectedClient,
  });

  const { handleCreateUser, handleSaveUser, handleReset2FA } = useUserActions({
    fetchData,
    addToast,
  });

  // ── Section Renderer ──────────────────────────────────────────────────────
  const renderSection = () => {
    if (topologySelectedClient) {
      return (
        <ClientDetail
          client={topologySelectedClient}
          onBack={() => setTopologySelectedClient(null)}
          onToggle={handleToggleClient}
          onDelete={() => handleDeleteClient(topologySelectedClient)}
          onQRCode={handleShowQRCode}
          onEdit={() => {
            setSelectedClientForEdit(topologySelectedClient);
            setShowEditModal(true);
          }}
        />
      );
    }
    // Garde-fou : un utilisateur qui atteindrait une section au-dessus de ses
    // droits (recherche globale, tab persisté en localStorage…) est renvoyé sur
    // son dashboard — sinon la section déclencherait des 403 en boucle.
    const forbidden =
      (!isManager && MANAGER_ONLY_SECTIONS.has(activeSection)) ||
      (!isAdmin && ADMIN_ONLY_SECTIONS.has(activeSection)) ||
      (activeSection === 'network' && !(isAdmin || isReseller));
    const section = forbidden ? 'dashboard' : activeSection;
    switch (section) {
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
            isManager={isManager}
            loading={loading}
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
            onlinePeers={onlinePeers}
            onSelect={setTopologySelectedClient}
            onQRCode={handleShowQRCode}
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
            onBulkDelete={handleBulkDelete}
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
            onViewReport={(user) => {
              setSelectedUserForReport(user);
              setShowUserReportModal(true);
            }}
          />
        );
      case 'servers':
        return (
          <Suspense fallback={<div className="h-48 animate-pulse bg-white/5 rounded-3xl" />}>
            <ServersSection />
          </Suspense>
        );
      case 'network':
        return (
          <Suspense fallback={<div className="h-48 animate-pulse bg-white/5 rounded-3xl" />}>
            <NetworkSection userRole={session?.role || ''} />
          </Suspense>
        );
      case 'logs':
        return (
          <Suspense fallback={<div className="h-48 animate-pulse bg-white/5 rounded-3xl" />}>
            <LogsSection />
          </Suspense>
        );
      case 'settings':
        return (
          <Suspense fallback={<div className="h-48 animate-pulse bg-white/5 rounded-3xl" />}>
            <SettingsSection />
          </Suspense>
        );
      case 'optimization':
        return (
          <Suspense fallback={<div className="h-48 animate-pulse bg-white/5 rounded-3xl" />}>
            <OptimizationSection systemStats={systemStats} />
          </Suspense>
        );
      case 'audit':
        return (
          <Suspense fallback={<div className="h-48 animate-pulse bg-white/5 rounded-3xl" />}>
            <AuditSection />
          </Suspense>
        );
      case 'dns':
        return (
          <Suspense fallback={<div className="h-48 animate-pulse bg-white/5 rounded-3xl" />}>
            <DnsSection />
          </Suspense>
        );
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

      <div className="fixed top-4 right-4 z-40 flex items-center gap-2">
        <ServerSelector userRole={session?.role || ''} />
        <button
          onClick={() => setShowSearch(true)}
          className="hidden md:flex items-center gap-2 px-4 py-2.5 glass-panel border rounded-xl transition-all text-[11px] font-black uppercase tracking-widest shadow-lg hover:scale-105"
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
      </div>

      <ErrorBoundary sectionName="Sidebar">
        <Sidebar
          activeSection={topologySelectedClient ? 'containers' : activeSection}
          setActiveSection={handleNavigate}
          isOpen={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          onLogout={onLogout}
          uptime={uptime}
          userRole={session?.role || ''}
          instanceLicensed={instanceLicensed}
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

        {/* 2FA warning banner — shown to admins who haven't set up 2FA */}
        {isAdmin && session.twoFactorEnabled === false && (
          <TwoFABanner onNavigate={() => setActiveSection('settings')} />
        )}

        {/* Licence de l'instance (revendeur) : expiration, maj, white-label */}
        <LicenseBanner lic={instanceLic} />

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
              </div>
              <div className="text-[10px] opacity-60">
                &copy; {new Date().getFullYear()} Faleryo Labs. All rights reserved.
              </div>
            </div>
          </footer>
        </div>
      </main>

      {isManager && (
        <div className="fixed bottom-6 right-6 z-40 hidden xl:block animate-in fade-in slide-in-from-right-10 duration-1000">
          <PerformanceMonitor />
        </div>
      )}

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
            allContainers={allContainers}
          />
        )}
        {showCreateUserModal && (
          <CreateUserModal
            isOpen={showCreateUserModal}
            onClose={() => setShowCreateUserModal(false)}
            onCreate={handleCreateUser}
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

        <UserReportModal
          isOpen={showUserReportModal}
          onClose={() => {
            setShowUserReportModal(false);
            setSelectedUserForReport(null);
          }}
          user={selectedUserForReport}
        />

        {showEditUserModal && selectedUserForEdit && (
          <EditUserModal
            isOpen={showEditUserModal}
            onClose={() => {
              setShowEditUserModal(false);
              setSelectedUserForEdit(null);
            }}
            user={selectedUserForEdit}
            onSave={handleSaveUser}
            onReset2FA={handleReset2FA}
          />
        )}

        <ConfirmModal
          isOpen={confirmModal.open}
          title={
            confirmModal.type === 'bulk-delete'
              ? `Supprimer ${confirmModal.clients?.length ?? 0} peer${(confirmModal.clients?.length ?? 0) > 1 ? 's' : ''}`
              : confirmModal.type === 'delete-container'
                ? 'Supprimer le conteneur'
                : confirmModal.type === 'delete-user'
                  ? "Supprimer l'opérateur"
                  : 'Supprimer le client'
          }
          message={
            confirmModal.type === 'bulk-delete' && confirmModal.clients ? (
              <span>
                Supprimer définitivement{' '}
                <strong className={cn('font-mono', isDark ? 'text-white' : 'text-slate-900')}>
                  {confirmModal.clients.length} peer{confirmModal.clients.length > 1 ? 's' : ''}
                </strong>{' '}
                ? Cette action est irréversible.
              </span>
            ) : confirmModal.type === 'delete-container' ? (
              <span>
                Supprimer le conteneur vide{' '}
                <strong className={cn('font-mono', isDark ? 'text-white' : 'text-slate-900')}>
                  {confirmModal.container}
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
            ) : (
              'Cette action est irréversible.'
            )
          }
          confirmLabel="Supprimer définitivement"
          intent="danger"
          onConfirm={executeDelete}
          onCancel={() =>
            setConfirmModal({
              open: false,
              client: null,
              container: null,
              user: null,
              clients: null,
            })
          }
        />
      </ErrorBoundary>
    </div>
  );
};

export default MainLayout;
