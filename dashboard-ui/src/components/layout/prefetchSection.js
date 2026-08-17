// prefetchSection.js — Précharge le code d'un onglet AVANT le clic.
//
// Huit sections sont chargées à la demande (React.lazy) : le premier affichage
// déclenche donc un téléchargement réseau, d'où l'attente visible en changeant
// d'onglet — jusqu'à 50 Ko pour Serveurs. En lançant le même `import()` dès le
// survol du menu, le module est déjà en cache quand l'utilisateur clique.
//
// `import()` est idempotent : rappeler le même chemin renvoie la promesse déjà
// résolue, sans second téléchargement. Un préchargement inutile ne coûte rien.

const LOADERS = {
  servers: () => import('../../features/servers/components/ServersSection'),
  network: () => import('../../features/network/components/NetworkSection'),
  sales: () => import('../../features/sales/components/SalesSection'),
  logs: () => import('../../features/monitoring/components/LogsSection'),
  settings: () => import('../../features/settings/components/SettingsSection'),
  optimization: () => import('../../features/settings/components/OptimizationSection'),
  audit: () => import('../../features/monitoring/components/AuditSection'),
  dns: () => import('../../features/dns/components/DnsEditor'),
};

const started = new Set();

export function prefetchSection(id) {
  if (!id || started.has(id) || !LOADERS[id]) return;
  started.add(id);
  // Un échec de préchargement ne doit RIEN casser : le clic refera l'import et
  // c'est React.lazy qui gèrera l'erreur à ce moment-là.
  LOADERS[id]().catch(() => started.delete(id));
}

export default prefetchSection;
