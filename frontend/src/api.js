import axios from 'axios';

export const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';
export const AUTH_STORAGE_KEY = 'hx_mm_auth';

export const apiClient = axios.create({
  baseURL: API_BASE,
  timeout: 12000,
});

export function getStoredAuth() {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    localStorage.removeItem(AUTH_STORAGE_KEY);
    return null;
  }
}

export function saveAuth(auth) {
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(auth));
}

export function clearAuth() {
  localStorage.removeItem(AUTH_STORAGE_KEY);
}

apiClient.interceptors.request.use((config) => {
  const auth = getStoredAuth();
  if (auth?.token) {
    config.headers.Authorization = `Bearer ${auth.token}`;
  }
  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      clearAuth();
      if (window.location.pathname !== '/login') {
        sessionStorage.setItem('hx_mm_auth_error', error.response.data?.code || 'TOKEN_INVALID');
        window.history.replaceState({}, '', '/login');
        window.dispatchEvent(new PopStateEvent('popstate'));
      }
    }
    return Promise.reject(error);
  }
);

export function apiErrorMessage(error) {
  return error.response?.data?.error || error.message || 'Request failed';
}
