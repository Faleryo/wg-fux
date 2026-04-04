import { useState } from 'react';

const STORAGE_KEYS = {
  token: 'wg-api-token',
  role: 'wg-user-role',
  username: 'wg-user-username',
  cache: 'wg-fux-cache',
};

const readSession = () => ({
  token: localStorage.getItem(STORAGE_KEYS.token) || sessionStorage.getItem(STORAGE_KEYS.token),
  role: localStorage.getItem(STORAGE_KEYS.role),
  username: localStorage.getItem(STORAGE_KEYS.username),
});

/**
 * Feature: Auth
 * Manages authentication session state, login and logout.
 * Previously inline in App.jsx.
 */
const useAuth = () => {
  const [session, setSession] = useState(readSession);

  const login = (token, rememberMe, role, username) => {
    if (rememberMe) {
      localStorage.setItem(STORAGE_KEYS.token, token);
    } else {
      sessionStorage.setItem(STORAGE_KEYS.token, token);
    }
    if (role) localStorage.setItem(STORAGE_KEYS.role, role);
    if (username) localStorage.setItem(STORAGE_KEYS.username, username);
    setSession({ token, role: role || null, username: username || null });
  };

  const logout = () => {
    localStorage.removeItem(STORAGE_KEYS.token);
    sessionStorage.removeItem(STORAGE_KEYS.token);
    localStorage.removeItem(STORAGE_KEYS.role);
    localStorage.removeItem(STORAGE_KEYS.username);
    sessionStorage.removeItem(STORAGE_KEYS.cache);
    setSession({ token: null, role: null, username: null });
  };

  return { session, login, logout };
};

export default useAuth;
