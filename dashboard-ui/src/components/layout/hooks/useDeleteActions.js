import { useState, useRef } from 'react';
import { axiosInstance } from '../../../lib/api';

/**
 * Owns all confirm-modal state and deletion logic (client, container, user, bulk).
 * Extracted from MainLayout to keep it under 500 lines.
 */
const useDeleteActions = ({
  fetchData,
  addToast,
  suppressWsToast,
  topologySelectedClient,
  setTopologySelectedClient,
}) => {
  const [confirmModal, setConfirmModal] = useState({ open: false, client: null });
  const isDeletingRef = useRef(false);

  const handleDeleteClient = (client) =>
    setConfirmModal({ open: true, type: 'delete-client', client });

  const handleDeleteContainerPrompt = (containerName) =>
    setConfirmModal({ open: true, type: 'delete-container', container: containerName });

  const handleBulkDelete = (selectedClients, clearSelection) => {
    if (!selectedClients?.length) return;
    setConfirmModal({ open: true, type: 'bulk-delete', clients: selectedClients, clearSelection });
  };

  const handleDeleteUser = (user) => setConfirmModal({ open: true, type: 'delete-user', user });

  const executeDelete = async () => {
    if (isDeletingRef.current) return;
    isDeletingRef.current = true;

    const { type, client, container, user, clients: bulkClients, clearSelection } = confirmModal;
    setConfirmModal({ open: false, client: null, container: null, user: null, clients: null });
    suppressWsToast();

    try {
      if (type === 'bulk-delete' && bulkClients?.length) {
        try {
          suppressWsToast();
          const clientList = bulkClients.map((c) => ({ container: c.container, name: c.name }));
          const res = await axiosInstance.post('/clients/bulk-delete', { clients: clientList });
          const n = res.data.success;
          addToast(`${n} peer${n > 1 ? 's' : ''} supprimé${n > 1 ? 's' : ''}`, 'success');
          clearSelection?.();
          fetchData();
        } catch (err) {
          addToast(err.response?.data?.error || 'Erreur lors de la suppression groupée', 'error');
        }
        return;
      }

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

  return {
    confirmModal,
    setConfirmModal,
    handleDeleteClient,
    handleDeleteContainerPrompt,
    handleBulkDelete,
    handleDeleteUser,
    executeDelete,
  };
};

export default useDeleteActions;
