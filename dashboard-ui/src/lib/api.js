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
    'Content-Type': 'application/json'
  }
});

export const getWsUri = (type) => {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const { hostname, port, host } = window.location;
  // Inclure le token JWT pour l'auth WS côté serveur
  const token = localStorage.getItem('wg-api-token') || sessionStorage.getItem('wg-api-token') || '';
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
axiosInstance.interceptors.request.use(config => {
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
      const duration = response.config.metadata ? new Date() - response.config.metadata.startTime : 'unknown';
      if (window.location.port === '5173' || response.status >= 500) {
        console.log(`[API-PERF] ${response.config.method.toUpperCase()} ${response.config.url} took ${duration}ms`);
      }
    return response;
  },
  (error) => {
    const duration = error.config?.metadata ? new Date() - error.config.metadata.startTime : null;
    const status = error.response?.status;
    const errMsg = error.response?.data?.error || error.response?.data?.message;
    
    if (window.location.port === '5173' || status >= 400) {
      console.error(`[API-ERR] ${error.config?.method?.toUpperCase()} ${error.config?.url} failed after ${duration}ms:`, errMsg);
    }

    // Auto-logout on auth failure (Grade Diamond Hardening)
    if (status === 401 || (status === 403 && errMsg === 'Account expired')) {
      logOut();
    }
    return Promise.reject(error);
  }
);

function logOut() {
  const keys = ['wg-api-token', 'wg-user-role', 'wg-user-username'];
  keys.forEach(k => {
    localStorage.removeItem(k);
    sessionStorage.removeItem(k);
  });
  window.location.href = '/login';
}

