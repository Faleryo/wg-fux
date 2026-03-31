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

// Intercepteur pour ajouter le token API
axiosInstance.interceptors.request.use(config => {
  const token = localStorage.getItem('wg-api-token') || sessionStorage.getItem('wg-api-token');
  if (token) {
    config.headers['X-Api-Token'] = token;
  }
  return config;
});

// Intercepteur pour gérer l'expiration de session (Auto-Logout)
axiosInstance.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401 && error.response.data?.error === 'Invalid token') {
      localStorage.removeItem('wg-api-token');
      sessionStorage.removeItem('wg-api-token');
      window.location.reload();
    }
    return Promise.reject(error);
  }
);
