import { useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { useTheme } from '../../../context/ThemeContext';
import { getContainerColor } from './ClientListHelpers';
import ClientListToolbar from './ClientListToolbar';
import ContainerGridView from './ContainerGridView';
import ClientGridView from './ClientGridView';

export const ClientList = ({
  clients = [],
  allContainers = [],
  activeContainer = null,
  setActiveContainer,
  onSelect,
  onToggle,
  onEdit,
  onQRCode,
  onDelete,
  onDeleteContainer,
  onCreateClient,
  onCreateContainer,
}) => {
  const { theme } = useTheme();
  const [search, setSearch] = useState('');

  const containerGroups = clients.reduce((acc, client) => {
    const key = client.container || 'default';
    if (!acc[key]) acc[key] = [];
    acc[key].push(client);
    return acc;
  }, {});

  if (Array.isArray(allContainers)) {
    allContainers.forEach((c) => {
      const cName = typeof c === 'string' ? c : c?.name || '';
      if (cName && !containerGroups[cName]) containerGroups[cName] = [];
    });
  }

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

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-5 duration-700">
      <ClientListToolbar
        activeContainer={activeContainer}
        setActiveContainer={setActiveContainer}
        selectedColor={selectedColor}
        search={search}
        setSearch={setSearch}
        containerEntriesLength={containerEntries.length}
        containerGroups={containerGroups}
        onCreateClient={onCreateClient}
        onCreateContainer={onCreateContainer}
        clients={clients}
        containerClients={containerClients}
      />

      <AnimatePresence mode="wait">
        {!activeContainer ? (
          <ContainerGridView
            key="container-grid"
            containerEntries={containerEntries}
            onSelectContainer={setActiveContainer}
            onDeleteContainer={onDeleteContainer}
          />
        ) : (
          <ClientGridView
            key={`container-${activeContainer}`}
            activeContainer={activeContainer}
            containerGroups={containerGroups}
            selectedColor={selectedColor}
            containerClients={containerClients}
            search={search}
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
