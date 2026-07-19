import { useState, useCallback } from 'react';
import { AnimatePresence } from 'framer-motion';
import { useTheme } from '../../../context/ThemeContext';
import { getContainerColor } from './ClientListHelpers';
import ClientListToolbar from './ClientListToolbar';
import ContainerGridView from './ContainerGridView';
import ClientGridView from './ClientGridView';
import ReconcileBanner from './ReconcileBanner';

export const ClientList = ({
  clients = [],
  allContainers = [],
  activeContainer = null,
  setActiveContainer,
  onlinePeers = [],
  onSelect,
  onToggle,
  onEdit,
  onQRCode,
  onDelete,
  onDeleteContainer,
  onCreateClient,
  onCreateContainer,
  onBulkDelete,
}) => {
  const { theme } = useTheme();
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState(new Set());

  // ISOLATION D'ESPACE : la vue Conteneurs ne montre QUE les conteneurs possédés
  // (allContainers est déjà filtré par propriétaire côté API). Les clients dont le
  // conteneur n'est PAS possédé (ex. conteneurs d'autres utilisateurs, présents
  // dans le flux /clients global de l'admin) ne créent pas de groupe ici → plus
  // de mélange. Ces conteneurs restent consultables via le rapport utilisateur.
  const ownedNames = new Set(
    (Array.isArray(allContainers) ? allContainers : []).map((c) =>
      typeof c === 'string' ? c : c?.name || ''
    )
  );

  const containerGroups = clients.reduce((acc, client) => {
    const key = client.container || 'default';
    if (!ownedNames.has(key)) return acc; // conteneur non possédé → exclu de la vue
    if (!acc[key]) acc[key] = [];
    acc[key].push(client);
    return acc;
  }, {});

  // Conteneurs possédés sans aucun peer → groupe vide (pour rester affichés).
  ownedNames.forEach((cName) => {
    if (cName && !containerGroups[cName]) containerGroups[cName] = [];
  });

  const containerEntries = Object.entries(containerGroups);

  const containerClients = activeContainer
    ? (containerGroups[activeContainer] || []).filter(
        (c) =>
          !search ||
          String(c?.name || '')
            .toLowerCase()
            .includes(search.toLowerCase()) ||
          String(c?.ip || '').includes(search)
      )
    : [];

  const selectedColor = activeContainer ? getContainerColor(activeContainer) : theme;

  const onToggleSelect = useCallback((client) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(client.id)) next.delete(client.id);
      else next.add(client.id);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  const handleBulkDelete = useCallback(() => {
    const selectedClients = clients.filter((c) => selectedIds.has(c.id));
    if (selectedClients.length === 0) return;
    onBulkDelete?.(selectedClients, clearSelection);
  }, [clients, selectedIds, onBulkDelete, clearSelection]);

  // Clear selection when leaving container view
  const handleSetActiveContainer = useCallback(
    (name) => {
      setActiveContainer(name);
      setSelectedIds(new Set());
    },
    [setActiveContainer]
  );

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-5 duration-700">
      <ClientListToolbar
        activeContainer={activeContainer}
        setActiveContainer={handleSetActiveContainer}
        selectedColor={selectedColor}
        search={search}
        setSearch={setSearch}
        containerEntriesLength={containerEntries.length}
        containerGroups={containerGroups}
        onCreateClient={onCreateClient}
        onCreateContainer={onCreateContainer}
        clients={clients}
        containerClients={containerClients}
        selectedIds={selectedIds}
        onBulkDelete={handleBulkDelete}
        onClearSelection={clearSelection}
      />

      <ReconcileBanner />

      <AnimatePresence mode="wait">
        {!activeContainer ? (
          <ContainerGridView
            key="container-grid"
            containerEntries={containerEntries}
            onSelectContainer={handleSetActiveContainer}
            onDeleteContainer={onDeleteContainer}
          />
        ) : (
          <ClientGridView
            key={`container-${activeContainer}`}
            activeContainer={activeContainer}
            containerGroups={containerGroups}
            selectedColor={selectedColor}
            containerClients={containerClients}
            onlinePeers={onlinePeers}
            search={search}
            selectedIds={selectedIds}
            onToggleSelect={onToggleSelect}
            onSelect={onSelect}
            onToggle={onToggle}
            onEdit={onEdit}
            onQRCode={onQRCode}
            onDelete={onDelete}
          />
        )}
      </AnimatePresence>
    </div>
  );
};

export default ClientList;
