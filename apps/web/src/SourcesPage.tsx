import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { JobList, JobRun, Source, SourceList, SourcePreset } from '@lead-hunter/contracts';
import styles from './SourcesPage.module.css';
import {
  checkSource,
  createSource,
  listSources,
  runSource,
  setSourceEnabled,
  type CreateOutcome,
  type Outcome,
} from './api/sources.js';
import { discoverNow, listJobs } from './api/jobs.js';
import { strings } from './strings.pl.js';
import { formatWarsaw } from './warsawTime.js';

const t = strings.sources;
const j = strings.jobs;
const failureText = strings.opportunities.sourceFailure;

type Message = { kind: 'ok' | 'error'; text: string };

function withStatus(reason: keyof typeof failureText, httpStatus?: number): string {
  return `${failureText[reason]}${httpStatus === undefined ? '' : ` (HTTP ${httpStatus})`}`;
}

/** `2026-10-25T10:00:00Z` → `12:00` (Europe/Warsaw). */
function clock(iso: string): string {
  return formatWarsaw(iso).slice(-5);
}

function refusalText(outcome: Exclude<Outcome<unknown>, { ok: true }>): string {
  switch (outcome.refused) {
    case 'too_soon':
      return t.tooSoon(clock(outcome.nextAllowedAt));
    case 'disabled':
      return t.sourceDisabled;
    case 'not_found':
      return t.notFound;
    case 'exists':
      return t.exists;
    case 'busy':
      return t.busy;
  }
}

function SourceItem({ source, onChanged }: { source: Source; onChanged: () => void }) {
  const [pending, setPending] = useState<'run' | 'check' | 'toggle' | null>(null);
  const [message, setMessage] = useState<Message | null>(null);

  async function perform(kind: 'run' | 'check') {
    setPending(kind);
    setMessage(null);
    try {
      if (kind === 'run') {
        const outcome = await runSource(source.id);
        if (!outcome.ok) setMessage({ kind: 'error', text: refusalText(outcome) });
        else {
          const r = outcome.value;
          setMessage(
            r.status === 'failed' && r.error
              ? { kind: 'error', text: t.runFailed(withStatus(r.error.reason, r.error.httpStatus)) }
              : { kind: 'ok', text: t.runDone(r.new, r.duplicates, r.failed) },
          );
        }
      } else {
        const outcome = await checkSource(source.id);
        if (!outcome.ok) setMessage({ kind: 'error', text: refusalText(outcome) });
        else {
          const h = outcome.value;
          setMessage(
            h.ok || !h.error
              ? { kind: 'ok', text: t.checkOk(formatWarsaw(h.checkedAt)) }
              : {
                  kind: 'error',
                  text: t.checkFailed(withStatus(h.error.reason, h.error.httpStatus)),
                },
          );
        }
      }
    } catch {
      setMessage({ kind: 'error', text: t.actionFailed });
    }
    setPending(null);
    onChanged();
  }

  async function toggle() {
    setPending('toggle');
    setMessage(null);
    try {
      await setSourceEnabled(source.id, !source.enabled);
      onChanged();
    } catch {
      setMessage({ kind: 'error', text: t.toggleFailed });
    }
    setPending(null);
  }

  const failing =
    source.lastError !== null &&
    (source.lastSuccessAt === null || source.lastError.at >= source.lastSuccessAt);
  const lastError = source.lastError;
  const health = failing ? t.healthError : source.lastAttemptAt ? t.healthOk : t.healthUnknown;
  const busy = pending !== null;

  return (
    <li className={styles.item}>
      <h3>{source.name}</h3>
      <dl className={styles.facts}>
        <dt>{t.access}</dt>
        <dd>
          {source.accessNote}
          {source.termsUrl && (
            <>
              {' '}
              <a href={source.termsUrl} target="_blank" rel="noreferrer noopener">
                {t.terms}
              </a>
            </>
          )}
        </dd>
        <dt>{t.enabled}</dt>
        <dd>{source.enabled ? 'tak' : 'nie'}</dd>
        <dt>{t.health}</dt>
        <dd>{health}</dd>
        <dt>{t.lastAttempt}</dt>
        <dd>{source.lastAttemptAt ? formatWarsaw(source.lastAttemptAt) : t.never}</dd>
        <dt>{t.lastSuccess}</dt>
        <dd>{source.lastSuccessAt ? formatWarsaw(source.lastSuccessAt) : t.never}</dd>
        {lastError && (
          <>
            <dt>{t.lastError}</dt>
            <dd>
              {withStatus(lastError.reason, lastError.httpStatus)} ({formatWarsaw(lastError.at)})
            </dd>
          </>
        )}
        {source.nextAllowedAt && Date.parse(source.nextAllowedAt) > Date.now() && (
          <>
            <dt>{t.nextAllowed}</dt>
            <dd>{formatWarsaw(source.nextAllowedAt)}</dd>
          </>
        )}
      </dl>
      <div className={styles.actions}>
        <button type="button" disabled={busy || !source.enabled} onClick={() => perform('run')}>
          {pending === 'run' ? t.running : t.run}
        </button>
        <button type="button" disabled={busy || !source.enabled} onClick={() => perform('check')}>
          {pending === 'check' ? t.checking : t.check}
        </button>
        <button type="button" disabled={busy} onClick={toggle}>
          {source.enabled ? t.disable : t.enable}
        </button>
      </div>
      {message && (
        <p role="status" className={message.kind === 'ok' ? styles.ok : styles.error}>
          {message.text}
        </p>
      )}
    </li>
  );
}

