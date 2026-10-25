import { useState, type FormEvent } from 'react';
import styles from './App.module.css';
import { login } from './api/auth.js';
import { strings } from './strings.pl.js';

/** Seconds to whole minutes, rounded up, never below 1. */
export function minutesLeft(seconds: number): number {
  return Math.max(1, Math.ceil(seconds / 60));
}

export function LoginForm({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const result = await login(password);
      if (result === 'ok') {
        setPassword('');
        onLoggedIn();
      } else if (result === 'invalid') {
        setMessage(strings.login.invalid);
      } else if (result === 'not_configured') {
        setMessage(strings.login.notConfigured);
      } else {
        setMessage(strings.login.throttled(minutesLeft(result.throttled)));
      }
    } catch {
      setMessage(strings.login.failed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={styles.form} onSubmit={submit}>
      <h2>{strings.login.title}</h2>
      <label htmlFor="password">{strings.login.passwordLabel}</label>
      <input
        id="password"
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        required
      />
      <button type="submit" disabled={busy}>
        {busy ? strings.login.submitting : strings.login.submit}
      </button>
      {message && (
        <p role="alert" className={styles.error}>
          {message}
        </p>
      )}
    </form>
  );
}
