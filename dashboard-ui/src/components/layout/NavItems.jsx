import React from 'react';
import {
  Home,
  Package,
  BadgeDollarSign,
  Users,
  FileText,
  Activity,
  Gauge,
  ShieldCheck,
  Settings,
  Server,
  LogOut,
  ChevronRight,
  Globe,
  Network,
} from 'lucide-react';
import { motion } from 'framer-motion';
import { cn, COLOR_MAP } from '../../lib/utils';

const NavItems = ({
  activeSection,
  setActiveSection,
  onClose,
  collapsed,
  isDark,
  theme,
  onLogout,
  t,
  userRole,
  instanceLicensed,
  needsOnboarding,
}) => {
  const isAdmin = userRole === 'admin';
  // Un viewer (revendeur) n'a pas accès aux endpoints manager/admin : on masque
  // les sections qui ne feraient que produire des 403 (logs, dns, optimisation,
  // audit). Il ne lui reste que son dashboard scopé, ses conteneurs, la topologie.
  const isManager = userRole === 'admin' || userRole === 'manager';
  const isReseller = userRole === 'reseller';
  // Sur une INSTANCE licenciée (VPS revendeur), les onglets "plateforme"
  // (enrôlement de serveurs, réseau de crédits) sont masqués : seule la
  // plateforme mère enrôle et facture — les afficher ne ferait que semer la
  // confusion chez le client.
  const navItems = [
    { id: 'dashboard', icon: <Home size={20} />, label: t('dashboard') },
    { id: 'containers', icon: <Package size={20} />, label: t('containers') },
    {
      // Le comptoir du vendeur : abonnements, renouvellements payants, crédits.
      // UNIQUEMENT sur une instance licenciée — sur la plateforme mère, le
      // business passe par Réseau/Serveurs, pas par la vente au détail.
      id: 'sales',
      icon: <BadgeDollarSign size={20} />,
      label: t('sales'),
      hidden: !instanceLicensed || !(isReseller || isAdmin || userRole === 'manager'),
    },
    {
      id: 'network',
      icon: <Network size={20} />,
      label: t('network'),
      hidden: !(isAdmin || isReseller) || instanceLicensed,
    },
    {
      id: 'users',
      icon: <Users size={20} />,
      label: t('users_manage'),
      hidden: !isAdmin,
    },
    {
      id: 'servers',
      icon: <Server size={20} />,
      label: t('servers'),
      // Un revendeur gère SES VPS/licences ici (espace de travail) — masqué
      // seulement sur une instance licenciée (c'est la mère qui enrôle).
      hidden: !(isAdmin || isReseller) || instanceLicensed,
    },
    { id: 'logs', icon: <FileText size={20} />, label: t('logs'), hidden: !isManager },
    { id: 'topology', icon: <Activity size={20} />, label: t('topology') },
    { id: 'dns', icon: <Globe size={20} />, label: t('dns_editor'), hidden: !isManager },
    { id: 'optimization', icon: <Gauge size={20} />, label: t('optimization'), hidden: !isManager },
    { id: 'audit', icon: <ShieldCheck size={20} />, label: t('audit'), hidden: !isManager },
    {
      id: 'settings',
      icon: <Settings size={20} />,
      label: t('settings'),
      hidden: !isAdmin,
    },
  ];

  return (
    <nav className="flex-1 px-3 space-y-1.5 overflow-y-auto custom-scrollbar">
      {navItems
        // Un revendeur invité par lien n'a accès qu'à l'onglet Serveurs tant
        // qu'il n'a pas enregistré son propre VPS (l'API refuse déjà le reste).
        .filter((i) => (needsOnboarding ? i.id === 'servers' : !i.hidden))
        .map((item) => {
          const isActive = activeSection === item.id;
          return (
            <button
              key={item.id}
              onClick={() => {
                setActiveSection(item.id);
                onClose();
              }}
              title={collapsed ? item.label : undefined}
              className={cn(
                'group relative w-full flex items-center gap-3 px-3 py-3 rounded-2xl transition-all duration-300',
                collapsed ? 'md:justify-center md:px-0' : '',
                isActive
                  ? 'text-white shadow-lg'
                  : isDark
                    ? 'text-slate-500 hover:bg-white/5 hover:text-slate-200'
                    : 'text-slate-500 hover:bg-black/5 hover:text-slate-900'
              )}
              style={
                isActive
                  ? {
                      backgroundColor: COLOR_MAP[theme]?.[600] || '#4f46e5',
                      boxShadow: `0 4px 14px -4px ${COLOR_MAP[theme]?.[600] || '#4f46e5'}66`,
                    }
                  : undefined
              }
            >
              {isActive && (
                <motion.div
                  layoutId="activeNav"
                  className="absolute left-0 top-1/2 -translate-y-1/2 h-8 w-1 bg-white rounded-r-full shadow-[0_0_15px_white]"
                />
              )}
              <div
                className={cn(
                  'transition-transform duration-300 flex-shrink-0',
                  !isActive && 'group-hover:scale-110 group-hover:rotate-3'
                )}
              >
                {React.cloneElement(item.icon, {
                  size: 18,
                  className: isActive
                    ? 'text-white'
                    : cn(
                        'transition-colors',
                        isDark ? 'group-hover:text-white' : 'group-hover:text-slate-900'
                      ),
                })}
              </div>
              <span
                className={cn(
                  'font-bold text-xs tracking-wide uppercase whitespace-nowrap transition-all duration-300 overflow-hidden',
                  collapsed ? 'md:w-0 md:opacity-0' : 'w-auto opacity-100',
                  isActive
                    ? 'text-white'
                    : cn(
                        'transition-colors',
                        isDark
                          ? 'text-slate-500 group-hover:text-white'
                          : 'text-slate-400 group-hover:text-slate-900'
                      )
                )}
              >
                {item.label}
              </span>
              {!collapsed && isActive && (
                <motion.div
                  initial={{ opacity: 0, x: -5 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="ml-auto"
                >
                  <ChevronRight size={14} />
                </motion.div>
              )}
            </button>
          );
        })}

      <button
        onClick={() => {
          onLogout();
          onClose();
        }}
        className={cn(
          'group w-full flex items-center gap-3 px-3 py-3 rounded-2xl transition-all duration-300 mt-6',
          isDark
            ? 'text-slate-500 hover:bg-red-500/10 hover:text-red-400'
            : 'text-slate-400 hover:bg-red-50 hover:text-red-600',
          collapsed && 'md:justify-center md:px-0'
        )}
        title={collapsed ? t('logout') : undefined}
      >
        <LogOut
          size={18}
          className="group-hover:scale-110 group-hover:rotate-3 transition-transform flex-shrink-0"
        />
        <span
          className={cn(
            'font-bold text-xs tracking-wide uppercase transition-all duration-300 overflow-hidden text-slate-500 group-hover:text-red-400',
            collapsed ? 'md:w-0 md:opacity-0' : 'w-auto opacity-100'
          )}
        >
          {t('logout')}
        </span>
      </button>
    </nav>
  );
};

export default NavItems;
