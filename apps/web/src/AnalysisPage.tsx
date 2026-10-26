import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import type { AnalysisActivity, AnalysisHistoryEntry } from '@lead-hunter/contracts';
import styles from './AnalysisPage.module.css';
import { cancelAnalysis, getAnalysisActivity, resumeAnalysis } from './api/analysis.js';
import { strings } from './strings.pl.js';
import { formatWarsaw } from './warsawTime.js';

const t = strings.analysis;

/** D-9: the page asks for the state this often while it is visible. */
const POLL_MS = 3000;

type Load =
  | { state: 'loading' }
  | { state: 'error' }
  | { state: 'ready'; data: AnalysisActivity; stale: boolean; receivedAt: number };

function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return minutes > 0 ? `${minutes} min ${seconds} s` : `${seconds} s`;
}

function formatTimeout(ms: number): string {
  return ms === 0 ? t.noTimeout : formatDuration(ms);
}

function formatNumber(value: number, digits: number): string {
  return value.toLocaleString('pl-PL', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function useActivity(): { load: Load; refresh: () => void } {
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const active = useRef(true);

  const refresh = useCallback(() => {
    getAnalysisActivity().then(
      (data) => {
        if (active.current) setLoad({ state: 'ready', data, stale: false, receivedAt: Date.now() });
      },
      () => {
        if (!active.current) return;
        setLoad((previous) =>
          previous.state === 'ready' ? { ...previous, stale: true } : { state: 'error' },
        );
      },
    );
  }, []);

  useEffect(() => {
    active.current = true;
    refresh();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') refresh();
    }, POLL_MS);
    return () => {
      active.current = false;
      clearInterval(timer);
    };
  }, [refresh]);

  return { load, refresh };
}

/** Server time moved forward by what passed locally, so a wrong phone clock does not matter. */
function useServerNow(data: AnalysisActivity, receivedAt: number): number {
  const [, tick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, []);
  return Date.parse(data.now) + (Date.now() - receivedAt);
}

function Active({ data, now }: { data: AnalysisActivity; now: number }) {
  const entry = data.active;
  if (!entry) return <p>{t.activeNone}</p>;
  const elapsed = now - Date.parse(entry.attemptStartedAt);
  return (
    <div className={styles.item}>
      <Link to={`/okazje/${entry.opportunityId}`}>{entry.title}</Link>
      <dl className={styles.facts}>
        <dt>{t.model}</dt>
        <dd>
          {entry.provider} · {entry.model}
        </dd>
        <dt>{t.stage}</dt>
        <dd>{t.stages[entry.stage]}</dd>
        <dt>{t.started}</dt>
        <dd>{formatWarsaw(entry.startedAt)}</dd>
        {entry.stage === 'requesting' && (
          <>
            <dt>{t.elapsed}</dt>
            <dd>{t.elapsedOf(formatDuration(elapsed), formatTimeout(data.timeoutMs))}</dd>
          </>
        )}
        <dt>{t.attempt}</dt>
        <dd>{t.attemptOf(entry.attempt, entry.maxAttempts)}</dd>
        {entry.nextAttemptAt && (
          <>
            <dt>{t.nextAttempt}</dt>
            <dd>{formatWarsaw(entry.nextAttemptAt)}</dd>
          </>
        )}
        {entry.lastReason && (
          <>
            <dt>{t.previousFailure}</dt>
            <dd>{t.reasons[entry.lastReason]}</dd>
          </>
        )}
      </dl>
    </div>
  );
}

function History({ entry }: { entry: AnalysisHistoryEntry }) {
  return (
    <li className={styles.item}>
      <Link to={`/okazje/${entry.opportunityId}`}>{entry.title}</Link>
      <dl className={styles.facts}>
        <dt>{t.stage}</dt>
        <dd>{t.outcomes[entry.outcome]}</dd>
        {entry.reason && (
          <>
            <dt>{t.reason}</dt>
            <dd>{t.reasons[entry.reason]}</dd>
          </>
        )}
        <dt>{t.model}</dt>
        <dd>
          {entry.provider} · {entry.model}
        </dd>
        <dt>{t.finished}</dt>
        <dd>
          {formatWarsaw(entry.finishedAt)} · {entry.reused ? t.reused : t.attempts(entry.attempts)}
        </dd>
      </dl>
    </li>
  );
}

