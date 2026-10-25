import { useCallback, useEffect, useState } from 'react';
import styles from './App.module.css';
import { LoginForm } from './LoginForm.js';
import { getSession, logout } from './api/auth.js';
import { setUnauthorizedHandler } from './api/client.js';
import { fetchHealth } from './api/health.js';
import { strings } from './strings.pl.js';

type Status = 'loading' | 'ok' | 'error';
type View = 'checking' | 'login' | 'ready';

function Shell({ onLogout }: { onLogout: () => void }) {
  const [status, setStatus] = useState<Status>('loading');

  useEffect(() => {
    let active = true;
    fetchHealth().then(
      (health) => active && setStatus(health.status === 'ok' ? 'ok' : 'error'),
      () => active && setStatus('error'),
    );
    return () => {
      active = false;
    };
  }, []);

  return (
    <>
      <p role="status" className={status === 'error' ? styles.error : styles.status}>
        {strings.status[status]}
      </p>
      <button type="button" className={styles.logout} onClick={onLogout}>
        {strings.login.logout}
      </button>
    </>
  );
}

export function App() {
  const [view, setView] = useState<View>('checking');

  useEffect(() => {
    setUnauthorizedHandler(() => setView('login'));
    let active = true;
    getSession().then(
      (authenticated) => active && setView(authenticated ? 'ready' : 'login'),
      () => active && setView('login'),
    );
    return () => {
      active = false;
    };
  }, []);

  const handleLogout = useCallback(() => {
    // On a failed logout the session is still alive, so the shell stays.
    logout().then(
      () => setView('login'),
      () => {},
    );
  }, []);

  return (
    <main className={styles.page}>
      <h1>{strings.appName}</h1>
      <p>{strings.tagline}</p>
      {view === 'login' && <LoginForm onLoggedIn={() => setView('ready')} />}
      {view === 'ready' && <Shell onLogout={handleLogout} />}
    </main>
  );
}
