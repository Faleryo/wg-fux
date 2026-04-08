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

export const getWsUri = (type) => {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const { hostname, port, host } = window.location;
  // Inclure le token JWT pour l'auth WS côté serveur
  const token =
    localStorage.getItem('wg-api-token') || sessionStorage.getItem('wg-api-token') || '';
  const tokenParam = token ? `?token=${encodeURIComponent(token)}` : '';

  // Mode Développement
  if (port === '3000' || port === '5173') {
    const wsBase = `${protocol}//${hostname}:3000/api/logs-ws`;
    if (type === 'logs-api') return `${wsBase}/api${tokenParam}`;
    if (type === 'logs-wg') return `${wsBase}/wireguard${tokenParam}`;
    if (type === 'status') return `${protocol}//${hostname}:3000/api/status-ws${tokenParam}`;
  }

  // Mode Production (Proxy Nginx)
  const wsBase = `${protocol}//${host}/api/logs-ws`;
  if (type === 'logs-api') return `${wsBase}/api${tokenParam}`;
  if (type === 'logs-wg') return `${wsBase}/wireguard${tokenParam}`;
  if (type === 'status') return `${protocol}//${host}/api/status-ws${tokenParam}`;
  return `${protocol}//${host}/ws${tokenParam}`;
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
    // Log performance in dev mode
    const duration = response.config.metadata
      ? new Date() - response.config.metadata.startTime
      : 'unknown';
    const isDev = window.location.port === '5173' || window.location.hostname === 'localhost';

    if (isDev) {
      console.log(
        `[API-SUCCESS] ${response.config.method.toUpperCase()} ${response.config.url} (${duration}ms)`
      );
    }
    return response;
  },
  (error) => {
    const duration = error.config?.metadata ? new Date() - error.config.metadata.startTime : null;
    const status = error.response?.status;
    const data = error.response?.data;

    // Obsidian-Tier Error Parsing: On favorise le message détaillé si présent
    const errMsg = data?.message || data?.error || error.message || 'Unknown API Error';
    const errCode = data?.code || 'ERR_UNKNOWN';

    const isDev = window.location.port === '5173' || window.location.hostname === 'localhost';

    if (isDev || status >= 400) {
      console.error(
        `[API-ERR] ${error.config?.method?.toUpperCase()} ${error.config?.url} [${status}] (${duration}ms):`,
        { code: errCode, message: errMsg, path: data?.path }
      );
    }

    // Auto-logout on auth failure (Grade Diamond Hardening)
    // 401: Unauthorized (Token expiré ou invalide)
    // 403 + Account expired: Spécifique à certains profils de sécurité
    if (status === 401 || (status === 403 && (data?.error === 'ACCOUNT_EXPIRED' || errMsg === 'Account expired'))) {
      logOut();
    }
    return Promise.reject(error);
  }
);

function logOut() {
  const keys = ['wg-api-token', 'wg-user-role', 'wg-user-username'];
  keys.forEach((k) => {
    localStorage.removeItem(k);
    sessionStorage.removeItem(k);
  });
  window.location.href = '/login';
}
