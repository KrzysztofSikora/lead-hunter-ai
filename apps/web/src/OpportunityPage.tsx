import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import type { ActivityEvent, OpportunityDetail } from '@lead-hunter/contracts';
import styles from './OpportunityPage.module.css';
import { CardActions } from './CardActions.js';
import { requestAnalysis } from './api/analysis.js';
import { getOpportunity } from './api/opportunities.js';
import { buildCard, type CardItem, type CardSection } from './opportunityCard.js';
import { strings } from './strings.pl.js';
import { formatUsd } from './usd.js';
import { formatWarsaw } from './warsawTime.js';

const t = strings.opportunity;
const list = strings.opportunities;

type Load =
  | { state: 'loading' }
  | { state: 'error' }
  | { state: 'missing' }
  | { state: 'ready'; data: OpportunityDetail };

/** Source text is always rendered as text (React escaping), never as HTML. */
export function OpportunityPage() {
  const { id } = useParams();
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [reloads, setReloads] = useState(0);

  useEffect(() => {
    let active = true;
    const numeric = Number(id);
    if (!Number.isInteger(numeric) || numeric < 1) {
      setLoad({ state: 'missing' });
      return;
    }
    setLoad({ state: 'loading' });
    getOpportunity(numeric).then(
      (data) => active && setLoad(data ? { state: 'ready', data } : { state: 'missing' }),
      () => active && setLoad({ state: 'error' }),
    );
    return () => {
      active = false;
    };
  }, [id, reloads]);

  return (
    <section>
      <p>
        <Link to="/okazje">{t.back}</Link>
      </p>
      {load.state === 'loading' && <p role="status">{t.loading}</p>}
      {load.state === 'missing' && <p role="alert">{t.notFound}</p>}
      {load.state === 'error' && (
        <p role="alert" className={styles.error}>
          {t.loadFailed}
        </p>
      )}
      {load.state === 'ready' && (
        <Detail
          data={load.data}
          onChange={(data) => setLoad({ state: 'ready', data })}
          onRequested={() => setReloads((n) => n + 1)}
        />
      )}
    </section>
  );
}

const TAG_CLASS = {
  source: styles.tagSource,
  inference: styles.tagInference,
  estimate: styles.tagEstimate,
  rules: styles.tagRules,
  unknown: styles.tagUnknown,
} as const;

