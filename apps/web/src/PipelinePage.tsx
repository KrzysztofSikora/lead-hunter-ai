import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import type { PipelineItem, PipelineResponse } from '@lead-hunter/contracts';
import styles from './PipelinePage.module.css';
import { getPipeline } from './api/pipeline.js';
import { formatMinor, strings } from './strings.pl.js';
import { formatCalendarDate } from './warsawTime.js';

const t = strings.pipeline;

type Load = { state: 'loading' } | { state: 'error' } | { state: 'ready'; data: PipelineResponse };

function useLoad(): Load {
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  useEffect(() => {
    let active = true;
    getPipeline().then(
      (data) => active && setLoad({ state: 'ready', data }),
      () => active && setLoad({ state: 'error' }),
    );
    return () => {
      active = false;
    };
  }, []);
  return load;
}

function Item({ item }: { item: PipelineItem }) {
  return (
    <li className={styles.item}>
      <Link to={`/okazje/${item.id}`}>{item.title}</Link>
      <span className={styles.meta}>
        {[
          item.score === null ? null : strings.opportunities.score(item.score),
          item.followUpOn ? t.followUp(formatCalendarDate(item.followUpOn)) : null,
          ...item.paid.map((sum) => formatMinor(sum.totalMinor, sum.currency)),
        ]
          .filter((part) => part !== null)
          .join(' · ')}
      </span>
    </li>
  );
}

/** S-08 D-8: follow-ups due today or overdue, shown on the start view until S-13's Today brief. */
export function DueFollowUps() {
  const load = useLoad();
  if (load.state === 'loading') return null;
  if (load.state === 'error') {
    return (
      <p role="alert" className={styles.error}>
        {t.dueLoadFailed}
      </p>
    );
  }
  return (
    <section aria-labelledby="due-title">
      <h2 id="due-title">{t.dueTitle}</h2>
      {load.data.followUpsDue.length === 0 ? (
        <p className={styles.muted}>{t.dueNone}</p>
      ) : (
        <ul className={styles.list}>
          {load.data.followUpsDue.map((item) => (
            <Item key={item.id} item={item} />
          ))}
        </ul>
      )}
    </section>
  );
}

/** S-08 D-11: the funnel as a simple list of stages. */
export function PipelinePage() {
  const load = useLoad();
  if (load.state === 'loading') return <p role="status">{t.loading}</p>;
  if (load.state === 'error') {
    return (
      <p role="alert" className={styles.error}>
        {t.loadFailed}
      </p>
    );
  }
  const { totals, stages, otherCounts } = load.data;
  const label = strings.opportunities.businessStatus;
  return (
    <section>
      <h2>{t.title}</h2>
      <dl className={styles.totals} aria-label={t.totalsTitle}>
        <div className={styles.total}>
          <dt>{t.contacted}</dt>
          <dd>{totals.contacted}</dd>
        </div>
        <div className={styles.total}>
          <dt>{t.won}</dt>
          <dd>{totals.won}</dd>
        </div>
        <div className={styles.total}>
          <dt>{t.paid}</dt>
          <dd>
            {totals.paid}
            {totals.paidSums.length === 0 ? null : (
              <ul className={styles.sums}>
                {totals.paidSums.map((sum) => (
                  <li key={sum.currency}>{formatMinor(sum.totalMinor, sum.currency)}</li>
                ))}
              </ul>
            )}
          </dd>
        </div>
      </dl>
      {stages.map((stage) => (
        <section key={stage.status} aria-labelledby={`stage-${stage.status}`}>
          <h3 id={`stage-${stage.status}`}>
            {label[stage.status]} ({stage.count})
          </h3>
          {stage.items.length === 0 ? (
            <p className={styles.muted}>{t.emptyStage}</p>
          ) : (
            <ul className={styles.list}>
              {stage.items.map((item) => (
                <Item key={item.id} item={item} />
              ))}
            </ul>
          )}
          {stage.count > stage.items.length && (
            <p className={styles.muted}>
              {t.moreInStage(stage.items.length, stage.count)}{' '}
              <Link to={`/okazje?status=${stage.status}`}>{t.openList}</Link>
            </p>
          )}
        </section>
      ))}
      <h3>{t.countsTitle}</h3>
      <ul className={styles.counts}>
        {otherCounts.map((entry) => (
          <li key={entry.status}>
            <Link to={`/okazje?status=${entry.status}`}>
              {label[entry.status]} ({entry.count})
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
