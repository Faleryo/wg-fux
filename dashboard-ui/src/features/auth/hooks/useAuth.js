import { useState, useEffect, useCallback, useRef } from 'react';
import { axiosInstance } from '../../../lib/api';

const STORAGE_KEYS = {
  token: 'wg-api-token',
  role: 'wg-user-role',
  username: 'wg-user-username',
  twoFactorEnabled: 'wg-user-2fa',
  cache: 'wg-fux-cache',
};

const readSession = () => ({
  token: localStorage.getItem(STORAGE_KEYS.token) || sessionStorage.getItem(STORAGE_KEYS.token),
  role: localStorage.getItem(STORAGE_KEYS.role) || sessionStorage.getItem(STORAGE_KEYS.role),
  username:
    localStorage.getItem(STORAGE_KEYS.username) || sessionStorage.getItem(STORAGE_KEYS.username),
  twoFactorEnabled:
    (localStorage.getItem(STORAGE_KEYS.twoFactorEnabled) ??
      sessionStorage.getItem(STORAGE_KEYS.twoFactorEnabled)) === 'true',
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
// Decode a JWT payload (no verification — used only for expiry scheduling)
const getTokenExp = (token) => {
  try {
    return JSON.parse(atob(token.split('.')[1])).exp * 1000;
  } catch {
    return null;
  }
};

const useAuth = () => {
  const [session, setSession] = useState(readSession);
  const refreshTimerRef = useRef(null);

  // Le ré-armement récursif passe par la fonction locale `arm`, PAS par
  // l'identité mémoïsée `scheduleRefresh` : se référencer soi-même depuis le
  // corps de son propre useCallback fait lire une valeur déclarée plus bas
  // (react-hooks/immutability), ce qui casse dès que la mémoïsation change
  // l'identité entre deux rendus.
  const scheduleRefresh = useCallback((token) => {
    const arm = (tok) => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
      const exp = getTokenExp(tok);
      if (!exp) return;
      const delay = Math.max(0, exp - Date.now() - 5 * 60 * 1000); // 5 min before expiry
      refreshTimerRef.current = setTimeout(async () => {
        try {
          const res = await axiosInstance.post('/auth/refresh');
          const newToken = res.data.token;
          const store = localStorage.getItem(STORAGE_KEYS.token) ? localStorage : sessionStorage;
          store.setItem(STORAGE_KEYS.token, newToken);
          arm(newToken);
        } catch {
          /* silently fail — next request will 401 and trigger logout */
        }
      }, delay);
    };
    arm(token);
  }, []);

  const login = useCallback(
    (token, rememberMe, role, username, twoFactorEnabled) => {
      if (!rememberMe) {
        // Clear any stale token a previous rememberMe session may have left
        // so scheduleRefresh can't accidentally route the refreshed token to localStorage.
        [
          STORAGE_KEYS.token,
          STORAGE_KEYS.role,
          STORAGE_KEYS.username,
          STORAGE_KEYS.twoFactorEnabled,
        ].forEach((k) => localStorage.removeItem(k));
      }
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
      // `twoFactorEnabled` doit être posé dès le login : MainLayout teste
      // `=== false` (pour ne pas afficher la bannière tant que l'état est
      // inconnu), donc l'omettre ici la laissait `undefined` et masquait
      // l'incitation 2FA jusqu'au prochain /auth/check, c.-à-d. au rechargement.
      const tf = !!twoFactorEnabled;
      const store = rememberMe ? localStorage : sessionStorage;
      store.setItem(STORAGE_KEYS.twoFactorEnabled, String(tf));
      setSession({
        token,
        role: role || null,
        username: username || null,
        twoFactorEnabled: tf,
      });
      scheduleRefresh(token);
    },
    [scheduleRefresh]
  );

  const logout = useCallback(() => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    // Blacklist the current token server-side (fire-and-forget — UI clears immediately)
    axiosInstance.post('/auth/logout').catch(() => {});
    clearStorage();
    setSession({ token: null, role: null, username: null });
  }, []);

  // Clear the refresh timer on unmount
  useEffect(
    () => () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    },
    []
  );

  // On mount, verify the stored token against the server and refresh role/username.
  // This prevents a tampered or stale role in storage from influencing the UI.
  useEffect(() => {
    const { token } = readSession();
    if (!token) return;
    const controller = new AbortController();
    axiosInstance
      .get('/auth/check', { signal: controller.signal })
      .then((res) => {
        const { role, username, twoFactorEnabled } = res.data;
        const store = localStorage.getItem(STORAGE_KEYS.token) ? localStorage : sessionStorage;
        const token = store.getItem(STORAGE_KEYS.token);
        if (token) scheduleRefresh(token);
        setSession((prev) => {
          const tf = !!twoFactorEnabled;
          if (prev.role === role && prev.username === username && prev.twoFactorEnabled === tf)
            return prev;
          store.setItem(STORAGE_KEYS.role, role);
          store.setItem(STORAGE_KEYS.username, username);
          store.setItem(STORAGE_KEYS.twoFactorEnabled, String(tf));
          return { ...prev, role, username, twoFactorEnabled: tf };
        });
      })
      .catch((err) => {
        if (err.name === 'CanceledError') return;
        // Only clear session on actual auth failures (401/403), not on network blips
        const status = err.response?.status;
        if (status === 401 || status === 403) {
          clearStorage();
          setSession({ token: null, role: null, username: null });
        }
      });
    return () => controller.abort();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