function Detail({
  data,
  onChange,
  onRequested,
}: {
  data: OpportunityDetail;
  onChange: (data: OpportunityDetail) => void;
  onRequested: () => void;
}) {
  const analysis = data.latestAnalysis;
  return (
    <>
      <h2>{data.source.title}</h2>
      {analysis?.demo && !data.prefilter?.rule && (
        <p role="note" className={styles.demo}>
          <strong>{t.demoBanner}</strong>
        </p>
      )}
      {analysis && !data.prefilter?.rule && (
        <p className={styles.meta}>
          {t.provider}: {analysis.provider} ({analysis.model}) · {t.analysedAt}{' '}
          {formatWarsaw(analysis.createdAt)}
        </p>
      )}
      {analysis && !data.prefilter?.rule && !analysis.demo && (
        <p className={styles.meta}>
          {analysis.reusedFromAnalysisId !== null
            ? t.reusedFrom
            : analysis.costMicroUsd !== null
              ? t.cost(formatUsd(analysis.costMicroUsd))
              : t.costUnknown(analysis.inputTokens, analysis.outputTokens)}
        </p>
      )}
      {analysis?.status === 'FAILED' && (
        <p role="alert" className={styles.error}>
          {t.failedReason}: {analysis.error}
        </p>
      )}
      {analysis && !data.prefilter?.rule && (
        <RequestButton
          id={data.id}
          force={analysis.status === 'COMPLETE'}
          label={analysis.status === 'COMPLETE' ? t.reanalyse : t.retry}
          onRequested={onRequested}
        />
      )}
      <div className={styles.card}>
        {buildCard(data).map((section, index) => (
          <Section
            key={section.key}
            section={section}
            number={index + 1}
            data={data}
            onChange={onChange}
          />
        ))}
      </div>
      {data.evidence.length > 0 && (
        <>
          <h3>{t.evidenceSection}</h3>
          <ul className={styles.evidence}>
            {data.evidence.map((item) => (
              <li key={item.id}>
                <strong>{t.evidenceTypes[item.type]}</strong> · {formatWarsaw(item.extractedAt)}
                {item.url && (
                  <div>
                    <a href={item.url} rel="noopener noreferrer nofollow" target="_blank">
                      {item.url}
                    </a>
                  </div>
                )}
                <pre className={styles.text}>{item.sourceFact}</pre>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

function Section({
  section,
  number,
  data,
  onChange,
}: {
  section: CardSection;
  number: number;
  data: OpportunityDetail;
  onChange: (data: OpportunityDetail) => void;
}) {
  return (
    <section className={`${styles.element} ${styles[`el_${section.key}`] ?? ''}`}>
      <h3>
        {number}. {section.title}
      </h3>
      {section.emptyReason && <p className={styles.emptyReason}>{section.emptyReason}</p>}
      {section.key === 'actions' && <CardActions data={data} onChange={onChange} />}
      {section.items.length > 0 && (
        <dl className={styles.facts}>
          {section.items.map((item) => (
            <Row key={item.id} item={item} />
          ))}
        </dl>
      )}
      {section.events && <History events={section.events} createdAt={data.createdAt} />}
    </section>
  );
}

function Row({ item }: { item: CardItem }) {
  return (
    <>
      <dt>
        {item.label}
        {item.tag && (
          <>
            {' '}
            <span className={`${styles.tag} ${TAG_CLASS[item.tag]}`}>{t.tags[item.tag]}</span>
          </>
        )}
      </dt>
      <dd>
        <Value item={item} />
      </dd>
    </>
  );
}

function Value({ item }: { item: CardItem }) {
  const { value } = item;
  if (value === null) return <span className={styles.none}>{t.tags.unknown}</span>;
  if (Array.isArray(value)) {
    return (
      <ul className={styles.plain}>
        {value.map((entry, index) => (
          <li key={index}>{entry}</li>
        ))}
      </ul>
    );
  }
  if (item.href) {
    return (
      <a href={item.href} rel="noopener noreferrer nofollow" target="_blank" className={styles.url}>
        {value}
      </a>
    );
  }
  if (item.more) {
    return (
      <>
        <pre className={styles.text}>{value}</pre>
        <details>
          <summary>{t.items.showAll}</summary>
          <pre className={styles.text}>{item.more}</pre>
        </details>
      </>
    );
  }
  return <>{value}</>;
}

function History({ events, createdAt }: { events: ActivityEvent[]; createdAt: string }) {
  const h = t.history;
  return (
    <ul className={styles.plain}>
      {events.map((event) => (
        <li key={event.id}>
          <strong>{formatWarsaw(event.occurredAt)}</strong> ·{' '}
          {event.type === 'NOTE' ? h.note : h.statusChange} ({h[event.actor]})
          {event.type === 'STATUS_CHANGE' && event.toStatus && (
            <>
              {': '}
              {event.fromStatus && `${list.businessStatus[event.fromStatus]} → `}
              {list.businessStatus[event.toStatus]}
            </>
          )}
          {event.reason && ` — ${h.reason}: ${t.actions.reasons[event.reason]}`}
          {event.cause?.kind === 'prefilter' &&
            ` — ${h.prefilter(strings.prefilterRules[event.cause.rule])}`}
          {event.cause?.kind === 'insufficient_data' && ` — ${h.insufficientData}`}
          {event.note && <div className={styles.text}>{event.note}</div>}
        </li>
      ))}
      <li>
        <strong>{formatWarsaw(createdAt)}</strong> · {t.detectedEntry}
      </li>
    </ul>
  );
}

function RequestButton({
  id,
  force,
  label,
  onRequested,
}: {
  id: number;
  force: boolean;
  label: string;
  onRequested: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const reload = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(reload.current), []);
  const press = () => {
    setBusy(true);
    setMessage(null);
    requestAnalysis(id, force).then(
      (outcome) => {
        setBusy(false);
        setMessage(
          outcome === 'queued'
            ? t.requestQueued
            : outcome === 'prefiltered'
              ? t.requestPrefiltered
              : outcome === 'not_configured'
                ? t.requestNotConfigured
                : t.notFound,
        );
        if (outcome === 'queued') reload.current = setTimeout(onRequested, 1500);
      },
      () => {
        setBusy(false);
        setMessage(t.requestFailed);
      },
    );
  };
  return (
    <p>
      <button type="button" onClick={press} disabled={busy}>
        {label}
      </button>
      {message && <span role="status"> {message}</span>}
    </p>
  );
}
