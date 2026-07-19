import React, { createContext, useContext, useState, useEffect } from 'react';

const translations = {
  fr: {
    dashboard: 'Tableau de bord',
    containers: 'Conteneurs',
    sales: 'Ventes',
    network: 'Réseau',
    users_manage: 'Utilisateurs',
    servers: 'Serveurs',
    logs: 'Logs',
    topology: 'Topologie',
    dns_editor: 'Éditeur DNS',
    optimization: 'Optimisation',
    audit: 'Audit',
    settings: 'Paramètres',
    logout: 'Déconnexion',
    configs: 'Configurations',
    support: 'Support',
    active_core: 'Cœur Actif',
    uptime: 'Temps Activité',
    reboot_system: 'Redémarrer Système',
    secure_portal: 'Espace Utilisateur Sécurisé',
    no_config: 'Aucune configuration disponible',
    contact_admin: "Contactez l'administrateur.",
  },
  en: {
    dashboard: 'Dashboard',
    containers: 'Containers',
    sales: 'Sales',
    network: 'Network',
    users_manage: 'Users',
    servers: 'Servers',
    logs: 'Logs',
    topology: 'Topology',
    dns_editor: 'DNS Editor',
    optimization: 'Optimization',
    audit: 'Audit',
    settings: 'Settings',
    logout: 'Logout',
    configs: 'Configurations',
    support: 'Support',
    active_core: 'Active Core',
    uptime: 'Uptime',
    reboot_system: 'Reboot System',
    secure_portal: 'Secure User Portal',
    no_config: 'No configuration available',
    contact_admin: 'Contact administrator.',
  },
};

const LanguageContext = createContext();

export const LanguageProvider = ({ children }) => {
  const [lang, setLang] = useState(localStorage.getItem('app-lang') || 'fr');

  useEffect(() => {
    localStorage.setItem('app-lang', lang);
  }, [lang]);

  const t = (key) => {
    return translations[lang]?.[key] || key;
  };

  return (
    <LanguageContext.Provider value={{ lang, setLang, t }}>{children}</LanguageContext.Provider>
  );
};

export const useLang = () => useContext(LanguageContext);
