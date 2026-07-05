import { axiosInstance } from '../../../lib/api';

const track = (event, props) => {
  try {
    window.posthog?.capture?.(event, props);
  } catch {
    /* non-bloquant */
  }
};

/**
 * Handles client + container creation, toggle, and config download.
 * Delete actions live in useDeleteActions (they need confirmModal state).
 */
const useClientActions = ({
  fetchData,
  addToast,
  suppressWsToast,
  setShowQRModal,
  setSelectedClientForModal,
}) => {
  const handleCreateClient = async (name, container, expiry, quota, uploadLimit) => {
    suppressWsToast();
    await axiosInstance.post('/clients', { name, container, expiry, quota, uploadLimit });
    fetchData();
    track('client_created', { container, name });
    try {
      const res = await axiosInstance.get(`/clients/${container}/${name}/config`);
      setSelectedClientForModal({ name, config: res.data.config || '' });
      setShowQRModal(true);
    } catch {
      // Non bloquant — config lisible plus tard via bouton QR
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

  const handleShowQRCode = async (client) => {
    try {
      const res = await axiosInstance.get(`/clients/${client.container}/${client.name}/config`);
      setSelectedClientForModal({ name: client.name, config: res.data.config || '' });
      setShowQRModal(true);
    } catch {
      addToast('Erreur chargement configuration', 'error');
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

  return {
    handleCreateClient,
    handleCreateContainer,
    handleToggleClient,
    handleShowQRCode,
    handleDownloadConfig,
  };
};

export default useClientActions;