function Host({ data }: { data: AnalysisActivity }) {
  const { temperatureC, load1, cpuCount, measuredAt } = data.host;
  const when = t.measuredAt(formatWarsaw(measuredAt));
  return (
    <dl className={styles.facts}>
      <dt>{t.temperature}</dt>
      <dd>
        {temperatureC === null ? t.unavailable : `${formatNumber(temperatureC, 1)} °C`}
        <span className={styles.meta}>{when}</span>
      </dd>
      <dt>{t.load}</dt>
      <dd>
        {load1 === null ? t.unavailable : t.loadValue(formatNumber(load1, 2), cpuCount)}
        <span className={styles.meta}>{when}</span>
      </dd>
    </dl>
  );
}

function Controls({ data, onDone }: { data: AnalysisActivity; onDone: () => void }) {
  const [busy, setBusy] = useState<'cancel' | 'resume' | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const run = (kind: 'cancel' | 'resume') => {
    setBusy(kind);
    setMessage(null);
    const action = kind === 'cancel' ? cancelAnalysis() : resumeAnalysis();
    action.then(
      (result) => {
        if ('cancelled' in result && !result.cancelled) setMessage(t.cancelledNothing);
        setBusy(null);
        onDone();
      },
      () => {
        setMessage(t.actionFailed);
        setBusy(null);
      },
    );
  };

  return (
    <div className={styles.section}>
      <div className={styles.actions}>
        <button type="button" disabled={busy !== null} onClick={() => run('cancel')}>
          {busy === 'cancel' ? t.cancelling : t.cancel}
        </button>
        {data.paused && (
          <button type="button" disabled={busy !== null} onClick={() => run('resume')}>
            {busy === 'resume' ? t.resuming : t.resume}
          </button>
        )}
      </div>
      {data.backendMayContinue && <p className={styles.meta}>{t.backendCaveat}</p>}
      {message && (
        <p role="alert" className={styles.error}>
          {message}
        </p>
      )}
    </div>
  );
}

function Ready({
  data,
  stale,
  receivedAt,
  refresh,
}: {
  data: AnalysisActivity;
  stale: boolean;
  receivedAt: number;
  refresh: () => void;
}) {
  const now = useServerNow(data, receivedAt);
  const hidden = data.queued.total - data.queued.items.length;
  return (
    <>
      {stale && (
        <p role="alert" className={styles.error}>
          {t.refreshFailed}
        </p>
      )}
      {data.paused && (
        <p role="status" className={styles.paused}>
          {t.pausedMessage}
        </p>
      )}
      <Controls data={data} onDone={refresh} />
      <section className={styles.section} aria-labelledby="analysis-active">
        <h2 id="analysis-active">{t.activeTitle}</h2>
        <Active data={data} now={now} />
      </section>
      <section className={styles.section} aria-labelledby="analysis-queue">
        <h2 id="analysis-queue">{t.queueTitle}</h2>
        {data.queued.total === 0 ? (
          <p>{t.queueEmpty}</p>
        ) : (
          <>
            <p>{t.queueTotal(data.queued.total)}</p>
            <ul className={styles.list}>
              {data.queued.items.map((item) => (
                <li key={item.opportunityId} className={styles.item}>
                  <Link to={`/okazje/${item.opportunityId}`}>{item.title}</Link>
                </li>
              ))}
            </ul>
            {hidden > 0 && <p className={styles.meta}>{t.queueMore(hidden)}</p>}
          </>
        )}
      </section>
      <section className={styles.section} aria-labelledby="analysis-history">
        <h2 id="analysis-history">{t.historyTitle}</h2>
        <p className={styles.meta}>{t.historyNote}</p>
        {data.history.length === 0 ? (
          <p>{t.historyEmpty}</p>
        ) : (
          <ul className={styles.list}>
            {data.history.map((entry, index) => (
              <History key={`${entry.opportunityId}-${entry.finishedAt}-${index}`} entry={entry} />
            ))}
          </ul>
        )}
      </section>
      <section className={styles.section} aria-labelledby="analysis-host">
        <h2 id="analysis-host">{t.hostTitle}</h2>
        <Host data={data} />
      </section>
    </>
  );
}

export function AnalysisPage() {
  const { load, refresh } = useActivity();
  return (
    <section>
      <h2>{t.title}</h2>
      {load.state === 'loading' && <p role="status">{t.loading}</p>}
      {load.state === 'error' && (
        <p role="alert" className={styles.error}>
          {t.loadFailed}
        </p>
      )}
      {load.state === 'ready' && (
        <Ready data={load.data} stale={load.stale} receivedAt={load.receivedAt} refresh={refresh} />
      )}
    </section>
  );
}
