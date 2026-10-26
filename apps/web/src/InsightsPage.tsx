import { useEffect, useState } from 'react';
import type { Insights, InsightsMetrics } from '@lead-hunter/contracts';
import styles from './InsightsPage.module.css';
import { getInsights, type InsightsPeriod } from './api/insights.js';
import { formatMinor, strings } from './strings.pl.js';
import { formatCalendarDate } from './warsawTime.js';

const t = strings.insights;

type Kind = 'week' | 'month';
type Load = { state: 'loading' } | { state: 'error' } | { state: 'ready'; data: Insights };

/** `key` undefined asks for the current period of that kind. */
function useLoad(kind: Kind, key: string | undefined): Load {
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  useEffect(() => {
    let active = true;
    setLoad({ state: 'loading' });
    const period: InsightsPeriod =
      key === undefined ? {} : kind === 'week' ? { week: key } : { month: key };
    getInsights(period).then(
      (data) => active && setLoad({ state: 'ready', data }),
      () => active && setLoad({ state: 'error' }),
    );
    return () => {
      active = false;
    };
  }, [kind, key]);
  return load;
}

/** FR-19 AC2: a rate or a sum that cannot be computed reads "brak danych", never 0. */
function rateText(replies: InsightsMetrics['replies']): string {
  return replies.rate === null ? t.noData : `${Math.round(replies.rate * 100)} %`;
}

function Sums({ sums }: { sums: { currency: string; totalMinor: number }[] }) {
  if (sums.length === 0) return <>{t.noData}</>;
  return (
    <ul className={styles.sums}>
      {sums.map((sum) => (
        <li key={sum.currency}>{formatMinor(sum.totalMinor, sum.currency)}</li>
      ))}
    </ul>
  );
}

function Totals({
  metrics,
  transitionsTo,
}: {
  metrics: InsightsMetrics;
  transitionsTo: Insights['transitionsTo'];
}) {
  const { replies } = metrics;
  const known = replies.replied + replies.noReply;
  const label = strings.opportunities.businessStatus;
  return (
    <dl className={styles.totals} aria-label={t.totalsTitle}>
      <div className={styles.total}>
        <dt>{t.transitions}</dt>
        <dd>
          {metrics.transitions}
          {transitionsTo.length > 0 && (
            <ul className={styles.sums}>
              {transitionsTo.map((entry) => (
                <li key={entry.status}>{t.transitionsTo(label[entry.status], entry.count)}</li>
              ))}
            </ul>
          )}
        </dd>
      </div>
      <div className={styles.total}>
        <dt>{t.offersSent}</dt>
        <dd>{metrics.offersSent}</dd>
      </div>
      <div className={styles.total}>
        <dt>{t.contacted}</dt>
        <dd>{metrics.contacted}</dd>
      </div>
      <div className={styles.total}>
        <dt>{t.replyRate}</dt>
        <dd>
          {rateText(replies)}
          {metrics.contacted > 0 && (
            <div className={styles.sub}>
              {t.replyLine(replies.replied, known, replies.awaiting)}
            </div>
          )}
        </dd>
      </div>
      <div className={styles.total}>
        <dt>{t.meetings}</dt>
        <dd>{metrics.meetings}</dd>
      </div>
      <div className={styles.total}>
        <dt>{t.wins}</dt>
        <dd>{metrics.wins}</dd>
      </div>
      <div className={styles.total}>
        <dt>{t.payments}</dt>
        <dd>
          {metrics.payments.count}
          <Sums sums={metrics.payments.sums} />
        </dd>
      </div>
    </dl>
  );
}

