import { useEffect, useState } from 'react';
import styles from './App.module.css';
import { fetchHealth } from './api/health.js';
import { strings } from './strings.pl.js';

type Status = 'loading' | 'ok' | 'error';

export function App() {
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
    <main className={styles.page}>
      <h1>{strings.appName}</h1>
      <p>{strings.tagline}</p>
      <p role="status" className={status === 'error' ? styles.error : styles.status}>
        {strings.status[status]}
      </p>
    </main>
  );
}
