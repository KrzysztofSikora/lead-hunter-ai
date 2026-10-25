import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import type { ImportResult } from '@lead-hunter/contracts';
import styles from './ImportPage.module.css';
import { importSignal } from './api/signals.js';
import type { FieldError } from './api/profile.js';
import { strings } from './strings.pl.js';

const t = strings.import;

type State =
  | { state: 'idle' }
  | { state: 'sending' }
  | { state: 'failed' }
  | { state: 'invalid'; fields: FieldError[] }
  | { state: 'done'; result: Exclude<ImportResult, { result: 'fetch_failed' }> };

/** Custom schema rules carry Polish text; library codes get a Polish text by code. */
function errorText(error: FieldError): string {
  if (error.code === 'custom') return error.message;
  const byCode = t.errors as Record<string, string>;
  return byCode[error.code] ?? t.errors.generic;
}

export function ImportPage() {
  const [text, setText] = useState('');
  const [url, setUrl] = useState('');
  const [status, setStatus] = useState<State>({ state: 'idle' });

  async function submit(event: FormEvent) {
    event.preventDefault();
    const body = { ...(text.trim() ? { text } : {}), ...(url.trim() ? { url: url.trim() } : {}) };
    setStatus({ state: 'sending' });
    try {
      const outcome = await importSignal(body);
      if (outcome.ok) {
        setStatus({ state: 'done', result: outcome.result });
        setText('');
        setUrl('');
      } else {
        setStatus({ state: 'invalid', fields: outcome.fields });
      }
    } catch {
      setStatus({ state: 'failed' });
    }
  }

  const fields = status.state === 'invalid' ? status.fields : [];
  const errorAt = (path: string) => fields.find((error) => error.path === path);
  const textError = errorAt('text');
  const urlError = errorAt('url');
  const otherErrors = fields.filter((error) => error.path !== 'text' && error.path !== 'url');

  return (
    <section>
      <h2>{t.title}</h2>
      <form className={styles.form} onSubmit={submit} noValidate>
        <div className={styles.field}>
          <label htmlFor="import-text">{t.textLabel}</label>
          <textarea
            id="import-text"
            rows={10}
            value={text}
            onChange={(event) => setText(event.target.value)}
            {...(textError
              ? { 'aria-invalid': true, 'aria-describedby': 'import-text-error' }
              : {})}
          />
          {textError && (
            <p id="import-text-error" className={styles.error}>
              {errorText(textError)}
            </p>
          )}
        </div>
        <div className={styles.field}>
          <label htmlFor="import-url">{t.urlLabel}</label>
          <input
            id="import-url"
            type="text"
            inputMode="url"
            autoComplete="off"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            {...(urlError ? { 'aria-invalid': true, 'aria-describedby': 'import-url-error' } : {})}
          />
          <p className={styles.hint}>{t.urlHint}</p>
          {urlError && (
            <p id="import-url-error" className={styles.error}>
              {errorText(urlError)}
            </p>
          )}
        </div>
        {otherErrors.map((error) => (
          <p key={`${error.path}:${error.code}`} className={styles.error}>
            {errorText(error)}
          </p>
        ))}
        <button type="submit" disabled={status.state === 'sending'}>
          {status.state === 'sending' ? t.submitting : t.submit}
        </button>
      </form>
      {status.state === 'failed' && (
        <p role="alert" className={styles.error}>
          {t.failed}
        </p>
      )}
      {status.state === 'done' && (
        <p role="status" className={styles.ok}>
          {status.result.result === 'created' ? t.created : t.duplicate}{' '}
          <Link to={`/okazje/${status.result.opportunityId}`}>
            {status.result.result === 'created' ? t.openCreated : t.openDuplicate}
          </Link>
        </p>
      )}
    </section>
  );
}