function GroupTable({
  title,
  rows,
}: {
  title: string;
  rows: { key: string; name: string; metrics: InsightsMetrics }[];
}) {
  return (
    <section aria-label={title}>
      <h3>{title}</h3>
      {rows.length === 0 ? (
        <p className={styles.muted}>{t.groupEmpty}</p>
      ) : (
        <div className={styles.scroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">{t.colGroup}</th>
                <th scope="col">{t.transitions}</th>
                <th scope="col">{t.offersSent}</th>
                <th scope="col">{t.contacted}</th>
                <th scope="col">{t.replyRate}</th>
                <th scope="col">{t.meetings}</th>
                <th scope="col">{t.wins}</th>
                <th scope="col">{t.payments}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ key, name, metrics }) => (
                <tr key={key}>
                  <th scope="row">{name}</th>
                  <td>{metrics.transitions}</td>
                  <td>{metrics.offersSent}</td>
                  <td>{metrics.contacted}</td>
                  <td>{rateText(metrics.replies)}</td>
                  <td>{metrics.meetings}</td>
                  <td>{metrics.wins}</td>
                  <td>
                    {metrics.payments.count}
                    <Sums sums={metrics.payments.sums} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** D-10: shown only when the operator entered time or costs (FR-19 AC3). */
function Work({ work }: { work: Insights['work'] }) {
  if (work.minutes === null && work.costs.length === 0) return null;
  return (
    <section aria-label={t.workTitle}>
      <h3>{t.workTitle}</h3>
      <dl className={styles.totals}>
        {work.minutes !== null && (
          <div className={styles.total}>
            <dt>{t.workMinutes}</dt>
            <dd>{t.hoursMinutes(work.minutes)}</dd>
          </div>
        )}
        {work.costs.length > 0 && (
          <>
            <div className={styles.total}>
              <dt>{t.workCosts}</dt>
              <dd>
                <Sums sums={work.costs} />
              </dd>
            </div>
            <div className={styles.total}>
              <dt>{t.workNet}</dt>
              <dd>
                <Sums sums={work.net} />
              </dd>
            </div>
          </>
        )}
      </dl>
    </section>
  );
}

/** S-14 D-12: week and month with previous/next, numbers from recorded facts only. */
export function InsightsPage() {
  const [kind, setKind] = useState<Kind>('week');
  const [key, setKey] = useState<string | undefined>(undefined);
  const load = useLoad(kind, key);

  const choose = (next: Kind) => {
    setKind(next);
    setKey(undefined);
  };

  const data = load.state === 'ready' ? load.data : null;
  const source = (group: Insights['bySource'][number]) =>
    group.source.kind === 'manual'
      ? { key: 'manual', name: t.manualSource }
      : {
          key: `source-${group.source.id}`,
          name: `${group.source.name} (${strings.opportunities.sourceTypes[group.source.type]})`,
        };

  return (
    <section>
      <h2>{t.title}</h2>
      <div className={styles.tabs} role="group" aria-label={t.kindLabel}>
        {(['week', 'month'] as const).map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={kind === value}
            className={kind === value ? styles.active : undefined}
            onClick={() => choose(value)}
          >
            {t[value]}
          </button>
        ))}
      </div>
      {load.state === 'loading' && <p role="status">{t.loading}</p>}
      {load.state === 'error' && (
        <p role="alert" className={styles.error}>
          {t.loadFailed}
        </p>
      )}
      {data && (
        <>
          <div className={styles.pager}>
            <button
              type="button"
              disabled={data.period.previous === null}
              onClick={() => setKey(data.period.previous ?? undefined)}
            >
              {t.previous}
            </button>
            <strong>
              {data.period.key}
              {data.period.current ? ` (${t.current})` : ''}
            </strong>
            <button
              type="button"
              disabled={data.period.current || data.period.next === null}
              onClick={() => setKey(data.period.next ?? undefined)}
            >
              {t.next}
            </button>
            <span className={styles.range}>
              {t.range(formatCalendarDate(data.period.from), formatCalendarDate(data.period.to))}
            </span>
          </div>
          <Totals metrics={data.totals} transitionsTo={data.transitionsTo} />
          <p className={styles.muted}>{t.replyNote}</p>
          <Work work={data.work} />
          <GroupTable
            title={t.bySource}
            rows={data.bySource.map((group) => ({ ...source(group), metrics: group.metrics }))}
          />
          <GroupTable
            title={t.byCategory}
            rows={data.byCategory.map((group) => ({
              key: group.category ?? 'none',
              name:
                group.category === null
                  ? t.uncategorised
                  : strings.opportunities.categories[group.category],
              metrics: group.metrics,
            }))}
          />
        </>
      )}
    </section>
  );
}