function jobError(run: JobRun): string {
  if (!run.error) return j.none;
  if (run.error.reason === 'interrupted') return j.interrupted;
  return withStatus(run.error.reason, run.error.httpStatus);
}

function jobCost(run: JobRun): string {
  return run.cost ? j.tokens(run.cost.inputTokens, run.cost.outputTokens) : j.noData;
}

/** D-13: the schedule, the cycle button and the last runs; refetches every 3 s while one runs. */
function Jobs({ onFinished }: { onFinished: () => void }) {
  const [jobs, setJobs] = useState<JobList | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [starting, setStarting] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);

  const load = useCallback(() => {
    listJobs().then(
      (list) => {
        setJobs(list);
        setLoadFailed(false);
      },
      () => setLoadFailed(true),
    );
  }, []);
  useEffect(load, [load]);

  const running = jobs?.running ?? false;
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(load, 3000);
    return () => {
      clearInterval(timer);
      onFinished();
    };
  }, [running, load, onFinished]);

  async function start() {
    setStarting(true);
    setMessage(null);
    try {
      const outcome = await discoverNow();
      if (!outcome.ok) setMessage({ kind: 'error', text: j.busy });
    } catch {
      setMessage({ kind: 'error', text: j.startFailed });
    }
    setStarting(false);
    load();
  }

  const schedule = jobs
    ? j.schedule(
        jobs.schedule.times.join(j.and),
        jobs.schedule.nextRunAt ? formatWarsaw(jobs.schedule.nextRunAt) : null,
      )
    : null;

  return (
    <div className={styles.jobs}>
      {schedule && <p>{schedule}</p>}
      <button type="button" disabled={starting || running} onClick={start}>
        {starting ? j.starting : j.runNow}
      </button>
      {running && !message && <p role="status">{j.busy}</p>}
      {message && (
        <p role="status" className={message.kind === 'ok' ? styles.ok : styles.error}>
          {message.text}
        </p>
      )}
      <h3>{j.title}</h3>
      {loadFailed && (
        <p role="alert" className={styles.error}>
          {j.loadFailed}
        </p>
      )}
      {jobs && jobs.items.length === 0 && <p>{j.empty}</p>}
      {jobs && jobs.items.length > 0 && (
        <ul className={styles.runs}>
          {jobs.items.map((run) => (
            <li key={run.id} className={styles.run}>
              <p className={styles.runHead}>
                <strong>{formatWarsaw(run.startedAt)}</strong> · {j.types[run.type]}
                {run.trigger && ` (${j.triggers[run.trigger]})`}
                {run.source && ` · ${run.source.name}`}
              </p>
              <dl className={styles.facts}>
                <dt>{j.statusCol}</dt>
                <dd>{j.status[run.status]}</dd>
                {(Object.keys(run.counters) as (keyof JobRun['counters'])[]).map((key) => (
                  <Counter key={key} label={j.counters[key]} value={run.counters[key]} />
                ))}
                <dt>{j.errorCol}</dt>
                <dd>{jobError(run)}</dd>
                <dt>{j.costCol}</dt>
                <dd>{jobCost(run)}</dd>
              </dl>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Counter({ label, value }: { label: string; value: number }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </>
  );
}

export function SourcesPage() {
  const [data, setData] = useState<SourceList | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [adding, setAdding] = useState(false);
  const [addMessage, setAddMessage] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');

  const load = useCallback(() => {
    listSources().then(
      (list) => {
        setData(list);
        setLoadFailed(false);
      },
      () => setLoadFailed(true),
    );
  }, []);
  useEffect(load, [load]);

  async function add(body: Parameters<typeof createSource>[0]) {
    setAdding(true);
    setAddMessage(null);
    let outcome: CreateOutcome | null = null;
    try {
      outcome = await createSource(body);
    } catch {
      setAddMessage(t.addFailed);
    }
    setAdding(false);
    if (!outcome) return;
    if (outcome.ok) {
      setName('');
      setUrl('');
      load();
    } else if (outcome.refused === 'invalid') {
      setAddMessage(outcome.fields.map((f) => f.message).join(' ') || t.invalidField);
    } else if (outcome.refused === 'exists') {
      setAddMessage(t.exists);
    } else {
      setAddMessage(t.addFailed);
    }
  }

  function submitCustom(event: FormEvent) {
    event.preventDefault();
    void add({ name, url });
  }

  if (loadFailed && !data)
    return (
      <p role="alert" className={styles.error}>
        {t.loadFailed}
      </p>
    );
  if (!data) return <p role="status">{t.loading}</p>;

  const added = new Set(data.items.map((s) => s.presetId));
  const available: SourcePreset[] = data.presets.filter((p) => !added.has(p.id));

  return (
    <section>
      <h2>{t.title}</h2>
      <Jobs onFinished={load} />
      {data.items.length === 0 ? (
        <p>{t.empty}</p>
      ) : (
        <ul className={styles.list}>
          {data.items.map((source) => (
            <SourceItem key={source.id} source={source} onChanged={load} />
          ))}
        </ul>
      )}
      <h3>{t.presetsTitle}</h3>
      {available.length === 0 ? (
        <p>{t.presetsNone}</p>
      ) : (
        <ul className={styles.presets}>
          {available.map((preset) => (
            <li key={preset.id}>
              <button type="button" disabled={adding} onClick={() => add({ preset: preset.id })}>
                {t.addPreset}: {preset.name}
              </button>
              <span className={styles.hint}>{preset.accessNote}</span>
            </li>
          ))}
        </ul>
      )}
      <h3>{t.customTitle}</h3>
      <form className={styles.form} onSubmit={submitCustom} noValidate>
        <div className={styles.field}>
          <label htmlFor="source-name">{t.nameLabel}</label>
          <input
            id="source-name"
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <div className={styles.field}>
          <label htmlFor="source-url">{t.urlLabel}</label>
          <input
            id="source-url"
            type="text"
            inputMode="url"
            autoComplete="off"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
          />
        </div>
        <button type="submit" disabled={adding}>
          {adding ? t.adding : t.addCustom}
        </button>
      </form>
      {addMessage && (
        <p role="alert" className={styles.error}>
          {addMessage}
        </p>
      )}
    </section>
  );
}
