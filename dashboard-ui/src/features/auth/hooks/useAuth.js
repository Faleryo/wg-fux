import { useState, useEffect, useCallback } from 'react';

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

const clearStorage = () => {
  Object.values(STORAGE_KEYS).forEach((k) => {
    localStorage.removeItem(k);
    sessionStorage.removeItem(k);
  });
};

/**
 * Manages auth session state.
 *
 * Listens for the `wg-auth-expired` event dispatched by the axios interceptor
 * (lib/api.js) when the server returns 401 / ACCOUNT_EXPIRED on an
 * authenticated request. That lets us swap to <LoginPage/> via state change
 * instead of a full page reload.
 */
const useAuth = () => {
  const [session, setSession] = useState(readSession);

  const login = useCallback((token, rememberMe, role, username) => {
    if (rememberMe) {
      localStorage.setItem(STORAGE_KEYS.token, token);
    } else {
      sessionStorage.setItem(STORAGE_KEYS.token, token);
    }
    if (role) {
      if (rememberMe) {
        localStorage.setItem(STORAGE_KEYS.role, role);
      } else {
        sessionStorage.setItem(STORAGE_KEYS.role, role);
      }
    }
    if (username) {
      if (rememberMe) {
        localStorage.setItem(STORAGE_KEYS.username, username);
      } else {
        sessionStorage.setItem(STORAGE_KEYS.username, username);
      }
    }
    setSession({ token, role: role || null, username: username || null });
  }, []);

  const logout = useCallback(() => {
    clearStorage();
    setSession({ token: null, role: null, username: null });
  }, []);

  useEffect(() => {
    const onExpired = () => {
      clearStorage();
      setSession({ token: null, role: null, username: null });
    };
    window.addEventListener('wg-auth-expired', onExpired);
    return () => window.removeEventListener('wg-auth-expired', onExpired);
  }, []);

  return { session, login, logout };
};

export default useAuth;
