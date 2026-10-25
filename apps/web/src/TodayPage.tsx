import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import type { DigestItem, DigestToday } from '@lead-hunter/contracts';
import styles from './TodayPage.module.css';
import { Item as FollowUpItem } from './PipelinePage.js';
import { fetchDigest } from './api/digest.js';
import { fetchHealth } from './api/health.js';
import { strings } from './strings.pl.js';
import { formatCalendarDate, formatWarsaw } from './warsawTime.js';

const t = strings.today;
const o = strings.opportunities;

type Health = 'loading' | 'ok' | 'error';
type Load = { state: 'loading' } | { state: 'error' } | { state: 'ready'; data: DigestToday };

function useHealth(): Health {
  const [status, setStatus] = useState<Health>('loading');
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
  return status;
}

function useDigest(): Load {
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  useEffect(() => {
    let active = true;
    fetchDigest().then(
      (data) => active && setLoad({ state: 'ready', data }),
      () => active && setLoad({ state: 'error' }),
    );
    return () => {
      active = false;
    };
  }, []);
  return load;
}

function Entry({ item }: { item: DigestItem }) {
  return (
    <li className={styles.item}>
      [{item.score}/100] <Link to={`/okazje/${item.id}`}>{item.title}</Link>
      {item.demo && <strong className={styles.demo}> · {o.demoBadge}</strong>}
      <span className={styles.meta}>
        {o.categories[item.category]} · {strings.opportunity.evidenceLevels[item.evidenceLevel]}
      </span>
      <span className={styles.meta}>
        {t.nextActionLabel}: {item.nextAction ?? t.nextActionNone}
      </span>
    </li>
  );
}

function SourceErrors({ errors }: { errors: DigestToday['sources']['errors'] }) {
  return (
    <ul>
      {errors.map((error) => (
        <li key={`${error.sourceId}-${error.at}`}>
          {error.source}: {o.sourceFailure[error.reason]}
          {error.httpStatus === undefined ? '' : ` (HTTP ${error.httpStatus})`} (
          {formatWarsaw(error.at)})
        </li>
      ))}
    </ul>
  );
}

function bestNextStep(step: DigestToday['bestNextStep']): string {
  if (step === null) return t.bestNone;
  if (step.kind === 'follow_up')
    return t.bestFollowUp(step.title, formatCalendarDate(step.followUpOn));
  return `${step.title} — ${t.nextActionLabel}: ${step.nextAction}`;
}

function Brief({ data }: { data: DigestToday }) {
  const { sources, llm } = data;
  const checked = sources.ok + sources.error;
  return (
    <>
      <h2>{t.title(formatCalendarDate(data.date))}</h2>
      <p>{t.verification(sources.ok, sources.error, sources.notChecked)}</p>
      <p>{t.newSignals(data.newSignals)}</p>
      <p>{t.newAboveThreshold(data.minScore, data.newAboveThreshold)}</p>

      {data.top.length === 0 ? (
        <div role="status">
          <p>{t.topEmpty}</p>
          <p>{t.sourcesChecked(checked)}</p>
          {sources.errors.length === 0 ? (
            <p>{t.sourceErrorsNone}</p>
          ) : (
            <>
              <p>{t.sourceErrorsTitle}:</p>
              <SourceErrors errors={sources.errors} />
            </>
          )}
        </div>
      ) : (
        <>
          <h3>{t.top(data.top.length)}</h3>
          <ol className={styles.top}>
            {data.top.map((item) => (
              <Entry key={item.id} item={item} />
            ))}
          </ol>
        </>
      )}

      <p>
        <strong>{t.bestNextStep}</strong> {bestNextStep(data.bestNextStep)}
      </p>
      <p>
        {t.cost}
        {llm.inputTokens === null && llm.outputTokens === null
          ? ''
          : ` (${t.tokens(llm.inputTokens, llm.outputTokens)})`}
      </p>

      <section aria-labelledby="due-title">
        <h3 id="due-title">{t.dueTitle}</h3>
        {data.followUpsDue.length === 0 ? (
          <p className={styles.muted}>{t.dueNone}</p>
        ) : (
          <ul className={styles.list}>
            {data.followUpsDue.map((item) => (
              <FollowUpItem key={item.id} item={item} />
            ))}
          </ul>
        )}
      </section>

      {data.top.length > 0 && (
        <section aria-labelledby="errors-title">
          <h3 id="errors-title">{t.sourceErrorsTitle}</h3>
          {sources.errors.length === 0 ? (
            <p className={styles.muted}>{t.sourceErrorsNone}</p>
          ) : (
            <SourceErrors errors={sources.errors} />
          )}
        </section>
      )}

      <section aria-labelledby="weak-title">
        <h3 id="weak-title">{t.weakTitle}</h3>
        <p className={styles.muted}>{t.weakNote}</p>
        {data.weakSignals.length === 0 ? (
          <p className={styles.muted}>{t.weakNone}</p>
        ) : (
          <ul className={styles.list}>
            {data.weakSignals.map((item) => (
              <Entry key={item.id} item={item} />
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

/** S-13: the daily brief in the order of PRD brief §11.1. */
export function TodayPage() {
  const health = useHealth();
  const load = useDigest();
  return (
    <section>
      <p role="status" className={health === 'error' ? styles.error : styles.status}>
        {strings.status[health]}
      </p>
      {load.state === 'loading' && <p role="status">{t.loading}</p>}
      {load.state === 'error' && (
        <p role="alert" className={styles.error}>
          {t.loadFailed}
        </p>
      )}
      {load.state === 'ready' && <Brief data={load.data} />}
    </section>
  );
}
