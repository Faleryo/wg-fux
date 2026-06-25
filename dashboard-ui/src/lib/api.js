import axios from 'axios';

// Détection dynamique de l'URL de l'API
const getApiUrl = () => {
  const { hostname, protocol, port } = window.location;
  // Si on est en développement (Vite sur 5173 ou API directe sur 3000)
  if (port === '3000' || port === '5173') {
    return `${protocol}//${hostname}:3000/api`;
  }
  // En production, on passe par le proxy Nginx du dashboard
  return '/api';
};

export const API_URL = getApiUrl();

export const axiosInstance = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

const getToken = () =>
  localStorage.getItem('wg-api-token') || sessionStorage.getItem('wg-api-token');

export const getWsUri = (type) => {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const { hostname, port, host } = window.location;

  // Mode Développement
  if (port === '3000' || port === '5173') {
    const wsBase = `${protocol}//${hostname}:3000/api/logs-ws`;
    if (type === 'logs-api') return `${wsBase}/api`;
    if (type === 'logs-wg') return `${wsBase}/wireguard`;
    if (type === 'status') return `${protocol}//${hostname}:3000/api/status-ws`;
  }

  // Mode Production (Proxy Nginx)
  const wsBase = `${protocol}//${host}/api/logs-ws`;
  if (type === 'logs-api') return `${wsBase}/api`;
  if (type === 'logs-wg') return `${wsBase}/wireguard`;
  if (type === 'status') return `${protocol}//${host}/api/status-ws`;
  return `${protocol}//${host}/ws`;
};

export const getWsToken = () => getToken();

const isDev = import.meta.env.DEV;

const sanitizeUrl = (url) => {
  if (!url) return url;
  return url.split('?')[0];
};

// Intercepteur pour ajouter le token API et tracer le temps de réponse (dev)
axiosInstance.interceptors.request.use((config) => {
  const token = localStorage.getItem('wg-api-token') || sessionStorage.getItem('wg-api-token');
  if (token) {
    config.headers['X-Api-Token'] = token;
  }
  config.metadata = { startTime: new Date() };
  return config;
});

// Intercepteur pour gérer l'expiration de session (Auto-Logout) et logs de performance
axiosInstance.interceptors.response.use(
  (response) => {
    const duration = response.config.metadata
      ? new Date() - response.config.metadata.startTime
      : null;
    // P7 : Logging structuré minimal en développement
    if (isDev) {
      const logEntry = {
        ts: new Date().toISOString(),
        level: 'info',
        svc: 'ui-api',
        msg: `[API-SUCCESS] ${response.config.method.toUpperCase()} ${sanitizeUrl(response.config.url)}`,
        duration_ms: duration,
      };
      console.log(JSON.stringify(logEntry));
    }
    return response;
  },
  (error) => {
    const duration = error.config?.metadata ? new Date() - error.config.metadata.startTime : null;
    const status = error.response?.status;
    const data = error.response?.data;

    // -Tier Error Parsing: On favorise le message détaillé si présent
    const errMsg = data?.message || data?.error || error.message || 'Unknown API Error';
    const errCode = data?.code || 'ERR_UNKNOWN';

    // P7 : Logging structuré des erreurs
    if (isDev || status >= 400) {
      const logEntry = {
        ts: new Date().toISOString(),
        level: status >= 500 ? 'error' : 'warn',
        svc: 'ui-api',
        msg: `[API-ERR] ${error.config?.method?.toUpperCase()} ${sanitizeUrl(error.config?.url)}`,
        status,
        duration_ms: duration,
        error: { code: errCode, message: errMsg, path: data?.path },
      };
      console.error(JSON.stringify(logEntry));
    }

    // Auto-logout on auth failure for AUTHENTICATED requests only.
    // Skip the /auth/login endpoint itself — a wrong-password 401 should
    // surface as an in-form error, not as a session-expired redirect that
    // wipes localStorage and reloads the page.
    const url = error.config?.url || '';
    const isLoginAttempt = url.endsWith('/auth/login');
    if (
      !isLoginAttempt &&
      (status === 401 ||
        (status === 403 && (data?.error === 'ACCOUNT_EXPIRED' || errMsg === 'Account expired')))
    ) {
      logOut();
    }
    return Promise.reject(error);
  }
);

// Clears session storage and notifies the app via a custom event so React can
// swap to <LoginPage/> without a full page reload (which would lose error
// toasts, dev-server HMR state, and feel sluggish).
function logOut() {
  ['wg-api-token', 'wg-user-role', 'wg-user-username', 'wg-fux-cache'].forEach((k) => {
    localStorage.removeItem(k);
    sessionStorage.removeItem(k);
  });
  window.dispatchEvent(new CustomEvent('wg-auth-expired'));
}
