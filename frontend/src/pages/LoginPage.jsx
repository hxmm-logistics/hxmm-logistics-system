import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiClient, apiErrorMessage } from '../api';
import { translateError } from '../shared/ui.jsx';

export default function LoginPage({ onLogin }) {
  const { t } = useTranslation();
  const [form, setForm] = useState({ username: 'admin', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const authError = sessionStorage.getItem('hx_mm_auth_error');
    if (authError === 'TOKEN_EXPIRED') {
      setError(t('errors.tokenExpired'));
    }
    sessionStorage.removeItem('hx_mm_auth_error');
  }, [t]);

  async function submit(event) {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      const response = await apiClient.post('/auth/login', form);
      onLogin(response.data);
    } catch (err) {
      setError(translateError(t, apiErrorMessage(err)));
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="auth-page">
      <form className="panel form-stack login-panel" onSubmit={submit}>
        <h1>{t('auth.loginTitle')}</h1>
        <input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} placeholder={t('auth.username')} autoComplete="username" required />
        <input value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder={t('auth.password')} type="password" autoComplete="current-password" required />
        <button type="submit" disabled={loading}>{loading ? t('auth.loggingIn') : t('auth.login')}</button>
        {error && <p className="error">{error}</p>}
      </form>
    </section>
  );
}


