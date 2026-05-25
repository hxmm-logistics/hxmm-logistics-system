import React, { Suspense, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useTranslation } from 'react-i18next';
import './i18n';
import './styles.css';
import { apiClient, clearAuth, getStoredAuth, saveAuth } from './api';

const PublicTrackingPage = React.lazy(() => import('./pages/PublicTrackingPage.jsx'));
const LoginPage = React.lazy(() => import('./pages/LoginPage.jsx'));
const WarehousePdaPage = React.lazy(() => import('./pages/WarehousePdaPage.jsx'));
const AdminDashboardPage = React.lazy(() => import('./pages/AdminDashboardPage.jsx'));
const AdminOperationsPage = React.lazy(() => import('./pages/AdminOperationsPage.jsx'));
const AdminExceptionsPage = React.lazy(() => import('./pages/AdminExceptionsPage.jsx'));
const ShipmentDetailPage = React.lazy(() => import('./pages/ShipmentDetailPage.jsx'));

const PUBLIC_ROUTES = ['/', '/track', '/tracking'];
const ADMIN_ROUTES = ['/admin', '/dashboard'];

function useRoute() {
  const [path, setPath] = useState(window.location.pathname);

  useEffect(() => {
    const onChange = () => setPath(window.location.pathname);
    window.addEventListener('popstate', onChange);
    return () => window.removeEventListener('popstate', onChange);
  }, []);

  function navigate(to, { replace = false } = {}) {
    if (window.location.pathname === to) return;
    if (replace) window.history.replaceState({}, '', to);
    else window.history.pushState({}, '', to);
    setPath(to);
  }

  return { path, navigate };
}

function App() {
  const { t, i18n } = useTranslation();
  const { path, navigate } = useRoute();
  const [auth, setAuth] = useState(() => getStoredAuth());
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const role = auth?.user?.role?.trim().toLowerCase();
  const isAdmin = role === 'admin';
  const isOperator = role === 'operator';
  const isPublic = PUBLIC_ROUTES.includes(path);

  useEffect(() => {
    if (!auth && !isPublic && path !== '/login') {
      navigate('/login', { replace: true });
      return;
    }
    if (auth && path === '/login') {
      navigate(isOperator ? '/scan' : '/admin/dashboard', { replace: true });
      return;
    }
    if (auth && isOperator && ADMIN_ROUTES.some((route) => path.startsWith(route))) {
      navigate('/scan', { replace: true });
      return;
    }
    if (auth && isAdmin && path === '/dashboard') {
      navigate('/admin', { replace: true });
    }
  }, [auth, isAdmin, isOperator, isPublic, path]);

  useEffect(() => {
    const online = () => setIsOnline(true);
    const offline = () => setIsOnline(false);
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    return () => {
      window.removeEventListener('online', online);
      window.removeEventListener('offline', offline);
    };
  }, []);

  async function refreshMe() {
    const response = await apiClient.get('/auth/me');
    setAuth((current) => current ? { ...current, user: response.data.user } : current);
  }

  function handleLogin(nextAuth) {
    saveAuth(nextAuth);
    setAuth(nextAuth);
    navigate(nextAuth.user.role?.trim().toLowerCase() === 'operator' ? '/scan' : '/admin', { replace: true });
  }

  function logout() {
    clearAuth();
    setAuth(null);
    navigate('/login', { replace: true });
  }

  function changeLanguage(event) {
    i18n.changeLanguage(event.target.value);
  }

  const shellClass = isPublic ? 'public-app-shell' : 'app-shell';

  return (
    <main className={shellClass}>
      <header className="topbar">
        <button className="brand-button" onClick={() => navigate('/track')}>
          <span className="eyebrow">{t('app.subtitle')}</span>
          <strong>HX MM</strong>
        </button>
        <div className="topbar-actions">
          <label className="language-switch" htmlFor="language">
            <span>{t('language.label')}</span>
            <select id="language" value={i18n.language} onChange={changeLanguage}>
              <option value="zh">{t('language.zh')}</option>
              <option value="en">{t('language.en')}</option>
              <option value="my">{t('language.my')}</option>
            </select>
          </label>
          {auth && !isPublic && <button className="logout-button" onClick={logout}>{t('app.logout')}</button>}
        </div>
      </header>

      {!isPublic && auth && (
        <nav className="tabs" aria-label={t('app.navLabel')}>
          {isAdmin && <button className={path === '/admin/dashboard' ? 'active' : ''} onClick={() => navigate('/admin/dashboard')}>仪表盘</button>}
          {isAdmin && <button className={path === '/admin' ? 'active' : ''} onClick={() => navigate('/admin')}>{t('app.admin')}</button>}
          {isAdmin && <button className={path === '/admin/exceptions' ? 'active' : ''} onClick={() => navigate('/admin/exceptions')}>异常管理</button>}
          <button className={path === '/scan' ? 'active' : ''} onClick={() => navigate('/scan')}>{t('app.scan')}</button>
        </nav>
      )}

      {!isOnline && <div className="network-banner">{t('app.offline')}</div>}

      <Suspense fallback={<div className="empty">{t('app.loading')}</div>}>
        {isPublic && <PublicTrackingPage />}
        {path === '/login' && <LoginPage onLogin={handleLogin} />}
        {auth && path === '/scan' && <WarehousePdaPage navigate={navigate} active role={auth.user.role} />}
        {auth && isAdmin && path === '/admin/dashboard' && <AdminDashboardPage navigate={navigate} />}
        {auth && isAdmin && path === '/admin' && <AdminOperationsPage auth={auth} refreshMe={refreshMe} navigate={navigate} />}
        {auth && isAdmin && path === '/admin/exceptions' && <AdminExceptionsPage navigate={navigate} />}
        {auth && path.startsWith('/shipment/') && <ShipmentDetailPage trackingNo={decodeURIComponent(path.replace('/shipment/', ''))} />}
      </Suspense>
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);

