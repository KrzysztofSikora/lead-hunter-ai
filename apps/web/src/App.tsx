import { useCallback, useEffect, useState } from 'react';
import { Navigate, NavLink, Route, Routes } from 'react-router';
import styles from './App.module.css';
import { AnalysisPage } from './AnalysisPage.js';
import { ImportPage } from './ImportPage.js';
import { LoginForm } from './LoginForm.js';
import { OpportunitiesPage } from './OpportunitiesPage.js';
import { OpportunityPage } from './OpportunityPage.js';
import { PipelinePage } from './PipelinePage.js';
import { ProfilePage } from './ProfilePage.js';
import { SourcesPage } from './SourcesPage.js';
import { TodayPage } from './TodayPage.js';
import { getSession, logout } from './api/auth.js';
import { setUnauthorizedHandler } from './api/client.js';
import { strings } from './strings.pl.js';

type View = 'checking' | 'login' | 'ready' | 'error';

function Shell({ onLogout }: { onLogout: () => void }) {
  return (
    <>
      <nav aria-label={strings.nav.label} className={styles.nav}>
        <NavLink to="/" end>
          {strings.nav.start}
        </NavLink>
        <NavLink to="/okazje">{strings.nav.opportunities}</NavLink>
        <NavLink to="/analiza">{strings.nav.analysis}</NavLink>
        <NavLink to="/lejek">{strings.nav.pipeline}</NavLink>
        <NavLink to="/zrodla">{strings.nav.sources}</NavLink>
        <NavLink to="/import">{strings.nav.import}</NavLink>
        <NavLink to="/profil">{strings.nav.profile}</NavLink>
        <button type="button" className={styles.logout} onClick={onLogout}>
          {strings.login.logout}
        </button>
      </nav>
      <Routes>
        <Route path="/" element={<TodayPage />} />
        <Route path="/okazje" element={<OpportunitiesPage />} />
        <Route path="/okazje/:id" element={<OpportunityPage />} />
        <Route path="/analiza" element={<AnalysisPage />} />
        <Route path="/lejek" element={<PipelinePage />} />
        <Route path="/zrodla" element={<SourcesPage />} />
        <Route path="/import" element={<ImportPage />} />
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
