import { axiosInstance } from '../../../lib/api';

/**
 * Handles user creation, update, and 2FA reset.
 * Delete is in useDeleteActions (needs confirmModal).
 */
const useUserActions = ({ fetchData, addToast }) => {
  const handleCreateUser = async (username, password, role, expiry = null) => {
    // `expiry` n'est transmis que s'il est renseigné : le schéma est `.strict()`
    // et refuse une clé inattendue, ce qui ferait échouer TOUTE la création.
    await axiosInstance.post('/users', {
      username,
      password,
      role,
      ...(expiry ? { expiry } : {}),
    });
    addToast(`Opérateur ${username} créé avec succès`, 'success');
    fetchData();
  };

  const handleSaveUser = async (username, updateData) => {
    await axiosInstance.patch(`/users/${username}`, updateData);
    fetchData();
  };

  const handleReset2FA = async (username) => {
    await axiosInstance.post(`/users/${username}/reset-2fa`);
    fetchData();
  };

  return { handleCreateUser, handleSaveUser, handleReset2FA };
};

export default useUserActions;
