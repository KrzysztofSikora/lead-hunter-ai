import { useCallback, useEffect, useState } from 'react';
import { Navigate, NavLink, Route, Routes } from 'react-router';
import styles from './App.module.css';
import { LoginForm } from './LoginForm.js';
import { OpportunitiesPage } from './OpportunitiesPage.js';
import { OpportunityPage } from './OpportunityPage.js';
import { ProfilePage } from './ProfilePage.js';
import { getSession, logout } from './api/auth.js';
import { setUnauthorizedHandler } from './api/client.js';
import { fetchHealth } from './api/health.js';
import { strings } from './strings.pl.js';

type Status = 'loading' | 'ok' | 'error';
type View = 'checking' | 'login' | 'ready' | 'error';

function StatusView() {
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
    <p role="status" className={status === 'error' ? styles.error : styles.status}>
      {strings.status[status]}
    </p>
  );
}

function Shell({ onLogout }: { onLogout: () => void }) {
  return (
    <>
      <nav aria-label={strings.nav.label} className={styles.nav}>
        <NavLink to="/" end>
          {strings.nav.start}
        </NavLink>
        <NavLink to="/okazje">{strings.nav.opportunities}</NavLink>
        <NavLink to="/profil">{strings.nav.profile}</NavLink>
        <button type="button" className={styles.logout} onClick={onLogout}>
          {strings.login.logout}
        </button>
      </nav>
      <Routes>
        <Route path="/" element={<StatusView />} />
        <Route path="/okazje" element={<OpportunitiesPage />} />
        <Route path="/okazje/:id" element={<OpportunityPage />} />
        <Route path="/profil" element={<ProfilePage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
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
      () => active && setView('error'),
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
      {view === 'error' && (
        <p role="status" className={styles.error}>
          {strings.status.error}
        </p>
      )}
      {view === 'ready' && <Shell onLogout={handleLogout} />}
    </main>
  );
}
